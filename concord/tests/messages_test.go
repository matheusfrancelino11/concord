package tests

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"concord/internal/models"
	"concord/internal/snowflake"
)

func registerUserHelper(t *testing.T, h *testHarness, username, email, password string) models.AuthResponse {
	t.Helper()
	regReq := models.RegisterRequest{
		Email:    email,
		Username: username,
		Password: password,
	}
	resp, body := h.request(t, http.MethodPost, "/v1/auth/register", "", regReq)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("register failed (%d): %s", resp.StatusCode, string(body))
	}
	var authResp models.AuthResponse
	if err := json.Unmarshal(body, &authResp); err != nil {
		t.Fatalf("unmarshal authResp: %v", err)
	}
	return authResp
}

func createGuildHelper(t *testing.T, h *testHarness, token, name string) models.GuildDetailResponse {
	t.Helper()
	guildReq := models.CreateGuildRequest{Name: name}
	resp, body := h.request(t, http.MethodPost, "/v1/guilds", token, guildReq)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create guild failed (%d): %s", resp.StatusCode, string(body))
	}
	var guildResp models.GuildDetailResponse
	if err := json.Unmarshal(body, &guildResp); err != nil {
		t.Fatalf("unmarshal guildResp: %v", err)
	}
	return guildResp
}

func addGuildMemberHelper(t *testing.T, h *testHarness, guildID, userID snowflake.ID) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	query := `INSERT INTO members (guild_id, user_id, joined_at) VALUES ($1, $2, NOW()) ON CONFLICT DO NOTHING`
	if _, err := h.pool.Exec(ctx, query, guildID, userID); err != nil {
		t.Fatalf("failed to add guild member: %v", err)
	}
}

func TestMessage_CreateAndListChronological(t *testing.T) {
	h := setupTestHarness(t)
	unique := fmt.Sprintf("%d", time.Now().UnixNano())

	user := registerUserHelper(t, h, "msguser_"+unique, "msguser_"+unique+"@example.com", "supersecret123")
	guild := createGuildHelper(t, h, user.Token, "Message Server "+unique)

	if len(guild.Channels) == 0 {
		t.Fatalf("expected at least 1 default text channel")
	}
	channelID := guild.Channels[0].ID.String()

	// 1. Initial list on empty channel returns empty array [] (200 OK)
	resp, body := h.request(t, http.MethodGet, "/v1/channels/"+channelID+"/messages", user.Token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK on empty channel, got %d: %s", resp.StatusCode, string(body))
	}
	var initialList []models.MessageResponse
	if err := json.Unmarshal(body, &initialList); err != nil {
		t.Fatalf("unmarshal initial list: %v", err)
	}
	if len(initialList) != 0 {
		t.Fatalf("expected 0 messages initially, got %d", len(initialList))
	}

	// 2. Post 3 messages sequentially
	posted := make([]models.MessageResponse, 3)
	for i := 0; i < 3; i++ {
		postReq := models.CreateMessageRequest{
			Content: fmt.Sprintf("Chronological test message %d", i+1),
		}
		pResp, pBody := h.request(t, http.MethodPost, "/v1/channels/"+channelID+"/messages", user.Token, postReq)
		if pResp.StatusCode != http.StatusCreated {
			t.Fatalf("post message %d failed (%d): %s", i+1, pResp.StatusCode, string(pBody))
		}
		if err := json.Unmarshal(pBody, &posted[i]); err != nil {
			t.Fatalf("unmarshal posted message %d: %v", i+1, err)
		}
		if posted[i].ID == 0 {
			t.Fatalf("expected non-zero snowflake ID for message %d", i+1)
		}
		if posted[i].Author.Username != user.User.Username {
			t.Fatalf("author username mismatch: expected %s, got %s", user.User.Username, posted[i].Author.Username)
		}
		time.Sleep(5 * time.Millisecond) // ensure distinct timestamps
	}

	// 3. Fetch all messages -> must be sorted chronologically [oldest, ..., newest]
	resp, body = h.request(t, http.MethodGet, "/v1/channels/"+channelID+"/messages", user.Token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get messages failed (%d): %s", resp.StatusCode, string(body))
	}
	var allMessages []models.MessageResponse
	if err := json.Unmarshal(body, &allMessages); err != nil {
		t.Fatalf("unmarshal all messages: %v", err)
	}
	if len(allMessages) != 3 {
		t.Fatalf("expected 3 messages, got %d", len(allMessages))
	}
	if allMessages[0].Content != "Chronological test message 1" ||
		allMessages[1].Content != "Chronological test message 2" ||
		allMessages[2].Content != "Chronological test message 3" {
		t.Fatalf("messages not in chronological order: %+v", allMessages)
	}

	// 4. Pagination: limit=2 returns latest 2 messages in chronological order: [msg 2, msg 3]
	resp, body = h.request(t, http.MethodGet, "/v1/channels/"+channelID+"/messages?limit=2", user.Token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("limit=2 query failed: %s", string(body))
	}
	var limitMessages []models.MessageResponse
	if err := json.Unmarshal(body, &limitMessages); err != nil {
		t.Fatalf("unmarshal limit messages: %v", err)
	}
	if len(limitMessages) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(limitMessages))
	}
	if limitMessages[0].ID != posted[1].ID || limitMessages[1].ID != posted[2].ID {
		t.Fatalf("expected [msg2, msg3], got [%s, %s]", limitMessages[0].ID.String(), limitMessages[1].ID.String())
	}

	// 5. Cursor: before=<msg 3 ID>&limit=2 returns [msg 1, msg 2]
	resp, body = h.request(t, http.MethodGet, "/v1/channels/"+channelID+"/messages?before="+posted[2].ID.String()+"&limit=2", user.Token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("before cursor query failed: %s", string(body))
	}
	var beforeMessages []models.MessageResponse
	if err := json.Unmarshal(body, &beforeMessages); err != nil {
		t.Fatalf("unmarshal before messages: %v", err)
	}
	if len(beforeMessages) != 2 {
		t.Fatalf("expected 2 messages before msg3, got %d", len(beforeMessages))
	}
	if beforeMessages[0].ID != posted[0].ID || beforeMessages[1].ID != posted[1].ID {
		t.Fatalf("expected [msg1, msg2], got [%s, %s]", beforeMessages[0].ID.String(), beforeMessages[1].ID.String())
	}
}

