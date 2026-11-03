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

// AdminHandler handles HTTP requests for roles, permissions, server moderation, and bans
type AdminHandler struct {
	adminService service.AdminService
	hubManager   *gateway.HubManager
}

// NewAdminHandler constructs a new AdminHandler
func NewAdminHandler(adminService service.AdminService, hubManager *gateway.HubManager) *AdminHandler {
	return &AdminHandler{
		adminService: adminService,
		hubManager:   hubManager,
	}
}

func (h *AdminHandler) handleServiceError(w http.ResponseWriter, err error) {
	if errors.Is(err, service.ErrForbidden) ||
		errors.Is(err, service.ErrHierarchyViolation) ||
		errors.Is(err, service.ErrCannotModerateOwner) ||
		errors.Is(err, service.ErrCannotModerateSelf) {
		WriteJSON(w, http.StatusForbidden, ErrorResponse{Error: err.Error()})
		return
	}
	if errors.Is(err, service.ErrGuildNotFound) ||
		errors.Is(err, service.ErrChannelNotFound) ||
		errors.Is(err, service.ErrRoleNotFound) ||
		errors.Is(err, service.ErrMemberNotFound) {
		WriteJSON(w, http.StatusNotFound, ErrorResponse{Error: err.Error()})
		return
	}
	if errors.Is(err, service.ErrCannotDeleteEveryone) ||
		errors.Is(err, service.ErrCannotDeleteManaged) ||
		errors.Is(err, service.ErrRoleNameRequired) ||
		errors.Is(err, service.ErrInvalidGuildName) {
		WriteJSON(w, http.StatusBadRequest, ErrorResponse{Error: err.Error()})
		return
	}
	WriteJSON(w, http.StatusBadRequest, ErrorResponse{Error: err.Error()})
}

// UpdateGuild handles PATCH /guilds/:id
func (h *AdminHandler) UpdateGuild(w http.ResponseWriter, r *http.Request) {
	callerID, err := middleware.GetUserID(r.Context())
	if err != nil {
		WriteJSON(w, http.StatusUnauthorized, ErrorResponse{Error: "Unauthorized"})
		return
	}

	guildID, err := snowflake.Parse(chi.URLParam(r, "id"))
	if err != nil {
		WriteJSON(w, http.StatusBadRequest, ErrorResponse{Error: "Invalid guild ID"})
		return
	}

	var req models.UpdateGuildRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteJSON(w, http.StatusBadRequest, ErrorResponse{Error: "Invalid JSON payload"})
		return
	}

	guildDetail, err := h.adminService.UpdateGuild(r.Context(), callerID, guildID, &req)
	if err != nil {
		h.handleServiceError(w, err)
		return
	}

	if h.hubManager != nil {
		h.hubManager.BroadcastToGuild(guildID, gateway.EventGuildUpdate, guildDetail)
	}

	WriteJSON(w, http.StatusOK, guildDetail)
}

// ListRoles handles GET /guilds/:id/roles
func (h *AdminHandler) ListRoles(w http.ResponseWriter, r *http.Request) {
	callerID, err := middleware.GetUserID(r.Context())
	if err != nil {
		WriteJSON(w, http.StatusUnauthorized, ErrorResponse{Error: "Unauthorized"})
		return
	}

	guildID, err := snowflake.Parse(chi.URLParam(r, "id"))
	if err != nil {
		WriteJSON(w, http.StatusBadRequest, ErrorResponse{Error: "Invalid guild ID"})
		return
	}

	roles, err := h.adminService.ListRoles(r.Context(), callerID, guildID)
	if err != nil {
		h.handleServiceError(w, err)
		return
	}

	WriteJSON(w, http.StatusOK, roles)
}

// CreateRole handles POST /guilds/:id/roles
func (h *AdminHandler) CreateRole(w http.ResponseWriter, r *http.Request) {
	callerID, err := middleware.GetUserID(r.Context())
	if err != nil {
		WriteJSON(w, http.StatusUnauthorized, ErrorResponse{Error: "Unauthorized"})
		return
	}

	guildID, err := snowflake.Parse(chi.URLParam(r, "id"))
	if err != nil {
		WriteJSON(w, http.StatusBadRequest, ErrorResponse{Error: "Invalid guild ID"})
		return
	}

	var req models.CreateRoleRequest
	_ = json.NewDecoder(r.Body).Decode(&req)

	role, err := h.adminService.CreateRole(r.Context(), callerID, guildID, &req)
	if err != nil {
		h.handleServiceError(w, err)
		return
	}

	if h.hubManager != nil {
		h.hubManager.BroadcastToGuild(guildID, gateway.EventGuildRoleCreate, map[string]interface{}{
			"guild_id": guildID,
			"role":     role,
		})
	}

	WriteJSON(w, http.StatusCreated, role)
}

