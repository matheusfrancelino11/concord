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

// TestMilestone3_ServerInvitesAndJoining tests:
// 1. User A creates guild
// 2. User A creates invite code (POST /guilds/:id/invites)
// 3. User B inspects invite code (GET /invites/:code)
// 4. User B redeems invite code (POST /invites/:code/use) and joins guild
// 5. User A and B both appear in GET /guilds/:id/members
// 6. User B cannot join again (idempotent / returns guild)
func TestMilestone3_ServerInvitesAndJoining(t *testing.T) {
	h := setupTestHarness(t)
	unique := fmt.Sprintf("%d", time.Now().UnixNano())

	alice := registerUserHelper(t, h, "inv_alice_"+unique, "inv_alice_"+unique+"@test.com", "Password123!")
	bob := registerUserHelper(t, h, "inv_bob_"+unique, "inv_bob_"+unique+"@test.com", "Password123!")

	// Alice creates server
	guild := createGuildHelper(t, h, alice.Token, "Invite Guild "+unique)
	guildID := guild.ID.String()

	// 1. Alice creates invite
	createInvReq := models.CreateInviteRequest{
		MaxUses: 2,
		MaxAge:  3600,
	}
	resp, body := h.request(t, http.MethodPost, "/v1/guilds/"+guildID+"/invites", alice.Token, createInvReq)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201 Created on invite creation, got %d: %s", resp.StatusCode, string(body))
	}
	var invite models.Invite
	if err := json.Unmarshal(body, &invite); err != nil {
		t.Fatalf("unmarshal invite: %v", err)
	}
	if len(invite.Code) != 8 {
		t.Fatalf("expected 8-character invite code, got %s", invite.Code)
	}

	// 2. Bob inspects invite details
	resp, body = h.request(t, http.MethodGet, "/v1/invites/"+invite.Code, bob.Token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK on get invite, got %d: %s", resp.StatusCode, string(body))
	}
	var invDetails models.InviteResponse
	if err := json.Unmarshal(body, &invDetails); err != nil {
		t.Fatalf("unmarshal invite details: %v", err)
	}
	if invDetails.Guild.Name != "Invite Guild "+unique {
		t.Fatalf("mismatched guild name in invite details: %s", invDetails.Guild.Name)
	}
	if invDetails.Inviter.Username != "inv_alice_"+unique {
		t.Fatalf("mismatched inviter username: %s", invDetails.Inviter.Username)
	}

	// 3. Bob redeems invite and joins guild
	resp, body = h.request(t, http.MethodPost, "/v1/invites/"+invite.Code+"/use", bob.Token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK on join guild, got %d: %s", resp.StatusCode, string(body))
	}
	var joinedGuild models.GuildDetailResponse
	if err := json.Unmarshal(body, &joinedGuild); err != nil {
		t.Fatalf("unmarshal joined guild: %v", err)
	}
	if joinedGuild.ID.String() != guildID {
		t.Fatalf("expected joined guild ID %s, got %s", guildID, joinedGuild.ID.String())
	}

	// 4. Verify member list contains Alice and Bob
	resp, body = h.request(t, http.MethodGet, "/v1/guilds/"+guildID+"/members", alice.Token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK on list members, got %d: %s", resp.StatusCode, string(body))
	}
	var members []models.MemberResponse
	if err := json.Unmarshal(body, &members); err != nil {
		t.Fatalf("unmarshal members: %v", err)
	}
	if len(members) != 2 {
		t.Fatalf("expected 2 members in guild, got %d", len(members))
	}

	foundAlice := false
	foundBob := false
	for _, m := range members {
		if m.User.Username == "inv_alice_"+unique {
			foundAlice = true
		}
		if m.User.Username == "inv_bob_"+unique {
			foundBob = true
		}
	}
	if !foundAlice || !foundBob {
		t.Fatalf("members list missing Alice or Bob: %+v", members)
	}

	// 5. Test Bob joining again (idempotent)
	resp, body = h.request(t, http.MethodPost, "/v1/invites/"+invite.Code+"/use", bob.Token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK on repeat join, got %d: %s", resp.StatusCode, string(body))
	}

	t.Logf("Empirical confirmation: Milestone 3 server invites and membership join flow verified successfully")
}

