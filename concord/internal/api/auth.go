package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"concord/internal/middleware"
	"concord/internal/models"
	"concord/internal/service"
)

type AuthHandler struct {
	authService service.AuthService
}

func NewAuthHandler(authService service.AuthService) *AuthHandler {
	return &AuthHandler{authService: authService}
}

// Register handles POST /auth/register
func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var req models.RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteError(w, http.StatusBadRequest, "MALFORMED_JSON", "Invalid JSON payload")
		return
	}

	resp, err := h.authService.Register(r.Context(), &req)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrInvalidEmail):
			WriteError(w, http.StatusBadRequest, "INVALID_EMAIL", err.Error())
		case errors.Is(err, service.ErrInvalidUsername):
			WriteError(w, http.StatusBadRequest, "INVALID_USERNAME", err.Error())
		case errors.Is(err, service.ErrWeakPassword):
			WriteError(w, http.StatusBadRequest, "WEAK_PASSWORD", err.Error())
		case errors.Is(err, service.ErrPasswordTooLong):
			WriteError(w, http.StatusBadRequest, "PASSWORD_TOO_LONG", err.Error())
		case errors.Is(err, service.ErrUserAlreadyExists):
			WriteError(w, http.StatusConflict, "USER_ALREADY_EXISTS", "Email or username is already in use")
		default:
			WriteError(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Failed to register user")
		}
		return
	}

	WriteJSON(w, http.StatusCreated, resp)
}

// Login handles POST /auth/login
func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req models.LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteError(w, http.StatusBadRequest, "MALFORMED_JSON", "Invalid JSON payload")
		return
	}

	resp, err := h.authService.Login(r.Context(), &req)
	if err != nil {
		if errors.Is(err, service.ErrInvalidCredentials) {
			WriteError(w, http.StatusUnauthorized, "INVALID_CREDENTIALS", "Invalid email or password")
			return
		}
		WriteError(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Failed to authenticate")
		return
	}

	WriteJSON(w, http.StatusOK, resp)
}

// Refresh handles POST /auth/refresh
func (h *AuthHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	var req models.RefreshRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteError(w, http.StatusBadRequest, "MALFORMED_JSON", "Invalid JSON payload")
		return
	}

	resp, err := h.authService.RefreshToken(r.Context(), &req)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrExpiredToken):
			WriteError(w, http.StatusUnauthorized, "TOKEN_EXPIRED", "Refresh token has expired")
		case errors.Is(err, service.ErrInvalidToken), errors.Is(err, service.ErrInvalidTokenType):
			WriteError(w, http.StatusUnauthorized, "INVALID_TOKEN", "Refresh token is invalid")
		case errors.Is(err, service.ErrUserNotFound):
			WriteError(w, http.StatusUnauthorized, "USER_NOT_FOUND", "User account no longer exists")
		default:
			WriteError(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Failed to refresh token")
		}
		return
	}

	WriteJSON(w, http.StatusOK, resp)
}

// Me handles GET /auth/me
func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	userID, err := middleware.GetUserID(r.Context())
	if err != nil {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Missing authentication context")
		return
	}

	profile, err := h.authService.GetCurrentUser(r.Context(), userID)
	if err != nil {
		if errors.Is(err, service.ErrUserNotFound) {
			WriteError(w, http.StatusNotFound, "USER_NOT_FOUND", "User profile not found")
			return
		}
		WriteError(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Failed to retrieve user profile")
		return
	}

	WriteJSON(w, http.StatusOK, models.MeResponse{User: *profile})
}