// UpdateRole handles PATCH /guilds/:id/roles/:roleId
func (h *AdminHandler) UpdateRole(w http.ResponseWriter, r *http.Request) {
	callerID, err := middleware.GetUserID(r.Context())
	if err != nil {
		WriteJSON(w, http.StatusUnauthorized, ErrorResponse{Error: "Unauthorized"})
		return
	}

	guildID, err := snowflake.Parse(chi.URLParam(r, "id"))
	if err != nil {
		WriteJSON(w, http.StatusBadRequest, ErrorResponse{Error: "Invalid guild ID"})
		return
	}

	roleID, err := snowflake.Parse(chi.URLParam(r, "roleId"))
	if err != nil {
		WriteJSON(w, http.StatusBadRequest, ErrorResponse{Error: "Invalid role ID"})
		return
	}

	var req models.UpdateRoleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteJSON(w, http.StatusBadRequest, ErrorResponse{Error: "Invalid JSON payload"})
		return
	}

	role, err := h.adminService.UpdateRole(r.Context(), callerID, guildID, roleID, &req)
	if err != nil {
		h.handleServiceError(w, err)
		return
	}

	if h.hubManager != nil {
		h.hubManager.BroadcastToGuild(guildID, gateway.EventGuildRoleUpdate, map[string]interface{}{
			"guild_id": guildID,
			"role":     role,
		})
	}

	WriteJSON(w, http.StatusOK, role)
}

