package models

import (
	"time"

	"concord/internal/snowflake"
)

// Invite represents an invite record in PostgreSQL
type Invite struct {
	Code      string        `json:"code"`
	GuildID   snowflake.ID  `json:"guild_id"`
	ChannelID snowflake.ID  `json:"channel_id"`
	InviterID snowflake.ID  `json:"inviter_id"`
	Uses      int           `json:"uses"`
	MaxUses   int           `json:"max_uses"`
	ExpiresAt *time.Time    `json:"expires_at"`
	CreatedAt time.Time     `json:"created_at"`
}

// CreateInviteRequest is the payload for POST /guilds/:id/invites
type CreateInviteRequest struct {
	ChannelID *snowflake.ID `json:"channel_id,omitempty"`
	MaxUses   int           `json:"max_uses"`
	MaxAge    int           `json:"max_age"` // seconds (0 = never expires)
}

// InviteGuildSummary represents basic guild info returned with an invite
type InviteGuildSummary struct {
	ID          snowflake.ID `json:"id"`
	Name        string       `json:"name"`
	Icon        *string      `json:"icon"`
	MemberCount int          `json:"member_count"`
}

// InviteChannelSummary represents basic channel info returned with an invite
type InviteChannelSummary struct {
	ID   snowflake.ID `json:"id"`
	Name string       `json:"name"`
	Type int          `json:"type"`
}

// InviteResponse represents the full invite details returned by GET /invites/:code
type InviteResponse struct {
	Code      string               `json:"code"`
	GuildID   snowflake.ID         `json:"guild_id"`
	ChannelID snowflake.ID         `json:"channel_id"`
	InviterID snowflake.ID         `json:"inviter_id"`
	Uses      int                  `json:"uses"`
	MaxUses   int                  `json:"max_uses"`
	ExpiresAt *time.Time           `json:"expires_at"`
	CreatedAt time.Time            `json:"created_at"`
	Guild     InviteGuildSummary   `json:"guild"`
	Channel   InviteChannelSummary `json:"channel"`
	Inviter   UserSummary          `json:"inviter"`
}
