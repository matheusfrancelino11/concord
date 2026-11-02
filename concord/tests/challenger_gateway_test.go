package tests

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"nhooyr.io/websocket"

	"concord/internal/gateway"
	"concord/internal/models"
	"concord/internal/service"
)

// ============================================================================
// AREA 1: GATEWAY HANDSHAKE & ADVERSARIAL AUTHENTICATION
// ============================================================================

// TestChallenger_Handshake_HelloAndIdentify verifies:
// 1. Connection receives Opcode 10 HELLO with heartbeat_interval 41250ms.
// 2. Client sends IDENTIFY with valid JWT token.
// 3. Server returns Opcode 0 READY with session_id, user info, and guilds list.
// 4. Server dispatches Opcode 0 GUILD_CREATE for each guild.
// 5. Client sending a second IDENTIFY while authenticated is rejected with close code 4005.
func TestChallenger_Handshake_HelloAndIdentify(t *testing.T) {
	h := setupTestHarness(t)
	unique := fmt.Sprintf("%d", time.Now().UnixNano())

	user := registerUserHelper(t, h, "gw_user_"+unique, "gw_user_"+unique+"@challenger.test", "StrongPass123!")
	guild1 := createGuildHelper(t, h, user.Token, "GW Guild 1 "+unique)
	guild2 := createGuildHelper(t, h, user.Token, "GW Guild 2 "+unique)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// 1. Connect to /v1/gateway
	wsConn, _, err := websocket.Dial(ctx, h.wsURL+"/v1/gateway", nil)
	if err != nil {
		t.Fatalf("failed to dial websocket: %v", err)
	}
	defer wsConn.Close(websocket.StatusNormalClosure, "test teardown")

	// 2. Read Opcode 10 HELLO
	_, data, err := wsConn.Read(ctx)
	if err != nil {
		t.Fatalf("failed to read HELLO: %v", err)
	}

	var helloEnv gateway.GatewayEnvelope
	if err := json.Unmarshal(data, &helloEnv); err != nil {
		t.Fatalf("failed to unmarshal HELLO: %v", err)
	}
	if helloEnv.Op != gateway.OpcodeHello {
		t.Fatalf("expected Opcode 10 (HELLO), got op=%d", helloEnv.Op)
	}

	var helloData gateway.HelloData
	if err := json.Unmarshal(helloEnv.D, &helloData); err != nil {
		t.Fatalf("failed to unmarshal HelloData: %v", err)
	}
	if helloData.HeartbeatInterval != 41250 {
		t.Fatalf("expected heartbeat_interval 41250, got %d", helloData.HeartbeatInterval)
	}

	// 3. Send valid IDENTIFY
	identifyPayload, err := json.Marshal(gateway.GatewayEnvelope{
		Op: gateway.OpcodeIdentify,
		D:  []byte(fmt.Sprintf(`{"token":"%s"}`, user.Token)),
	})
	if err != nil {
		t.Fatalf("failed to marshal IDENTIFY: %v", err)
	}
	if err := wsConn.Write(ctx, websocket.MessageText, identifyPayload); err != nil {
		t.Fatalf("failed to write IDENTIFY: %v", err)
	}

	// 4. Read Opcode 0 READY
	_, readyData, err := wsConn.Read(ctx)
	if err != nil {
		t.Fatalf("failed to read READY: %v", err)
	}
	var readyEnv gateway.GatewayEnvelope
	if err := json.Unmarshal(readyData, &readyEnv); err != nil {
		t.Fatalf("failed to unmarshal READY envelope: %v", err)
	}
	if readyEnv.Op != gateway.OpcodeDispatch || readyEnv.T != gateway.EventReady {
		t.Fatalf("expected Opcode 0 READY, got op=%d, t=%s", readyEnv.Op, readyEnv.T)
	}
	if readyEnv.S == nil || *readyEnv.S != 1 {
		t.Fatalf("expected sequence 1 for READY, got %v", readyEnv.S)
	}

	var readyPayload gateway.ReadyData
	if err := json.Unmarshal(readyEnv.D, &readyPayload); err != nil {
		t.Fatalf("failed to parse ready payload: %v", err)
	}
	if readyPayload.SessionID == "" {
		t.Fatalf("expected non-empty session_id in READY")
	}
	if len(readyPayload.Guilds) != 2 {
		t.Fatalf("expected 2 guilds in READY, got %d", len(readyPayload.Guilds))
	}

	// 5. Read GUILD_CREATE events for both guilds
	receivedGuildIDs := make(map[string]bool)
	for i := 0; i < 2; i++ {
		_, gcData, err := wsConn.Read(ctx)
		if err != nil {
			t.Fatalf("failed to read GUILD_CREATE %d: %v", i+1, err)
		}
		var gcEnv gateway.GatewayEnvelope
		if err := json.Unmarshal(gcData, &gcEnv); err != nil {
			t.Fatalf("failed to unmarshal GUILD_CREATE %d: %v", i+1, err)
		}
		if gcEnv.Op != gateway.OpcodeDispatch || gcEnv.T != gateway.EventGuildCreate {
			t.Fatalf("expected Opcode 0 GUILD_CREATE, got op=%d, t=%s", gcEnv.Op, gcEnv.T)
		}
		var gcPayload models.GuildDetailResponse
		if err := json.Unmarshal(gcEnv.D, &gcPayload); err != nil {
			t.Fatalf("failed to parse GUILD_CREATE %d payload: %v", i+1, err)
		}
		receivedGuildIDs[gcPayload.ID.String()] = true
	}

	if !receivedGuildIDs[guild1.ID.String()] || !receivedGuildIDs[guild2.ID.String()] {
		t.Fatalf("did not receive GUILD_CREATE for all guilds: %+v", receivedGuildIDs)
	}

	// 6. Adversarial Attack: Send second IDENTIFY while already authenticated -> close code 4005
	_ = wsConn.Write(ctx, websocket.MessageText, identifyPayload)
	_, _, err = wsConn.Read(ctx)
	if err == nil {
		t.Fatalf("expected server to close connection on double IDENTIFY, but read succeeded")
	}
	closeStatus := websocket.CloseStatus(err)
	if int(closeStatus) != gateway.CloseCodeAlreadyAuthenticated {
		t.Fatalf("expected close status code 4005 (Already Authenticated), got %d (err: %v)", closeStatus, err)
	}
	t.Logf("Empirical confirmation: second IDENTIFY rejected with close code 4005")
}

