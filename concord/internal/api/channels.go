package api

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"concord/internal/middleware"
	"concord/internal/service"
	"concord/internal/snowflake"
)

type ChannelHandler struct {
	channelService service.ChannelService
}

func NewChannelHandler(channelService service.ChannelService) *ChannelHandler {
	return &ChannelHandler{channelService: channelService}
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