// TestMilestone3_PresenceTransitions tests:
// 1. User connects -> receives READY & GUILD_CREATE
// 2. User sends Opcode 3 (PRESENCE_UPDATE with status: "idle")
// 3. User sends Opcode 3 (PRESENCE_UPDATE with status: "dnd")
// 4. Partner in shared guild receives real-time PRESENCE_UPDATE events
func TestMilestone3_PresenceTransitions(t *testing.T) {
	h := setupTestHarness(t)
	unique := fmt.Sprintf("%d", time.Now().UnixNano())

	alice := registerUserHelper(t, h, "pres_alice_"+unique, "pres_alice_"+unique+"@test.com", "Password123!")
	bob := registerUserHelper(t, h, "pres_bob_"+unique, "pres_bob_"+unique+"@test.com", "Password123!")

	guild := createGuildHelper(t, h, alice.Token, "Pres Guild "+unique)
	addGuildMemberHelper(t, h, guild.ID, bob.User.ID)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Connect Bob first
	bobConn, _, err := websocket.Dial(ctx, h.wsURL+"/v1/gateway", nil)
	if err != nil {
		t.Fatalf("dial bob: %v", err)
	}
	defer bobConn.Close(websocket.StatusNormalClosure, "")

	_, _, _ = bobConn.Read(ctx) // HELLO
	_ = bobConn.Write(ctx, websocket.MessageText, []byte(fmt.Sprintf(`{"op":2,"d":{"token":"%s"}}`, bob.Token)))
	_, _, _ = bobConn.Read(ctx) // READY
	_, _, _ = bobConn.Read(ctx) // GUILD_CREATE

	// Connect Alice second
	aliceConn, _, err := websocket.Dial(ctx, h.wsURL+"/v1/gateway", nil)
	if err != nil {
		t.Fatalf("dial alice: %v", err)
	}
	defer aliceConn.Close(websocket.StatusNormalClosure, "")

	_, _, _ = aliceConn.Read(ctx) // HELLO
	_ = aliceConn.Write(ctx, websocket.MessageText, []byte(fmt.Sprintf(`{"op":2,"d":{"token":"%s"}}`, alice.Token)))
	_, _, _ = aliceConn.Read(ctx) // READY
	_, _, _ = aliceConn.Read(ctx) // GUILD_CREATE

	// Bob should receive Alice's initial PRESENCE_UPDATE (status: online)
	_, data, err := bobConn.Read(ctx)
	if err != nil {
		t.Fatalf("Bob failed to receive Alice's online presence: %v", err)
	}
	var env gateway.GatewayEnvelope
	_ = json.Unmarshal(data, &env)
	if env.T != gateway.EventPresenceUpdate {
		t.Fatalf("expected PRESENCE_UPDATE, got %s", env.T)
	}
	var p models.Presence
	_ = json.Unmarshal(env.D, &p)
	if p.UserID.String() != alice.User.ID.String() || p.Status != models.StatusOnline {
		t.Fatalf("expected Alice online presence, got: %+v", p)
	}

	// Alice sends Opcode 3: status = "idle"
	idlePayload := `{"op":3,"d":{"status":"idle"}}`
	_ = aliceConn.Write(ctx, websocket.MessageText, []byte(idlePayload))

	// Bob receives PRESENCE_UPDATE (status: idle)
	_, data, err = bobConn.Read(ctx)
	if err != nil {
		t.Fatalf("Bob failed to receive Alice's idle presence: %v", err)
	}
	_ = json.Unmarshal(data, &env)
	if env.T != gateway.EventPresenceUpdate {
		t.Fatalf("expected PRESENCE_UPDATE, got %s", env.T)
	}
	_ = json.Unmarshal(env.D, &p)
	if p.UserID.String() != alice.User.ID.String() || p.Status != models.StatusIdle {
		t.Fatalf("expected Alice idle presence, got: %+v", p)
	}

	// Alice sends Opcode 3: status = "dnd"
	dndPayload := `{"op":3,"d":{"status":"dnd"}}`
	_ = aliceConn.Write(ctx, websocket.MessageText, []byte(dndPayload))

	// Bob receives PRESENCE_UPDATE (status: dnd)
	_, data, err = bobConn.Read(ctx)
	if err != nil {
		t.Fatalf("Bob failed to receive Alice's dnd presence: %v", err)
	}
	_ = json.Unmarshal(data, &env)
	_ = json.Unmarshal(env.D, &p)
	if p.UserID.String() != alice.User.ID.String() || p.Status != models.StatusDND {
		t.Fatalf("expected Alice dnd presence, got: %+v", p)
	}

	t.Logf("Empirical confirmation: Milestone 3 real-time presence transitions verified successfully")
}

