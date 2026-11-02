package tests

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"concord/internal/api"
	"concord/internal/models"
	"concord/internal/snowflake"
)

// ============================================================================
// CHALLENGER 2 EMPIRICAL TEST SUITE: Message Persistence & REST API Endpoints
// ============================================================================

// TestAdversarial_MessagePaginationAndOrdering stress-tests:
// - Chronological ordering (oldest -> newest) across multi-message series
// - Boundary: limit=0 (returns 400 INVALID_PARAMETER)
// - Boundary: limit=100 (returns exact 100 messages)
// - Boundary: limit=500 (clamped to 100 messages)
// - Boundary: invalid cursor before="not_a_snowflake" (returns 400 INVALID_PARAMETER)
// - Boundary: negative cursor before="-99" (returns 400 INVALID_PARAMETER)
// - Boundary: cursor before=0 (returns 200 with empty array)
// - Pagination sliding window: before=<msg_id>&limit=20
func TestAdversarial_MessagePaginationAndOrdering(t *testing.T) {
	h := setupTestHarness(t)
	unique := fmt.Sprintf("%d", time.Now().UnixNano())

	user := registerUserHelper(t, h, "page_user_"+unique, "page_user_"+unique+"@example.com", "supersecret123")
	guild := createGuildHelper(t, h, user.Token, "Pagination Guild "+unique)

	if len(guild.Channels) == 0 {
		t.Fatalf("guild created without channels")
	}
	channelID := guild.Channels[0].ID.String()

	// 1. Verify limit=0 returns HTTP 400
	resp, body := h.request(t, http.MethodGet, "/v1/channels/"+channelID+"/messages?limit=0", user.Token, nil)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for limit=0, got %d: %s", resp.StatusCode, string(body))
	}
	var errResp api.ErrorResponse
	if err := json.Unmarshal(body, &errResp); err != nil {
		t.Fatalf("unmarshal error response for limit=0: %v", err)
	}
	if errResp.Code != "INVALID_PARAMETER" {
		t.Fatalf("expected error code INVALID_PARAMETER for limit=0, got %s", errResp.Code)
	}

	// 2. Verify invalid cursor string before="abc" returns HTTP 400
	resp, body = h.request(t, http.MethodGet, "/v1/channels/"+channelID+"/messages?before=invalid_cursor", user.Token, nil)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid before cursor, got %d: %s", resp.StatusCode, string(body))
	}
	if err := json.Unmarshal(body, &errResp); err != nil {
		t.Fatalf("unmarshal error response for invalid cursor: %v", err)
	}
	if errResp.Code != "INVALID_PARAMETER" {
		t.Fatalf("expected error code INVALID_PARAMETER for invalid cursor, got %s", errResp.Code)
	}

	// 3. Verify out-of-range cursor before="999999999999999999999999" returns HTTP 400
	resp, body = h.request(t, http.MethodGet, "/v1/channels/"+channelID+"/messages?before=999999999999999999999999", user.Token, nil)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for out-of-range before cursor, got %d: %s", resp.StatusCode, string(body))
	}
	if err := json.Unmarshal(body, &errResp); err != nil {
		t.Fatalf("unmarshal error response for out-of-range cursor: %v", err)
	}
	if errResp.Code != "INVALID_PARAMETER" {
		t.Fatalf("expected INVALID_PARAMETER for out-of-range cursor, got %s", errResp.Code)
	}

	// 4. Verify cursor before=0 or negative before=-123 returns HTTP 200 with empty array []
	resp, body = h.request(t, http.MethodGet, "/v1/channels/"+channelID+"/messages?before=0", user.Token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 for before=0, got %d: %s", resp.StatusCode, string(body))
	}
	var emptyMsgs []models.MessageResponse
	if err := json.Unmarshal(body, &emptyMsgs); err != nil {
		t.Fatalf("unmarshal before=0 msgs: %v", err)
	}
	if len(emptyMsgs) != 0 {
		t.Fatalf("expected 0 messages for before=0, got %d", len(emptyMsgs))
	}

	resp, body = h.request(t, http.MethodGet, "/v1/channels/"+channelID+"/messages?before=-123", user.Token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 for before=-123, got %d: %s", resp.StatusCode, string(body))
	}

	// 5. Post 105 messages to rigorously verify limit=100 and limit=500 clamping
	t.Logf("Posting 105 messages to channel %s...", channelID)
	totalMessages := 105
	postedIDs := make([]snowflake.ID, totalMessages)

	for i := 0; i < totalMessages; i++ {
		req := models.CreateMessageRequest{
			Content: fmt.Sprintf("Bulk message %03d", i+1),
		}
		pResp, pBody := h.request(t, http.MethodPost, "/v1/channels/"+channelID+"/messages", user.Token, req)
		if pResp.StatusCode != http.StatusCreated {
			t.Fatalf("failed posting message %d: %s", i+1, string(pBody))
		}
		var msg models.MessageResponse
		if err := json.Unmarshal(pBody, &msg); err != nil {
			t.Fatalf("unmarshal message %d: %v", i+1, err)
		}
		postedIDs[i] = msg.ID
	}

	// 6. Test limit=100: Must return exactly 100 messages
	resp, body = h.request(t, http.MethodGet, "/v1/channels/"+channelID+"/messages?limit=100", user.Token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 for limit=100, got %d: %s", resp.StatusCode, string(body))
	}
	var list100 []models.MessageResponse
	if err := json.Unmarshal(body, &list100); err != nil {
		t.Fatalf("unmarshal limit=100 response: %v", err)
	}
	if len(list100) != 100 {
		t.Fatalf("expected exactly 100 messages for limit=100, got %d", len(list100))
	}

	// Verify strict chronological order (oldest -> newest)
	for i := 1; i < len(list100); i++ {
		if list100[i].ID <= list100[i-1].ID {
			t.Fatalf("chronological order violated at index %d: ID %s <= prev ID %s",
				i, list100[i].ID.String(), list100[i-1].ID.String())
		}
		if list100[i].CreatedAt.Before(list100[i-1].CreatedAt) {
			t.Fatalf("chronological timestamp violated at index %d: %v < %v",
				i, list100[i].CreatedAt, list100[i-1].CreatedAt)
		}
	}
	// The 100 messages must be messages 6 to 105 (the latest 100)
	if list100[0].ID != postedIDs[5] {
		t.Fatalf("expected first of latest 100 to be message index 5 (%s), got %s",
			postedIDs[5].String(), list100[0].ID.String())
	}
	if list100[99].ID != postedIDs[104] {
		t.Fatalf("expected last of latest 100 to be message index 104 (%s), got %s",
			postedIDs[104].String(), list100[99].ID.String())
	}

	// 7. Test limit=500: Must be clamped to 100 messages!
	resp, body = h.request(t, http.MethodGet, "/v1/channels/"+channelID+"/messages?limit=500", user.Token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 for limit=500, got %d: %s", resp.StatusCode, string(body))
	}
	var listClamped []models.MessageResponse
	if err := json.Unmarshal(body, &listClamped); err != nil {
		t.Fatalf("unmarshal limit=500 response: %v", err)
	}
	if len(listClamped) != 100 {
		t.Fatalf("expected limit=500 to be CLAMPED to 100 messages, but received %d", len(listClamped))
	}
	// Verify chronological ordering in clamped output
	for i := 1; i < len(listClamped); i++ {
		if listClamped[i].ID <= listClamped[i-1].ID {
			t.Fatalf("chronological order violated in clamped output at index %d: %s <= %s",
				i, listClamped[i].ID.String(), listClamped[i-1].ID.String())
		}
	}

	// 8. Pagination window: before=<postedIDs[50]>&limit=20
	// postedIDs has index 0..104. postedIDs[50] is message 51.
	// messages before message 51 should be messages 31..50 (indexes 30..49)
	beforeTarget := postedIDs[50]
	resp, body = h.request(t, http.MethodGet,
		fmt.Sprintf("/v1/channels/%s/messages?before=%s&limit=20", channelID, beforeTarget.String()),
		user.Token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 for before window, got %d: %s", resp.StatusCode, string(body))
	}
	var windowMsgs []models.MessageResponse
	if err := json.Unmarshal(body, &windowMsgs); err != nil {
		t.Fatalf("unmarshal window messages: %v", err)
	}
	if len(windowMsgs) != 20 {
		t.Fatalf("expected 20 messages in pagination window, got %d", len(windowMsgs))
	}
	for i := 0; i < 20; i++ {
		expectedID := postedIDs[30+i]
		if windowMsgs[i].ID != expectedID {
			t.Fatalf("window message %d ID mismatch: expected %s (msg %d), got %s",
				i, expectedID.String(), 30+i+1, windowMsgs[i].ID.String())
		}
	}
}

