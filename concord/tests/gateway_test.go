package tests

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"nhooyr.io/websocket"

	"concord/internal/gateway"
	"concord/internal/models"
)

func TestGateway_HandshakeLifecycle(t *testing.T) {
	h := setupTestHarness(t)
	unique := fmt.Sprintf("%d", time.Now().UnixNano())

	user := registerUserHelper(t, h, "gw_user_"+unique, "gw_user_"+unique+"@example.com", "supersecret123")
	guild := createGuildHelper(t, h, user.Token, "GW Guild "+unique)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// 1. Connect to /v1/gateway
	wsConn, _, err := websocket.Dial(ctx, h.wsURL+"/v1/gateway", nil)
	if err != nil {
		t.Fatalf("failed to dial websocket: %v", err)
	}
	defer wsConn.Close(websocket.StatusNormalClosure, "test finished")

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
		t.Fatalf("expected opcode 10 (HELLO), got %d", helloEnv.Op)
	}
	var helloData gateway.HelloData
	if err := json.Unmarshal(helloEnv.D, &helloData); err != nil {
		t.Fatalf("failed to unmarshal HelloData: %v", err)
	}
	if helloData.HeartbeatInterval != gateway.HeartbeatIntervalMs {
		t.Fatalf("expected heartbeat_interval %d, got %d", gateway.HeartbeatIntervalMs, helloData.HeartbeatInterval)
	}

	// 3. Send Opcode 1 HEARTBEAT -> Expect Opcode 11 HEARTBEAT_ACK
	hbMsg := []byte(`{"op":1,"d":null}`)
	if err := wsConn.Write(ctx, websocket.MessageText, hbMsg); err != nil {
		t.Fatalf("failed to write heartbeat: %v", err)
	}

	_, ackData, err := wsConn.Read(ctx)
	if err != nil {
		t.Fatalf("failed to read HEARTBEAT_ACK: %v", err)
	}
	var ackEnv gateway.GatewayEnvelope
	if err := json.Unmarshal(ackData, &ackEnv); err != nil {
		t.Fatalf("failed to unmarshal HEARTBEAT_ACK: %v", err)
	}
	if ackEnv.Op != gateway.OpcodeHeartbeatACK {
		t.Fatalf("expected opcode 11 (HEARTBEAT_ACK), got %d", ackEnv.Op)
	}

	// 4. Send Opcode 2 IDENTIFY
	identifyData, err := json.Marshal(gateway.GatewayEnvelope{
		Op: gateway.OpcodeIdentify,
		D:  []byte(fmt.Sprintf(`{"token":"%s"}`, user.Token)),
	})
	if err != nil {
		t.Fatalf("failed to marshal IDENTIFY: %v", err)
	}
	if err := wsConn.Write(ctx, websocket.MessageText, identifyData); err != nil {
		t.Fatalf("failed to write IDENTIFY: %v", err)
	}

	// 5. Read Opcode 0 READY
	_, readyBytes, err := wsConn.Read(ctx)
	if err != nil {
		t.Fatalf("failed to read READY: %v", err)
	}
	var readyEnv gateway.GatewayEnvelope
	if err := json.Unmarshal(readyBytes, &readyEnv); err != nil {
		t.Fatalf("failed to unmarshal READY envelope: %v", err)
	}
	if readyEnv.Op != gateway.OpcodeDispatch || readyEnv.T != gateway.EventReady {
		t.Fatalf("expected Opcode 0 READY, got op=%d t=%s", readyEnv.Op, readyEnv.T)
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
	if len(readyPayload.Guilds) != 1 || readyPayload.Guilds[0].ID != guild.ID.String() {
		t.Fatalf("ready guilds mismatch: %+v", readyPayload.Guilds)
	}

	// 6. Read Opcode 0 GUILD_CREATE
	_, gcBytes, err := wsConn.Read(ctx)
	if err != nil {
		t.Fatalf("failed to read GUILD_CREATE: %v", err)
	}
	var gcEnv gateway.GatewayEnvelope
	if err := json.Unmarshal(gcBytes, &gcEnv); err != nil {
		t.Fatalf("failed to unmarshal GUILD_CREATE envelope: %v", err)
	}
	if gcEnv.Op != gateway.OpcodeDispatch || gcEnv.T != gateway.EventGuildCreate {
		t.Fatalf("expected Opcode 0 GUILD_CREATE, got op=%d t=%s", gcEnv.Op, gcEnv.T)
	}
	if gcEnv.S == nil || *gcEnv.S != 2 {
		t.Fatalf("expected sequence 2 for GUILD_CREATE, got %v", gcEnv.S)
	}
}

