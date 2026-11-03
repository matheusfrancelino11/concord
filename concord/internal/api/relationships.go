package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"concord/internal/middleware"
	"concord/internal/models"
	"concord/internal/service"
	"concord/internal/snowflake"
)

type RelationshipHandler struct {
	relService service.RelationshipService
}

func NewRelationshipHandler(relService service.RelationshipService) *RelationshipHandler {
	return &RelationshipHandler{relService: relService}
}

// ListRelationships handles GET /users/@me/relationships
func (h *RelationshipHandler) ListRelationships(w http.ResponseWriter, r *http.Request) {
	callerID, err := middleware.GetUserID(r.Context())
	if err != nil {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Missing authentication context")
		return
	}

	rels, err := h.relService.ListRelationships(r.Context(), callerID)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to list relationships")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(rels)
}

// SendFriendRequest handles POST /users/@me/relationships
func (h *RelationshipHandler) SendFriendRequest(w http.ResponseWriter, r *http.Request) {
	callerID, err := middleware.GetUserID(r.Context())
	if err != nil {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Missing authentication context")
		return
	}

	var req models.SendFriendRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_BODY", "Invalid JSON payload")
		return
	}

	rel, err := h.relService.SendFriendRequest(r.Context(), callerID, req.Username)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "FAILED_FRIEND_REQUEST", err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(rel)
}

// AcceptFriendRequest handles PUT /users/@me/relationships/:id
func (h *RelationshipHandler) AcceptFriendRequest(w http.ResponseWriter, r *http.Request) {
	callerID, err := middleware.GetUserID(r.Context())
	if err != nil {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Missing authentication context")
		return
	}

	idStr := chi.URLParam(r, "id")
	targetID, err := snowflake.Parse(idStr)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_ID", "Invalid target user ID")
		return
	}

	rel, err := h.relService.AcceptFriendRequest(r.Context(), callerID, targetID)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "FAILED_ACCEPT_REQUEST", err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(rel)
}

// RemoveRelationship handles DELETE /users/@me/relationships/:id
func (h *RelationshipHandler) RemoveRelationship(w http.ResponseWriter, r *http.Request) {
	callerID, err := middleware.GetUserID(r.Context())
	if err != nil {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Missing authentication context")
		return
	}

	idStr := chi.URLParam(r, "id")
	targetID, err := snowflake.Parse(idStr)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_ID", "Invalid target user ID")
		return
	}

	if err := h.relService.RemoveRelationship(r.Context(), callerID, targetID); err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to remove relationship")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// BlockUser handles POST /users/@me/relationships/:id/block
func (h *RelationshipHandler) BlockUser(w http.ResponseWriter, r *http.Request) {
	callerID, err := middleware.GetUserID(r.Context())
	if err != nil {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Missing authentication context")
		return
	}

	idStr := chi.URLParam(r, "id")
	targetID, err := snowflake.Parse(idStr)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_ID", "Invalid target user ID")
		return
	}

	rel, err := h.relService.BlockUser(r.Context(), callerID, targetID)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "FAILED_BLOCK_USER", err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(rel)
}