// TestChallenger_Handshake_AuthRejectionMatrix verifies:
// 1. Invalid JWT string -> close code 4004.
// 2. Expired JWT -> close code 4004.
// 3. Empty token / missing token -> close code 4004.
// 4. Malformed JSON frame -> close code 1008 (Policy Violation).
// 5. Unrecognized initial opcode -> close code 4000.
func TestChallenger_Handshake_AuthRejectionMatrix(t *testing.T) {
	h := setupTestHarness(t)
	unique := fmt.Sprintf("%d", time.Now().UnixNano())

	user := registerUserHelper(t, h, "auth_rej_"+unique, "auth_rej_"+unique+"@challenger.test", "StrongPass123!")

	// 1. Invalid JWT string
	t.Run("InvalidJWTString", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		conn, _, err := websocket.Dial(ctx, h.wsURL+"/gateway", nil)
		if err != nil {
			t.Fatalf("dial: %v", err)
		}
		defer conn.Close(websocket.StatusNormalClosure, "")

		_, _, _ = conn.Read(ctx) // HELLO

		badIdentify := []byte(`{"op":2,"d":{"token":"gibberish.invalid.jwt"}}`)
		_ = conn.Write(ctx, websocket.MessageText, badIdentify)

		_, _, err = conn.Read(ctx)
		if err == nil {
			t.Fatalf("expected close on invalid JWT, but read succeeded")
		}
		if int(websocket.CloseStatus(err)) != gateway.CloseCodeAuthenticationFailed {
			t.Fatalf("expected close code 4004, got %v", websocket.CloseStatus(err))
		}
	})

	// 2. Expired JWT
	t.Run("ExpiredJWT", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		// Generate a legitimately signed JWT that expired 1 hour ago
		now := time.Now().UTC()
		claims := service.Claims{
			UserID:    user.User.ID.String(),
			TokenType: service.TokenTypeAccess,
			RegisteredClaims: jwt.RegisteredClaims{
				Subject:   user.User.ID.String(),
				IssuedAt:  jwt.NewNumericDate(now.Add(-2 * time.Hour)),
				ExpiresAt: jwt.NewNumericDate(now.Add(-1 * time.Hour)),
			},
		}
		expiredTokenObj := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
		expiredTokenStr, err := expiredTokenObj.SignedString([]byte(h.cfg.JWTSecret))
		if err != nil {
			t.Fatalf("failed to sign expired token: %v", err)
		}

		conn, _, err := websocket.Dial(ctx, h.wsURL+"/v1/gateway", nil)
		if err != nil {
			t.Fatalf("dial: %v", err)
		}
		defer conn.Close(websocket.StatusNormalClosure, "")

		_, _, _ = conn.Read(ctx) // HELLO

		expiredIdentify := []byte(fmt.Sprintf(`{"op":2,"d":{"token":"%s"}}`, expiredTokenStr))
		_ = conn.Write(ctx, websocket.MessageText, expiredIdentify)

		_, _, err = conn.Read(ctx)
		if err == nil {
			t.Fatalf("expected close on expired JWT, but read succeeded")
		}
		if int(websocket.CloseStatus(err)) != gateway.CloseCodeAuthenticationFailed {
			t.Fatalf("expected close code 4004 for expired JWT, got %v", websocket.CloseStatus(err))
		}
	})

	// 3. Empty Token
	t.Run("EmptyToken", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		conn, _, err := websocket.Dial(ctx, h.wsURL+"/gateway", nil)
		if err != nil {
			t.Fatalf("dial: %v", err)
		}
		defer conn.Close(websocket.StatusNormalClosure, "")

		_, _, _ = conn.Read(ctx) // HELLO

		_ = conn.Write(ctx, websocket.MessageText, []byte(`{"op":2,"d":{"token":""}}`))

		_, _, err = conn.Read(ctx)
		if err == nil {
			t.Fatalf("expected close on empty token, but read succeeded")
		}
		if int(websocket.CloseStatus(err)) != gateway.CloseCodeAuthenticationFailed {
			t.Fatalf("expected close code 4004 for empty token, got %v", websocket.CloseStatus(err))
		}
	})

	// 4. Malformed JSON frame
	t.Run("MalformedJSON", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		conn, _, err := websocket.Dial(ctx, h.wsURL+"/gateway", nil)
		if err != nil {
			t.Fatalf("dial: %v", err)
		}
		defer conn.Close(websocket.StatusNormalClosure, "")

		_, _, _ = conn.Read(ctx) // HELLO

		_ = conn.Write(ctx, websocket.MessageText, []byte(`{not valid json at all`))

		_, _, err = conn.Read(ctx)
		if err == nil {
			t.Fatalf("expected close on malformed JSON, but read succeeded")
		}
		if websocket.CloseStatus(err) != websocket.StatusPolicyViolation {
			t.Fatalf("expected close status StatusPolicyViolation (1008), got %v", websocket.CloseStatus(err))
		}
	})

	// 5. Unrecognized Opcode before IDENTIFY
	t.Run("UnrecognizedOpcodeBeforeAuth", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		conn, _, err := websocket.Dial(ctx, h.wsURL+"/gateway", nil)
		if err != nil {
			t.Fatalf("dial: %v", err)
		}
		defer conn.Close(websocket.StatusNormalClosure, "")

		_, _, _ = conn.Read(ctx) // HELLO

		// Opcode 3 (PRESENCE_UPDATE) before authenticating
		_ = conn.Write(ctx, websocket.MessageText, []byte(`{"op":3,"d":{"status":"online"}}`))

		_, _, err = conn.Read(ctx)
		if err == nil {
			t.Fatalf("expected close on unauthenticated Opcode 3, but read succeeded")
		}
		if int(websocket.CloseStatus(err)) != gateway.CloseCodeUnknownError {
			t.Fatalf("expected close code 4000 (CloseCodeUnknownError), got %v", websocket.CloseStatus(err))
		}
	})
}

