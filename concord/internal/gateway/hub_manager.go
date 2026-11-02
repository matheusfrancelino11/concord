package gateway

import (
	"sync"

	"nhooyr.io/websocket"

	"concord/internal/snowflake"
)

// HubManager maintains active Hub instances per guild with thread-safe access
type HubManager struct {
	mu   sync.RWMutex
	hubs map[string]*Hub
}

// NewHubManager constructs a new HubManager
func NewHubManager() *HubManager {
	return &HubManager{
		hubs: make(map[string]*Hub),
	}
}

// GetOrCreateHub retrieves an existing guild Hub or instantiates and starts a new one
func (m *HubManager) GetOrCreateHub(guildID string) *Hub {
	m.mu.RLock()
	hub, exists := m.hubs[guildID]
	m.mu.RUnlock()
	if exists {
		return hub
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	// Double-check under write lock
	if hub, exists = m.hubs[guildID]; exists {
		return hub
	}

	hub = NewHub(guildID)
	m.hubs[guildID] = hub
	go hub.Run()
	return hub
}

// GetHub retrieves an existing guild Hub if present
func (m *HubManager) GetHub(guildID string) (*Hub, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	hub, exists := m.hubs[guildID]
	return hub, exists
}

// BroadcastToGuild delivers an event to all connected members of the specified guild
func (m *HubManager) BroadcastToGuild(guildID snowflake.ID, eventType string, payload any) {
	m.BroadcastToGuildExcept(guildID, eventType, payload, "")
}

// BroadcastToGuildExcept delivers an event to connected members of the guild excluding a specific session
func (m *HubManager) BroadcastToGuildExcept(guildID snowflake.ID, eventType string, payload any, exceptSessionID string) {
	guildIDStr := guildID.String()
	m.mu.RLock()
	hub, exists := m.hubs[guildIDStr]
	m.mu.RUnlock()

	if exists {
		hub.BroadcastExcept(eventType, payload, exceptSessionID)
	}
}

// CloseHub stops and removes a guild Hub
func (m *HubManager) CloseHub(guildID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if hub, exists := m.hubs[guildID]; exists {
		hub.Stop()
		delete(m.hubs, guildID)
	}
}

// CloseAll stops all hubs and releases resources
func (m *HubManager) CloseAll(code websocket.StatusCode, reason string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	for id, hub := range m.hubs {
		hub.Stop()
		delete(m.hubs, id)
	}
}

// ActiveHubCount returns the number of currently active guild Hubs
func (m *HubManager) ActiveHubCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.hubs)
}
