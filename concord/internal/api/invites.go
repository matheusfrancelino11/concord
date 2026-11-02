package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"concord/internal/gateway"
	"concord/internal/middleware"
	"concord/internal/models"
	"concord/internal/service"
	"concord/internal/snowflake"
)

// InviteHandler handles HTTP requests for invites and server memberships
type InviteHandler struct {
	inviteService service.InviteService
	hubManager    *gateway.HubManager
	sessionStore  *gateway.SessionStore
}

// NewInviteHandler constructs a new InviteHandler
func NewInviteHandler(
	inviteService service.InviteService,
	hubManager *gateway.HubManager,
	sessionStore *gateway.SessionStore,
) *InviteHandler {
	return &InviteHandler{
		inviteService: inviteService,
		hubManager:    hubManager,
		sessionStore:  sessionStore,
	}
}

// CreateInvite handles POST /guilds/:id/invites
func (h *InviteHandler) CreateInvite(w http.ResponseWriter, r *http.Request) {
	callerID, err := middleware.GetUserID(r.Context())
	if err != nil {
		WriteJSON(w, http.StatusUnauthorized, ErrorResponse{Error: "Unauthorized"})
		return
	}

	guildIDStr := chi.URLParam(r, "id")
	guildID, err := snowflake.Parse(guildIDStr)
	if err != nil {
		WriteJSON(w, http.StatusBadRequest, ErrorResponse{Error: "Invalid guild ID"})
		return
	}

	var req models.CreateInviteRequest
	if r.ContentLength > 0 {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}

	invite, err := h.inviteService.CreateInvite(r.Context(), callerID, guildID, &req)
	if err != nil {
		if errors.Is(err, service.ErrForbidden) {
			WriteJSON(w, http.StatusForbidden, ErrorResponse{Error: err.Error()})
			return
		}
		WriteJSON(w, http.StatusBadRequest, ErrorResponse{Error: err.Error()})
		return
	}

	WriteJSON(w, http.StatusCreated, invite)
}

// GetInvite handles GET /invites/:code
func (h *InviteHandler) GetInvite(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	if code == "" {
		WriteJSON(w, http.StatusBadRequest, ErrorResponse{Error: "Invite code is required"})
		return
	}

	inviteResp, err := h.inviteService.GetInvite(r.Context(), code)
	if err != nil {
		if errors.Is(err, service.ErrInviteNotFound) {
			WriteJSON(w, http.StatusNotFound, ErrorResponse{Error: "Invite not found or has expired"})
			return
		}
		WriteJSON(w, http.StatusInternalServerError, ErrorResponse{Error: err.Error()})
		return
	}

	WriteJSON(w, http.StatusOK, inviteResp)
}

// UseInvite handles POST /invites/:code/use
func (h *InviteHandler) UseInvite(w http.ResponseWriter, r *http.Request) {
	callerID, err := middleware.GetUserID(r.Context())
	if err != nil {
		WriteJSON(w, http.StatusUnauthorized, ErrorResponse{Error: "Unauthorized"})
		return
	}

	code := chi.URLParam(r, "code")
	if code == "" {
		WriteJSON(w, http.StatusBadRequest, ErrorResponse{Error: "Invite code is required"})
		return
	}

	guildDetail, memberResp, err := h.inviteService.UseInvite(r.Context(), callerID, code)
	if err != nil {
		if errors.Is(err, service.ErrInviteNotFound) {
			WriteJSON(w, http.StatusNotFound, ErrorResponse{Error: "Invite not found or has expired"})
			return
		}
		WriteJSON(w, http.StatusBadRequest, ErrorResponse{Error: err.Error()})
		return
	}

	// If this was a new member addition, broadcast GUILD_MEMBER_ADD to guild Hub
	if memberResp != nil {
		h.hubManager.BroadcastToGuild(memberResp.GuildID, gateway.EventMemberAdd, memberResp)

		// Attach newly joined guild to caller's active WebSocket sessions
		hub := h.hubManager.GetOrCreateHub(memberResp.GuildID.String())
		h.sessionStore.AttachGuildToUserSessions(callerID, memberResp.GuildID, hub, guildDetail)
	}

	WriteJSON(w, http.StatusOK, guildDetail)
}

// ListMembers handles GET /guilds/:id/members
func (h *InviteHandler) ListMembers(w http.ResponseWriter, r *http.Request) {
	callerID, err := middleware.GetUserID(r.Context())
	if err != nil {
		WriteJSON(w, http.StatusUnauthorized, ErrorResponse{Error: "Unauthorized"})
		return
	}

	guildIDStr := chi.URLParam(r, "id")
	guildID, err := snowflake.Parse(guildIDStr)
	if err != nil {
		WriteJSON(w, http.StatusBadRequest, ErrorResponse{Error: "Invalid guild ID"})
		return
	}

	members, err := h.inviteService.ListMembers(r.Context(), callerID, guildID)
	if err != nil {
		if errors.Is(err, service.ErrForbidden) {
			WriteJSON(w, http.StatusForbidden, ErrorResponse{Error: err.Error()})
			return
		}
		WriteJSON(w, http.StatusInternalServerError, ErrorResponse{Error: err.Error()})
		return
	}

	WriteJSON(w, http.StatusOK, members)
}