// TestAdversarial_AuthorizationInvariants stress-tests:
// - Attempt to edit Alice's message as Bob -> HTTP 403 FORBIDDEN
// - Verify message content untouched in DB after Bob's edit attempt
// - Attempt to delete Alice's message as regular member Bob -> HTTP 403 FORBIDDEN
// - Verify message remains intact in DB after Bob's delete attempt
// - Attempt to delete Alice's message as Guild Owner -> HTTP 204 NO CONTENT (permitted)
// - Verify message row is deleted from DB
// - Non-member outsider edit & delete attempts -> HTTP 403 FORBIDDEN
func TestAdversarial_AuthorizationInvariants(t *testing.T) {
	h := setupTestHarness(t)
	unique := fmt.Sprintf("%09d", time.Now().UnixNano()%1000000000)

	guildOwner := registerUserHelper(t, h, "own_"+unique, "own_"+unique+"@example.com", "supersecret123")
	alice := registerUserHelper(t, h, "ali_"+unique, "ali_"+unique+"@example.com", "supersecret123")
	bob := registerUserHelper(t, h, "bob_"+unique, "bob_"+unique+"@example.com", "supersecret123")
	outsider := registerUserHelper(t, h, "out_"+unique, "out_"+unique+"@example.com", "supersecret123")

	guild := createGuildHelper(t, h, guildOwner.Token, "Auth Invariant Guild "+unique)
	channelID := guild.Channels[0].ID.String()

	// Add Alice and Bob as regular members to the guild
	addGuildMemberHelper(t, h, guild.ID, alice.User.ID)
	addGuildMemberHelper(t, h, guild.ID, bob.User.ID)
	// outsider is NOT added to the guild

	// Alice creates a message
	aliceContent := "Alice original sensitive announcement"
	pResp, pBody := h.request(t, http.MethodPost, "/v1/channels/"+channelID+"/messages", alice.Token, models.CreateMessageRequest{
		Content: aliceContent,
	})
	if pResp.StatusCode != http.StatusCreated {
		t.Fatalf("Alice message creation failed: %s", string(pBody))
	}
	var aliceMsg models.MessageResponse
	if err := json.Unmarshal(pBody, &aliceMsg); err != nil {
		t.Fatalf("unmarshal Alice message: %v", err)
	}

	// 1. Bob attempts to edit Alice's message -> 403 FORBIDDEN
	resp, body := h.request(t, http.MethodPatch,
		fmt.Sprintf("/v1/channels/%s/messages/%s", channelID, aliceMsg.ID.String()),
		bob.Token,
		models.UpdateMessageRequest{Content: "Tampered by Bob"},
	)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 for Bob editing Alice's message, got %d: %s", resp.StatusCode, string(body))
	}

	// Verify DB state: Content unchanged, edited_at still NULL
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	var dbContent string
	var editedAt *time.Time
	err := h.pool.QueryRow(ctx, `SELECT content, edited_at FROM messages WHERE id = $1`, aliceMsg.ID).Scan(&dbContent, &editedAt)
	if err != nil {
		t.Fatalf("query DB for Alice message: %v", err)
	}
	if dbContent != aliceContent {
		t.Fatalf("DB content corrupted after unauthorized edit: expected %q, got %q", aliceContent, dbContent)
	}
	if editedAt != nil {
		t.Fatalf("edited_at should remain nil after failed edit, got %v", editedAt)
	}

	// 2. Outsider attempts to edit Alice's message -> 403 FORBIDDEN
	resp, body = h.request(t, http.MethodPatch,
		fmt.Sprintf("/v1/channels/%s/messages/%s", channelID, aliceMsg.ID.String()),
		outsider.Token,
		models.UpdateMessageRequest{Content: "Tampered by Outsider"},
	)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 for outsider editing Alice's message, got %d: %s", resp.StatusCode, string(body))
	}

	// 3. Bob attempts to delete Alice's message -> 403 FORBIDDEN
	resp, body = h.request(t, http.MethodDelete,
		fmt.Sprintf("/v1/channels/%s/messages/%s", channelID, aliceMsg.ID.String()),
		bob.Token, nil,
	)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 for Bob deleting Alice's message, got %d: %s", resp.StatusCode, string(body))
	}

	// Verify message still exists in DB
	var exists bool
	err = h.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM messages WHERE id = $1)`, aliceMsg.ID).Scan(&exists)
	if err != nil || !exists {
		t.Fatalf("Alice message was deleted after unauthorized delete attempt: err=%v exists=%v", err, exists)
	}

	// 4. Outsider attempts to delete Alice's message -> 403 FORBIDDEN
	resp, body = h.request(t, http.MethodDelete,
		fmt.Sprintf("/v1/channels/%s/messages/%s", channelID, aliceMsg.ID.String()),
		outsider.Token, nil,
	)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 for outsider deleting Alice's message, got %d: %s", resp.StatusCode, string(body))
	}

	// 5. Guild Owner deletes Alice's message -> 204 NO CONTENT (permitted)
	resp, body = h.request(t, http.MethodDelete,
		fmt.Sprintf("/v1/channels/%s/messages/%s", channelID, aliceMsg.ID.String()),
		guildOwner.Token, nil,
	)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("expected 204 for Guild Owner deleting Alice's message, got %d: %s", resp.StatusCode, string(body))
	}

	// Verify message row is gone from DB
	err = h.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM messages WHERE id = $1)`, aliceMsg.ID).Scan(&exists)
	if err != nil {
		t.Fatalf("query DB for message existence: %v", err)
	}
	if exists {
		t.Fatalf("Alice message still exists in DB after owner deletion")
	}

	// 6. Attempt deleting already deleted message -> 404 MESSAGE_NOT_FOUND
	resp, body = h.request(t, http.MethodDelete,
		fmt.Sprintf("/v1/channels/%s/messages/%s", channelID, aliceMsg.ID.String()),
		guildOwner.Token, nil,
	)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 when deleting already deleted message, got %d: %s", resp.StatusCode, string(body))
	}
}

