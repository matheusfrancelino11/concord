package models

import (
	"time"

	"concord/internal/snowflake"
)

// User represents the persistent user account record
type User struct {
	ID           snowflake.ID `json:"id"`
	Username     string       `json:"username"`
	Email        string       `json:"email"`
	PasswordHash string       `json:"-"`
	Avatar       *string      `json:"avatar"`
	GlobalName   *string      `json:"global_name"`
	Flags        int          `json:"flags"`
	CreatedAt    time.Time    `json:"created_at"`
}

// UserResponse is the public sanitized user profile
type UserResponse struct {
	ID         snowflake.ID `json:"id"`
	Username   string       `json:"username"`
	Email      string       `json:"email"`
	GlobalName *string      `json:"global_name,omitempty"`
	Avatar     *string      `json:"avatar,omitempty"`
	Flags      int          `json:"flags"`
	CreatedAt  time.Time    `json:"created_at"`
}

// RegisterRequest holds registration input payload
type RegisterRequest struct {
	Email      string  `json:"email"`
	Username   string  `json:"username"`
	Password   string  `json:"password"`
	GlobalName *string `json:"global_name,omitempty"`
}

// LoginRequest holds login input payload
type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// RefreshRequest holds token refresh input payload
type RefreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

// AuthResponse represents the complete response for register/login
type AuthResponse struct {
	User         UserResponse `json:"user"`
	Token        string       `json:"token"`
	RefreshToken string       `json:"refresh_token"`
}

// TokenResponse represents the token refresh response
type TokenResponse struct {
	Token string `json:"token"`
}

// MeResponse represents the response for GET /auth/me
type MeResponse struct {
	User UserResponse `json:"user"`
}
