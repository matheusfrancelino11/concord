package gateway

import (
	"log"
	"sync"
	"time"

	"concord/internal/snowflake"
)

const defaultRingBufferSize = 100

// BufferedEvent stores a dispatched frame for session resumption
type BufferedEvent struct {
	Seq  uint64
	Data []byte
}

// SessionRecord holds state, buffered events, and active connection for a user session
type SessionRecord struct {
	mu            sync.Mutex
	SessionID     string
	UserID        snowflake.ID
	GuildIDs      []snowflake.ID
	LastSeq       uint64
	EventBuffer   []BufferedEvent
	MaxBufferSize int
	ExpiresAt     time.Time
	activeClient  *Client
	hubs          []*Hub
}

// SetActiveClient associates an active WebSocket connection with this session
func (s *SessionRecord) SetActiveClient(c *Client) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.activeClient = c
	s.ExpiresAt = time.Time{} // Clear expiration while connected
}

// ClearActiveClient detaches the active connection and starts the reconnection TTL
func (s *SessionRecord) ClearActiveClient() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.activeClient = nil
	s.ExpiresAt = time.Now().Add(time.Duration(SessionTTLSec) * time.Second)
}

// Dispatch sequences, buffers, and forwards an event to the active client connection
func (s *SessionRecord) Dispatch(eventName string, payload any) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.LastSeq++
	seq := s.LastSeq

	data, err := NewDispatchEnvelope(seq, eventName, payload)
	if err != nil {
		log.Printf("[gateway] Error serializing event %s for session %s: %v", eventName, s.SessionID, err)
		return
	}

	s.EventBuffer = append(s.EventBuffer, BufferedEvent{
		Seq:  seq,
		Data: data,
	})

	if len(s.EventBuffer) > s.MaxBufferSize {
		s.EventBuffer = s.EventBuffer[len(s.EventBuffer)-s.MaxBufferSize:]
	}

	if s.activeClient != nil && !s.activeClient.closed.Load() {
		select {
		case s.activeClient.send <- data:
		default:
			log.Printf("[gateway] Session %s client buffer full, dropped event %s (seq %d)", s.SessionID, eventName, seq)
		}
	}
}

// AddHub tracks a guild Hub this session is registered in
func (s *SessionRecord) AddHub(h *Hub) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.hubs = append(s.hubs, h)
}

// RemoveFromHubs unregisters this session from all guild Hubs
func (s *SessionRecord) RemoveFromHubs() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, h := range s.hubs {
		h.Unregister(s)
	}
	s.hubs = nil
}

// AppendEvent stores a pre-sequenced dispatched frame in the circular buffer
func (s *SessionRecord) AppendEvent(seq uint64, data []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.LastSeq = seq
	s.EventBuffer = append(s.EventBuffer, BufferedEvent{
		Seq:  seq,
		Data: data,
	})

	if len(s.EventBuffer) > s.MaxBufferSize {
		s.EventBuffer = s.EventBuffer[len(s.EventBuffer)-s.MaxBufferSize:]
	}
}

// GetMissedEvents returns all events strictly newer than afterSeq.
// Returns false if afterSeq is too old (already evicted) or ahead of LastSeq.
func (s *SessionRecord) GetMissedEvents(afterSeq uint64) ([]BufferedEvent, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if afterSeq > s.LastSeq {
		return nil, false
	}

	if len(s.EventBuffer) == 0 {
		if afterSeq == s.LastSeq {
			return []BufferedEvent{}, true
		}
		return nil, false
	}

	oldestSeq := s.EventBuffer[0].Seq
	if afterSeq < oldestSeq && afterSeq+1 < oldestSeq {
		// Requested sequence has been evicted from the ring buffer
		return nil, false
	}

	missed := make([]BufferedEvent, 0, len(s.EventBuffer))
	for _, ev := range s.EventBuffer {
		if ev.Seq > afterSeq {
			missed = append(missed, ev)
		}
	}

	return missed, true
}

// SetExpiration sets the expiration deadline when client disconnects
func (s *SessionRecord) SetExpiration(ttl time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ExpiresAt = time.Now().Add(ttl)
}

// IsExpired checks if the session has expired
func (s *SessionRecord) IsExpired() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ExpiresAt.IsZero() {
		return false
	}
	return time.Now().After(s.ExpiresAt)
}

// SessionStore maintains active and reconnectable sessions in-memory
type SessionStore struct {
	mu       sync.RWMutex
	sessions map[string]*SessionRecord
}

// NewSessionStore constructs a new SessionStore
func NewSessionStore() *SessionStore {
	return &SessionStore{
		sessions: make(map[string]*SessionRecord),
	}
}

// CreateSession registers a new session record
func (store *SessionStore) CreateSession(sessionID string, userID snowflake.ID, guildIDs []snowflake.ID) *SessionRecord {
	store.mu.Lock()
	defer store.mu.Unlock()

	record := &SessionRecord{
		SessionID:     sessionID,
		UserID:        userID,
		GuildIDs:      guildIDs,
		MaxBufferSize: defaultRingBufferSize,
		EventBuffer:   make([]BufferedEvent, 0, defaultRingBufferSize),
		hubs:          make([]*Hub, 0),
	}
	store.sessions[sessionID] = record
	return record
}

// GetSession retrieves a session record if it exists and has not expired
func (store *SessionStore) GetSession(sessionID string) (*SessionRecord, bool) {
	store.mu.RLock()
	record, exists := store.sessions[sessionID]
	store.mu.RUnlock()

	if !exists {
		return nil, false
	}

	if record.IsExpired() {
		store.RemoveSession(sessionID)
		return nil, false
	}

	return record, true
}

// RemoveSession deletes a session record and unregisters from hubs
func (store *SessionStore) RemoveSession(sessionID string) {
	store.mu.Lock()
	defer store.mu.Unlock()

	if record, exists := store.sessions[sessionID]; exists {
		record.RemoveFromHubs()
		delete(store.sessions, sessionID)
	}
}

// PurgeExpired cleans up expired sessions
func (store *SessionStore) PurgeExpired() {
	store.mu.Lock()
	defer store.mu.Unlock()

	now := time.Now()
	for id, s := range store.sessions {
		if !s.ExpiresAt.IsZero() && now.After(s.ExpiresAt) {
			s.RemoveFromHubs()
			delete(store.sessions, id)
		}
	}
}