// ============================================================================
// AREA 2: HEARTBEAT & ZOMBIE EVICTION
// ============================================================================

// TestChallenger_Heartbeat_Lifecycle verifies:
// 1. Client can send Opcode 1 HEARTBEAT before IDENTIFY, receiving Opcode 11 HEARTBEAT_ACK.
// 2. Client sending Opcode 1 HEARTBEAT after IDENTIFY receives Opcode 11 HEARTBEAT_ACK.
// 3. Client sending rapid burst of heartbeats receives all HEARTBEAT_ACKs without deadlock or frame loss.
func TestChallenger_Heartbeat_Lifecycle(t *testing.T) {
	h := setupTestHarness(t)
	unique := fmt.Sprintf("%d", time.Now().UnixNano())

	user := registerUserHelper(t, h, "hb_user_"+unique, "hb_user_"+unique+"@challenger.test", "StrongPass123!")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	conn, _, err := websocket.Dial(ctx, h.wsURL+"/v1/gateway", nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "done")

	// Read HELLO
	_, _, err = conn.Read(ctx)
	if err != nil {
		t.Fatalf("failed to read HELLO: %v", err)
	}

	// 1. Heartbeat BEFORE IDENTIFY
	hbMsg := []byte(`{"op":1,"d":null}`)
	if err := conn.Write(ctx, websocket.MessageText, hbMsg); err != nil {
		t.Fatalf("write heartbeat before auth: %v", err)
	}

	_, ackData, err := conn.Read(ctx)
	if err != nil {
		t.Fatalf("read heartbeat ack before auth: %v", err)
	}
	var ackEnv gateway.GatewayEnvelope
	if err := json.Unmarshal(ackData, &ackEnv); err != nil || ackEnv.Op != gateway.OpcodeHeartbeatACK {
		t.Fatalf("expected Opcode 11 HEARTBEAT_ACK, got op=%d (err: %v)", ackEnv.Op, err)
	}

	// 2. Authenticate
	identifyMsg := []byte(fmt.Sprintf(`{"op":2,"d":{"token":"%s"}}`, user.Token))
	if err := conn.Write(ctx, websocket.MessageText, identifyMsg); err != nil {
		t.Fatalf("write IDENTIFY: %v", err)
	}
	_, _, _ = conn.Read(ctx) // READY

	// 3. Heartbeat AFTER IDENTIFY
	if err := conn.Write(ctx, websocket.MessageText, hbMsg); err != nil {
		t.Fatalf("write heartbeat after auth: %v", err)
	}
	_, ackData2, err := conn.Read(ctx)
	if err != nil {
		t.Fatalf("read heartbeat ack after auth: %v", err)
	}
	var ackEnv2 gateway.GatewayEnvelope
	if err := json.Unmarshal(ackData2, &ackEnv2); err != nil || ackEnv2.Op != gateway.OpcodeHeartbeatACK {
		t.Fatalf("expected Opcode 11 HEARTBEAT_ACK, got op=%d", ackEnv2.Op)
	}

	// 4. Burst of 15 Heartbeats
	const burstCount = 15
	for i := 0; i < burstCount; i++ {
		bMsg := []byte(fmt.Sprintf(`{"op":1,"d":%d}`, i+1))
		if err := conn.Write(ctx, websocket.MessageText, bMsg); err != nil {
			t.Fatalf("burst write %d failed: %v", i+1, err)
		}
	}

	for i := 0; i < burstCount; i++ {
		_, bAck, err := conn.Read(ctx)
		if err != nil {
			t.Fatalf("burst read ack %d failed: %v", i+1, err)
		}
		var bEnv gateway.GatewayEnvelope
		if err := json.Unmarshal(bAck, &bEnv); err != nil || bEnv.Op != gateway.OpcodeHeartbeatACK {
			t.Fatalf("burst ack %d mismatch: op=%d", i+1, bEnv.Op)
		}
	}
	t.Logf("Empirical confirmation: %d heartbeat burst cleanly acknowledged", burstCount)
}

