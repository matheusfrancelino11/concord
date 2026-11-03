package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"concord/internal/middleware"
	"concord/internal/models"
	"concord/internal/service"
	"concord/internal/snowflake"
)

type ChannelHandler struct {
	channelService service.ChannelService
}

func NewChannelHandler(channelService service.ChannelService) *ChannelHandler {
	return &ChannelHandler{channelService: channelService}
}

// CreateDMChannel handles POST /users/@me/channels
func (h *ChannelHandler) CreateDMChannel(w http.ResponseWriter, r *http.Request) {
	callerID, err := middleware.GetUserID(r.Context())
	if err != nil {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Missing authentication context")
		return
	}

	var req models.CreateDMChannelRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_BODY", "Invalid JSON payload")
		return
	}

	if req.RecipientID == 0 {
		WriteError(w, http.StatusBadRequest, "MISSING_RECIPIENT", "recipient_id is required")
		return
	}

	ch, err := h.channelService.GetOrCreateDMChannel(r.Context(), callerID, req.RecipientID)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "FAILED_CREATE_DM", err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(ch)
}

// ListUserDMChannels handles GET /users/@me/channels
func (h *ChannelHandler) ListUserDMChannels(w http.ResponseWriter, r *http.Request) {
	callerID, err := middleware.GetUserID(r.Context())
	if err != nil {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Missing authentication context")
		return
	}

	channels, err := h.channelService.ListUserDMChannels(r.Context(), callerID)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to list DM channels")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(channels)
}

// DeleteChannel handles DELETE /channels/:id
func (h *ChannelHandler) DeleteChannel(w http.ResponseWriter, r *http.Request) {
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

	// Try close DM first if it's a DM channel
	if err := h.channelService.CloseDMChannel(r.Context(), callerID, channelID); err == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	err = h.channelService.DeleteChannel(r.Context(), callerID, channelID)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrChannelNotFound):
			WriteError(w, http.StatusNotFound, "CHANNEL_NOT_FOUND", "Channel not found")
		case errors.Is(err, service.ErrForbidden):
			WriteError(w, http.StatusForbidden, "FORBIDDEN", "You do not have permission to delete this channel")
		case errors.Is(err, service.ErrCannotDeleteLastChannel):
			WriteError(w, http.StatusBadRequest, "CANNOT_DELETE_LAST_CHANNEL", "Cannot delete the last remaining text channel in the guild")
		default:
			WriteError(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Failed to delete channel")
		}
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
