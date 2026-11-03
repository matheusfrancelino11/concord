package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"concord/internal/models"
	"concord/internal/snowflake"
)

var (
	ErrChannelNotFound         = errors.New("channel not found")
	ErrInvalidChannelName      = errors.New("channel name must be between 1 and 100 characters")
	ErrInvalidChannelType      = errors.New("invalid channel type (must be 0 for text, 2 for voice, or 4 for category)")
	ErrCannotDeleteLastChannel = errors.New("cannot delete the last remaining text channel")
)

// ChannelService defines the interface for channel operations
type ChannelService interface {
	CreateChannel(ctx context.Context, callerID snowflake.ID, guildID snowflake.ID, req *models.CreateChannelRequest) (*models.ChannelResponse, error)
	ListGuildChannels(ctx context.Context, callerID snowflake.ID, guildID snowflake.ID) ([]models.ChannelResponse, error)
	DeleteChannel(ctx context.Context, callerID snowflake.ID, channelID snowflake.ID) error
	GetOrCreateDMChannel(ctx context.Context, callerID, recipientID snowflake.ID) (*models.ChannelResponse, error)
	ListUserDMChannels(ctx context.Context, callerID snowflake.ID) ([]models.ChannelResponse, error)
	CloseDMChannel(ctx context.Context, callerID, channelID snowflake.ID) error
}

type channelService struct {
	db        *pgxpool.Pool
	snowflake *snowflake.Generator
}

// NewChannelService creates a new ChannelService instance
func NewChannelService(db *pgxpool.Pool, sf *snowflake.Generator) ChannelService {
	return &channelService{
		db:        db,
		snowflake: sf,
	}
}

func (s *channelService) CreateChannel(ctx context.Context, callerID snowflake.ID, guildID snowflake.ID, req *models.CreateChannelRequest) (*models.ChannelResponse, error) {
	// Verify guild existence
	var exists bool
	guildCheck := `SELECT EXISTS(SELECT 1 FROM guilds WHERE id = $1)`
	if err := s.db.QueryRow(ctx, guildCheck, guildID).Scan(&exists); err != nil {
		return nil, fmt.Errorf("check guild: %w", err)
	}
	if !exists {
		return nil, ErrGuildNotFound
	}

	// Verify caller membership
	var isMember bool
	memberCheck := `SELECT EXISTS(SELECT 1 FROM members WHERE guild_id = $1 AND user_id = $2)`
	if err := s.db.QueryRow(ctx, memberCheck, guildID, callerID).Scan(&isMember); err != nil {
		return nil, fmt.Errorf("check member: %w", err)
	}
	if !isMember {
		return nil, ErrForbidden
	}

	// Validate channel type
	if req.Type != models.ChannelTypeText && req.Type != models.ChannelTypeVoice && req.Type != models.ChannelTypeCategory {
		return nil, ErrInvalidChannelType
	}

	// Normalize name
	name := strings.TrimSpace(req.Name)
	if req.Type == models.ChannelTypeText {
		name = strings.ToLower(name)
		fields := strings.Fields(name)
		name = strings.Join(fields, "-")
	}

	runes := utf8.RuneCountInString(name)
	if runes < 1 || runes > 100 {
		return nil, ErrInvalidChannelName
	}

	var bitrate *int
	var userLimit *int
	if req.Type == models.ChannelTypeVoice {
		b := 64000
		if req.Bitrate != nil && *req.Bitrate >= 8000 && *req.Bitrate <= 384000 {
			b = *req.Bitrate
		}
		bitrate = &b

		ul := 0
		if req.UserLimit != nil && *req.UserLimit >= 0 && *req.UserLimit <= 99 {
			ul = *req.UserLimit
		}
		userLimit = &ul
	}

	channelID, err := s.snowflake.NextID()
	if err != nil {
		return nil, fmt.Errorf("generate channel id: %w", err)
	}

	var position int
	posSQL := `SELECT COALESCE(MAX(position), -1) + 1 FROM channels WHERE guild_id = $1`
	if err := s.db.QueryRow(ctx, posSQL, guildID).Scan(&position); err != nil {
		return nil, fmt.Errorf("compute position: %w", err)
	}

	insertSQL := `
		INSERT INTO channels (id, guild_id, type, name, topic, position, parent_id, bitrate, user_limit, rate_limit, nsfw, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, FALSE, NOW())
		RETURNING id, guild_id, type, name, topic, position, parent_id, bitrate, user_limit, rate_limit, nsfw, created_at
	`
	var c models.Channel
	err = s.db.QueryRow(ctx, insertSQL,
		channelID,
		guildID,
		req.Type,
		name,
		req.Topic,
		position,
		req.ParentID,
		bitrate,
		userLimit,
	).Scan(
		&c.ID,
		&c.GuildID,
		&c.Type,
		&c.Name,
		&c.Topic,
		&c.Position,
		&c.ParentID,
		&c.Bitrate,
		&c.UserLimit,
		&c.RateLimit,
		&c.NSFW,
		&c.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("insert channel: %w", err)
	}

	return &models.ChannelResponse{
		ID:        c.ID,
		GuildID:   c.GuildID,
		Type:      c.Type,
		Name:      c.Name,
		Topic:     c.Topic,
		Position:  c.Position,
		ParentID:  c.ParentID,
		Bitrate:   c.Bitrate,
		UserLimit: c.UserLimit,
		RateLimit: c.RateLimit,
		NSFW:      c.NSFW,
		CreatedAt: c.CreatedAt,
	}, nil
}