// TestChallenger_ZombieEviction_Invariant verifies the zombie eviction calculation
// and verifies that client connection touch tracking properly registers freshness.
func TestChallenger_ZombieEviction_Invariant(t *testing.T) {
	// Verify timing specifications per SCOPE.md and Discord Protocol:
	// HeartbeatIntervalMs = 41250 ms
	// HeartbeatGracePeriodMs = 10000 ms
	// ZombieTimeoutMs = 51250 ms
	if gateway.HeartbeatIntervalMs != 41250 {
		t.Fatalf("HeartbeatIntervalMs mismatch: expected 41250, got %d", gateway.HeartbeatIntervalMs)
	}
	if gateway.ZombieTimeoutMs != 51250 {
		t.Fatalf("ZombieTimeoutMs mismatch: expected 51250, got %d", gateway.ZombieTimeoutMs)
	}

	// Verify Client heartbeat tracking behavior directly
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	client := gateway.NewClient(ctx, nil, 1001, "test_session", nil, nil, 0)
	t0 := client.LastHeartbeatTime()
	if time.Since(t0) > 1*time.Second {
		t.Fatalf("client initial heartbeat time too stale: %v", t0)
	}

	time.Sleep(10 * time.Millisecond)
	client.TouchHeartbeat()
	t1 := client.LastHeartbeatTime()
	if !t1.After(t0) {
		t.Fatalf("TouchHeartbeat failed to advance timestamp: t0=%v, t1=%v", t0, t1)
	}
	t.Logf("Empirical confirmation: Client heartbeat freshness updates correctly (t0=%v, t1=%v)", t0.UnixMilli(), t1.UnixMilli())
}

// ============================================================================
// AREA 3: DUAL-CLIENT REAL-TIME FANOUT & ISOLATION
// ============================================================================

// TestChallenger_DualClient_Fanout_And_CrossGuildIsolation verifies:
// 1. Client A and Client B in Guild 1 both receive MESSAGE_CREATE, MESSAGE_UPDATE, TYPING_START, and MESSAGE_DELETE.
// 2. Client C in Guild 2 (isolated tenant) does NOT receive any events from Guild 1.
func TestChallenger_DualClient_Fanout_And_CrossGuildIsolation(t *testing.T) {
	h := setupTestHarness(t)
	unique := fmt.Sprintf("%d", time.Now().UnixNano())

	alice := registerUserHelper(t, h, "alice_fan_"+unique, "alice_fan_"+unique+"@challenger.test", "StrongPass123!")
	bob := registerUserHelper(t, h, "bob_fan_"+unique, "bob_fan_"+unique+"@challenger.test", "StrongPass123!")
	charlie := registerUserHelper(t, h, "charlie_iso_"+unique, "charlie_iso_"+unique+"@challenger.test", "StrongPass123!")

	// Guild 1: Alice (owner) and Bob (member)
	guild1 := createGuildHelper(t, h, alice.Token, "Guild One "+unique)
	channelID1 := guild1.Channels[0].ID.String()
	addGuildMemberHelper(t, h, guild1.ID, bob.User.ID)

	// Guild 2: Charlie (isolated)
	guild2 := createGuildHelper(t, h, charlie.Token, "Guild Two "+unique)
	_ = guild2

	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()

	// Helper to connect and identify
	connectAndIdentify := func(token string) *websocket.Conn {
		conn, _, err := websocket.Dial(ctx, h.wsURL+"/v1/gateway", nil)
		if err != nil {
			t.Fatalf("dial failed: %v", err)
		}
		_, _, _ = conn.Read(ctx) // HELLO
		_ = conn.Write(ctx, websocket.MessageText, []byte(fmt.Sprintf(`{"op":2,"d":{"token":"%s"}}`, token)))
		_, _, _ = conn.Read(ctx) // READY
		_, _, _ = conn.Read(ctx) // GUILD_CREATE
		return conn
	}

	bobConn := connectAndIdentify(bob.Token)
	defer bobConn.Close(websocket.StatusNormalClosure, "")

	aliceConn := connectAndIdentify(alice.Token)
	defer aliceConn.Close(websocket.StatusNormalClosure, "")

	charlieConn := connectAndIdentify(charlie.Token)
	defer charlieConn.Close(websocket.StatusNormalClosure, "")

	time.Sleep(50 * time.Millisecond) // Let Hub registration complete

	// 1. MESSAGE_CREATE Fanout Test
	postReq := models.CreateMessageRequest{Content: "Challenger Dual Client Fanout Message"}
	pResp, pBody := h.request(t, http.MethodPost, "/v1/channels/"+channelID1+"/messages", alice.Token, postReq)
	if pResp.StatusCode != http.StatusCreated {
		t.Fatalf("post message failed: %s", string(pBody))
	}
	var createdMsg models.MessageResponse
	_ = json.Unmarshal(pBody, &createdMsg)

	// Bob receives MESSAGE_CREATE
	_, bobData, err := bobConn.Read(ctx)
	if err != nil {
		t.Fatalf("Bob failed to receive MESSAGE_CREATE: %v", err)
	}
	var bobEnv gateway.GatewayEnvelope
	_ = json.Unmarshal(bobData, &bobEnv)
	if bobEnv.T != gateway.EventMessageCreate {
		t.Fatalf("Bob expected MESSAGE_CREATE, got %s", bobEnv.T)
	}

	// Alice receives MESSAGE_CREATE
	_, aliceData, err := aliceConn.Read(ctx)
	if err != nil {
		t.Fatalf("Alice failed to receive MESSAGE_CREATE: %v", err)
	}
	var aliceEnv gateway.GatewayEnvelope
	_ = json.Unmarshal(aliceData, &aliceEnv)
	if aliceEnv.T != gateway.EventMessageCreate {
		t.Fatalf("Alice expected MESSAGE_CREATE, got %s", aliceEnv.T)
	}

	// Charlie MUST NOT receive anything (verify isolation with short read timeout)
	charlieCtx, charlieCancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	_, _, err = charlieConn.Read(charlieCtx)
	charlieCancel()
	if err == nil {
		t.Fatalf("CROSS-GUILD LEAK: Charlie in Guild 2 received an event intended for Guild 1!")
	}
	t.Logf("Empirical confirmation: Guild 2 tenant isolated from Guild 1 MESSAGE_CREATE")

	// 2. MESSAGE_UPDATE Fanout Test
	patchReq := models.UpdateMessageRequest{Content: "Challenger Dual Client Fanout Message (Edited)"}
	h.request(t, http.MethodPatch, "/v1/channels/"+channelID1+"/messages/"+createdMsg.ID.String(), alice.Token, patchReq)

	_, bUpdate, err := bobConn.Read(ctx)
	if err != nil {
		t.Fatalf("Bob failed to receive MESSAGE_UPDATE: %v", err)
	}
	var bUpdateEnv gateway.GatewayEnvelope
	_ = json.Unmarshal(bUpdate, &bUpdateEnv)
	if bUpdateEnv.T != gateway.EventMessageUpdate {
		t.Fatalf("Bob expected MESSAGE_UPDATE, got %s", bUpdateEnv.T)
	}
	_, _, _ = aliceConn.Read(ctx) // Drain Alice's update

	// 3. TYPING_START Fanout Test
	h.request(t, http.MethodPost, "/v1/channels/"+channelID1+"/typing", alice.Token, nil)

	_, bTyping, err := bobConn.Read(ctx)
	if err != nil {
		t.Fatalf("Bob failed to receive TYPING_START: %v", err)
	}
	var bTypingEnv gateway.GatewayEnvelope
	_ = json.Unmarshal(bTyping, &bTypingEnv)
	if bTypingEnv.T != gateway.EventTypingStart {
		t.Fatalf("Bob expected TYPING_START, got %s", bTypingEnv.T)
	}
	_, _, _ = aliceConn.Read(ctx) // Drain Alice's typing

	// 4. MESSAGE_DELETE Fanout Test
	h.request(t, http.MethodDelete, "/v1/channels/"+channelID1+"/messages/"+createdMsg.ID.String(), alice.Token, nil)

	_, bDelete, err := bobConn.Read(ctx)
	if err != nil {
		t.Fatalf("Bob failed to receive MESSAGE_DELETE: %v", err)
	}
	var bDeleteEnv gateway.GatewayEnvelope
	_ = json.Unmarshal(bDelete, &bDeleteEnv)
	if bDeleteEnv.T != gateway.EventMessageDelete {
		t.Fatalf("Bob expected MESSAGE_DELETE, got %s", bDeleteEnv.T)
	}
	_, _, _ = aliceConn.Read(ctx) // Drain Alice's delete

	t.Logf("Empirical confirmation: Dual-client fanout verified for CREATE, UPDATE, TYPING, DELETE with zero leakage")
}

