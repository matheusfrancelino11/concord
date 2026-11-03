package models

import (
	"concord/internal/snowflake"
)

// Relationship type constants matching Discord
const (
	RelationshipTypeFriend   = 1
	RelationshipTypeBlocked  = 2
	RelationshipTypeIncoming = 3
	RelationshipTypeOutgoing = 4
)

// Relationship represents a friendship, block, or pending request
type Relationship struct {
	UserID   snowflake.ID `json:"user_id"`
	TargetID snowflake.ID `json:"target_id"`
	Type     int          `json:"type"`
}

// RelationshipResponse is the serialized response with target user profile
type RelationshipResponse struct {
	ID   snowflake.ID `json:"id"` // target user id
	Type int          `json:"type"`
	User UserResponse `json:"user"`
}

// SendFriendRequest is the request payload to send a friend request by username
type SendFriendRequest struct {
	Username string `json:"username"`
}
