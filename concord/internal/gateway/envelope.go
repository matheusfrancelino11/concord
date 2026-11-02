package gateway

import (
	"encoding/json"
	"fmt"
)

// GatewayEnvelope represents the standard Discord-compatible JSON frame
type GatewayEnvelope struct {
	Op int             `json:"op"`
	D  json.RawMessage `json:"d,omitempty"`
	S  *uint64         `json:"s,omitempty"`
	T  string          `json:"t,omitempty"`
}

// HelloData is the payload for Opcode 10 (HELLO)
type HelloData struct {
	HeartbeatInterval int `json:"heartbeat_interval"`
}

// IdentifyData is the payload for Opcode 2 (IDENTIFY)
type IdentifyData struct {
	Token string `json:"token"`
}

// ResumeData is the payload for Opcode 6 (RESUME)
type ResumeData struct {
	Token     string `json:"token"`
	SessionID string `json:"session_id"`
	Seq       uint64 `json:"seq"`
}

// GuildStub represents a guild summary in READY event
type GuildStub struct {
	ID          string `json:"id"`
	Unavailable bool   `json:"unavailable"`
}

// ReadyData is the payload for READY dispatch event
type ReadyData struct {
	V         int         `json:"v"`
	User      any         `json:"user"`
	Guilds    []GuildStub `json:"guilds"`
	SessionID string      `json:"session_id"`
}

// NewHelloEnvelope builds an Opcode 10 frame
func NewHelloEnvelope(heartbeatIntervalMs int) ([]byte, error) {
	d, err := json.Marshal(HelloData{HeartbeatInterval: heartbeatIntervalMs})
	if err != nil {
		return nil, fmt.Errorf("marshal hello data: %w", err)
	}
	env := GatewayEnvelope{
		Op: OpcodeHello,
		D:  d,
	}
	return json.Marshal(env)
}

// NewHeartbeatACKEnvelope builds an Opcode 11 frame
func NewHeartbeatACKEnvelope() []byte {
	return []byte(`{"op":11}`)
}

// NewInvalidSessionEnvelope builds an Opcode 9 frame
func NewInvalidSessionEnvelope(resumable bool) []byte {
	if resumable {
		return []byte(`{"op":9,"d":true}`)
	}
	return []byte(`{"op":9,"d":false}`)
}

// NewDispatchEnvelope builds an Opcode 0 dispatch frame with sequence and event name
func NewDispatchEnvelope(seq uint64, eventName string, payload any) ([]byte, error) {
	var d json.RawMessage
	if rawBytes, ok := payload.([]byte); ok {
		d = rawBytes
	} else if rawMsg, ok := payload.(json.RawMessage); ok {
		d = rawMsg
	} else {
		marshaled, err := json.Marshal(payload)
		if err != nil {
			return nil, fmt.Errorf("marshal dispatch data: %w", err)
		}
		d = marshaled
	}

	env := GatewayEnvelope{
		Op: OpcodeDispatch,
		S:  &seq,
		T:  eventName,
		D:  d,
	}
	return json.Marshal(env)
}