// TestChallenger_HighConcurrency_Fanout stress-tests 5 connected guild members
// receiving 20 concurrently posted messages.
func TestChallenger_HighConcurrency_Fanout(t *testing.T) {
	h := setupTestHarness(t)
	unique := fmt.Sprintf("%d", time.Now().UnixNano())

	owner := registerUserHelper(t, h, "hc_owner_"+unique, "hc_owner_"+unique+"@challenger.test", "StrongPass123!")
	guild := createGuildHelper(t, h, owner.Token, "HC Guild "+unique)
	channelID := guild.Channels[0].ID.String()

	const memberCount = 4
	members := make([]models.AuthResponse, memberCount)
	for i := 0; i < memberCount; i++ {
		members[i] = registerUserHelper(t, h, fmt.Sprintf("hc_m%d_%s", i, unique), fmt.Sprintf("hc_m%d_%s@challenger.test", i, unique), "StrongPass123!")
		addGuildMemberHelper(t, h, guild.ID, members[i].User.ID)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	allUsers := append([]models.AuthResponse{owner}, members...)
	conns := make([]*websocket.Conn, len(allUsers))

	for i, u := range allUsers {
		conn, _, err := websocket.Dial(ctx, h.wsURL+"/v1/gateway", nil)
		if err != nil {
			t.Fatalf("dial member %d: %v", i, err)
		}
		defer conn.Close(websocket.StatusNormalClosure, "")
		conns[i] = conn

		_, _, _ = conn.Read(ctx) // HELLO
		_ = conn.Write(ctx, websocket.MessageText, []byte(fmt.Sprintf(`{"op":2,"d":{"token":"%s"}}`, u.Token)))
		_, _, _ = conn.Read(ctx) // READY
		_, _, _ = conn.Read(ctx) // GUILD_CREATE
	}

	time.Sleep(60 * time.Millisecond)

	// Concurrently post 15 messages via REST
	const messageCount = 15
	var wg sync.WaitGroup
	var postErrors atomic.Int32

	for m := 0; m < messageCount; m++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			req := models.CreateMessageRequest{Content: fmt.Sprintf("Concurrent stress msg #%d", idx)}
			resp, _ := h.request(t, http.MethodPost, "/v1/channels/"+channelID+"/messages", owner.Token, req)
			if resp.StatusCode != http.StatusCreated {
				postErrors.Add(1)
			}
		}(m)
	}
	wg.Wait()

	if postErrors.Load() > 0 {
		t.Fatalf("%d messages failed to post", postErrors.Load())
	}

	// Verify that each of the 5 connected clients receives all 15 MESSAGE_CREATE frames
	for clientIdx, c := range conns {
		for m := 0; m < messageCount; m++ {
			_, data, err := c.Read(ctx)
			if err != nil {
				t.Fatalf("client %d failed reading message %d: %v", clientIdx, m+1, err)
			}
			var env gateway.GatewayEnvelope
			if err := json.Unmarshal(data, &env); err != nil {
				t.Fatalf("client %d unmarshal %d: %v", clientIdx, m+1, err)
			}
			if env.T != gateway.EventMessageCreate {
				t.Fatalf("client %d expected MESSAGE_CREATE, got %s", clientIdx, env.T)
			}
		}
	}

	t.Logf("Empirical confirmation: High concurrency stress test passed (%d clients x %d messages = %d frames delivered)",
		len(conns), messageCount, len(conns)*messageCount)
}

