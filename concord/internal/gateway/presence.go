package gateway

import (
	"sync"

	"concord/internal/models"
	"concord/internal/snowflake"
)

// PresenceTracker tracks connected user statuses and active session counts in memory
type PresenceTracker struct {
	mu           sync.RWMutex
	userStatus   map[snowflake.ID]string
	userSessions map[snowflake.ID]map[string]bool
}

// NewPresenceTracker constructs a new PresenceTracker
func NewPresenceTracker() *PresenceTracker {
	return &PresenceTracker{
		userStatus:   make(map[snowflake.ID]string),
		userSessions: make(map[snowflake.ID]map[string]bool),
	}
}

// AddSession registers a session for a user.
// Returns the active status ("online", "idle", "dnd") and whether this is the first session (user became online).
func (pt *PresenceTracker) AddSession(userID snowflake.ID, sessionID string) (status string, becameOnline bool) {
	pt.mu.Lock()
	defer pt.mu.Unlock()

	sessions, exists := pt.userSessions[userID]
	if !exists {
		sessions = make(map[string]bool)
		pt.userSessions[userID] = sessions
	}

	sessions[sessionID] = true
	becameOnline = len(sessions) == 1

	status, ok := pt.userStatus[userID]
	if !ok || status == models.StatusOffline || status == models.StatusInvisible {
		status = models.StatusOnline
		pt.userStatus[userID] = status
	}

	return status, becameOnline
}

// RemoveSession unregisters a session for a user.
// Returns whether all sessions for the user are closed and user became offline.
func (pt *PresenceTracker) RemoveSession(userID snowflake.ID, sessionID string) (becameOffline bool) {
	pt.mu.Lock()
	defer pt.mu.Unlock()

	sessions, exists := pt.userSessions[userID]
	if !exists {
		return false
	}

	delete(sessions, sessionID)
	if len(sessions) == 0 {
		delete(pt.userSessions, userID)
		pt.userStatus[userID] = models.StatusOffline
		return true
	}

	return false
}

// SetStatus updates custom status for user (e.g. from Opcode 3).
func (pt *PresenceTracker) SetStatus(userID snowflake.ID, status string) string {
	pt.mu.Lock()
	defer pt.mu.Unlock()

	switch status {
	case models.StatusOnline, models.StatusIdle, models.StatusDND, models.StatusInvisible, models.StatusOffline:
		pt.userStatus[userID] = status
	default:
		status = models.StatusOnline
		pt.userStatus[userID] = status
	}
	return status
}

// GetStatus returns the current status of a user
func (pt *PresenceTracker) GetStatus(userID snowflake.ID) string {
	pt.mu.RLock()
	defer pt.mu.RUnlock()

	status, exists := pt.userStatus[userID]
	if !exists {
		return models.StatusOffline
	}
	if status == models.StatusInvisible {
		return models.StatusOffline
	}
	return status
}

// GetPresences returns a map of user ID to presence status for a slice of user IDs
func (pt *PresenceTracker) GetPresences(userIDs []snowflake.ID) map[snowflake.ID]string {
	pt.mu.RLock()
	defer pt.mu.RUnlock()

	result := make(map[snowflake.ID]string, len(userIDs))
	for _, uid := range userIDs {
		status, exists := pt.userStatus[uid]
		if !exists || status == models.StatusInvisible {
			result[uid] = models.StatusOffline
		} else {
			result[uid] = status
		}
	}
	return result
}