func TestMessage_ValidationsAndReplies(t *testing.T) {
	h := setupTestHarness(t)
	unique := fmt.Sprintf("%d", time.Now().UnixNano())

	user := registerUserHelper(t, h, "valuser_"+unique, "valuser_"+unique+"@example.com", "supersecret123")
	outsider := registerUserHelper(t, h, "outsider_"+unique, "outsider_"+unique+"@example.com", "supersecret123")
	guild := createGuildHelper(t, h, user.Token, "Val Server "+unique)
	channelID := guild.Channels[0].ID.String()

	// 1. Whitespace only content -> 400 MESSAGE_EMPTY
	emptyReq := models.CreateMessageRequest{Content: "   \n\t  "}
	resp, _ := h.request(t, http.MethodPost, "/v1/channels/"+channelID+"/messages", user.Token, emptyReq)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty content, got %d", resp.StatusCode)
	}

	// 2. Content > 2000 runes -> 400 MESSAGE_TOO_LONG
	longContent := strings.Repeat("a", 2001)
	longReq := models.CreateMessageRequest{Content: longContent}
	resp, _ = h.request(t, http.MethodPost, "/v1/channels/"+channelID+"/messages", user.Token, longReq)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for content > 2000 runes, got %d", resp.StatusCode)
	}

	// 3. Post to Voice Channel -> 400 INVALID_CHANNEL_TYPE
	voiceReq := models.CreateChannelRequest{
		Name: "voice-chat",
		Type: models.ChannelTypeVoice,
	}
	vResp, vBody := h.request(t, http.MethodPost, "/v1/guilds/"+guild.ID.String()+"/channels", user.Token, voiceReq)
	if vResp.StatusCode != http.StatusCreated {
		t.Fatalf("failed to create voice channel: %s", string(vBody))
	}
	var voiceChan models.ChannelResponse
	_ = json.Unmarshal(vBody, &voiceChan)

	resp, _ = h.request(t, http.MethodPost, "/v1/channels/"+voiceChan.ID.String()+"/messages", user.Token, models.CreateMessageRequest{Content: "voice text"})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 posting to voice channel, got %d", resp.StatusCode)
	}

	// 4. Outsider (non-member) post -> 403 FORBIDDEN
	resp, _ = h.request(t, http.MethodPost, "/v1/channels/"+channelID+"/messages", outsider.Token, models.CreateMessageRequest{Content: "intruder"})
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 for non-member post, got %d", resp.StatusCode)
	}

	// 5. Outsider (non-member) list -> 403 FORBIDDEN
	resp, _ = h.request(t, http.MethodGet, "/v1/channels/"+channelID+"/messages", outsider.Token, nil)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 for non-member list, got %d", resp.StatusCode)
	}

	// 6. Post valid base message
	resp, body := h.request(t, http.MethodPost, "/v1/channels/"+channelID+"/messages", user.Token, models.CreateMessageRequest{Content: "Base message"})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("post base message failed: %s", string(body))
	}
	var baseMsg models.MessageResponse
	_ = json.Unmarshal(body, &baseMsg)

	// 7. Reply to non-existent message -> 400 INVALID_REPLY
	bogusID, _ := snowflake.Parse("999999999999999")
	badReplyReq := models.CreateMessageRequest{
		Content:   "bad reply",
		ReplyToID: &bogusID,
	}
	resp, _ = h.request(t, http.MethodPost, "/v1/channels/"+channelID+"/messages", user.Token, badReplyReq)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for reply to non-existent message, got %d", resp.StatusCode)
	}

	// 8. Reply to valid message -> 201 Created with type == 19
	validReplyReq := models.CreateMessageRequest{
		Content:   "valid reply",
		ReplyToID: &baseMsg.ID,
	}
	resp, body = h.request(t, http.MethodPost, "/v1/channels/"+channelID+"/messages", user.Token, validReplyReq)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201 for valid reply, got %d: %s", resp.StatusCode, string(body))
	}
	var replyMsg models.MessageResponse
	_ = json.Unmarshal(body, &replyMsg)
	if replyMsg.Type != models.MessageTypeReply {
		t.Fatalf("expected message type 19 for reply, got %d", replyMsg.Type)
	}
	if replyMsg.ReplyToID == nil || *replyMsg.ReplyToID != baseMsg.ID {
		t.Fatalf("reply_to_id mismatch")
	}
}

