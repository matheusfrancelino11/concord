package models

import (
	"concord/internal/snowflake"
)

// PresenceStatus represents status strings
type PresenceStatus = string

const (
	StatusOnline    PresenceStatus = "online"
	StatusIdle      PresenceStatus = "idle"
	StatusDND       PresenceStatus = "dnd"
	StatusInvisible PresenceStatus = "invisible"
	StatusOffline   PresenceStatus = "offline"
)

// Presence represents a user's presence update payload
type Presence struct {
	UserID       snowflake.ID      `json:"user_id"`
	Status       PresenceStatus    `json:"status"`
	GuildID      *snowflake.ID     `json:"guild_id,omitempty"`
	ClientStatus map[string]string `json:"client_status,omitempty"`
	User         *UserSummary      `json:"user,omitempty"`
}

// PresenceUpdateRequest is the payload for Opcode 3
type PresenceUpdateRequest struct {
	Status PresenceStatus `json:"status"`
}
