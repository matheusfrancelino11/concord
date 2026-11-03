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

// TestMilestone5_ScreenShareVoiceState tests:
// 1. Alice and Bob join a guild and connect to Gateway WebSocket.
// 2. Alice connects to voice channel (Opcode 4).
// 3. Alice starts screen share: sends Opcode 4 with self_stream = true.
// 4. Bob receives VOICE_STATE_UPDATE broadcast with self_stream = true.
// 5. Database voice_states table confirms self_stream is persisted as true.
// 6. Alice stops screen share: sends Opcode 4 with self_stream = false.
// 7. Bob receives VOICE_STATE_UPDATE broadcast with self_stream = false.
// 8. Database voice_states table confirms self_stream is updated to false.
func TestMilestone5_ScreenShareVoiceState(t *testing.T) {
	h := setupTestHarness(t)
	unique := fmt.Sprintf("%d", time.Now().UnixNano())

	alice := registerUserHelper(t, h, "ss_alice_"+unique, "ss_alice_"+unique+"@test.com", "Password123!")
	bob := registerUserHelper(t, h, "ss_bob_"+unique, "ss_bob_"+unique+"@test.com", "Password123!")

	guild := createGuildHelper(t, h, alice.Token, "ScreenShare Guild "+unique)
	addGuildMemberHelper(t, h, guild.ID, bob.User.ID)

	// Create a voice channel
	voiceChannelReq := models.CreateChannelRequest{
		Name: "Stream Room " + unique,
		Type: 2,
	}
	resp, body := h.request(t, http.MethodPost, "/v1/guilds/"+guild.ID.String()+"/channels", alice.Token, voiceChannelReq)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("failed to create voice channel: %s", string(body))
	}
	var voiceCh models.ChannelResponse
	_ = json.Unmarshal(body, &voiceCh)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Connect Bob to Gateway
	bobConn, _, err := websocket.Dial(ctx, h.wsURL+"/v1/gateway", nil)
	if err != nil {
		t.Fatalf("dial bob: %v", err)
	}
	defer bobConn.Close(websocket.StatusNormalClosure, "")

	_, _, _ = bobConn.Read(ctx) // HELLO
	_ = bobConn.Write(ctx, websocket.MessageText, []byte(fmt.Sprintf(`{"op":2,"d":{"token":"%s"}}`, bob.Token)))
	_, _, _ = bobConn.Read(ctx) // READY
	_, _, _ = bobConn.Read(ctx) // GUILD_CREATE

	// Connect Alice to Gateway
	aliceConn, _, err := websocket.Dial(ctx, h.wsURL+"/v1/gateway", nil)
	if err != nil {
		t.Fatalf("dial alice: %v", err)
	}
	defer aliceConn.Close(websocket.StatusNormalClosure, "")

	_, _, _ = aliceConn.Read(ctx) // HELLO
	_ = aliceConn.Write(ctx, websocket.MessageText, []byte(fmt.Sprintf(`{"op":2,"d":{"token":"%s"}}`, alice.Token)))
	_, _, _ = aliceConn.Read(ctx) // READY
	_, _, _ = aliceConn.Read(ctx) // GUILD_CREATE

	// Drain Alice's online presence event on Bob
	_, _, _ = bobConn.Read(ctx)

	// 1. Alice joins voice channel
	joinVoiceOp := fmt.Sprintf(`{"op":4,"d":{"guild_id":"%s","channel_id":"%s","self_mute":false,"self_deaf":false,"self_stream":false}}`,
		guild.ID.String(), voiceCh.ID.String())
	_ = aliceConn.Write(ctx, websocket.MessageText, []byte(joinVoiceOp))

	// Bob receives VOICE_STATE_UPDATE for voice join
	_, data, err := bobConn.Read(ctx)
	if err != nil {
		t.Fatalf("Bob failed to receive initial VOICE_STATE_UPDATE: %v", err)
	}
	var env gateway.GatewayEnvelope
	_ = json.Unmarshal(data, &env)
	if env.T != gateway.EventVoiceStateUpdate {
		t.Fatalf("expected VOICE_STATE_UPDATE, got %s", env.T)
	}
	var vs models.VoiceState
	_ = json.Unmarshal(env.D, &vs)
	if vs.SelfStream {
		t.Fatalf("expected self_stream to be false initially, got true")
	}

	// 2. Alice starts screen share (self_stream = true)
	startStreamOp := fmt.Sprintf(`{"op":4,"d":{"guild_id":"%s","channel_id":"%s","self_mute":false,"self_deaf":false,"self_stream":true}}`,
		guild.ID.String(), voiceCh.ID.String())
	_ = aliceConn.Write(ctx, websocket.MessageText, []byte(startStreamOp))

	// Bob receives VOICE_STATE_UPDATE with self_stream = true
	_, data, err = bobConn.Read(ctx)
	if err != nil {
		t.Fatalf("Bob failed to receive screen share VOICE_STATE_UPDATE: %v", err)
	}
	_ = json.Unmarshal(data, &env)
	if env.T != gateway.EventVoiceStateUpdate {
		t.Fatalf("expected VOICE_STATE_UPDATE on start screen share, got %s", env.T)
	}
	_ = json.Unmarshal(env.D, &vs)
	if !vs.SelfStream {
		t.Fatalf("expected self_stream to be true, got false")
	}
	if vs.UserID.String() != alice.User.ID.String() {
		t.Fatalf("expected user %s, got %s", alice.User.ID.String(), vs.UserID.String())
	}

	// Verify database persistence of self_stream = true
	var dbSelfStream bool
	err = h.pool.QueryRow(ctx, "SELECT self_stream FROM voice_states WHERE guild_id = $1 AND user_id = $2",
		guild.ID, alice.User.ID).Scan(&dbSelfStream)
	if err != nil {
		t.Fatalf("failed to query voice_states DB: %v", err)
	}
	if !dbSelfStream {
		t.Fatalf("expected DB self_stream to be true, got false")
	}

	// 3. Alice stops screen share (self_stream = false)
	stopStreamOp := fmt.Sprintf(`{"op":4,"d":{"guild_id":"%s","channel_id":"%s","self_mute":false,"self_deaf":false,"self_stream":false}}`,
		guild.ID.String(), voiceCh.ID.String())
	_ = aliceConn.Write(ctx, websocket.MessageText, []byte(stopStreamOp))

	// Bob receives VOICE_STATE_UPDATE with self_stream = false
	_, data, err = bobConn.Read(ctx)
	if err != nil {
		t.Fatalf("Bob failed to receive stop screen share VOICE_STATE_UPDATE: %v", err)
	}
	_ = json.Unmarshal(data, &env)
	if env.T != gateway.EventVoiceStateUpdate {
		t.Fatalf("expected VOICE_STATE_UPDATE on stop screen share, got %s", env.T)
	}
	_ = json.Unmarshal(env.D, &vs)
	if vs.SelfStream {
		t.Fatalf("expected self_stream to be false, got true")
	}

	// Verify database persistence of self_stream = false
	err = h.pool.QueryRow(ctx, "SELECT self_stream FROM voice_states WHERE guild_id = $1 AND user_id = $2",
		guild.ID, alice.User.ID).Scan(&dbSelfStream)
	if err != nil {
		t.Fatalf("failed to query voice_states DB: %v", err)
	}
	if dbSelfStream {
		t.Fatalf("expected DB self_stream to be false, got true")
	}

	t.Logf("Empirical confirmation: Milestone 5 Screen Share voice state transitions verified successfully")
}
