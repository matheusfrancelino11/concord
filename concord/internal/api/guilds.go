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

type GuildHandler struct {
	guildService   service.GuildService
	channelService service.ChannelService
}

func NewGuildHandler(guildService service.GuildService, channelService service.ChannelService) *GuildHandler {
	return &GuildHandler{
		guildService:   guildService,
		channelService: channelService,
	}
}

// CreateGuild handles POST /guilds
func (h *GuildHandler) CreateGuild(w http.ResponseWriter, r *http.Request) {
	callerID, err := middleware.GetUserID(r.Context())
	if err != nil {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Missing authentication context")
		return
	}

	var req models.CreateGuildRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteError(w, http.StatusBadRequest, "MALFORMED_JSON", "Invalid JSON payload")
		return
	}

	resp, err := h.guildService.CreateGuild(r.Context(), callerID, &req)
	if err != nil {
		if errors.Is(err, service.ErrInvalidGuildName) {
			WriteError(w, http.StatusBadRequest, "INVALID_GUILD_NAME", err.Error())
			return
		}
		WriteError(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Failed to create guild")
		return
	}

	WriteJSON(w, http.StatusCreated, resp)
}

// ListGuilds handles GET /guilds
func (h *GuildHandler) ListGuilds(w http.ResponseWriter, r *http.Request) {
	callerID, err := middleware.GetUserID(r.Context())
	if err != nil {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Missing authentication context")
		return
	}

	guilds, err := h.guildService.ListUserGuilds(r.Context(), callerID)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Failed to list guilds")
		return
	}

	WriteJSON(w, http.StatusOK, guilds)
}

// GetGuildDetails handles GET /guilds/:id
func (h *GuildHandler) GetGuildDetails(w http.ResponseWriter, r *http.Request) {
	callerID, err := middleware.GetUserID(r.Context())
	if err != nil {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Missing authentication context")
		return
	}

	idStr := chi.URLParam(r, "id")
	guildID, err := snowflake.Parse(idStr)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_ID", "Invalid guild ID format")
		return
	}

	guild, err := h.guildService.GetGuildDetails(r.Context(), callerID, guildID)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrGuildNotFound):
			WriteError(w, http.StatusNotFound, "GUILD_NOT_FOUND", "Guild not found")
		case errors.Is(err, service.ErrForbidden):
			WriteError(w, http.StatusForbidden, "FORBIDDEN", "You are not a member of this guild")
		default:
			WriteError(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Failed to retrieve guild")
		}
		return
	}

	WriteJSON(w, http.StatusOK, guild)
}

// DeleteGuild handles DELETE /guilds/:id
func (h *GuildHandler) DeleteGuild(w http.ResponseWriter, r *http.Request) {
	callerID, err := middleware.GetUserID(r.Context())
	if err != nil {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Missing authentication context")
		return
	}

	idStr := chi.URLParam(r, "id")
	guildID, err := snowflake.Parse(idStr)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_ID", "Invalid guild ID format")
		return
	}

	err = h.guildService.DeleteGuild(r.Context(), callerID, guildID)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrGuildNotFound):
			WriteError(w, http.StatusNotFound, "GUILD_NOT_FOUND", "Guild not found")
		case errors.Is(err, service.ErrOnlyOwnerCanDelete), errors.Is(err, service.ErrForbidden):
			WriteError(w, http.StatusForbidden, "FORBIDDEN", "Only the guild owner can delete this guild")
		default:
			WriteError(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Failed to delete guild")
		}
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// CreateChannel handles POST /guilds/:id/channels
func (h *GuildHandler) CreateChannel(w http.ResponseWriter, r *http.Request) {
	callerID, err := middleware.GetUserID(r.Context())
	if err != nil {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Missing authentication context")
		return
	}

	idStr := chi.URLParam(r, "id")
	guildID, err := snowflake.Parse(idStr)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_ID", "Invalid guild ID format")
		return
	}

	var req models.CreateChannelRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteError(w, http.StatusBadRequest, "MALFORMED_JSON", "Invalid JSON payload")
		return
	}

	channel, err := h.channelService.CreateChannel(r.Context(), callerID, guildID, &req)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrGuildNotFound):
			WriteError(w, http.StatusNotFound, "GUILD_NOT_FOUND", "Guild not found")
		case errors.Is(err, service.ErrForbidden):
			WriteError(w, http.StatusForbidden, "FORBIDDEN", "You are not a member of this guild")
		case errors.Is(err, service.ErrInvalidChannelName):
			WriteError(w, http.StatusBadRequest, "INVALID_CHANNEL_NAME", err.Error())
		case errors.Is(err, service.ErrInvalidChannelType):
			WriteError(w, http.StatusBadRequest, "INVALID_CHANNEL_TYPE", err.Error())
		default:
			WriteError(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Failed to create channel")
		}
		return
	}

	WriteJSON(w, http.StatusCreated, channel)
}

// ListChannels handles GET /guilds/:id/channels
func (h *GuildHandler) ListChannels(w http.ResponseWriter, r *http.Request) {
	callerID, err := middleware.GetUserID(r.Context())
	if err != nil {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Missing authentication context")
		return
	}

	idStr := chi.URLParam(r, "id")
	guildID, err := snowflake.Parse(idStr)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_ID", "Invalid guild ID format")
		return
	}

	channels, err := h.channelService.ListGuildChannels(r.Context(), callerID, guildID)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrGuildNotFound):
			WriteError(w, http.StatusNotFound, "GUILD_NOT_FOUND", "Guild not found")
		case errors.Is(err, service.ErrForbidden):
			WriteError(w, http.StatusForbidden, "FORBIDDEN", "You are not a member of this guild")
		default:
			WriteError(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Failed to list channels")
		}
		return
	}

	WriteJSON(w, http.StatusOK, channels)
}