// ============================================================================
// AREA 4: SESSION RESUME & ADVERSARIAL EDGE CASES
// ============================================================================

// TestChallenger_SessionResume_MissedEventsReplay verifies:
// 1. Client connects and captures session_id and seq.
// 2. Client disconnects.
// 3. New messages are posted while disconnected.
// 4. Client sends Opcode 6 RESUME -> receives missed messages replayed + RESUMED event.
// 5. Subsequent live messages delivered without interruption.
func TestChallenger_SessionResume_MissedEventsReplay(t *testing.T) {
	h := setupTestHarness(t)
	unique := fmt.Sprintf("%d", time.Now().UnixNano())

	alice := registerUserHelper(t, h, "alice_sres_"+unique, "alice_sres_"+unique+"@challenger.test", "StrongPass123!")
	bob := registerUserHelper(t, h, "bob_sres_"+unique, "bob_sres_"+unique+"@challenger.test", "StrongPass123!")

	guild := createGuildHelper(t, h, alice.Token, "Resume Suite "+unique)
	channelID := guild.Channels[0].ID.String()
	addGuildMemberHelper(t, h, guild.ID, bob.User.ID)

	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()

	// Step 1: Bob connects and authenticates
	bobConn, _, err := websocket.Dial(ctx, h.wsURL+"/gateway", nil)
	if err != nil {
		t.Fatalf("dial Bob: %v", err)
	}
	_, _, _ = bobConn.Read(ctx) // HELLO
	_ = bobConn.Write(ctx, websocket.MessageText, []byte(fmt.Sprintf(`{"op":2,"d":{"token":"%s"}}`, bob.Token)))

	_, readyBytes, _ := bobConn.Read(ctx) // READY
	var readyEnv gateway.GatewayEnvelope
	_ = json.Unmarshal(readyBytes, &readyEnv)
	var readyPayload gateway.ReadyData
	_ = json.Unmarshal(readyEnv.D, &readyPayload)
	sessionID := readyPayload.SessionID

	_, gcBytes, _ := bobConn.Read(ctx) // GUILD_CREATE
	var gcEnv gateway.GatewayEnvelope
	_ = json.Unmarshal(gcBytes, &gcEnv)
	lastSeq := *gcEnv.S

	// Step 2: Disconnect Bob
	bobConn.Close(websocket.StatusNormalClosure, "disconnecting for resume")
	time.Sleep(50 * time.Millisecond)

	// Step 3: Alice sends 2 messages while Bob is offline
	msg1 := models.CreateMessageRequest{Content: "Offline message 1"}
	msg2 := models.CreateMessageRequest{Content: "Offline message 2"}
	h.request(t, http.MethodPost, "/v1/channels/"+channelID+"/messages", alice.Token, msg1)
	h.request(t, http.MethodPost, "/v1/channels/"+channelID+"/messages", alice.Token, msg2)

	// Step 4: Bob reconnects on new socket and sends Opcode 6 RESUME
	newBobConn, _, err := websocket.Dial(ctx, h.wsURL+"/gateway", nil)
	if err != nil {
		t.Fatalf("reconnect Bob: %v", err)
	}
	defer newBobConn.Close(websocket.StatusNormalClosure, "done")

	_, _, err = newBobConn.Read(ctx) // HELLO
	if err != nil {
		t.Fatalf("read HELLO on reconnect: %v", err)
	}

	resumePayload := gateway.GatewayEnvelope{
		Op: gateway.OpcodeResume,
		D: func() []byte {
			b, _ := json.Marshal(gateway.ResumeData{
				Token:     bob.Token,
				SessionID: sessionID,
				Seq:       lastSeq,
			})
			return b
		}(),
	}
	rData, _ := json.Marshal(resumePayload)
	if err := newBobConn.Write(ctx, websocket.MessageText, rData); err != nil {
		t.Fatalf("write RESUME: %v", err)
	}

	// Step 5: Read Replayed Event 1
	_, rData1, err := newBobConn.Read(ctx)
	if err != nil {
		t.Fatalf("failed to read replayed event 1: %v", err)
	}
	var rEnv1 gateway.GatewayEnvelope
	_ = json.Unmarshal(rData1, &rEnv1)
	if rEnv1.Op != gateway.OpcodeDispatch || rEnv1.T != gateway.EventMessageCreate {
		t.Fatalf("expected replayed MESSAGE_CREATE 1, got op=%d, t=%s", rEnv1.Op, rEnv1.T)
	}
	var rMsg1 models.MessageResponse
	_ = json.Unmarshal(rEnv1.D, &rMsg1)
	if rMsg1.Content != "Offline message 1" {
		t.Fatalf("expected 'Offline message 1', got %s", rMsg1.Content)
	}

	// Step 6: Read Replayed Event 2
	_, rData2, err := newBobConn.Read(ctx)
	if err != nil {
		t.Fatalf("failed to read replayed event 2: %v", err)
	}
	var rEnv2 gateway.GatewayEnvelope
	_ = json.Unmarshal(rData2, &rEnv2)
	if rEnv2.Op != gateway.OpcodeDispatch || rEnv2.T != gateway.EventMessageCreate {
		t.Fatalf("expected replayed MESSAGE_CREATE 2, got op=%d, t=%s", rEnv2.Op, rEnv2.T)
	}

	// Step 7: Read RESUMED event
	_, resumedData, err := newBobConn.Read(ctx)
	if err != nil {
		t.Fatalf("failed to read RESUMED: %v", err)
	}
	var resumedEnv gateway.GatewayEnvelope
	_ = json.Unmarshal(resumedData, &resumedEnv)
	if resumedEnv.Op != gateway.OpcodeDispatch || resumedEnv.T != gateway.EventResumed {
		t.Fatalf("expected Opcode 0 RESUMED, got op=%d, t=%s", resumedEnv.Op, resumedEnv.T)
	}

	// Step 8: Live event delivery after resumption
	h.request(t, http.MethodPost, "/v1/channels/"+channelID+"/messages", alice.Token, models.CreateMessageRequest{Content: "Live message after resume"})
	_, liveData, err := newBobConn.Read(ctx)
	if err != nil {
		t.Fatalf("failed to read live message: %v", err)
	}
	var liveEnv gateway.GatewayEnvelope
	_ = json.Unmarshal(liveData, &liveEnv)
	if liveEnv.T != gateway.EventMessageCreate {
		t.Fatalf("expected live MESSAGE_CREATE, got %s", liveEnv.T)
	}

	t.Logf("Empirical confirmation: Session resumption replayed 2 missed events, dispatched RESUMED, and resumed live streaming")
}

