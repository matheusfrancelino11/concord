package models

import (
	"time"

	"concord/internal/snowflake"
)

// Guild represents a Discord-like server in PostgreSQL
type Guild struct {
	ID           snowflake.ID  `json:"id"`
	Name         string        `json:"name"`
	Icon         *string       `json:"icon"`
	OwnerID      snowflake.ID  `json:"owner_id"`
	AFKChannelID *snowflake.ID `json:"afk_channel_id"`
	AFKTimeout   int           `json:"afk_timeout"`
	CreatedAt    time.Time     `json:"created_at"`
}

// CreateGuildRequest is the payload for POST /guilds
type CreateGuildRequest struct {
	Name string  `json:"name"`
	Icon *string `json:"icon"`
}

// GuildSummaryResponse is the concise representation for GET /guilds
type GuildSummaryResponse struct {
	ID        snowflake.ID `json:"id"`
	Name      string       `json:"name"`
	Icon      *string      `json:"icon"`
	OwnerID   snowflake.ID `json:"owner_id"`
	CreatedAt time.Time    `json:"created_at"`
}

// Role represents a guild permission role
type Role struct {
	ID          snowflake.ID `json:"id"`
	GuildID     snowflake.ID `json:"guild_id"`
	Name        string       `json:"name"`
	Permissions int64        `json:"permissions"`
	Position    int          `json:"position"`
	Color       int          `json:"color"`
	Hoist       bool         `json:"hoist"`
	Mentionable bool         `json:"mentionable"`
	Managed     bool         `json:"managed"`
}

// RoleResponse formats the role for API responses
type RoleResponse struct {
	ID          snowflake.ID `json:"id"`
	GuildID     snowflake.ID `json:"guild_id"`
	Name        string       `json:"name"`
	Permissions string       `json:"permissions"`
	Position    int          `json:"position"`
	Color       int          `json:"color"`
	Hoist       bool         `json:"hoist"`
	Mentionable bool         `json:"mentionable"`
	Managed     bool         `json:"managed"`
}

// GuildDetailResponse represents the complete server payload with channels and roles
type GuildDetailResponse struct {
	ID           snowflake.ID      `json:"id"`
	Name         string            `json:"name"`
	Icon         *string           `json:"icon"`
	OwnerID      snowflake.ID      `json:"owner_id"`
	AFKChannelID *snowflake.ID     `json:"afk_channel_id"`
	AFKTimeout   int               `json:"afk_timeout"`
	CreatedAt    time.Time         `json:"created_at"`
	Channels     []ChannelResponse `json:"channels"`
	Roles        []RoleResponse    `json:"roles"`
}

// Member represents the membership record
type Member struct {
	GuildID  snowflake.ID `json:"guild_id"`
	UserID   snowflake.ID `json:"user_id"`
	Nick     *string      `json:"nick"`
	JoinedAt time.Time    `json:"joined_at"`
	Deaf     bool         `json:"deaf"`
	Mute     bool         `json:"mute"`
	Flags    int          `json:"flags"`
}

// MemberResponse wraps member with nested user profile
type MemberResponse struct {
	GuildID  snowflake.ID `json:"guild_id"`
	UserID   snowflake.ID `json:"user_id"`
	Nick     *string      `json:"nick"`
	JoinedAt time.Time    `json:"joined_at"`
	Deaf     bool         `json:"deaf"`
	Mute     bool         `json:"mute"`
	Flags    int          `json:"flags"`
	User     UserSummary  `json:"user"`
}

// UserSummary is the concise user profile embedded in member responses
type UserSummary struct {
	ID         snowflake.ID `json:"id"`
	Username   string       `json:"username"`
	GlobalName *string      `json:"global_name"`
	Avatar     *string      `json:"avatar"`
}