func (s *channelService) ListGuildChannels(ctx context.Context, callerID snowflake.ID, guildID snowflake.ID) ([]models.ChannelResponse, error) {
	var exists bool
	guildCheck := `SELECT EXISTS(SELECT 1 FROM guilds WHERE id = $1)`
	if err := s.db.QueryRow(ctx, guildCheck, guildID).Scan(&exists); err != nil {
		return nil, fmt.Errorf("check guild: %w", err)
	}
	if !exists {
		return nil, ErrGuildNotFound
	}

	var isMember bool
	memberCheck := `SELECT EXISTS(SELECT 1 FROM members WHERE guild_id = $1 AND user_id = $2)`
	if err := s.db.QueryRow(ctx, memberCheck, guildID, callerID).Scan(&isMember); err != nil {
		return nil, fmt.Errorf("check member: %w", err)
	}
	if !isMember {
		return nil, ErrForbidden
	}

	query := `
		SELECT id, guild_id, type, name, topic, position, parent_id, bitrate, user_limit, rate_limit, nsfw, created_at
		FROM channels
		WHERE guild_id = $1
		ORDER BY position ASC, id ASC
	`
	rows, err := s.db.Query(ctx, query, guildID)
	if err != nil {
		return nil, fmt.Errorf("query channels: %w", err)
	}
	defer rows.Close()

	channels := make([]models.ChannelResponse, 0)
	for rows.Next() {
		var c models.ChannelResponse
		if err := rows.Scan(
			&c.ID,
			&c.GuildID,
			&c.Type,
			&c.Name,
			&c.Topic,
			&c.Position,
			&c.ParentID,
			&c.Bitrate,
			&c.UserLimit,
			&c.RateLimit,
			&c.NSFW,
			&c.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan channel: %w", err)
		}
		channels = append(channels, c)
	}

	return channels, nil
}

func (s *channelService) DeleteChannel(ctx context.Context, callerID snowflake.ID, channelID snowflake.ID) error {
	var guildID snowflake.ID
	var chType int
	channelQuery := `SELECT guild_id, type FROM channels WHERE id = $1`
	if err := s.db.QueryRow(ctx, channelQuery, channelID).Scan(&guildID, &chType); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrChannelNotFound
		}
		return fmt.Errorf("query channel: %w", err)
	}

	var ownerID snowflake.ID
	guildQuery := `SELECT owner_id FROM guilds WHERE id = $1`
	if err := s.db.QueryRow(ctx, guildQuery, guildID).Scan(&ownerID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrGuildNotFound
		}
		return fmt.Errorf("query guild: %w", err)
	}

	// RBAC Invariant: in Milestone 1, only the guild owner may delete channels
	if callerID != ownerID {
		return ErrForbidden
	}

	// Text Channel Invariant: a guild must always retain at least one text channel.
	// No text channel can be deleted if it is the last remaining text channel in the guild,
	// regardless of whether its name is "geral" or custom.
	if chType == models.ChannelTypeText {
		var textChannelCount int
		countSQL := `SELECT COUNT(*) FROM channels WHERE guild_id = $1 AND type = $2`
		if err := s.db.QueryRow(ctx, countSQL, guildID, models.ChannelTypeText).Scan(&textChannelCount); err != nil {
			return fmt.Errorf("count text channels: %w", err)
		}
		if textChannelCount <= 1 {
			return ErrCannotDeleteLastChannel
		}
	}

	deleteSQL := `DELETE FROM channels WHERE id = $1`
	if _, err := s.db.Exec(ctx, deleteSQL, channelID); err != nil {
		return fmt.Errorf("delete channel: %w", err)
	}

	return nil
}

