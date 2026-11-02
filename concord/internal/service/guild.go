package service

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"concord/internal/models"
	"concord/internal/snowflake"
)

var (
	ErrInvalidGuildName   = errors.New("guild name must be between 2 and 100 characters")
	ErrGuildNotFound      = errors.New("guild not found")
	ErrForbidden          = errors.New("you do not have permission to perform this action")
	ErrOnlyOwnerCanDelete = errors.New("only the guild owner can delete this guild")
)

// GuildService defines the interface for guild operations
type GuildService interface {
	CreateGuild(ctx context.Context, callerID snowflake.ID, req *models.CreateGuildRequest) (*models.GuildDetailResponse, error)
	ListUserGuilds(ctx context.Context, userID snowflake.ID) ([]models.GuildSummaryResponse, error)
	GetGuildDetails(ctx context.Context, callerID snowflake.ID, guildID snowflake.ID) (*models.GuildDetailResponse, error)
	DeleteGuild(ctx context.Context, callerID snowflake.ID, guildID snowflake.ID) error
}

type guildService struct {
	db        *pgxpool.Pool
	snowflake *snowflake.Generator
}

// NewGuildService creates a new GuildService instance
func NewGuildService(db *pgxpool.Pool, sf *snowflake.Generator) GuildService {
	return &guildService{
		db:        db,
		snowflake: sf,
	}
}

