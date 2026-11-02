package gateway

import (
	"sync/atomic"
)

type broadcastItem struct {
	eventType string
	payload   any
}

// Hub manages active and resumable sessions for a single guild
type Hub struct {
	guildID    string
	sessions   map[string]*SessionRecord
	register   chan *SessionRecord
	unregister chan *SessionRecord
	broadcast  chan *broadcastItem
	stop       chan struct{}
	closed     atomic.Bool
}

// NewHub constructs a new guild Hub
func NewHub(guildID string) *Hub {
	return &Hub{
		guildID:    guildID,
		sessions:   make(map[string]*SessionRecord),
		register:   make(chan *SessionRecord, 64),
		unregister: make(chan *SessionRecord, 64),
		broadcast:  make(chan *broadcastItem, 256),
		stop:       make(chan struct{}),
	}
}

// GuildID returns the guild ID
func (h *Hub) GuildID() string {
	return h.guildID
}

// Register enqueues a session registration
func (h *Hub) Register(s *SessionRecord) {
	if h.closed.Load() {
		return
	}
	select {
	case h.register <- s:
	case <-h.stop:
	}
}

// Unregister enqueues a session unregistration
func (h *Hub) Unregister(s *SessionRecord) {
	if h.closed.Load() {
		return
	}
	select {
	case h.unregister <- s:
	case <-h.stop:
	}
}

// Broadcast enqueues an event for distribution to all sessions belonging to this guild
func (h *Hub) Broadcast(eventType string, payload any) {
	if h.closed.Load() {
		return
	}
	item := &broadcastItem{
		eventType: eventType,
		payload:   payload,
	}
	select {
	case h.broadcast <- item:
	default:
		// Non-blocking drop if channel overflows
	}
}

// Stop terminates the Hub loop
func (h *Hub) Stop() {
	if h.closed.CompareAndSwap(false, true) {
		close(h.stop)
	}
}

// SessionCount returns current number of registered sessions in this Hub
func (h *Hub) SessionCount() int {
	return len(h.sessions)
}

// Run executes the actor loop processing registrations, unregistrations, and broadcasts
func (h *Hub) Run() {
	for {
		select {
		case s := <-h.register:
			h.sessions[s.SessionID] = s

		case s := <-h.unregister:
			delete(h.sessions, s.SessionID)

		case item := <-h.broadcast:
			for id, s := range h.sessions {
				if s.IsExpired() {
					delete(h.sessions, id)
					continue
				}
				s.Dispatch(item.eventType, item.payload)
			}

		case <-h.stop:
			clear(h.sessions)
			return
		}
	}
}
