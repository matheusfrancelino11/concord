package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"concord/internal/middleware"
	"concord/internal/models"
	"concord/internal/service"
	"concord/internal/snowflake"
)

// MessageHandler handles HTTP requests for messages and typing indicators
type MessageHandler struct {
	messageService service.MessageService
}

// NewMessageHandler constructs a new MessageHandler
func NewMessageHandler(messageService service.MessageService) *MessageHandler {
	return &MessageHandler{
		messageService: messageService,
	}
}

// ListMessages handles GET /channels/{id}/messages?before=<id>&limit=50
func (h *MessageHandler) ListMessages(w http.ResponseWriter, r *http.Request) {
	callerID, err := middleware.GetUserID(r.Context())
	if err != nil {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Missing authentication context")
		return
	}

	channelIDStr := chi.URLParam(r, "id")
	channelID, err := snowflake.Parse(channelIDStr)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_ID", "Invalid channel ID format")
		return
	}

	limit := 50
	limitStr := r.URL.Query().Get("limit")
	if limitStr != "" {
		parsedLimit, err := strconv.Atoi(limitStr)
		if err != nil || parsedLimit <= 0 {
			WriteError(w, http.StatusBadRequest, "INVALID_PARAMETER", "Invalid limit parameter")
			return
		}
		limit = parsedLimit
	}

	var before *snowflake.ID
	beforeStr := r.URL.Query().Get("before")
	if beforeStr != "" {
		bID, err := snowflake.Parse(beforeStr)
		if err != nil {
			WriteError(w, http.StatusBadRequest, "INVALID_PARAMETER", "Invalid before parameter")
			return
		}
		before = &bID
	}

	messages, err := h.messageService.ListMessages(r.Context(), callerID, channelID, before, limit)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrChannelNotFound):
			WriteError(w, http.StatusNotFound, "CHANNEL_NOT_FOUND", "Channel not found")
		case errors.Is(err, service.ErrInvalidChannelType):
			WriteError(w, http.StatusBadRequest, "INVALID_CHANNEL_TYPE", "Cannot perform message operations on non-text channels")
		case errors.Is(err, service.ErrForbidden):
			WriteError(w, http.StatusForbidden, "FORBIDDEN", "You are not a member of this guild")
		default:
			WriteError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to retrieve messages")
		}
		return
	}

	WriteJSON(w, http.StatusOK, messages)
}

// CreateMessage handles POST /channels/{id}/messages
func (h *MessageHandler) CreateMessage(w http.ResponseWriter, r *http.Request) {
	callerID, err := middleware.GetUserID(r.Context())
	if err != nil {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Missing authentication context")
		return
	}

	channelIDStr := chi.URLParam(r, "id")
	channelID, err := snowflake.Parse(channelIDStr)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_ID", "Invalid channel ID format")
		return
	}

	var req models.CreateMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteError(w, http.StatusBadRequest, "MALFORMED_JSON", "Invalid JSON request body")
		return
	}

	resp, _, err := h.messageService.CreateMessage(r.Context(), callerID, channelID, &req)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrChannelNotFound):
			WriteError(w, http.StatusNotFound, "CHANNEL_NOT_FOUND", "Channel not found")
		case errors.Is(err, service.ErrInvalidChannelType):
			WriteError(w, http.StatusBadRequest, "INVALID_CHANNEL_TYPE", "Cannot perform message operations on non-text channels")
		case errors.Is(err, service.ErrForbidden):
			WriteError(w, http.StatusForbidden, "FORBIDDEN", "You are not a member of this guild")
		case errors.Is(err, service.ErrMessageEmpty):
			WriteError(w, http.StatusBadRequest, "MESSAGE_EMPTY", "Message content cannot be empty")
		case errors.Is(err, service.ErrMessageTooLong):
			WriteError(w, http.StatusBadRequest, "MESSAGE_TOO_LONG", "Message content exceeds 2000 characters limit")
		case errors.Is(err, service.ErrInvalidReply):
			WriteError(w, http.StatusBadRequest, "INVALID_REPLY", "Referenced message not found in this channel")
		default:
			WriteError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to create message")
		}
		return
	}

	WriteJSON(w, http.StatusCreated, resp)
}