func (s *guildService) CreateGuild(ctx context.Context, callerID snowflake.ID, req *models.CreateGuildRequest) (*models.GuildDetailResponse, error) {
	name := strings.TrimSpace(req.Name)
	runes := utf8.RuneCountInString(name)
	if runes < 2 || runes > 100 {
		return nil, ErrInvalidGuildName
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	guildID, err := s.snowflake.NextID()
	if err != nil {
		return nil, fmt.Errorf("generate guild id: %w", err)
	}

	roleID, err := s.snowflake.NextID()
	if err != nil {
		return nil, fmt.Errorf("generate role id: %w", err)
	}

	channelID, err := s.snowflake.NextID()
	if err != nil {
		return nil, fmt.Errorf("generate channel id: %w", err)
	}

	const insertGuildSQL = `
		INSERT INTO guilds (id, name, icon, owner_id, afk_channel_id, afk_timeout, created_at)
		VALUES ($1, $2, $3, $4, NULL, 300, NOW())
		RETURNING id, name, icon, owner_id, afk_channel_id, afk_timeout, created_at
	`
	var g models.Guild
	err = tx.QueryRow(ctx, insertGuildSQL, guildID, name, req.Icon, callerID).Scan(
		&g.ID,
		&g.Name,
		&g.Icon,
		&g.OwnerID,
		&g.AFKChannelID,
		&g.AFKTimeout,
		&g.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("insert guild: %w", err)
	}

	const insertMemberSQL = `
		INSERT INTO members (guild_id, user_id, nick, joined_at, deaf, mute, flags)
		VALUES ($1, $2, NULL, NOW(), FALSE, FALSE, 0)
	`
	if _, err := tx.Exec(ctx, insertMemberSQL, guildID, callerID); err != nil {
		return nil, fmt.Errorf("insert owner member: %w", err)
	}

	const insertRoleSQL = `
		INSERT INTO roles (id, guild_id, name, permissions, position, color, hoist, mentionable, managed)
		VALUES ($1, $2, '@everyone', $3, 0, 0, FALSE, FALSE, FALSE)
		RETURNING id, guild_id, name, permissions, position, color, hoist, mentionable, managed
	`
	var r models.Role
	err = tx.QueryRow(ctx, insertRoleSQL, roleID, guildID, models.DefaultEveryonePermissions).Scan(
		&r.ID,
		&r.GuildID,
		&r.Name,
		&r.Permissions,
		&r.Position,
		&r.Color,
		&r.Hoist,
		&r.Mentionable,
		&r.Managed,
	)
	if err != nil {
		return nil, fmt.Errorf("insert @everyone role: %w", err)
	}

	const insertChannelSQL = `
		INSERT INTO channels (id, guild_id, type, name, topic, position, parent_id, bitrate, user_limit, rate_limit, nsfw, created_at)
		VALUES ($1, $2, 0, 'geral', NULL, 0, NULL, NULL, NULL, 0, FALSE, NOW())
		RETURNING id, guild_id, type, name, topic, position, parent_id, bitrate, user_limit, rate_limit, nsfw, created_at
	`
	var c models.Channel
	err = tx.QueryRow(ctx, insertChannelSQL, channelID, guildID).Scan(
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
		return nil, fmt.Errorf("insert #geral channel: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit tx: %w", err)
	}

	return &models.GuildDetailResponse{
		ID:           g.ID,
		Name:         g.Name,
		Icon:         g.Icon,
		OwnerID:      g.OwnerID,
		AFKChannelID: g.AFKChannelID,
		AFKTimeout:   g.AFKTimeout,
		CreatedAt:    g.CreatedAt,
		Channels: []models.ChannelResponse{
			{
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
			},
		},
		Roles: []models.RoleResponse{
			{
				ID:          r.ID,
				GuildID:     r.GuildID,
				Name:        r.Name,
				Permissions: strconv.FormatInt(r.Permissions, 10),
				Position:    r.Position,
				Color:       r.Color,
				Hoist:       r.Hoist,
				Mentionable: r.Mentionable,
				Managed:     r.Managed,
			},
		},
	}, nil
}

func (s *guildService) ListUserGuilds(ctx context.Context, userID snowflake.ID) ([]models.GuildSummaryResponse, error) {
	query := `
		SELECT g.id, g.name, g.icon, g.owner_id, g.created_at
		FROM guilds g
		JOIN members m ON g.id = m.guild_id
		WHERE m.user_id = $1
		ORDER BY g.created_at ASC
	`
	rows, err := s.db.Query(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("query user guilds: %w", err)
	}
	defer rows.Close()

	guilds := make([]models.GuildSummaryResponse, 0)
	for rows.Next() {
		var g models.GuildSummaryResponse
		if err := rows.Scan(&g.ID, &g.Name, &g.Icon, &g.OwnerID, &g.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan guild: %w", err)
		}
		guilds = append(guilds, g)
	}

	return guilds, nil
}

func (s *guildService) GetGuildDetails(ctx context.Context, callerID snowflake.ID, guildID snowflake.ID) (*models.GuildDetailResponse, error) {
	var g models.Guild
	guildQuery := `
		SELECT id, name, icon, owner_id, afk_channel_id, afk_timeout, created_at
		FROM guilds
		WHERE id = $1
	`
	err := s.db.QueryRow(ctx, guildQuery, guildID).Scan(
		&g.ID,
		&g.Name,
		&g.Icon,
		&g.OwnerID,
		&g.AFKChannelID,
		&g.AFKTimeout,
		&g.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrGuildNotFound
		}
		return nil, fmt.Errorf("query guild: %w", err)
	}

	var isMember bool
	memberQuery := `SELECT EXISTS(SELECT 1 FROM members WHERE guild_id = $1 AND user_id = $2)`
	if err := s.db.QueryRow(ctx, memberQuery, guildID, callerID).Scan(&isMember); err != nil {
		return nil, fmt.Errorf("check member: %w", err)
	}
	if !isMember {
		return nil, ErrForbidden
	}

	channelsQuery := `
		SELECT id, guild_id, type, name, topic, position, parent_id, bitrate, user_limit, rate_limit, nsfw, created_at
		FROM channels
		WHERE guild_id = $1
		ORDER BY position ASC, id ASC
	`
	cRows, err := s.db.Query(ctx, channelsQuery, guildID)
	if err != nil {
		return nil, fmt.Errorf("query channels: %w", err)
	}
	defer cRows.Close()

	channels := make([]models.ChannelResponse, 0)
	for cRows.Next() {
		var c models.ChannelResponse
		if err := cRows.Scan(
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

	rolesQuery := `
		SELECT id, guild_id, name, permissions, position, color, hoist, mentionable, managed
		FROM roles
		WHERE guild_id = $1
		ORDER BY position ASC, id ASC
	`
	rRows, err := s.db.Query(ctx, rolesQuery, guildID)
	if err != nil {
		return nil, fmt.Errorf("query roles: %w", err)
	}
	defer rRows.Close()

	roles := make([]models.RoleResponse, 0)
	for rRows.Next() {
		var r models.Role
		if err := rRows.Scan(
			&r.ID,
			&r.GuildID,
			&r.Name,
			&r.Permissions,
			&r.Position,
			&r.Color,
			&r.Hoist,
			&r.Mentionable,
			&r.Managed,
		); err != nil {
			return nil, fmt.Errorf("scan role: %w", err)
		}
		roles = append(roles, models.RoleResponse{
			ID:          r.ID,
			GuildID:     r.GuildID,
			Name:        r.Name,
			Permissions: strconv.FormatInt(r.Permissions, 10),
			Position:    r.Position,
			Color:       r.Color,
			Hoist:       r.Hoist,
			Mentionable: r.Mentionable,
			Managed:     r.Managed,
		})
	}

	return &models.GuildDetailResponse{
		ID:           g.ID,
		Name:         g.Name,
		Icon:         g.Icon,
		OwnerID:      g.OwnerID,
		AFKChannelID: g.AFKChannelID,
		AFKTimeout:   g.AFKTimeout,
		CreatedAt:    g.CreatedAt,
		Channels:     channels,
		Roles:        roles,
	}, nil
}

func (s *guildService) DeleteGuild(ctx context.Context, callerID snowflake.ID, guildID snowflake.ID) error {
	var ownerID snowflake.ID
	query := `SELECT owner_id FROM guilds WHERE id = $1`
	if err := s.db.QueryRow(ctx, query, guildID).Scan(&ownerID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrGuildNotFound
		}
		return fmt.Errorf("query guild owner: %w", err)
	}

	if ownerID != callerID {
		return ErrOnlyOwnerCanDelete
	}

	deleteSQL := `DELETE FROM guilds WHERE id = $1`
	if _, err := s.db.Exec(ctx, deleteSQL, guildID); err != nil {
		return fmt.Errorf("delete guild: %w", err)
	}

	return nil
}