func (s *channelService) GetOrCreateDMChannel(ctx context.Context, callerID, recipientID snowflake.ID) (*models.ChannelResponse, error) {
	if callerID == recipientID {
		return nil, errors.New("cannot create direct message channel with yourself")
	}

	// Verify recipient exists
	var recipient models.UserResponse
	recipQuery := `SELECT id, username, email, global_name, avatar, flags, created_at FROM users WHERE id = $1`
	err := s.db.QueryRow(ctx, recipQuery, recipientID).Scan(
		&recipient.ID,
		&recipient.Username,
		&recipient.Email,
		&recipient.GlobalName,
		&recipient.Avatar,
		&recipient.Flags,
		&recipient.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("recipient user not found")
		}
		return nil, fmt.Errorf("query recipient: %w", err)
	}

	// Check if DM channel already exists between these two users
	var existingChannelID snowflake.ID
	findQuery := `
		SELECT c.id
		FROM channels c
		JOIN channel_recipients r1 ON c.id = r1.channel_id AND r1.user_id = $1
		JOIN channel_recipients r2 ON c.id = r2.channel_id AND r2.user_id = $2
		WHERE c.type = $3
		LIMIT 1;`
	err = s.db.QueryRow(ctx, findQuery, callerID, recipientID, models.ChannelTypeDM).Scan(&existingChannelID)
	if err == nil {
		name := recipient.Username
		if recipient.GlobalName != nil && *recipient.GlobalName != "" {
			name = *recipient.GlobalName
		}
		return &models.ChannelResponse{
			ID:         existingChannelID,
			GuildID:    0,
			Type:       models.ChannelTypeDM,
			Name:       name,
			CreatedAt:  recipient.CreatedAt,
			Recipients: []models.UserResponse{recipient},
		}, nil
	}

	// Channel doesn't exist, create new
	channelID, err := s.snowflake.NextID()
	if err != nil {
		return nil, fmt.Errorf("generate channel id: %w", err)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	name := recipient.Username
	if recipient.GlobalName != nil && *recipient.GlobalName != "" {
		name = *recipient.GlobalName
	}

	insertChannel := `
		INSERT INTO channels (id, guild_id, type, name, position)
		VALUES ($1, NULL, $2, $3, 0);`
	if _, err := tx.Exec(ctx, insertChannel, channelID, models.ChannelTypeDM, name); err != nil {
		return nil, fmt.Errorf("insert dm channel: %w", err)
	}

	insertRecip := `INSERT INTO channel_recipients (channel_id, user_id) VALUES ($1, $2), ($1, $3);`
	if _, err := tx.Exec(ctx, insertRecip, channelID, callerID, recipientID); err != nil {
		return nil, fmt.Errorf("insert recipients: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit dm tx: %w", err)
	}

	return &models.ChannelResponse{
		ID:         channelID,
		GuildID:    0,
		Type:       models.ChannelTypeDM,
		Name:       name,
		CreatedAt:  time.Now(),
		Recipients: []models.UserResponse{recipient},
	}, nil
}

func (s *channelService) ListUserDMChannels(ctx context.Context, callerID snowflake.ID) ([]models.ChannelResponse, error) {
	query := `
		SELECT c.id, c.type, c.name, c.created_at
		FROM channels c
		JOIN channel_recipients cr ON c.id = cr.channel_id
		WHERE cr.user_id = $1 AND c.type = $2
		ORDER BY c.created_at DESC;`

	rows, err := s.db.Query(ctx, query, callerID, models.ChannelTypeDM)
	if err != nil {
		return nil, fmt.Errorf("query dm channels: %w", err)
	}
	defer rows.Close()

	var result []models.ChannelResponse
	for rows.Next() {
		var c models.ChannelResponse
		if err := rows.Scan(&c.ID, &c.Type, &c.Name, &c.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan dm channel: %w", err)
		}
		c.GuildID = 0
		result = append(result, c)
	}

	// For each DM channel, populate the recipient user info
	for i := range result {
		recipQuery := `
			SELECT u.id, u.username, u.email, u.global_name, u.avatar, u.flags, u.created_at
			FROM users u
			JOIN channel_recipients cr ON u.id = cr.user_id
			WHERE cr.channel_id = $1 AND u.id != $2
			LIMIT 1;`
		var u models.UserResponse
		err := s.db.QueryRow(ctx, recipQuery, result[i].ID, callerID).Scan(
			&u.ID,
			&u.Username,
			&u.Email,
			&u.GlobalName,
			&u.Avatar,
			&u.Flags,
			&u.CreatedAt,
		)
		if err == nil {
			result[i].Recipients = []models.UserResponse{u}
			if u.GlobalName != nil && *u.GlobalName != "" {
				result[i].Name = *u.GlobalName
			} else {
				result[i].Name = u.Username
			}
		}
	}

	if result == nil {
		result = make([]models.ChannelResponse, 0)
	}
	return result, nil
}

func (s *channelService) CloseDMChannel(ctx context.Context, callerID, channelID snowflake.ID) error {
	query := `DELETE FROM channel_recipients WHERE channel_id = $1 AND user_id = $2;`
	res, err := s.db.Exec(ctx, query, channelID, callerID)
	if err != nil {
		return fmt.Errorf("close dm: %w", err)
	}
	if res.RowsAffected() == 0 {
		return ErrChannelNotFound
	}

	var remaining int
	_ = s.db.QueryRow(ctx, `SELECT COUNT(*) FROM channel_recipients WHERE channel_id = $1`, channelID).Scan(&remaining)
	if remaining == 0 {
		_, _ = s.db.Exec(ctx, `DELETE FROM channels WHERE id = $1`, channelID)
	}
	return nil
}
