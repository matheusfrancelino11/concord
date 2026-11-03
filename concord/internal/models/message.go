package models

import (
	"time"

	"concord/internal/snowflake"
)

// Message type constants
const (
	MessageTypeDefault = 0  // Normal text message
	MessageTypeReply   = 19 // Reply referencing another message
)

// Message represents the internal PostgreSQL message record
type Message struct {
	ID        snowflake.ID  `json:"id"`
	ChannelID snowflake.ID  `json:"channel_id"`
	AuthorID  snowflake.ID  `json:"author_id"`
	Content   string        `json:"content"`
	Type      int           `json:"type"`
	EditedAt  *time.Time    `json:"edited_at"`
	Pinned    bool          `json:"pinned"`
	ReplyToID *snowflake.ID `json:"reply_to_id"`
	CreatedAt time.Time     `json:"created_at"`
}

// MessageResponse represents the public JSON structure returned by the API and WebSocket
type MessageResponse struct {
	ID        snowflake.ID  `json:"id"`
	ChannelID snowflake.ID  `json:"channel_id"`
	GuildID   snowflake.ID  `json:"guild_id,omitempty"`
	Author    UserSummary   `json:"author"`
	Content   string        `json:"content"`
	Type      int           `json:"type"`
	EditedAt  *time.Time    `json:"edited_at"`
	Pinned    bool          `json:"pinned"`
	ReplyToID *snowflake.ID `json:"reply_to_id,omitempty"`
	CreatedAt time.Time     `json:"created_at"`
}

// CreateMessageRequest is the input payload for POST /channels/:id/messages
type CreateMessageRequest struct {
	Content   string        `json:"content"`
	ReplyToID *snowflake.ID `json:"reply_to_id,omitempty"`
}

// UpdateMessageRequest is the input payload for PATCH /channels/:id/messages/:mid
type UpdateMessageRequest struct {
	Content string `json:"content"`
}

// MessageDeletePayload is the payload dispatched in MESSAGE_DELETE event
type MessageDeletePayload struct {
	ID        snowflake.ID `json:"id"`
	ChannelID snowflake.ID `json:"channel_id"`
	GuildID   snowflake.ID `json:"guild_id"`
}

// TypingStartPayload is the payload dispatched in TYPING_START event
type TypingStartPayload struct {
	ChannelID  snowflake.ID `json:"channel_id"`
	GuildID    snowflake.ID `json:"guild_id,omitempty"`
	UserID     snowflake.ID `json:"user_id"`
	Username   string       `json:"username,omitempty"`
	GlobalName *string      `json:"global_name,omitempty"`
	Timestamp  int64        `json:"timestamp"`
}