// DeleteRole handles DELETE /guilds/:id/roles/:roleId
func (h *AdminHandler) DeleteRole(w http.ResponseWriter, r *http.Request) {
	callerID, err := middleware.GetUserID(r.Context())
	if err != nil {
		WriteJSON(w, http.StatusUnauthorized, ErrorResponse{Error: "Unauthorized"})
		return
	}

	guildID, err := snowflake.Parse(chi.URLParam(r, "id"))
	if err != nil {
		WriteJSON(w, http.StatusBadRequest, ErrorResponse{Error: "Invalid guild ID"})
		return
	}

	roleID, err := snowflake.Parse(chi.URLParam(r, "roleId"))
	if err != nil {
		WriteJSON(w, http.StatusBadRequest, ErrorResponse{Error: "Invalid role ID"})
		return
	}

	if err := h.adminService.DeleteRole(r.Context(), callerID, guildID, roleID); err != nil {
		h.handleServiceError(w, err)
		return
	}

	if h.hubManager != nil {
		h.hubManager.BroadcastToGuild(guildID, gateway.EventGuildRoleDelete, map[string]interface{}{
			"guild_id": guildID,
			"role_id":  roleID,
		})
	}

	WriteJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// AddMemberRole handles PUT /guilds/:id/members/:uid/roles/:roleId
func (h *AdminHandler) AddMemberRole(w http.ResponseWriter, r *http.Request) {
	callerID, err := middleware.GetUserID(r.Context())
	if err != nil {
		WriteJSON(w, http.StatusUnauthorized, ErrorResponse{Error: "Unauthorized"})
		return
	}

	guildID, err := snowflake.Parse(chi.URLParam(r, "id"))
	if err != nil {
		WriteJSON(w, http.StatusBadRequest, ErrorResponse{Error: "Invalid guild ID"})
		return
	}

	targetUserID, err := snowflake.Parse(chi.URLParam(r, "uid"))
	if err != nil {
		WriteJSON(w, http.StatusBadRequest, ErrorResponse{Error: "Invalid user ID"})
		return
	}

	roleID, err := snowflake.Parse(chi.URLParam(r, "roleId"))
	if err != nil {
		WriteJSON(w, http.StatusBadRequest, ErrorResponse{Error: "Invalid role ID"})
		return
	}

	if err := h.adminService.AddMemberRole(r.Context(), callerID, guildID, targetUserID, roleID); err != nil {
		h.handleServiceError(w, err)
		return
	}

	// Fetch updated member and broadcast
	updatedMember, _ := h.adminService.UpdateMember(r.Context(), callerID, guildID, targetUserID, &models.UpdateMemberRequest{})
	if updatedMember != nil && h.hubManager != nil {
		h.hubManager.BroadcastToGuild(guildID, gateway.EventMemberUpdate, updatedMember)
	}

	WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// RemoveMemberRole handles DELETE /guilds/:id/members/:uid/roles/:roleId
func (h *AdminHandler) RemoveMemberRole(w http.ResponseWriter, r *http.Request) {
	callerID, err := middleware.GetUserID(r.Context())
	if err != nil {
		WriteJSON(w, http.StatusUnauthorized, ErrorResponse{Error: "Unauthorized"})
		return
	}

	guildID, err := snowflake.Parse(chi.URLParam(r, "id"))
	if err != nil {
		WriteJSON(w, http.StatusBadRequest, ErrorResponse{Error: "Invalid guild ID"})
		return
	}

	targetUserID, err := snowflake.Parse(chi.URLParam(r, "uid"))
	if err != nil {
		WriteJSON(w, http.StatusBadRequest, ErrorResponse{Error: "Invalid user ID"})
		return
	}

	roleID, err := snowflake.Parse(chi.URLParam(r, "roleId"))
	if err != nil {
		WriteJSON(w, http.StatusBadRequest, ErrorResponse{Error: "Invalid role ID"})
		return
	}

	if err := h.adminService.RemoveMemberRole(r.Context(), callerID, guildID, targetUserID, roleID); err != nil {
		h.handleServiceError(w, err)
		return
	}

	// Fetch updated member and broadcast
	updatedMember, _ := h.adminService.UpdateMember(r.Context(), callerID, guildID, targetUserID, &models.UpdateMemberRequest{})
	if updatedMember != nil && h.hubManager != nil {
		h.hubManager.BroadcastToGuild(guildID, gateway.EventMemberUpdate, updatedMember)
	}

	WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// UpdateMember handles PATCH /guilds/:id/members/:uid
func (h *AdminHandler) UpdateMember(w http.ResponseWriter, r *http.Request) {
	callerID, err := middleware.GetUserID(r.Context())
	if err != nil {
		WriteJSON(w, http.StatusUnauthorized, ErrorResponse{Error: "Unauthorized"})
		return
	}

	guildID, err := snowflake.Parse(chi.URLParam(r, "id"))
	if err != nil {
		WriteJSON(w, http.StatusBadRequest, ErrorResponse{Error: "Invalid guild ID"})
		return
	}

	targetUserID, err := snowflake.Parse(chi.URLParam(r, "uid"))
	if err != nil {
		WriteJSON(w, http.StatusBadRequest, ErrorResponse{Error: "Invalid user ID"})
		return
	}

	var req models.UpdateMemberRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteJSON(w, http.StatusBadRequest, ErrorResponse{Error: "Invalid JSON payload"})
		return
	}

	member, err := h.adminService.UpdateMember(r.Context(), callerID, guildID, targetUserID, &req)
	if err != nil {
		h.handleServiceError(w, err)
		return
	}

	if h.hubManager != nil {
		h.hubManager.BroadcastToGuild(guildID, gateway.EventMemberUpdate, member)
	}

	WriteJSON(w, http.StatusOK, member)
}

// KickMember handles DELETE /guilds/:id/members/:uid
func (h *AdminHandler) KickMember(w http.ResponseWriter, r *http.Request) {
	callerID, err := middleware.GetUserID(r.Context())
	if err != nil {
		WriteJSON(w, http.StatusUnauthorized, ErrorResponse{Error: "Unauthorized"})
		return
	}

	guildID, err := snowflake.Parse(chi.URLParam(r, "id"))
	if err != nil {
		WriteJSON(w, http.StatusBadRequest, ErrorResponse{Error: "Invalid guild ID"})
		return
	}

	targetUserID, err := snowflake.Parse(chi.URLParam(r, "uid"))
	if err != nil {
		WriteJSON(w, http.StatusBadRequest, ErrorResponse{Error: "Invalid user ID"})
		return
	}

	if err := h.adminService.KickMember(r.Context(), callerID, guildID, targetUserID); err != nil {
		h.handleServiceError(w, err)
		return
	}

	if h.hubManager != nil {
		h.hubManager.BroadcastToGuild(guildID, gateway.EventMemberRemove, map[string]interface{}{
			"guild_id": guildID,
			"user_id":  targetUserID,
		})
	}

	WriteJSON(w, http.StatusOK, map[string]string{"status": "kicked"})
}

// ListBans handles GET /guilds/:id/bans
func (h *AdminHandler) ListBans(w http.ResponseWriter, r *http.Request) {
	callerID, err := middleware.GetUserID(r.Context())
	if err != nil {
		WriteJSON(w, http.StatusUnauthorized, ErrorResponse{Error: "Unauthorized"})
		return
	}

	guildID, err := snowflake.Parse(chi.URLParam(r, "id"))
	if err != nil {
		WriteJSON(w, http.StatusBadRequest, ErrorResponse{Error: "Invalid guild ID"})
		return
	}

	bans, err := h.adminService.ListBans(r.Context(), callerID, guildID)
	if err != nil {
		h.handleServiceError(w, err)
		return
	}

	WriteJSON(w, http.StatusOK, bans)
}

// BanMember handles PUT /guilds/:id/bans/:uid
func (h *AdminHandler) BanMember(w http.ResponseWriter, r *http.Request) {
	callerID, err := middleware.GetUserID(r.Context())
	if err != nil {
		WriteJSON(w, http.StatusUnauthorized, ErrorResponse{Error: "Unauthorized"})
		return
	}

	guildID, err := snowflake.Parse(chi.URLParam(r, "id"))
	if err != nil {
		WriteJSON(w, http.StatusBadRequest, ErrorResponse{Error: "Invalid guild ID"})
		return
	}

	targetUserID, err := snowflake.Parse(chi.URLParam(r, "uid"))
	if err != nil {
		WriteJSON(w, http.StatusBadRequest, ErrorResponse{Error: "Invalid user ID"})
		return
	}

	var req models.CreateBanRequest
	_ = json.NewDecoder(r.Body).Decode(&req)

	if err := h.adminService.BanMember(r.Context(), callerID, guildID, targetUserID, &req); err != nil {
		h.handleServiceError(w, err)
		return
	}

	if h.hubManager != nil {
		h.hubManager.BroadcastToGuild(guildID, gateway.EventMemberRemove, map[string]interface{}{
			"guild_id": guildID,
			"user_id":  targetUserID,
		})
		h.hubManager.BroadcastToGuild(guildID, gateway.EventGuildBanAdd, map[string]interface{}{
			"guild_id": guildID,
			"user_id":  targetUserID,
			"reason":   req.Reason,
		})
	}

	WriteJSON(w, http.StatusOK, map[string]string{"status": "banned"})
}

// UnbanMember handles DELETE /guilds/:id/bans/:uid
func (h *AdminHandler) UnbanMember(w http.ResponseWriter, r *http.Request) {
	callerID, err := middleware.GetUserID(r.Context())
	if err != nil {
		WriteJSON(w, http.StatusUnauthorized, ErrorResponse{Error: "Unauthorized"})
		return
	}

	guildID, err := snowflake.Parse(chi.URLParam(r, "id"))
	if err != nil {
		WriteJSON(w, http.StatusBadRequest, ErrorResponse{Error: "Invalid guild ID"})
		return
	}

	targetUserID, err := snowflake.Parse(chi.URLParam(r, "uid"))
	if err != nil {
		WriteJSON(w, http.StatusBadRequest, ErrorResponse{Error: "Invalid user ID"})
		return
	}

	if err := h.adminService.UnbanMember(r.Context(), callerID, guildID, targetUserID); err != nil {
		h.handleServiceError(w, err)
		return
	}

	if h.hubManager != nil {
		h.hubManager.BroadcastToGuild(guildID, gateway.EventGuildBanRemove, map[string]interface{}{
			"guild_id": guildID,
			"user_id":  targetUserID,
		})
	}

	WriteJSON(w, http.StatusOK, map[string]string{"status": "unbanned"})
}

// SetChannelOverwrite handles PUT /channels/:id/permissions/:targetId
func (h *AdminHandler) SetChannelOverwrite(w http.ResponseWriter, r *http.Request) {
	callerID, err := middleware.GetUserID(r.Context())
	if err != nil {
		WriteJSON(w, http.StatusUnauthorized, ErrorResponse{Error: "Unauthorized"})
		return
	}

	channelID, err := snowflake.Parse(chi.URLParam(r, "id"))
	if err != nil {
		WriteJSON(w, http.StatusBadRequest, ErrorResponse{Error: "Invalid channel ID"})
		return
	}

	targetID, err := snowflake.Parse(chi.URLParam(r, "targetId"))
	if err != nil {
		WriteJSON(w, http.StatusBadRequest, ErrorResponse{Error: "Invalid target ID"})
		return
	}

	var req models.SetPermissionOverwriteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteJSON(w, http.StatusBadRequest, ErrorResponse{Error: "Invalid JSON payload"})
		return
	}

	if err := h.adminService.SetChannelOverwrite(r.Context(), callerID, channelID, targetID, &req); err != nil {
		h.handleServiceError(w, err)
		return
	}

	WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// DeleteChannelOverwrite handles DELETE /channels/:id/permissions/:targetId
func (h *AdminHandler) DeleteChannelOverwrite(w http.ResponseWriter, r *http.Request) {
	callerID, err := middleware.GetUserID(r.Context())
	if err != nil {
		WriteJSON(w, http.StatusUnauthorized, ErrorResponse{Error: "Unauthorized"})
		return
	}

	channelID, err := snowflake.Parse(chi.URLParam(r, "id"))
	if err != nil {
		WriteJSON(w, http.StatusBadRequest, ErrorResponse{Error: "Invalid channel ID"})
		return
	}

	targetID, err := snowflake.Parse(chi.URLParam(r, "targetId"))
	if err != nil {
		WriteJSON(w, http.StatusBadRequest, ErrorResponse{Error: "Invalid target ID"})
		return
	}

	if err := h.adminService.DeleteChannelOverwrite(r.Context(), callerID, channelID, targetID); err != nil {
		h.handleServiceError(w, err)
		return
	}

	WriteJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