func TestGateway_AuthenticationRejection(t *testing.T) {
	h := setupTestHarness(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	wsConn, _, err := websocket.Dial(ctx, h.wsURL+"/gateway", nil)
	if err != nil {
		t.Fatalf("failed to dial websocket: %v", err)
	}
	defer wsConn.Close(websocket.StatusNormalClosure, "test cleanup")

	// Read HELLO
	_, _, err = wsConn.Read(ctx)
	if err != nil {
		t.Fatalf("failed to read HELLO: %v", err)
	}

	// Send invalid IDENTIFY
	badIdentify := []byte(`{"op":2,"d":{"token":"invalid.jwt.token"}}`)
	if err := wsConn.Write(ctx, websocket.MessageText, badIdentify); err != nil {
		t.Fatalf("failed to write invalid IDENTIFY: %v", err)
	}

	// Expect close with code 4004 (Authentication Failed)
	_, _, err = wsConn.Read(ctx)
	if err == nil {
		t.Fatalf("expected connection to be closed with code 4004, but read succeeded")
	}

	closeStatus := websocket.CloseStatus(err)
	if int(closeStatus) != gateway.CloseCodeAuthenticationFailed {
		t.Fatalf("expected close status code 4004, got %v (err: %v)", closeStatus, err)
	}
}

func TestGateway_AlreadyAuthenticatedRejection(t *testing.T) {
	h := setupTestHarness(t)
	unique := fmt.Sprintf("%d", time.Now().UnixNano())

	user := registerUserHelper(t, h, "gw_auth2_"+unique, "gw_auth2_"+unique+"@example.com", "supersecret123")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	wsConn, _, err := websocket.Dial(ctx, h.wsURL+"/gateway", nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer wsConn.Close(websocket.StatusNormalClosure, "")

	// Read HELLO
	_, _, _ = wsConn.Read(ctx)

	// Send valid IDENTIFY
	validIdentify := []byte(fmt.Sprintf(`{"op":2,"d":{"token":"%s"}}`, user.Token))
	_ = wsConn.Write(ctx, websocket.MessageText, validIdentify)

	// Read READY
	_, _, _ = wsConn.Read(ctx)

	// Send second IDENTIFY -> protocol violation
	_ = wsConn.Write(ctx, websocket.MessageText, validIdentify)

	// Expect close code 4005 (Already authenticated)
	_, _, err = wsConn.Read(ctx)
	if err == nil {
		t.Fatalf("expected close with 4005, but read succeeded")
	}
	closeStatus := websocket.CloseStatus(err)
	if int(closeStatus) != gateway.CloseCodeAlreadyAuthenticated {
		t.Fatalf("expected close status code 4005, got %v (err: %v)", closeStatus, err)
	}
}

func TestGateway_RealTimeHubFanout(t *testing.T) {
	h := setupTestHarness(t)
	unique := fmt.Sprintf("%d", time.Now().UnixNano())

	alice := registerUserHelper(t, h, "alice_rt_"+unique, "alice_rt_"+unique+"@example.com", "supersecret123")
	bob := registerUserHelper(t, h, "bob_rt_"+unique, "bob_rt_"+unique+"@example.com", "supersecret123")

	guild := createGuildHelper(t, h, alice.Token, "Fanout Guild "+unique)
	channelID := guild.Channels[0].ID.String()

	// Add Bob to guild
	addGuildMemberHelper(t, h, guild.ID, bob.User.ID)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Connect Bob's WebSocket and complete handshake
	bobConn, _, err := websocket.Dial(ctx, h.wsURL+"/v1/gateway", nil)
	if err != nil {
		t.Fatalf("dial Bob websocket: %v", err)
	}
	defer bobConn.Close(websocket.StatusNormalClosure, "done")

	// Read HELLO for Bob
	_, _, _ = bobConn.Read(ctx)

	// Identify Bob
	bobIdentify := []byte(fmt.Sprintf(`{"op":2,"d":{"token":"%s"}}`, bob.Token))
	_ = bobConn.Write(ctx, websocket.MessageText, bobIdentify)

	// Read Bob's READY and GUILD_CREATE
	_, _, _ = bobConn.Read(ctx) // READY
	_, _, _ = bobConn.Read(ctx) // GUILD_CREATE

	// Connect Alice's WebSocket and complete handshake
	aliceConn, _, err := websocket.Dial(ctx, h.wsURL+"/v1/gateway", nil)
	if err != nil {
		t.Fatalf("dial Alice websocket: %v", err)
	}
	defer aliceConn.Close(websocket.StatusNormalClosure, "done")

	_, _, _ = aliceConn.Read(ctx) // HELLO
	aliceIdentify := []byte(fmt.Sprintf(`{"op":2,"d":{"token":"%s"}}`, alice.Token))
	_ = aliceConn.Write(ctx, websocket.MessageText, aliceIdentify)
	_, _, _ = aliceConn.Read(ctx) // READY
	_, _, _ = aliceConn.Read(ctx) // GUILD_CREATE

	// Wait brief moment for Hub registrations to settle
	time.Sleep(30 * time.Millisecond)

	// 1. MESSAGE_CREATE Fanout Test
	// Alice posts message via REST API
	postReq := models.CreateMessageRequest{Content: "Real-time fanout test"}
	pResp, pBody := h.request(t, http.MethodPost, "/v1/channels/"+channelID+"/messages", alice.Token, postReq)
	if pResp.StatusCode != http.StatusCreated {
		t.Fatalf("post message failed: %s", string(pBody))
	}
	var createdMsg models.MessageResponse
	_ = json.Unmarshal(pBody, &createdMsg)

	// Bob must receive MESSAGE_CREATE over WebSocket
	_, bobMsgData, err := bobConn.Read(ctx)
	if err != nil {
		t.Fatalf("Bob failed to receive MESSAGE_CREATE: %v", err)
	}
	var createEnv gateway.GatewayEnvelope
	if err := json.Unmarshal(bobMsgData, &createEnv); err != nil {
		t.Fatalf("unmarshal createEnv: %v", err)
	}
	if createEnv.Op != gateway.OpcodeDispatch || createEnv.T != gateway.EventMessageCreate {
		t.Fatalf("expected MESSAGE_CREATE, got op=%d t=%s", createEnv.Op, createEnv.T)
	}
	var receivedMsg models.MessageResponse
	if err := json.Unmarshal(createEnv.D, &receivedMsg); err != nil {
		t.Fatalf("unmarshal receivedMsg: %v", err)
	}
	if receivedMsg.ID != createdMsg.ID || receivedMsg.Content != "Real-time fanout test" {
		t.Fatalf("received message mismatch: %+v", receivedMsg)
	}

	// Also verify Alice received her own MESSAGE_CREATE over WebSocket
	_, aliceMsgData, err := aliceConn.Read(ctx)
	if err != nil {
		t.Fatalf("Alice failed to receive MESSAGE_CREATE: %v", err)
	}
	var aliceEnv gateway.GatewayEnvelope
	_ = json.Unmarshal(aliceMsgData, &aliceEnv)
	if aliceEnv.T != gateway.EventMessageCreate {
		t.Fatalf("Alice expected MESSAGE_CREATE, got %s", aliceEnv.T)
	}

	// 2. MESSAGE_UPDATE Fanout Test
	// Alice edits message via REST API
	patchReq := models.UpdateMessageRequest{Content: "Real-time fanout test (edited)"}
	h.request(t, http.MethodPatch, "/v1/channels/"+channelID+"/messages/"+createdMsg.ID.String(), alice.Token, patchReq)

	// Bob receives MESSAGE_UPDATE
	_, bobUpdateData, err := bobConn.Read(ctx)
	if err != nil {
		t.Fatalf("Bob failed to receive MESSAGE_UPDATE: %v", err)
	}
	var updateEnv gateway.GatewayEnvelope
	_ = json.Unmarshal(bobUpdateData, &updateEnv)
	if updateEnv.T != gateway.EventMessageUpdate {
		t.Fatalf("expected MESSAGE_UPDATE, got %s", updateEnv.T)
	}

	// Alice also drains her MESSAGE_UPDATE
	_, _, _ = aliceConn.Read(ctx)

	// 3. TYPING_START Fanout Test
	// Alice triggers typing via REST API
	h.request(t, http.MethodPost, "/v1/channels/"+channelID+"/typing", alice.Token, nil)

	// Bob receives TYPING_START
	_, bobTypingData, err := bobConn.Read(ctx)
	if err != nil {
		t.Fatalf("Bob failed to receive TYPING_START: %v", err)
	}
	var typingEnv gateway.GatewayEnvelope
	_ = json.Unmarshal(bobTypingData, &typingEnv)
	if typingEnv.T != gateway.EventTypingStart {
		t.Fatalf("expected TYPING_START, got %s", typingEnv.T)
	}
	var typingPayload models.TypingStartPayload
	_ = json.Unmarshal(typingEnv.D, &typingPayload)
	if typingPayload.UserID != alice.User.ID || typingPayload.ChannelID.String() != channelID {
		t.Fatalf("typing payload mismatch: %+v", typingPayload)
	}

	// Alice also drains TYPING_START
	_, _, _ = aliceConn.Read(ctx)

	// 4. MESSAGE_DELETE Fanout Test
	// Alice deletes message via REST API
	h.request(t, http.MethodDelete, "/v1/channels/"+channelID+"/messages/"+createdMsg.ID.String(), alice.Token, nil)

	// Bob receives MESSAGE_DELETE
	_, bobDeleteData, err := bobConn.Read(ctx)
	if err != nil {
		t.Fatalf("Bob failed to receive MESSAGE_DELETE: %v", err)
	}
	var deleteEnv gateway.GatewayEnvelope
	_ = json.Unmarshal(bobDeleteData, &deleteEnv)
	if deleteEnv.T != gateway.EventMessageDelete {
		t.Fatalf("expected MESSAGE_DELETE, got %s", deleteEnv.T)
	}
	var deletePayload models.MessageDeletePayload
	_ = json.Unmarshal(deleteEnv.D, &deletePayload)
	if deletePayload.ID != createdMsg.ID || deletePayload.ChannelID.String() != channelID {
		t.Fatalf("delete payload mismatch: %+v", deletePayload)
	}
}

func TestGateway_SessionResumeAndInvalidSession(t *testing.T) {
	h := setupTestHarness(t)
	unique := fmt.Sprintf("%d", time.Now().UnixNano())

	alice := registerUserHelper(t, h, "alice_res_"+unique, "alice_res_"+unique+"@example.com", "supersecret123")
	bob := registerUserHelper(t, h, "bob_res_"+unique, "bob_res_"+unique+"@example.com", "supersecret123")
	guild := createGuildHelper(t, h, alice.Token, "Resume Guild "+unique)
	channelID := guild.Channels[0].ID.String()
	addGuildMemberHelper(t, h, guild.ID, bob.User.ID)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// 1. Test Invalid Session (Opcode 9)
	badConn, _, err := websocket.Dial(ctx, h.wsURL+"/gateway", nil)
	if err != nil {
		t.Fatalf("dial badConn: %v", err)
	}
	_, _, _ = badConn.Read(ctx) // HELLO
	badResume := []byte(`{"op":6,"d":{"token":"` + bob.Token + `","session_id":"bogus_session_123","seq":5}}`)
	_ = badConn.Write(ctx, websocket.MessageText, badResume)

	_, invalidData, err := badConn.Read(ctx)
	if err != nil {
		t.Fatalf("read invalid session: %v", err)
	}
	var invEnv gateway.GatewayEnvelope
	_ = json.Unmarshal(invalidData, &invEnv)
	if invEnv.Op != gateway.OpcodeInvalidSession {
		t.Fatalf("expected Opcode 9 INVALID_SESSION, got %d", invEnv.Op)
	}
	badConn.Close(websocket.StatusNormalClosure, "")

	// 2. Successful Session Resumption
	// Connect Bob, authenticate, capture session_id and seq
	bobConn, _, err := websocket.Dial(ctx, h.wsURL+"/gateway", nil)
	if err != nil {
		t.Fatalf("dial bobConn: %v", err)
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

	// Disconnect Bob cleanly
	bobConn.Close(websocket.StatusNormalClosure, "disconnecting for resume test")
	time.Sleep(50 * time.Millisecond)

	// Alice posts a message while Bob is disconnected
	pResp, pBody := h.request(t, http.MethodPost, "/v1/channels/"+channelID+"/messages", alice.Token, models.CreateMessageRequest{Content: "Message sent during Bob's disconnect"})
	if pResp.StatusCode != http.StatusCreated {
		t.Fatalf("post message during disconnect failed: %s", string(pBody))
	}
	var missedMsg models.MessageResponse
	_ = json.Unmarshal(pBody, &missedMsg)

	// Bob reconnects with a fresh socket
	newBobConn, _, err := websocket.Dial(ctx, h.wsURL+"/gateway", nil)
	if err != nil {
		t.Fatalf("reconnect Bob: %v", err)
	}
	defer newBobConn.Close(websocket.StatusNormalClosure, "done")

	// Read HELLO
	_, _, err = newBobConn.Read(ctx)
	if err != nil {
		t.Fatalf("failed to read HELLO on reconnect: %v", err)
	}

	// Bob sends RESUME (Opcode 6) with his previous sessionID and lastSeq
	resumeData := gateway.ResumeData{
		Token:     bob.Token,
		SessionID: sessionID,
		Seq:       lastSeq,
	}
	rBytes, _ := json.Marshal(gateway.GatewayEnvelope{
		Op: gateway.OpcodeResume,
		D:  func() []byte { b, _ := json.Marshal(resumeData); return b }(),
	})
	if err := newBobConn.Write(ctx, websocket.MessageText, rBytes); err != nil {
		t.Fatalf("failed to write RESUME: %v", err)
	}

	// Bob must receive the missed MESSAGE_CREATE replayed!
	_, replayedBytes, err := newBobConn.Read(ctx)
	if err != nil {
		t.Fatalf("failed to receive replayed frame: %v", err)
	}
	var replayEnv gateway.GatewayEnvelope
	if err := json.Unmarshal(replayedBytes, &replayEnv); err != nil {
		t.Fatalf("unmarshal replayEnv: %v", err)
	}
	if replayEnv.Op != gateway.OpcodeDispatch || replayEnv.T != gateway.EventMessageCreate {
		t.Fatalf("expected replayed MESSAGE_CREATE, got op=%d t=%s", replayEnv.Op, replayEnv.T)
	}
	var replayedMsg models.MessageResponse
	if err := json.Unmarshal(replayEnv.D, &replayedMsg); err != nil {
		t.Fatalf("unmarshal replayedMsg: %v", err)
	}
	if replayedMsg.ID != missedMsg.ID || replayedMsg.Content != "Message sent during Bob's disconnect" {
		t.Fatalf("replayed message content mismatch: %+v", replayedMsg)
	}

	// Next, Bob must receive the RESUMED event
	_, resumedBytes, err := newBobConn.Read(ctx)
	if err != nil {
		t.Fatalf("failed to receive RESUMED event: %v", err)
	}
	var resumedEnv gateway.GatewayEnvelope
	_ = json.Unmarshal(resumedBytes, &resumedEnv)
	if resumedEnv.Op != gateway.OpcodeDispatch || resumedEnv.T != gateway.EventResumed {
		t.Fatalf("expected Opcode 0 RESUMED, got op=%d t=%s", resumedEnv.Op, resumedEnv.T)
	}
}