// TestAdversarial_InputValidationBoundaries stress-tests:
// - Empty messages (empty string, whitespace, newlines, tabs) -> 400 MESSAGE_EMPTY
// - Messages > 2000 runes:
//   - 2000 ASCII chars -> 201 Created (valid limit boundary)
//   - 2001 ASCII chars -> 400 MESSAGE_TOO_LONG
//   - 2000 Multi-byte Unicode runes -> 201 Created (6000 bytes, but 2000 runes)
//   - 2001 Multi-byte Unicode runes -> 400 MESSAGE_TOO_LONG
//   - Emojis: 2001 emoji runes -> 400 MESSAGE_TOO_LONG
// - Cross-channel reply validation:
//   - Reply to message in another channel in same guild -> 400 INVALID_REPLY
//   - Reply to message in channel of another guild -> 400 INVALID_REPLY
//   - Reply to non-existent snowflake -> 400 INVALID_REPLY
func TestAdversarial_InputValidationBoundaries(t *testing.T) {
	h := setupTestHarness(t)
	unique := fmt.Sprintf("%d", time.Now().UnixNano())

	user := registerUserHelper(t, h, "val_user_"+unique, "val_user_"+unique+"@example.com", "supersecret123")
	guild1 := createGuildHelper(t, h, user.Token, "Validation Guild 1 "+unique)
	guild2 := createGuildHelper(t, h, user.Token, "Validation Guild 2 "+unique)

	channel1A := guild1.Channels[0].ID.String()

	// Create Channel 1B in guild 1
	cResp, cBody := h.request(t, http.MethodPost, "/v1/guilds/"+guild1.ID.String()+"/channels", user.Token, models.CreateChannelRequest{
		Name: "channel-1b",
		Type: models.ChannelTypeText,
	})
	if cResp.StatusCode != http.StatusCreated {
		t.Fatalf("failed to create channel 1b: %s", string(cBody))
	}
	var channel1B models.ChannelResponse
	if err := json.Unmarshal(cBody, &channel1B); err != nil {
		t.Fatalf("unmarshal channel 1b: %v", err)
	}

	channel2A := guild2.Channels[0].ID.String()

	// 1. Post empty messages
	emptyPayloads := []string{
		"",
		"   ",
		"\t\t\n\r  \n  ",
	}
	for i, payload := range emptyPayloads {
		resp, body := h.request(t, http.MethodPost, "/v1/channels/"+channel1A+"/messages", user.Token, models.CreateMessageRequest{
			Content: payload,
		})
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("case %d: expected 400 for empty content, got %d: %s", i, resp.StatusCode, string(body))
		}
		var errResp api.ErrorResponse
		_ = json.Unmarshal(body, &errResp)
		if errResp.Code != "MESSAGE_EMPTY" {
			t.Fatalf("case %d: expected error code MESSAGE_EMPTY, got %s", i, errResp.Code)
		}
	}

	// 2. Exact 2000 ASCII chars -> valid (201 Created)
	ascii2000 := strings.Repeat("A", 2000)
	resp, body := h.request(t, http.MethodPost, "/v1/channels/"+channel1A+"/messages", user.Token, models.CreateMessageRequest{
		Content: ascii2000,
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201 for exactly 2000 ASCII chars, got %d: %s", resp.StatusCode, string(body))
	}

	// 3. 2001 ASCII chars -> rejected (400 MESSAGE_TOO_LONG)
	ascii2001 := strings.Repeat("A", 2001)
	resp, body = h.request(t, http.MethodPost, "/v1/channels/"+channel1A+"/messages", user.Token, models.CreateMessageRequest{
		Content: ascii2001,
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for 2001 ASCII chars, got %d: %s", resp.StatusCode, string(body))
	}
	var errResp api.ErrorResponse
	_ = json.Unmarshal(body, &errResp)
	if errResp.Code != "MESSAGE_TOO_LONG" {
		t.Fatalf("expected MESSAGE_TOO_LONG for 2001 ASCII chars, got %s", errResp.Code)
	}

	// 4. Exact 2000 multi-byte runes (e.g. '世' = 3 bytes each, total 6000 bytes) -> 201 Created
	runes2000 := strings.Repeat("世", 2000)
	resp, body = h.request(t, http.MethodPost, "/v1/channels/"+channel1A+"/messages", user.Token, models.CreateMessageRequest{
		Content: runes2000,
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201 for 2000 multibyte runes, got %d: %s", resp.StatusCode, string(body))
	}

	// 5. 2001 multi-byte runes -> 400 MESSAGE_TOO_LONG
	runes2001 := strings.Repeat("世", 2001)
	resp, body = h.request(t, http.MethodPost, "/v1/channels/"+channel1A+"/messages", user.Token, models.CreateMessageRequest{
		Content: runes2001,
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for 2001 multibyte runes, got %d: %s", resp.StatusCode, string(body))
	}
	_ = json.Unmarshal(body, &errResp)
	if errResp.Code != "MESSAGE_TOO_LONG" {
		t.Fatalf("expected MESSAGE_TOO_LONG for 2001 multibyte runes, got %s", errResp.Code)
	}

	// 6. Post base message in Channel 1A
	resp, body = h.request(t, http.MethodPost, "/v1/channels/"+channel1A+"/messages", user.Token, models.CreateMessageRequest{
		Content: "Valid base message in Channel 1A",
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("failed to post base message in 1A: %s", string(body))
	}
	var msg1A models.MessageResponse
	if err := json.Unmarshal(body, &msg1A); err != nil {
		t.Fatalf("unmarshal base message 1A: %v", err)
	}

	// 7. Post base message in Channel 2A (Guild 2)
	resp, body = h.request(t, http.MethodPost, "/v1/channels/"+channel2A+"/messages", user.Token, models.CreateMessageRequest{
		Content: "Valid base message in Channel 2A (Guild 2)",
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("failed to post base message in 2A: %s", string(body))
	}
	var msg2A models.MessageResponse
	if err := json.Unmarshal(body, &msg2A); err != nil {
		t.Fatalf("unmarshal base message 2A: %v", err)
	}

	// 8. Attempt cross-channel reply: posting in Channel 1B referencing msg1A (Channel 1A) -> 400 INVALID_REPLY
	crossChanReply := models.CreateMessageRequest{
		Content:   "Cross-channel reply attempt",
		ReplyToID: &msg1A.ID,
	}
	resp, body = h.request(t, http.MethodPost, "/v1/channels/"+channel1B.ID.String()+"/messages", user.Token, crossChanReply)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for cross-channel reply within same guild, got %d: %s", resp.StatusCode, string(body))
	}
	_ = json.Unmarshal(body, &errResp)
	if errResp.Code != "INVALID_REPLY" {
		t.Fatalf("expected INVALID_REPLY for cross-channel reply, got %s", errResp.Code)
	}

	// 9. Attempt cross-guild reply: posting in Channel 1A referencing msg2A (Guild 2) -> 400 INVALID_REPLY
	crossGuildReply := models.CreateMessageRequest{
		Content:   "Cross-guild reply attempt",
		ReplyToID: &msg2A.ID,
	}
	resp, body = h.request(t, http.MethodPost, "/v1/channels/"+channel1A+"/messages", user.Token, crossGuildReply)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for cross-guild reply, got %d: %s", resp.StatusCode, string(body))
	}
	_ = json.Unmarshal(body, &errResp)
	if errResp.Code != "INVALID_REPLY" {
		t.Fatalf("expected INVALID_REPLY for cross-guild reply, got %s", errResp.Code)
	}

	// 10. Attempt reply to non-existent snowflake -> 400 INVALID_REPLY
	fakeID, _ := snowflake.Parse("123456789012345678")
	fakeReply := models.CreateMessageRequest{
		Content:   "Fake reply attempt",
		ReplyToID: &fakeID,
	}
	resp, body = h.request(t, http.MethodPost, "/v1/channels/"+channel1A+"/messages", user.Token, fakeReply)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for reply to fake ID, got %d: %s", resp.StatusCode, string(body))
	}
	_ = json.Unmarshal(body, &errResp)
	if errResp.Code != "INVALID_REPLY" {
		t.Fatalf("expected INVALID_REPLY for fake ID reply, got %s", errResp.Code)
	}
}

// TestAdversarial_EphemeralTypingTrigger stress-tests:
// - Call POST /channels/:id/typing
// - Verify HTTP 204 NO CONTENT
// - Verify ZERO rows inserted across ALL tables in database (strictly ephemeral)
// - Verify non-member returns HTTP 403 FORBIDDEN
// - Verify invalid snowflake returns HTTP 400 INVALID_ID
// - Verify non-existent channel returns HTTP 404 CHANNEL_NOT_FOUND
func TestAdversarial_EphemeralTypingTrigger(t *testing.T) {
	h := setupTestHarness(t)
	unique := fmt.Sprintf("%d", time.Now().UnixNano())

	user := registerUserHelper(t, h, "type_user_"+unique, "type_user_"+unique+"@example.com", "supersecret123")
	outsider := registerUserHelper(t, h, "type_out_"+unique, "type_out_"+unique+"@example.com", "supersecret123")
	guild := createGuildHelper(t, h, user.Token, "Typing Guild "+unique)
	channelID := guild.Channels[0].ID.String()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Count rows in key tables before typing
	countRows := func() (msgCount, chanCount, guildCount, userCount int) {
		_ = h.pool.QueryRow(ctx, `SELECT count(*) FROM messages`).Scan(&msgCount)
		_ = h.pool.QueryRow(ctx, `SELECT count(*) FROM channels`).Scan(&chanCount)
		_ = h.pool.QueryRow(ctx, `SELECT count(*) FROM guilds`).Scan(&guildCount)
		_ = h.pool.QueryRow(ctx, `SELECT count(*) FROM users`).Scan(&userCount)
		return
	}

	msgsBefore, chansBefore, guildsBefore, usersBefore := countRows()

	// 1. Call POST /channels/:id/typing
	resp, body := h.request(t, http.MethodPost, "/v1/channels/"+channelID+"/typing", user.Token, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("expected 204 No Content for typing trigger, got %d: %s", resp.StatusCode, string(body))
	}
	if len(body) != 0 {
		t.Fatalf("expected empty body for 204 No Content, got %d bytes: %q", len(body), string(body))
	}

	// 2. Count rows after typing: MUST BE IDENTICAL (0 rows inserted)
	msgsAfter, chansAfter, guildsAfter, usersAfter := countRows()
	if msgsBefore != msgsAfter {
		t.Fatalf("ephemeral invariant violated: messages table changed from %d to %d", msgsBefore, msgsAfter)
	}
	if chansBefore != chansAfter || guildsBefore != guildsAfter || usersBefore != usersAfter {
		t.Fatalf("database mutated during ephemeral typing trigger: chans(%d->%d) guilds(%d->%d) users(%d->%d)",
			chansBefore, chansAfter, guildsBefore, guildsAfter, usersBefore, usersAfter)
	}

	// 3. Outsider triggers typing -> 403 FORBIDDEN
	resp, body = h.request(t, http.MethodPost, "/v1/channels/"+channelID+"/typing", outsider.Token, nil)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 for outsider typing, got %d: %s", resp.StatusCode, string(body))
	}

	// 4. Invalid snowflake channel ID -> 400 INVALID_ID
	resp, body = h.request(t, http.MethodPost, "/v1/channels/not-a-snowflake/typing", user.Token, nil)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid channel ID format, got %d: %s", resp.StatusCode, string(body))
	}
	var errResp api.ErrorResponse
	_ = json.Unmarshal(body, &errResp)
	if errResp.Code != "INVALID_ID" {
		t.Fatalf("expected INVALID_ID error code, got %s", errResp.Code)
	}

	// 5. Non-existent channel snowflake -> 404 CHANNEL_NOT_FOUND
	resp, body = h.request(t, http.MethodPost, "/v1/channels/99999999999999999/typing", user.Token, nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 for non-existent channel, got %d: %s", resp.StatusCode, string(body))
	}
	_ = json.Unmarshal(body, &errResp)
	if errResp.Code != "CHANNEL_NOT_FOUND" {
		t.Fatalf("expected CHANNEL_NOT_FOUND error code, got %s", errResp.Code)
	}
}

