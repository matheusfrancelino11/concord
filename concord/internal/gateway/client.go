package gateway

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"nhooyr.io/websocket"

	"concord/internal/snowflake"
)

// Client represents an active WebSocket connection
type Client struct {
	id            string
	userID        snowflake.ID
	sessionID     string
	conn          *websocket.Conn
	send          chan []byte
	seq           atomic.Uint64
	lastHeartbeat atomic.Int64
	session       *SessionRecord
	sessionStore  *SessionStore
	ctx           context.Context
	cancel        context.CancelFunc
	closeOnce     sync.Once
	closed        atomic.Bool
}

// NewClient constructs a new Client connection wrapper
func NewClient(
	ctx context.Context,
	conn *websocket.Conn,
	userID snowflake.ID,
	sessionID string,
	session *SessionRecord,
	sessionStore *SessionStore,
	startSeq uint64,
) *Client {
	clientCtx, clientCancel := context.WithCancel(ctx)

	// Generate random 16-byte connection ID
	connIDBytes := make([]byte, 16)
	_, _ = rand.Read(connIDBytes)
	connID := hex.EncodeToString(connIDBytes)

	c := &Client{
		id:           connID,
		userID:       userID,
		sessionID:    sessionID,
		conn:         conn,
		send:         make(chan []byte, 256),
		session:      session,
		sessionStore: sessionStore,
		ctx:          clientCtx,
		cancel:       clientCancel,
	}
	c.seq.Store(startSeq)
	c.lastHeartbeat.Store(time.Now().UnixMilli())
	return c
}

// ID returns unique connection ID
func (c *Client) ID() string {
	return c.id
}

// UserID returns user ID
func (c *Client) UserID() snowflake.ID {
	return c.userID
}

// SessionID returns session ID
func (c *Client) SessionID() string {
	return c.sessionID
}

// NextSeq increments and returns the next sequence number
func (c *Client) NextSeq() uint64 {
	return c.seq.Add(1)
}

// CurrentSeq returns the current sequence number
func (c *Client) CurrentSeq() uint64 {
	return c.seq.Load()
}

// TouchHeartbeat updates the last heartbeat timestamp
func (c *Client) TouchHeartbeat() {
	c.lastHeartbeat.Store(time.Now().UnixMilli())
}

// LastHeartbeatTime returns time of last received heartbeat
func (c *Client) LastHeartbeatTime() time.Time {
	return time.UnixMilli(c.lastHeartbeat.Load())
}

// SendRaw enqueues raw byte frame to the client send channel
func (c *Client) SendRaw(data []byte) {
	if c.closed.Load() {
		return
	}

	select {
	case c.send <- data:
	default:
		log.Printf("[gateway] Client %s send buffer full, dropped raw frame", c.id)
	}
}

// WritePump pulls from send channel and writes WebSocket text frames
func (c *Client) WritePump() {
	defer func() {
		c.CloseWithCode(websocket.StatusNormalClosure, "Write pump terminating")
	}()

	for {
		select {
		case <-c.ctx.Done():
			return
		case data, ok := <-c.send:
			if !ok {
				return
			}
			writeCtx, writeCancel := context.WithTimeout(c.ctx, 5*time.Second)
			err := c.conn.Write(writeCtx, websocket.MessageText, data)
			writeCancel()
			if err != nil {
				log.Printf("[gateway] Write error for client %s: %v", c.id, err)
				return
			}
		}
	}
}

// CloseWithCode shuts down the client connection and cleans up resources
func (c *Client) CloseWithCode(code websocket.StatusCode, reason string) {
	c.closeOnce.Do(func() {
		c.closed.Store(true)
		c.cancel()

		if c.session != nil {
			c.session.ClearActiveClient()
		}

		_ = c.conn.Close(code, reason)
	})
}
