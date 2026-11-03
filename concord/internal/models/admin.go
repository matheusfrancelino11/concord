package models

import (
	"time"

	"concord/internal/snowflake"
)

// CreateRoleRequest defines payload to create a new guild role
type CreateRoleRequest struct {
	Name        string  `json:"name"`
	Permissions *string `json:"permissions"`
	Color       *int    `json:"color"`
	Hoist       *bool   `json:"hoist"`
	Mentionable *bool   `json:"mentionable"`
}

// UpdateRoleRequest defines payload to modify an existing guild role
type UpdateRoleRequest struct {
	Name        *string `json:"name"`
	Permissions *string `json:"permissions"`
	Color       *int    `json:"color"`
	Hoist       *bool   `json:"hoist"`
	Mentionable *bool   `json:"mentionable"`
	Position    *int    `json:"position"`
}

// UpdateMemberRequest defines payload to update a guild member
type UpdateMemberRequest struct {
	Nick  *string         `json:"nick"`
	Mute  *bool           `json:"mute"`
	Deaf  *bool           `json:"deaf"`
	Roles *[]snowflake.ID `json:"roles"`
}

// Ban represents a banned user record
type Ban struct {
	GuildID   snowflake.ID `json:"guild_id"`
	UserID    snowflake.ID `json:"user_id"`
	Reason    *string      `json:"reason"`
	CreatedAt time.Time    `json:"created_at"`
}

// BanResponse represents banned user details in API responses
type BanResponse struct {
	User      UserSummary `json:"user"`
	Reason    *string     `json:"reason"`
	CreatedAt time.Time   `json:"created_at"`
}

// CreateBanRequest defines payload to ban a user
type CreateBanRequest struct {
	Reason            *string `json:"reason"`
	DeleteMessageDays *int    `json:"delete_message_days"`
}

// UpdateGuildRequest defines payload to update guild name and icon
type UpdateGuildRequest struct {
	Name *string `json:"name"`
	Icon *string `json:"icon"`
}

// PermissionOverwrite represents a channel permission overwrite record
type PermissionOverwrite struct {
	ChannelID  snowflake.ID `json:"channel_id"`
	TargetID   snowflake.ID `json:"target_id"`
	TargetType int          `json:"target_type"` // 0 = role, 1 = member
	Allow      string       `json:"allow"`
	Deny       string       `json:"deny"`
}

// SetPermissionOverwriteRequest defines payload to create or update a channel overwrite
type SetPermissionOverwriteRequest struct {
	TargetType int     `json:"target_type"` // 0 = role, 1 = member
	Allow      *string `json:"allow"`
	Deny       *string `json:"deny"`
}