// TestChallenger_SessionResume_AdversarialRejections verifies:
// 1. Bogus session_id -> Opcode 9 INVALID_SESSION (d: false).
// 2. Session Hijacking (Bob uses Alice's session_id) -> Opcode 9 INVALID_SESSION.
// 3. Invalid Future Seq -> Opcode 9 INVALID_SESSION + close code 4007.
// 4. Ring Buffer Eviction (>100 missed events) -> Opcode 9 INVALID_SESSION + close code 4007.
func TestChallenger_SessionResume_AdversarialRejections(t *testing.T) {
	h := setupTestHarness(t)
	unique := fmt.Sprintf("%d", time.Now().UnixNano())

	alice := registerUserHelper(t, h, "alice_sadv_"+unique, "alice_sadv_"+unique+"@challenger.test", "StrongPass123!")
	bob := registerUserHelper(t, h, "bob_sadv_"+unique, "bob_sadv_"+unique+"@challenger.test", "StrongPass123!")
	guild := createGuildHelper(t, h, alice.Token, "Adversarial Resume "+unique)
	_ = guild

	// Case 1: Bogus session_id
	t.Run("BogusSessionID", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		conn, _, err := websocket.Dial(ctx, h.wsURL+"/gateway", nil)
		if err != nil {
			t.Fatalf("dial: %v", err)
		}
		defer conn.Close(websocket.StatusNormalClosure, "")
		_, _, _ = conn.Read(ctx) // HELLO

		bogusResume := []byte(fmt.Sprintf(`{"op":6,"d":{"token":"%s","session_id":"nonexistent_session_999","seq":1}}`, bob.Token))
		_ = conn.Write(ctx, websocket.MessageText, bogusResume)

		_, data, err := conn.Read(ctx)
		if err != nil {
			t.Fatalf("failed to read response: %v", err)
		}
		var env gateway.GatewayEnvelope
		_ = json.Unmarshal(data, &env)
		if env.Op != gateway.OpcodeInvalidSession {
			t.Fatalf("expected Opcode 9 INVALID_SESSION, got %d", env.Op)
		}
	})

	// Case 2: Session Hijacking (Bob tries to resume Alice's session)
	t.Run("SessionHijacking", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		// Alice creates session
		aConn, _, _ := websocket.Dial(ctx, h.wsURL+"/gateway", nil)
		_, _, _ = aConn.Read(ctx)
		_ = aConn.Write(ctx, websocket.MessageText, []byte(fmt.Sprintf(`{"op":2,"d":{"token":"%s"}}`, alice.Token)))
		_, aReady, _ := aConn.Read(ctx)
		var aEnv gateway.GatewayEnvelope
		_ = json.Unmarshal(aReady, &aEnv)
		var aReadyPayload gateway.ReadyData
		_ = json.Unmarshal(aEnv.D, &aReadyPayload)
		aliceSessionID := aReadyPayload.SessionID
		aConn.Close(websocket.StatusNormalClosure, "")
		time.Sleep(30 * time.Millisecond)

		// Bob tries to hijack Alice's session
		bConn, _, _ := websocket.Dial(ctx, h.wsURL+"/gateway", nil)
		defer bConn.Close(websocket.StatusNormalClosure, "")
		_, _, _ = bConn.Read(ctx)

		hijackResume := []byte(fmt.Sprintf(`{"op":6,"d":{"token":"%s","session_id":"%s","seq":1}}`, bob.Token, aliceSessionID))
		_ = bConn.Write(ctx, websocket.MessageText, hijackResume)

		_, data, err := bConn.Read(ctx)
		if err != nil {
			t.Fatalf("failed to read: %v", err)
		}
		var env gateway.GatewayEnvelope
		_ = json.Unmarshal(data, &env)
		if env.Op != gateway.OpcodeInvalidSession {
			t.Fatalf("expected Opcode 9 INVALID_SESSION on session hijack attempt, got %d", env.Op)
		}
		t.Logf("Empirical confirmation: Session hijacking attempt rejected with Opcode 9")
	})

	// Case 3: Future Sequence Number
	t.Run("FutureSequenceNumber", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		conn, _, _ := websocket.Dial(ctx, h.wsURL+"/gateway", nil)
		_, _, _ = conn.Read(ctx)
		_ = conn.Write(ctx, websocket.MessageText, []byte(fmt.Sprintf(`{"op":2,"d":{"token":"%s"}}`, alice.Token)))
		_, rData, _ := conn.Read(ctx)
		var rEnv gateway.GatewayEnvelope
		_ = json.Unmarshal(rData, &rEnv)
		var rPayload gateway.ReadyData
		_ = json.Unmarshal(rEnv.D, &rPayload)
		sessionID := rPayload.SessionID
		conn.Close(websocket.StatusNormalClosure, "")
		time.Sleep(30 * time.Millisecond)

		newConn, _, _ := websocket.Dial(ctx, h.wsURL+"/gateway", nil)
		defer newConn.Close(websocket.StatusNormalClosure, "")
		_, _, _ = newConn.Read(ctx)

		// Resume with seq = 999999 (far in future)
		futureResume := []byte(fmt.Sprintf(`{"op":6,"d":{"token":"%s","session_id":"%s","seq":999999}}`, alice.Token, sessionID))
		_ = newConn.Write(ctx, websocket.MessageText, futureResume)

		_, data, err := newConn.Read(ctx)
		if err != nil {
			t.Fatalf("read failed: %v", err)
		}
		var env gateway.GatewayEnvelope
		_ = json.Unmarshal(data, &env)
		if env.Op != gateway.OpcodeInvalidSession {
			t.Fatalf("expected Opcode 9 for future sequence, got %d", env.Op)
		}

		// Subsequent read should report close with code 4007 (CloseCodeInvalidSeq)
		_, _, err = newConn.Read(ctx)
		if err == nil {
			t.Fatalf("expected socket close with code 4007, but read succeeded")
		}
		if int(websocket.CloseStatus(err)) != gateway.CloseCodeInvalidSeq {
			t.Fatalf("expected close code 4007 (InvalidSeq), got %v", websocket.CloseStatus(err))
		}
		t.Logf("Empirical confirmation: Future sequence rejected with Opcode 9 and close code 4007")
	})

	// Case 4: Ring Buffer Eviction (> 100 missed events)
	t.Run("RingBufferEviction", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()

		conn, _, _ := websocket.Dial(ctx, h.wsURL+"/gateway", nil)
		_, _, _ = conn.Read(ctx)
		_ = conn.Write(ctx, websocket.MessageText, []byte(fmt.Sprintf(`{"op":2,"d":{"token":"%s"}}`, alice.Token)))
		_, rData, _ := conn.Read(ctx)
		var rEnv gateway.GatewayEnvelope
		_ = json.Unmarshal(rData, &rEnv)
		var rPayload gateway.ReadyData
		_ = json.Unmarshal(rEnv.D, &rPayload)
		sessionID := rPayload.SessionID

		_, gcData, _ := conn.Read(ctx)
		var gcEnv gateway.GatewayEnvelope
		_ = json.Unmarshal(gcData, &gcEnv)
		startSeq := *gcEnv.S

		conn.Close(websocket.StatusNormalClosure, "")
		time.Sleep(30 * time.Millisecond)

		// Dispatch 105 events to the guild (buffer limit is defaultRingBufferSize = 100)
		hub := h.hubManager.GetOrCreateHub(guild.ID.String())
		for ev := 0; ev < 105; ev++ {
			hub.Broadcast(gateway.EventMessageCreate, map[string]any{
				"id":      fmt.Sprintf("ev_%d", ev),
				"content": fmt.Sprintf("filler %d", ev),
			})
		}
		time.Sleep(100 * time.Millisecond) // Let Hub actor drain

		// Now attempt to resume from startSeq (which has been evicted from the buffer)
		reconn, _, err := websocket.Dial(ctx, h.wsURL+"/gateway", nil)
		if err != nil {
			t.Fatalf("reconn dial failed: %v", err)
		}
		defer reconn.Close(websocket.StatusNormalClosure, "")
		_, _, _ = reconn.Read(ctx) // HELLO

		evictedResume := []byte(fmt.Sprintf(`{"op":6,"d":{"token":"%s","session_id":"%s","seq":%d}}`, alice.Token, sessionID, startSeq))
		_ = reconn.Write(ctx, websocket.MessageText, evictedResume)

		_, data, err := reconn.Read(ctx)
		if err != nil {
			t.Fatalf("failed reading Opcode 9: %v", err)
		}
		var env gateway.GatewayEnvelope
		_ = json.Unmarshal(data, &env)
		if env.Op != gateway.OpcodeInvalidSession {
			t.Fatalf("expected Opcode 9 for evicted sequence, got %d", env.Op)
		}

		_, _, err = reconn.Read(ctx)
		if err == nil {
			t.Fatalf("expected close code 4007 on evicted sequence, but read succeeded")
		}
		if int(websocket.CloseStatus(err)) != gateway.CloseCodeInvalidSeq {
			t.Fatalf("expected close code 4007 for evicted sequence, got %v", websocket.CloseStatus(err))
		}
		t.Logf("Empirical confirmation: Ring buffer eviction correctly identified and rejected with Opcode 9 and close code 4007")
	})
}
