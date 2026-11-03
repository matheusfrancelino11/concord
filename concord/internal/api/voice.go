package api

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"concord/internal/middleware"
	"concord/internal/service"
	"concord/internal/snowflake"
)

type VoiceHandler struct {
	voiceService service.VoiceService
}

func NewVoiceHandler(voiceService service.VoiceService) *VoiceHandler {
	return &VoiceHandler{voiceService: voiceService}
}

// GenerateToken handles POST /channels/{id}/voice/token
func (h *VoiceHandler) GenerateToken(w http.ResponseWriter, r *http.Request) {
	callerID, err := middleware.GetUserID(r.Context())
	if err != nil {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Missing authentication context")
		return
	}

	idStr := chi.URLParam(r, "id")
	channelID, err := snowflake.Parse(idStr)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_ID", "Invalid channel ID format")
		return
	}

	res, err := h.voiceService.GenerateVoiceToken(r.Context(), callerID, channelID)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrChannelNotFound):
			WriteError(w, http.StatusNotFound, "CHANNEL_NOT_FOUND", "Channel not found")
		case errors.Is(err, service.ErrInvalidChannelType):
			WriteError(w, http.StatusBadRequest, "INVALID_CHANNEL_TYPE", "Channel is not a voice channel")
		case errors.Is(err, service.ErrForbidden):
			WriteError(w, http.StatusForbidden, "FORBIDDEN", "You are not a member of this guild")
		default:
			WriteError(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Failed to generate voice token")
		}
		return
	}

	WriteJSON(w, http.StatusOK, res)
}