// UpdateMessage handles PATCH /channels/{id}/messages/{mid}
func (h *MessageHandler) UpdateMessage(w http.ResponseWriter, r *http.Request) {
	callerID, err := middleware.GetUserID(r.Context())
	if err != nil {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Missing authentication context")
		return
	}

	channelIDStr := chi.URLParam(r, "id")
	channelID, err := snowflake.Parse(channelIDStr)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_ID", "Invalid channel ID format")
		return
	}

	messageIDStr := chi.URLParam(r, "mid")
	messageID, err := snowflake.Parse(messageIDStr)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_ID", "Invalid message ID format")
		return
	}

	var req models.UpdateMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteError(w, http.StatusBadRequest, "MALFORMED_JSON", "Invalid JSON request body")
		return
	}

	resp, _, err := h.messageService.UpdateMessage(r.Context(), callerID, channelID, messageID, &req)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrChannelNotFound):
			WriteError(w, http.StatusNotFound, "CHANNEL_NOT_FOUND", "Channel not found")
		case errors.Is(err, service.ErrMessageNotFound):
			WriteError(w, http.StatusNotFound, "MESSAGE_NOT_FOUND", "Message not found")
		case errors.Is(err, service.ErrInvalidChannelType):
			WriteError(w, http.StatusBadRequest, "INVALID_CHANNEL_TYPE", "Cannot perform message operations on non-text channels")
		case errors.Is(err, service.ErrForbidden):
			WriteError(w, http.StatusForbidden, "FORBIDDEN", "You can only edit your own messages")
		case errors.Is(err, service.ErrMessageEmpty):
			WriteError(w, http.StatusBadRequest, "MESSAGE_EMPTY", "Message content cannot be empty")
		case errors.Is(err, service.ErrMessageTooLong):
			WriteError(w, http.StatusBadRequest, "MESSAGE_TOO_LONG", "Message content exceeds 2000 characters limit")
		default:
			WriteError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to update message")
		}
		return
	}

	WriteJSON(w, http.StatusOK, resp)
}

// DeleteMessage handles DELETE /channels/{id}/messages/{mid}
func (h *MessageHandler) DeleteMessage(w http.ResponseWriter, r *http.Request) {
	callerID, err := middleware.GetUserID(r.Context())
	if err != nil {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Missing authentication context")
		return
	}

	channelIDStr := chi.URLParam(r, "id")
	channelID, err := snowflake.Parse(channelIDStr)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_ID", "Invalid channel ID format")
		return
	}

	messageIDStr := chi.URLParam(r, "mid")
	messageID, err := snowflake.Parse(messageIDStr)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_ID", "Invalid message ID format")
		return
	}

	_, err = h.messageService.DeleteMessage(r.Context(), callerID, channelID, messageID)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrChannelNotFound):
			WriteError(w, http.StatusNotFound, "CHANNEL_NOT_FOUND", "Channel not found")
		case errors.Is(err, service.ErrMessageNotFound):
			WriteError(w, http.StatusNotFound, "MESSAGE_NOT_FOUND", "Message not found")
		case errors.Is(err, service.ErrForbidden):
			WriteError(w, http.StatusForbidden, "FORBIDDEN", "You do not have permission to delete this message")
		default:
			WriteError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to delete message")
		}
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// TriggerTyping handles POST /channels/{id}/typing
func (h *MessageHandler) TriggerTyping(w http.ResponseWriter, r *http.Request) {
	callerID, err := middleware.GetUserID(r.Context())
	if err != nil {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Missing authentication context")
		return
	}

	channelIDStr := chi.URLParam(r, "id")
	channelID, err := snowflake.Parse(channelIDStr)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_ID", "Invalid channel ID format")
		return
	}

	_, err = h.messageService.TriggerTyping(r.Context(), callerID, channelID)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrChannelNotFound):
			WriteError(w, http.StatusNotFound, "CHANNEL_NOT_FOUND", "Channel not found")
		case errors.Is(err, service.ErrInvalidChannelType):
			WriteError(w, http.StatusBadRequest, "INVALID_CHANNEL_TYPE", "Cannot perform typing on non-text channels")
		case errors.Is(err, service.ErrForbidden):
			WriteError(w, http.StatusForbidden, "FORBIDDEN", "You are not a member of this guild")
		default:
			WriteError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to trigger typing")
		}
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
