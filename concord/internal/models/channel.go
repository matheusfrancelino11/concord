package models

import (
	"time"

	"concord/internal/snowflake"
)

// Channel type constants
const (
	ChannelTypeText     = 0 // GUILD_TEXT
	ChannelTypeVoice    = 2 // GUILD_VOICE
	ChannelTypeCategory = 4 // GUILD_CATEGORY
)

// Permission bitfield constants
const (
	PermCreateInvite   int64 = 1 << 0
	PermKickMembers    int64 = 1 << 1
	PermBanMembers     int64 = 1 << 2
	PermAdministrator  int64 = 1 << 3
	PermManageChannels int64 = 1 << 4
	PermManageGuild    int64 = 1 << 5
	PermViewChannel    int64 = 1 << 10
	PermSendMessages   int64 = 1 << 11
	PermReadHistory    int64 = 1 << 16
	PermConnect        int64 = 1 << 20
	PermSpeak          int64 = 1 << 21
	PermMuteMembers    int64 = 1 << 22
	PermDeafenMembers  int64 = 1 << 23
	PermMoveMembers    int64 = 1 << 24
	PermManageRoles    int64 = 1 << 28

	// Default permissions for @everyone role:
	// ViewChannel + SendMessages + ReadHistory + Connect + Speak + CreateInvite
	DefaultEveryonePermissions int64 = PermViewChannel | PermSendMessages | PermReadHistory | PermConnect | PermSpeak | PermCreateInvite
)

// Channel represents a channel record in PostgreSQL
type Channel struct {
	ID        snowflake.ID  `json:"id"`
	GuildID   snowflake.ID  `json:"guild_id"`
	Type      int           `json:"type"`
	Name      string        `json:"name"`
	Topic     *string       `json:"topic"`
	Position  int           `json:"position"`
	ParentID  *snowflake.ID `json:"parent_id"`
	Bitrate   *int          `json:"bitrate"`
	UserLimit *int          `json:"user_limit"`
	RateLimit int           `json:"rate_limit"`
	NSFW      bool          `json:"nsfw"`
	CreatedAt time.Time     `json:"created_at"`
}

// ChannelResponse is the API model for channel endpoints
type ChannelResponse struct {
	ID        snowflake.ID  `json:"id"`
	GuildID   snowflake.ID  `json:"guild_id"`
	Type      int           `json:"type"`
	Name      string        `json:"name"`
	Topic     *string       `json:"topic,omitempty"`
	Position  int           `json:"position"`
	ParentID  *snowflake.ID `json:"parent_id,omitempty"`
	Bitrate   *int          `json:"bitrate,omitempty"`
	UserLimit *int          `json:"user_limit,omitempty"`
	RateLimit int           `json:"rate_limit"`
	NSFW      bool          `json:"nsfw"`
	CreatedAt time.Time     `json:"created_at"`
}

// CreateChannelRequest is the payload for creating a channel
type CreateChannelRequest struct {
	Name      string        `json:"name"`
	Type      int           `json:"type"`
	Topic     *string       `json:"topic,omitempty"`
	ParentID  *snowflake.ID `json:"parent_id,omitempty"`
	Bitrate   *int          `json:"bitrate,omitempty"`
	UserLimit *int          `json:"user_limit,omitempty"`
}
