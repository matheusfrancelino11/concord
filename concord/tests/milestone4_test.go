package tests

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/livekit/protocol/auth"

	"concord/internal/models"
)

// TestMilestone4_VoiceTokenGeneration tests:
// 1. User creates guild and creates a voice channel (type = 2).
// 2. Member requests voice token via POST /v1/channels/:id/voice/token.
// 3. Response contains valid LiveKit JWT, URL, room format, and channel ID.
// 4. JWT is cryptographically verified with dev credentials.
// 5. Requesting token for a text channel (type = 0) returns 400 INVALID_CHANNEL_TYPE.
// 6. Non-member requesting token returns 403 FORBIDDEN.
// 7. Non-existent channel returns 404 CHANNEL_NOT_FOUND.
func TestMilestone4_VoiceTokenGeneration(t *testing.T) {
	h := setupTestHarness(t)
	unique := fmt.Sprintf("%d", time.Now().UnixNano())

	alice := registerUserHelper(t, h, "v_alice_"+unique, "v_alice_"+unique+"@test.com", "Password123!")
	bob := registerUserHelper(t, h, "v_bob_"+unique, "v_bob_"+unique+"@test.com", "Password123!")

	// Alice creates server
	guild := createGuildHelper(t, h, alice.Token, "Voice Guild "+unique)
	guildID := guild.ID.String()

	// Find the default general text channel
	var textChannelID string
	for _, ch := range guild.Channels {
		if ch.Type == models.ChannelTypeText {
			textChannelID = ch.ID.String()
			break
		}
	}
	if textChannelID == "" {
		t.Fatal("expected default text channel in created guild")
	}

	// Alice creates a voice channel
	createChanReq := models.CreateChannelRequest{
		Name: "General Voice",
		Type: models.ChannelTypeVoice,
	}
	resp, body := h.request(t, http.MethodPost, "/v1/guilds/"+guildID+"/channels", alice.Token, createChanReq)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201 Created on voice channel creation, got %d: %s", resp.StatusCode, string(body))
	}
	var voiceChan models.ChannelResponse
	if err := json.Unmarshal(body, &voiceChan); err != nil {
		t.Fatalf("unmarshal voice channel: %v", err)
	}
	voiceChannelID := voiceChan.ID.String()

	// 1. Alice requests voice token
	resp, body = h.request(t, http.MethodPost, "/v1/channels/"+voiceChannelID+"/voice/token", alice.Token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK on voice token generation, got %d: %s", resp.StatusCode, string(body))
	}
	var tokenResp models.VoiceTokenResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		t.Fatalf("unmarshal voice token response: %v", err)
	}

	if tokenResp.Token == "" {
		t.Fatal("expected non-empty LiveKit token")
	}
	expectedRoom := fmt.Sprintf("guild_%s_channel_%s", guildID, voiceChannelID)
	if tokenResp.Room != expectedRoom {
		t.Fatalf("expected room %s, got %s", expectedRoom, tokenResp.Room)
	}
	if tokenResp.ChannelID != voiceChannelID {
		t.Fatalf("expected channel ID %s, got %s", voiceChannelID, tokenResp.ChannelID)
	}

	// Verify token signature with livekit key/secret
	verifier, err := auth.ParseAPIToken(tokenResp.Token)
	if err != nil {
		t.Fatalf("failed to parse API token: %v", err)
	}
	_, grants, err := verifier.Verify(h.cfg.LiveKitSecret)
	if err != nil {
		t.Fatalf("failed to verify LiveKit token signature: %v", err)
	}
	if grants.Identity != alice.User.ID.String() {
		t.Fatalf("expected token identity %s, got %s", alice.User.ID.String(), grants.Identity)
	}
	if grants.Video == nil || !grants.Video.RoomJoin || grants.Video.Room != expectedRoom {
		t.Fatalf("expected video grant for room %s with RoomJoin=true, got %+v", expectedRoom, grants.Video)
	}

	// 2. Bob (not in guild) tries to request voice token -> 403 Forbidden
	resp, body = h.request(t, http.MethodPost, "/v1/channels/"+voiceChannelID+"/voice/token", bob.Token, nil)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for non-member, got %d: %s", resp.StatusCode, string(body))
	}

	// 3. Alice requests voice token for a TEXT channel -> 400 Bad Request
	resp, body = h.request(t, http.MethodPost, "/v1/channels/"+textChannelID+"/voice/token", alice.Token, nil)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for text channel, got %d: %s", resp.StatusCode, string(body))
	}

	// 4. Alice requests voice token for non-existent channel -> 404 Not Found
	resp, body = h.request(t, http.MethodPost, "/v1/channels/999999999999999999/voice/token", alice.Token, nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 Not Found for non-existent channel, got %d: %s", resp.StatusCode, string(body))
	}
}