func TestMessage_EditAuthorization(t *testing.T) {
	h := setupTestHarness(t)
	unique := fmt.Sprintf("%d", time.Now().UnixNano())

	alice := registerUserHelper(t, h, "alice_edit_"+unique, "alice_edit_"+unique+"@example.com", "supersecret123")
	bob := registerUserHelper(t, h, "bob_edit_"+unique, "bob_edit_"+unique+"@example.com", "supersecret123")
	guild := createGuildHelper(t, h, alice.Token, "Edit Server "+unique)
	channelID := guild.Channels[0].ID.String()

	// Add Bob to guild
	addGuildMemberHelper(t, h, guild.ID, bob.User.ID)

	// Alice posts message
	pResp, pBody := h.request(t, http.MethodPost, "/v1/channels/"+channelID+"/messages", alice.Token, models.CreateMessageRequest{Content: "Original content"})
	if pResp.StatusCode != http.StatusCreated {
		t.Fatalf("post failed: %s", string(pBody))
	}
	var msg models.MessageResponse
	_ = json.Unmarshal(pBody, &msg)

	// 1. Bob attempts to edit Alice's message -> 403 FORBIDDEN
	patchReq := models.UpdateMessageRequest{Content: "Bob's malicious edit"}
	resp, _ := h.request(t, http.MethodPatch, "/v1/channels/"+channelID+"/messages/"+msg.ID.String(), bob.Token, patchReq)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 for non-author edit, got %d", resp.StatusCode)
	}

	// 2. Alice edits her own message -> 200 OK
	aliceEditReq := models.UpdateMessageRequest{Content: "Original content (edited by Alice)"}
	resp, body := h.request(t, http.MethodPatch, "/v1/channels/"+channelID+"/messages/"+msg.ID.String(), alice.Token, aliceEditReq)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK for author edit, got %d: %s", resp.StatusCode, string(body))
	}
	var updatedMsg models.MessageResponse
	_ = json.Unmarshal(body, &updatedMsg)
	if updatedMsg.Content != aliceEditReq.Content {
		t.Fatalf("content was not updated: %s", updatedMsg.Content)
	}
	if updatedMsg.EditedAt == nil {
		t.Fatalf("expected edited_at timestamp to be non-null")
	}

	// 3. Edit with empty content -> 400 MESSAGE_EMPTY
	resp, _ = h.request(t, http.MethodPatch, "/v1/channels/"+channelID+"/messages/"+msg.ID.String(), alice.Token, models.UpdateMessageRequest{Content: "   "})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty edit, got %d", resp.StatusCode)
	}
}

