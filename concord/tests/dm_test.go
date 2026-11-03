package tests

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"concord/internal/models"
)

func TestDirectMessagesFlow(t *testing.T) {
	h := setupTestHarness(t)
	defer h.pool.Close()

	// 1. Register Alice, Bob, and Charlie
	unique := fmt.Sprintf("%d", time.Now().UnixNano())
	alice := registerUserHelper(t, h, "dm_alice_"+unique, "dm_alice_"+unique+"@test.com", "Password123!")
	bob := registerUserHelper(t, h, "dm_bob_"+unique, "dm_bob_"+unique+"@test.com", "Password123!")
	charlie := registerUserHelper(t, h, "dm_charlie_"+unique, "dm_charlie_"+unique+"@test.com", "Password123!")

	// 2. Alice creates DM with Bob
	dmReq := models.CreateDMChannelRequest{
		RecipientID: bob.User.ID,
	}
	resp, body := h.request(t, http.MethodPost, "/v1/users/@me/channels", alice.Token, dmReq)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK creating DM, got %d: %s", resp.StatusCode, string(body))
	}

	var dmChannel models.ChannelResponse
	if err := json.Unmarshal(body, &dmChannel); err != nil {
		t.Fatalf("failed to decode DM channel response: %v", err)
	}

	if dmChannel.Type != models.ChannelTypeDM {
		t.Fatalf("expected channel type %d (DM), got %d", models.ChannelTypeDM, dmChannel.Type)
	}
	if len(dmChannel.Recipients) != 1 || dmChannel.Recipients[0].ID != bob.User.ID {
		t.Fatalf("expected recipient to be Bob (%s), got %+v", bob.User.ID, dmChannel.Recipients)
	}

	// 3. Alice creates DM with Bob AGAIN -> should return existing channel
	resp2, body2 := h.request(t, http.MethodPost, "/v1/users/@me/channels", alice.Token, dmReq)
	if resp2.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK on duplicate DM creation, got %d", resp2.StatusCode)
	}
	var dmChannel2 models.ChannelResponse
	_ = json.Unmarshal(body2, &dmChannel2)
	if dmChannel2.ID != dmChannel.ID {
		t.Fatalf("expected idempotent channel ID %s, got %s", dmChannel.ID, dmChannel2.ID)
	}

	// 4. Bob lists his DM channels -> should contain Alice
	respListBob, bodyListBob := h.request(t, http.MethodGet, "/v1/users/@me/channels", bob.Token, nil)
	if respListBob.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK listing Bob's DMs, got %d: %s", respListBob.StatusCode, string(bodyListBob))
	}
	var bobDMs []models.ChannelResponse
	if err := json.Unmarshal(bodyListBob, &bobDMs); err != nil {
		t.Fatalf("failed to decode Bob DMs: %v", err)
	}
	if len(bobDMs) == 0 || bobDMs[0].ID != dmChannel.ID {
		t.Fatalf("expected Bob to have DM channel %s, got %+v", dmChannel.ID, bobDMs)
	}
	if len(bobDMs[0].Recipients) == 0 || bobDMs[0].Recipients[0].ID != alice.User.ID {
		t.Fatalf("expected recipient in Bob's DM list to be Alice (%s), got %+v", alice.User.ID, bobDMs[0].Recipients)
	}

	// 5. Alice sends a message in the DM channel
	msgReq := models.CreateMessageRequest{
		Content: "Olá Bob, tudo bem?",
	}
	respMsg, bodyMsg := h.request(t, http.MethodPost, fmt.Sprintf("/v1/channels/%s/messages", dmChannel.ID.String()), alice.Token, msgReq)
	if respMsg.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201 Created sending DM message, got %d: %s", respMsg.StatusCode, string(bodyMsg))
	}
	var createdMsg models.MessageResponse
	_ = json.Unmarshal(bodyMsg, &createdMsg)
	if createdMsg.Content != "Olá Bob, tudo bem?" {
		t.Fatalf("unexpected message content: %s", createdMsg.Content)
	}

	// 6. Bob reads messages in the DM channel
	respRead, bodyRead := h.request(t, http.MethodGet, fmt.Sprintf("/v1/channels/%s/messages", dmChannel.ID.String()), bob.Token, nil)
	if respRead.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK reading DM messages, got %d: %s", respRead.StatusCode, string(bodyRead))
	}
	var messages []models.MessageResponse
	_ = json.Unmarshal(bodyRead, &messages)
	if len(messages) != 1 || messages[0].ID != createdMsg.ID {
		t.Fatalf("expected Bob to read 1 message with ID %s, got %d messages", createdMsg.ID, len(messages))
	}

	// 7. Security: Charlie (outsider) attempts to read Alice and Bob's DM channel
	respCharlie, bodyCharlie := h.request(t, http.MethodGet, fmt.Sprintf("/v1/channels/%s/messages", dmChannel.ID.String()), charlie.Token, nil)
	if respCharlie.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for Charlie reading DM, got %d: %s", respCharlie.StatusCode, string(bodyCharlie))
	}

	// 8. Bob closes/deletes the DM channel for himself
	respClose, _ := h.request(t, http.MethodDelete, fmt.Sprintf("/v1/channels/%s", dmChannel.ID.String()), bob.Token, nil)
	if respClose.StatusCode != http.StatusNoContent {
		t.Fatalf("expected 204 No Content closing DM, got %d", respClose.StatusCode)
	}
}