// TestAdversarial_InactiveChannelTypes stress-tests:
// - Operations on Voice Channel (type 2):
//   - POST messages -> HTTP 400 INVALID_CHANNEL_TYPE
//   - GET messages -> HTTP 400 INVALID_CHANNEL_TYPE
//   - POST typing -> HTTP 400 INVALID_CHANNEL_TYPE
//   - PATCH message -> HTTP 400 INVALID_CHANNEL_TYPE
// - Operations on Category Channel (type 4):
//   - POST messages -> HTTP 400 INVALID_CHANNEL_TYPE
//   - GET messages -> HTTP 400 INVALID_CHANNEL_TYPE
//   - POST typing -> HTTP 400 INVALID_CHANNEL_TYPE
//   - PATCH message -> HTTP 400 INVALID_CHANNEL_TYPE
func TestAdversarial_InactiveChannelTypes(t *testing.T) {
	h := setupTestHarness(t)
	unique := fmt.Sprintf("%d", time.Now().UnixNano())

	user := registerUserHelper(t, h, "type_chan_"+unique, "type_chan_"+unique+"@example.com", "supersecret123")
	guild := createGuildHelper(t, h, user.Token, "Channel Type Guild "+unique)

	// 1. Create a Voice Channel (Type = 2)
	vResp, vBody := h.request(t, http.MethodPost, "/v1/guilds/"+guild.ID.String()+"/channels", user.Token, models.CreateChannelRequest{
		Name: "general-voice",
		Type: models.ChannelTypeVoice,
	})
	if vResp.StatusCode != http.StatusCreated {
		t.Fatalf("failed to create voice channel: %s", string(vBody))
	}
	var voiceChan models.ChannelResponse
	if err := json.Unmarshal(vBody, &voiceChan); err != nil {
		t.Fatalf("unmarshal voice channel: %v", err)
	}
	voiceID := voiceChan.ID.String()

	// 2. Create a Category Channel (Type = 4)
	catResp, catBody := h.request(t, http.MethodPost, "/v1/guilds/"+guild.ID.String()+"/channels", user.Token, models.CreateChannelRequest{
		Name: "chat-category",
		Type: models.ChannelTypeCategory,
	})
	if catResp.StatusCode != http.StatusCreated {
		t.Fatalf("failed to create category channel: %s", string(catBody))
	}
	var catChan models.ChannelResponse
	if err := json.Unmarshal(catBody, &catChan); err != nil {
		t.Fatalf("unmarshal category channel: %v", err)
	}
	catID := catChan.ID.String()

	testNonTextChannel := func(channelName, chanID string) {
		// A. POST /channels/:id/messages -> 400 INVALID_CHANNEL_TYPE
		resp, body := h.request(t, http.MethodPost, "/v1/channels/"+chanID+"/messages", user.Token, models.CreateMessageRequest{
			Content: "Hello in non-text channel",
		})
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("[%s] expected 400 for posting message to non-text channel, got %d: %s", channelName, resp.StatusCode, string(body))
		}
		var errResp api.ErrorResponse
		_ = json.Unmarshal(body, &errResp)
		if errResp.Code != "INVALID_CHANNEL_TYPE" {
			t.Fatalf("[%s] expected INVALID_CHANNEL_TYPE error code, got %s", channelName, errResp.Code)
		}

		// B. GET /channels/:id/messages -> 400 INVALID_CHANNEL_TYPE
		resp, body = h.request(t, http.MethodGet, "/v1/channels/"+chanID+"/messages", user.Token, nil)
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("[%s] expected 400 for listing messages in non-text channel, got %d: %s", channelName, resp.StatusCode, string(body))
		}
		_ = json.Unmarshal(body, &errResp)
		if errResp.Code != "INVALID_CHANNEL_TYPE" {
			t.Fatalf("[%s] expected INVALID_CHANNEL_TYPE error code, got %s", channelName, errResp.Code)
		}

		// C. POST /channels/:id/typing -> 400 INVALID_CHANNEL_TYPE
		resp, body = h.request(t, http.MethodPost, "/v1/channels/"+chanID+"/typing", user.Token, nil)
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("[%s] expected 400 for typing in non-text channel, got %d: %s", channelName, resp.StatusCode, string(body))
		}
		_ = json.Unmarshal(body, &errResp)
		if errResp.Code != "INVALID_CHANNEL_TYPE" {
			t.Fatalf("[%s] expected INVALID_CHANNEL_TYPE error code, got %s", channelName, errResp.Code)
		}

		// D. PATCH /channels/:id/messages/:mid -> 400 INVALID_CHANNEL_TYPE
		fakeMid := "123456789012345678"
		resp, body = h.request(t, http.MethodPatch, "/v1/channels/"+chanID+"/messages/"+fakeMid, user.Token, models.UpdateMessageRequest{
			Content: "Updated content",
		})
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("[%s] expected 400 for patching message in non-text channel, got %d: %s", channelName, resp.StatusCode, string(body))
		}
		_ = json.Unmarshal(body, &errResp)
		if errResp.Code != "INVALID_CHANNEL_TYPE" {
			t.Fatalf("[%s] expected INVALID_CHANNEL_TYPE error code, got %s", channelName, errResp.Code)
		}
	}

	testNonTextChannel("VoiceChannel", voiceID)
	testNonTextChannel("CategoryChannel", catID)
}
