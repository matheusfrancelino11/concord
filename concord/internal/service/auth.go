package service

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"concord/internal/models"
	"concord/internal/snowflake"
)

const (
	TokenTypeAccess  = "access"
	TokenTypeRefresh = "refresh"

	AccessTokenDuration  = 1 * time.Hour
	RefreshTokenDuration = 30 * 24 * time.Hour
	BcryptCost           = 12
)

var (
	ErrInvalidCredentials = errors.New("invalid email or password")
	ErrUserAlreadyExists  = errors.New("email or username already exists")
	ErrInvalidToken       = errors.New("invalid or malformed token")
	ErrExpiredToken       = errors.New("token has expired")
	ErrInvalidTokenType   = errors.New("invalid token type")
	ErrUserNotFound       = errors.New("user not found")
	ErrWeakPassword       = errors.New("password must be at least 8 characters long")
	ErrPasswordTooLong    = errors.New("password must not exceed 72 bytes")
	ErrInvalidEmail       = errors.New("invalid email address format")
	ErrInvalidUsername    = errors.New("username must be between 2 and 32 alphanumeric characters")
)

var (
	usernameRegex = regexp.MustCompile(`^[a-zA-Z0-9_.-]{2,32}$`)
	emailRegex    = regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)
)

// Claims represents custom JWT claims
type Claims struct {
	UserID    string `json:"user_id"`
	TokenType string `json:"token_type"`
	jwt.RegisteredClaims
}

// AuthService defines the interface for authentication operations
type AuthService interface {
	Register(ctx context.Context, req *models.RegisterRequest) (*models.AuthResponse, error)
	Login(ctx context.Context, req *models.LoginRequest) (*models.AuthResponse, error)
	RefreshToken(ctx context.Context, req *models.RefreshRequest) (*models.TokenResponse, error)
	GetCurrentUser(ctx context.Context, userID snowflake.ID) (*models.UserResponse, error)
	ValidateToken(tokenStr string, expectedType string) (*Claims, error)
}

type authService struct {
	db        *pgxpool.Pool
	snowflake *snowflake.Generator
	jwtSecret []byte
}

// NewAuthService creates a new AuthService instance
func NewAuthService(db *pgxpool.Pool, sf *snowflake.Generator, jwtSecret string) AuthService {
	return &authService{
		db:        db,
		snowflake: sf,
		jwtSecret: []byte(jwtSecret),
	}
}

func (s *authService) Register(ctx context.Context, req *models.RegisterRequest) (*models.AuthResponse, error) {
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	req.Username = strings.TrimSpace(req.Username)

	if !emailRegex.MatchString(req.Email) {
		return nil, ErrInvalidEmail
	}
	if !usernameRegex.MatchString(req.Username) {
		return nil, ErrInvalidUsername
	}
	if len(req.Password) < 8 {
		return nil, ErrWeakPassword
	}
	if len([]byte(req.Password)) > 72 {
		return nil, ErrPasswordTooLong
	}

	var exists bool
	checkQuery := `SELECT EXISTS(SELECT 1 FROM users WHERE LOWER(email) = $1 OR LOWER(username) = $2)`
	if err := s.db.QueryRow(ctx, checkQuery, req.Email, strings.ToLower(req.Username)).Scan(&exists); err != nil {
		return nil, fmt.Errorf("check user existence: %w", err)
	}
	if exists {
		return nil, ErrUserAlreadyExists
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), BcryptCost)
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}

	userID, err := s.snowflake.NextID()
	if err != nil {
		return nil, fmt.Errorf("generate user id: %w", err)
	}

	insertQuery := `
		INSERT INTO users (id, username, email, password, global_name, avatar, flags, created_at)
		VALUES ($1, $2, $3, $4, $5, NULL, 0, NOW())
		RETURNING id, username, email, global_name, avatar, flags, created_at
	`
	var user models.User
	err = s.db.QueryRow(ctx, insertQuery,
		userID,
		req.Username,
		req.Email,
		string(hashedPassword),
		req.GlobalName,
	).Scan(
		&user.ID,
		&user.Username,
		&user.Email,
		&user.GlobalName,
		&user.Avatar,
		&user.Flags,
		&user.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("insert user: %w", err)
	}

	accessToken, err := s.generateToken(user.ID, user.Username, TokenTypeAccess, AccessTokenDuration)
	if err != nil {
		return nil, err
	}
	refreshToken, err := s.generateToken(user.ID, user.Username, TokenTypeRefresh, RefreshTokenDuration)
	if err != nil {
		return nil, err
	}

	return &models.AuthResponse{
		User: models.UserResponse{
			ID:         user.ID,
			Username:   user.Username,
			Email:      user.Email,
			GlobalName: user.GlobalName,
			Avatar:     user.Avatar,
			Flags:      user.Flags,
			CreatedAt:  user.CreatedAt,
		},
		Token:        accessToken,
		RefreshToken: refreshToken,
	}, nil
}

