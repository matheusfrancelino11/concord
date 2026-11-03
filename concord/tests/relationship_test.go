package tests

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"concord/internal/models"
)

func TestRelationshipsFlow(t *testing.T) {
	h := setupTestHarness(t)

	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	userA := registerUserHelper(t, h, "user_a_"+suffix, "user_a_"+suffix+"@example.com", "Password123!")
	userB := registerUserHelper(t, h, "user_b_"+suffix, "user_b_"+suffix+"@example.com", "Password123!")
	userC := registerUserHelper(t, h, "user_c_"+suffix, "user_c_"+suffix+"@example.com", "Password123!")

	// 1. Initial relationships list should be empty
	resp, body := h.request(t, http.MethodGet, "/v1/users/@me/relationships", userA.Token, nil)
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	var relsA []models.RelationshipResponse
	err := json.Unmarshal(body, &relsA)
	require.NoError(t, err)
	assert.Empty(t, relsA)

	// 2. User A sends friend request to User B by username
	sendReq := models.SendFriendRequest{Username: userB.User.Username}
	resp, body = h.request(t, http.MethodPost, "/v1/users/@me/relationships", userA.Token, sendReq)
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	var createdRel models.RelationshipResponse
	err = json.Unmarshal(body, &createdRel)
	require.NoError(t, err)
	assert.Equal(t, userB.User.ID, createdRel.ID)
	assert.Equal(t, models.RelationshipTypeOutgoing, createdRel.Type)

	// 3. User B checks relationships -> should have Incoming request from User A
	resp, body = h.request(t, http.MethodGet, "/v1/users/@me/relationships", userB.Token, nil)
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	var relsB []models.RelationshipResponse
	err = json.Unmarshal(body, &relsB)
	require.NoError(t, err)
	require.Len(t, relsB, 1)
	assert.Equal(t, userA.User.ID, relsB[0].ID)
	assert.Equal(t, models.RelationshipTypeIncoming, relsB[0].Type)

	// 4. User B accepts the request
	acceptPath := fmt.Sprintf("/v1/users/@me/relationships/%s", userA.User.ID.String())
	resp, body = h.request(t, http.MethodPut, acceptPath, userB.Token, nil)
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	var acceptedRel models.RelationshipResponse
	err = json.Unmarshal(body, &acceptedRel)
	require.NoError(t, err)
	assert.Equal(t, models.RelationshipTypeFriend, acceptedRel.Type)

	// 5. Both User A and User B should now have each other as Friends (type 1)
	resp, body = h.request(t, http.MethodGet, "/v1/users/@me/relationships", userA.Token, nil)
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	err = json.Unmarshal(body, &relsA)
	require.NoError(t, err)
	require.Len(t, relsA, 1)
	assert.Equal(t, models.RelationshipTypeFriend, relsA[0].Type)

	// 6. User A removes User B
	delPath := fmt.Sprintf("/v1/users/@me/relationships/%s", userB.User.ID.String())
	resp, _ = h.request(t, http.MethodDelete, delPath, userA.Token, nil)
	assert.Equal(t, http.StatusNoContent, resp.StatusCode)

	resp, body = h.request(t, http.MethodGet, "/v1/users/@me/relationships", userA.Token, nil)
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	err = json.Unmarshal(body, &relsA)
	require.NoError(t, err)
	assert.Empty(t, relsA)

	// 7. Test mutual friend request (A -> C, then C -> A auto-friends)
	resp, _ = h.request(t, http.MethodPost, "/v1/users/@me/relationships", userA.Token, models.SendFriendRequest{Username: userC.User.Username})
	assert.Equal(t, http.StatusOK, resp.StatusCode)

	resp, body = h.request(t, http.MethodPost, "/v1/users/@me/relationships", userC.Token, models.SendFriendRequest{Username: userA.User.Username})
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	var mutualRel models.RelationshipResponse
	err = json.Unmarshal(body, &mutualRel)
	require.NoError(t, err)
	assert.Equal(t, models.RelationshipTypeFriend, mutualRel.Type)
}