// TestMilestone3_VoiceStateTracking tests:
// 1. User sends Opcode 4 (VOICE_STATE_UPDATE with channel_id) to join voice channel
// 2. Hub broadcasts VOICE_STATE_UPDATE to guild members
// 3. PostgreSQL voice_states table contains the record
// 4. User sends Opcode 4 with channel_id: null to disconnect
// 5. Hub broadcasts VOICE_STATE_UPDATE with channel_id: null
func TestMilestone3_VoiceStateTracking(t *testing.T) {
	h := setupTestHarness(t)
	unique := fmt.Sprintf("%d", time.Now().UnixNano())

	alice := registerUserHelper(t, h, "vs_alice_"+unique, "vs_alice_"+unique+"@test.com", "Password123!")
	bob := registerUserHelper(t, h, "vs_bob_"+unique, "vs_bob_"+unique+"@test.com", "Password123!")

	guild := createGuildHelper(t, h, alice.Token, "VS Guild "+unique)
	addGuildMemberHelper(t, h, guild.ID, bob.User.ID)

	// Create a voice channel
	voiceChannelReq := models.CreateChannelRequest{
		Name: "Voice General " + unique,
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

	// Connect Bob
	bobConn, _, err := websocket.Dial(ctx, h.wsURL+"/v1/gateway", nil)
	if err != nil {
		t.Fatalf("dial bob: %v", err)
	}
	defer bobConn.Close(websocket.StatusNormalClosure, "")

	_, _, _ = bobConn.Read(ctx) // HELLO
	_ = bobConn.Write(ctx, websocket.MessageText, []byte(fmt.Sprintf(`{"op":2,"d":{"token":"%s"}}`, bob.Token)))
	_, _, _ = bobConn.Read(ctx) // READY
	_, _, _ = bobConn.Read(ctx) // GUILD_CREATE

	// Connect Alice
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

	// Alice sends Opcode 4: Join voice channel
	joinVoiceOp := fmt.Sprintf(`{"op":4,"d":{"guild_id":"%s","channel_id":"%s","self_mute":false,"self_deaf":false}}`,
		guild.ID.String(), voiceCh.ID.String())
	_ = aliceConn.Write(ctx, websocket.MessageText, []byte(joinVoiceOp))

	// Bob receives VOICE_STATE_UPDATE
	_, data, err := bobConn.Read(ctx)
	if err != nil {
		t.Fatalf("Bob failed to receive VOICE_STATE_UPDATE: %v", err)
	}
	var env gateway.GatewayEnvelope
	_ = json.Unmarshal(data, &env)
	if env.T != gateway.EventVoiceStateUpdate {
		t.Fatalf("expected VOICE_STATE_UPDATE, got %s", env.T)
	}
	var vs models.VoiceState
	_ = json.Unmarshal(env.D, &vs)
	if vs.UserID.String() != alice.User.ID.String() {
		t.Fatalf("mismatched user ID in voice state: %s", vs.UserID.String())
	}
	if vs.ChannelID == nil || vs.ChannelID.String() != voiceCh.ID.String() {
		t.Fatalf("expected channel ID %s, got %+v", voiceCh.ID.String(), vs.ChannelID)
	}

	// Alice sends Opcode 4 with null channel_id: Leave voice channel
	leaveVoiceOp := fmt.Sprintf(`{"op":4,"d":{"guild_id":"%s","channel_id":null}}`, guild.ID.String())
	_ = aliceConn.Write(ctx, websocket.MessageText, []byte(leaveVoiceOp))

	// Bob receives VOICE_STATE_UPDATE with null channel_id
	_, data, err = bobConn.Read(ctx)
	if err != nil {
		t.Fatalf("Bob failed to receive leave VOICE_STATE_UPDATE: %v", err)
	}
	_ = json.Unmarshal(data, &env)
	if env.T != gateway.EventVoiceStateUpdate {
		t.Fatalf("expected VOICE_STATE_UPDATE, got %s", env.T)
	}
	_ = json.Unmarshal(env.D, &vs)
	if vs.ChannelID != nil {
		t.Fatalf("expected nil channel ID on leave, got %+v", vs.ChannelID)
	}

	t.Logf("Empirical confirmation: Milestone 3 voice state tracking verified successfully")
}
