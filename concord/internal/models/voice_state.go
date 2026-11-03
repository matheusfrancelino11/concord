package models

import (
	"concord/internal/snowflake"
)

// VoiceState represents an active voice channel participant
type VoiceState struct {
	GuildID     snowflake.ID    `json:"guild_id"`
	ChannelID   *snowflake.ID   `json:"channel_id"`
	UserID      snowflake.ID    `json:"user_id"`
	SessionID   string          `json:"session_id"`
	SelfMute    bool            `json:"self_mute"`
	SelfDeaf    bool            `json:"self_deaf"`
	SelfVideo   bool            `json:"self_video"`
	SelfStream  bool            `json:"self_stream"`
	ServerMute  bool            `json:"server_mute"`
	ServerDeaf  bool            `json:"server_deaf"`
	Member      *MemberResponse `json:"member,omitempty"`
}

// VoiceStateUpdateRequest is received from client on Opcode 4
type VoiceStateUpdateRequest struct {
	GuildID    snowflake.ID  `json:"guild_id"`
	ChannelID  *snowflake.ID `json:"channel_id"`
	SelfMute   bool          `json:"self_mute"`
	SelfDeaf   bool          `json:"self_deaf"`
	SelfVideo  bool          `json:"self_video"`
	SelfStream bool          `json:"self_stream"`
}

// VoiceTokenResponse is returned by POST /v1/channels/:id/voice/token
type VoiceTokenResponse struct {
	Token     string `json:"token"`
	URL       string `json:"url"`
	Room      string `json:"room"`
	ChannelID string `json:"channel_id"`
}