func TestMessage_DeleteAuthorization(t *testing.T) {
	h := setupTestHarness(t)
	unique := fmt.Sprintf("%d", time.Now().UnixNano())

	owner := registerUserHelper(t, h, "owner_del_"+unique, "owner_del_"+unique+"@example.com", "supersecret123")
	member := registerUserHelper(t, h, "member_del_"+unique, "member_del_"+unique+"@example.com", "supersecret123")
	otherMember := registerUserHelper(t, h, "other_del_"+unique, "other_del_"+unique+"@example.com", "supersecret123")

	guild := createGuildHelper(t, h, owner.Token, "Delete Server "+unique)
	channelID := guild.Channels[0].ID.String()

	addGuildMemberHelper(t, h, guild.ID, member.User.ID)
	addGuildMemberHelper(t, h, guild.ID, otherMember.User.ID)

	// Member posts message 1
	pResp, pBody := h.request(t, http.MethodPost, "/v1/channels/"+channelID+"/messages", member.Token, models.CreateMessageRequest{Content: "Member message 1"})
	if pResp.StatusCode != http.StatusCreated {
		t.Fatalf("post failed: %s", string(pBody))
	}
	var msg1 models.MessageResponse
	_ = json.Unmarshal(pBody, &msg1)

	// 1. Other member attempts to delete msg1 -> 403 FORBIDDEN
	resp, _ := h.request(t, http.MethodDelete, "/v1/channels/"+channelID+"/messages/"+msg1.ID.String(), otherMember.Token, nil)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 for unauthorized delete, got %d", resp.StatusCode)
	}

	// 2. Guild Owner deletes member's msg1 -> 204 No Content
	resp, _ = h.request(t, http.MethodDelete, "/v1/channels/"+channelID+"/messages/"+msg1.ID.String(), owner.Token, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("expected 204 No Content for guild owner delete, got %d", resp.StatusCode)
	}

	// 3. Repeated delete of already deleted msg1 -> 404 MESSAGE_NOT_FOUND
	resp, _ = h.request(t, http.MethodDelete, "/v1/channels/"+channelID+"/messages/"+msg1.ID.String(), owner.Token, nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 for deleting non-existent message, got %d", resp.StatusCode)
	}

	// Member posts message 2
	pResp, pBody = h.request(t, http.MethodPost, "/v1/channels/"+channelID+"/messages", member.Token, models.CreateMessageRequest{Content: "Member message 2"})
	if pResp.StatusCode != http.StatusCreated {
		t.Fatalf("post failed: %s", string(pBody))
	}
	var msg2 models.MessageResponse
	_ = json.Unmarshal(pBody, &msg2)

	// 4. Author deletes own msg2 -> 204 No Content
	resp, _ = h.request(t, http.MethodDelete, "/v1/channels/"+channelID+"/messages/"+msg2.ID.String(), member.Token, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("expected 204 No Content for author delete, got %d", resp.StatusCode)
	}
}

func TestMessage_TypingIndicator(t *testing.T) {
	h := setupTestHarness(t)
	unique := fmt.Sprintf("%d", time.Now().UnixNano())

	user := registerUserHelper(t, h, "typeuser_"+unique, "typeuser_"+unique+"@example.com", "supersecret123")
	outsider := registerUserHelper(t, h, "typeoutsider_"+unique, "typeoutsider_"+unique+"@example.com", "supersecret123")
	guild := createGuildHelper(t, h, user.Token, "Typing Server "+unique)
	channelID := guild.Channels[0].ID.String()

	// 1. Member triggers typing -> 204 No Content
	resp, body := h.request(t, http.MethodPost, "/v1/channels/"+channelID+"/typing", user.Token, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("expected 204 No Content for typing, got %d: %s", resp.StatusCode, string(body))
	}

	// 2. Outsider triggers typing -> 403 FORBIDDEN
	resp, _ = h.request(t, http.MethodPost, "/v1/channels/"+channelID+"/typing", outsider.Token, nil)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 for outsider typing, got %d", resp.StatusCode)
	}
}
