package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
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