func (s *authService) Login(ctx context.Context, req *models.LoginRequest) (*models.AuthResponse, error) {
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if req.Email == "" || req.Password == "" || len(req.Password) < 8 || len([]byte(req.Password)) > 72 {
		return nil, ErrInvalidCredentials
	}

	query := `
		SELECT id, username, email, password, global_name, avatar, flags, created_at
		FROM users
		WHERE LOWER(email) = $1
	`
	var user models.User
	err := s.db.QueryRow(ctx, query, req.Email).Scan(
		&user.ID,
		&user.Username,
		&user.Email,
		&user.PasswordHash,
		&user.GlobalName,
		&user.Avatar,
		&user.Flags,
		&user.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrInvalidCredentials
		}
		return nil, fmt.Errorf("query user: %w", err)
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		return nil, ErrInvalidCredentials
	}

	accessToken, err := s.generateToken(user.ID, user.Username, TokenTypeAccess, AccessTokenDuration)
	if err != nil {
		return nil, err
	}
	refreshToken, err := s.generateToken(user.ID, user.Username, TokenTypeRefresh, RefreshTokenDuration)
	if err != nil {
		return nil, err
	}

	return &models.AuthResponse{
		User: models.UserResponse{
			ID:         user.ID,
			Username:   user.Username,
			Email:      user.Email,
			GlobalName: user.GlobalName,
			Avatar:     user.Avatar,
			Flags:      user.Flags,
			CreatedAt:  user.CreatedAt,
		},
		Token:        accessToken,
		RefreshToken: refreshToken,
	}, nil
}

func (s *authService) RefreshToken(ctx context.Context, req *models.RefreshRequest) (*models.TokenResponse, error) {
	if strings.TrimSpace(req.RefreshToken) == "" {
		return nil, ErrInvalidToken
	}

	claims, err := s.ValidateToken(req.RefreshToken, TokenTypeRefresh)
	if err != nil {
		return nil, err
	}

	userID, err := snowflake.Parse(claims.UserID)
	if err != nil {
		return nil, ErrInvalidToken
	}

	var username string
	query := `SELECT username FROM users WHERE id = $1`
	if err := s.db.QueryRow(ctx, query, userID).Scan(&username); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, fmt.Errorf("verify user: %w", err)
	}

	newAccessToken, err := s.generateToken(userID, username, TokenTypeAccess, AccessTokenDuration)
	if err != nil {
		return nil, err
	}

	return &models.TokenResponse{
		Token: newAccessToken,
	}, nil
}

func (s *authService) GetCurrentUser(ctx context.Context, userID snowflake.ID) (*models.UserResponse, error) {
	query := `
		SELECT id, username, email, global_name, avatar, flags, created_at
		FROM users
		WHERE id = $1
	`
	var user models.UserResponse
	err := s.db.QueryRow(ctx, query, userID).Scan(
		&user.ID,
		&user.Username,
		&user.Email,
		&user.GlobalName,
		&user.Avatar,
		&user.Flags,
		&user.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, fmt.Errorf("get user profile: %w", err)
	}

	return &user, nil
}

func (s *authService) generateToken(userID snowflake.ID, username string, tokenType string, duration time.Duration) (string, error) {
	now := time.Now().UTC()
	claims := Claims{
		UserID:    userID.String(),
		TokenType: tokenType,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID.String(),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(duration)),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenStr, err := token.SignedString(s.jwtSecret)
	if err != nil {
		return "", fmt.Errorf("failed to sign token: %w", err)
	}
	return tokenStr, nil
}

func (s *authService) ValidateToken(tokenStr string, expectedType string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return s.jwtSecret, nil
	})

	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return nil, ErrExpiredToken
		}
		return nil, ErrInvalidToken
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, ErrInvalidToken
	}

	if expectedType != "" && claims.TokenType != expectedType {
		return nil, ErrInvalidTokenType
	}

	return claims, nil
}
