package middleware

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"concord/internal/service"
	"concord/internal/snowflake"
)

type contextKey string

const (
	UserIDKey    contextKey = "concord_user_id"
	UserIDStrKey contextKey = "concord_user_id_str"
)

var (
	ErrNoAuthContext = errors.New("middleware: user ID not present in request context")
)

type AuthMiddleware struct {
	authService service.AuthService
}

// NewAuthMiddleware creates a new AuthMiddleware instance
func NewAuthMiddleware(authService service.AuthService) *AuthMiddleware {
	return &AuthMiddleware{authService: authService}
}

type authErrorResponse struct {
	Error string `json:"error"`
	Code  string `json:"code"`
}

func writeAuthError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(authErrorResponse{
		Error: message,
		Code:  code,
	})
}

// RequireAuth is a Chi middleware handler validating Bearer access JWTs
func (m *AuthMiddleware) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			writeAuthError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authorization header is required")
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			writeAuthError(w, http.StatusUnauthorized, "INVALID_AUTH_HEADER", "Authorization header must be in 'Bearer <token>' format")
			return
		}

		tokenStr := strings.TrimSpace(parts[1])
		if tokenStr == "" {
			writeAuthError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Bearer token is empty")
			return
		}

		claims, err := m.authService.ValidateToken(tokenStr, service.TokenTypeAccess)
		if err != nil {
			switch {
			case errors.Is(err, service.ErrExpiredToken):
				writeAuthError(w, http.StatusUnauthorized, "TOKEN_EXPIRED", "Access token has expired")
			case errors.Is(err, service.ErrInvalidTokenType):
				writeAuthError(w, http.StatusUnauthorized, "INVALID_TOKEN_TYPE", "Token type 'access' required")
			default:
				writeAuthError(w, http.StatusUnauthorized, "INVALID_TOKEN", "Access token is invalid or malformed")
			}
			return
		}

		sfID, err := snowflake.Parse(claims.UserID)
		if err != nil {
			writeAuthError(w, http.StatusUnauthorized, "INVALID_TOKEN", "Invalid user ID claim")
			return
		}

		ctx := context.WithValue(r.Context(), UserIDKey, sfID)
		ctx = context.WithValue(ctx, UserIDStrKey, claims.UserID)

		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// GetUserID retrieves the authenticated snowflake.ID from context
func GetUserID(ctx context.Context) (snowflake.ID, error) {
	val := ctx.Value(UserIDKey)
	if val == nil {
		return 0, ErrNoAuthContext
	}
	id, ok := val.(snowflake.ID)
	if !ok {
		return 0, ErrNoAuthContext
	}
	return id, nil
}

// GetUserIDString retrieves the string representation of user ID from context
func GetUserIDString(ctx context.Context) (string, error) {
	val := ctx.Value(UserIDStrKey)
	if val == nil {
		return "", ErrNoAuthContext
	}
	s, ok := val.(string)
	if !ok {
		return "", ErrNoAuthContext
	}
	return s, nil
}
