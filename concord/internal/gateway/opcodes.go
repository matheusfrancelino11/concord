package gateway

// Discord WebSocket Gateway Opcodes
const (
	OpcodeDispatch       = 0  // Receive: Events (READY, MESSAGE_CREATE, etc.)
	OpcodeHeartbeat      = 1  // Send/Receive: Ping/Pong keepalive
	OpcodeIdentify       = 2  // Send: Handshake authentication
	OpcodePresenceUpdate = 3  // Send: Presence update
	OpcodeResume         = 6  // Send: Resume disconnected session
	OpcodeInvalidSession = 9  // Receive: Session is invalid / cannot resume
	OpcodeHello          = 10 // Receive: Initial handshake payload with heartbeat interval
	OpcodeHeartbeatACK   = 11 // Receive: Confirmation of heartbeat
)

// Dispatch Event Names
const (
	EventReady         = "READY"
	EventGuildCreate   = "GUILD_CREATE"
	EventGuildUpdate   = "GUILD_UPDATE"
	EventGuildDelete   = "GUILD_DELETE"
	EventChannelCreate = "CHANNEL_CREATE"
	EventChannelUpdate = "CHANNEL_UPDATE"
	EventChannelDelete = "CHANNEL_DELETE"
	EventMessageCreate = "MESSAGE_CREATE"
	EventMessageUpdate = "MESSAGE_UPDATE"
	EventMessageDelete = "MESSAGE_DELETE"
	EventTypingStart   = "TYPING_START"
	EventResumed       = "RESUMED"
)

// Gateway Close Codes
const (
	CloseCodeUnknownError         = 4000
	CloseCodeAuthenticationFailed = 4004
	CloseCodeAlreadyAuthenticated = 4005
	CloseCodeInvalidSeq           = 4007
	CloseCodeSessionTimeout       = 4009
)

// Gateway timing constants
const (
	HeartbeatIntervalMs    = 41250 // milliseconds (41.25s)
	HeartbeatGracePeriodMs = 10000 // milliseconds (10s)
	ZombieTimeoutMs        = HeartbeatIntervalMs + HeartbeatGracePeriodMs // 51250ms
	HandshakeTimeoutSec    = 10    // seconds to wait for IDENTIFY/RESUME after HELLO
	SessionTTLSec          = 300   // 5 minutes session resumption window
)
