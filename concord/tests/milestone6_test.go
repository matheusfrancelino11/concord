package tests

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"testing"
	"time"

	"concord/internal/models"
)

func TestMilestone6_PermissionsAndRoles(t *testing.T) {
	h := setupTestHarness(t)
	unique := fmt.Sprintf("%d", time.Now().UnixNano())

	alice := registerUserHelper(t, h, "admin_alice_"+unique, "admin_alice_"+unique+"@test.com", "Password123!")
	bob := registerUserHelper(t, h, "admin_bob_"+unique, "admin_bob_"+unique+"@test.com", "Password123!")

	// 1. Alice creates guild
	guild := createGuildHelper(t, h, alice.Token, "Admin Guild "+unique)
	guildID := guild.ID.String()

	// 2. Alice creates role "Moderator"
	modPerms := strconv.FormatInt(models.PermKickMembers|models.PermBanMembers, 10)
	modColor := 0x00FF00
	modHoist := true
	createRolePayload := models.CreateRoleRequest{
		Name:        "Moderator",
		Permissions: &modPerms,
		Color:       &modColor,
		Hoist:       &modHoist,
	}
	resp, body := h.request(t, http.MethodPost, "/v1/guilds/"+guildID+"/roles", alice.Token, createRolePayload)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201 Created on create role, got %d: %s", resp.StatusCode, string(body))
	}

	var modRole models.RoleResponse
	if err := json.Unmarshal(body, &modRole); err != nil {
		t.Fatalf("failed to unmarshal role response: %v", err)
	}
	if modRole.Name != "Moderator" {
		t.Fatalf("expected role name Moderator, got %s", modRole.Name)
	}
	if modRole.Permissions != modPerms {
		t.Fatalf("expected role perms %s, got %s", modPerms, modRole.Permissions)
	}

	// 3. List roles
	resp, body = h.request(t, http.MethodGet, "/v1/guilds/"+guildID+"/roles", alice.Token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK on list roles, got %d: %s", resp.StatusCode, string(body))
	}
	var roles []models.RoleResponse
	if err := json.Unmarshal(body, &roles); err != nil {
		t.Fatalf("failed to unmarshal roles list: %v", err)
	}
	if len(roles) < 2 { // @everyone + Moderator
		t.Fatalf("expected at least 2 roles, got %d", len(roles))
	}

	// 4. Update role "Moderator" -> "Lead Mod" with red color
	newName := "Lead Mod"
	newColor := 0xFF0000
	updateRolePayload := models.UpdateRoleRequest{
		Name:  &newName,
		Color: &newColor,
	}
	resp, body = h.request(t, http.MethodPatch, "/v1/guilds/"+guildID+"/roles/"+modRole.ID.String(), alice.Token, updateRolePayload)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK on update role, got %d: %s", resp.StatusCode, string(body))
	}
	var updatedRole models.RoleResponse
	_ = json.Unmarshal(body, &updatedRole)
	if updatedRole.Name != "Lead Mod" || updatedRole.Color != newColor {
		t.Fatalf("expected updated name Lead Mod and color %d, got %s / %d", newColor, updatedRole.Name, updatedRole.Color)
	}

	// 5. Verify @everyone cannot be renamed
	var everyoneRoleID string
	for _, r := range roles {
		if r.Position == 0 || r.Name == "@everyone" {
			everyoneRoleID = r.ID.String()
			break
		}
	}
	badName := "renamed everyone"
	resp, _ = h.request(t, http.MethodPatch, "/v1/guilds/"+guildID+"/roles/"+everyoneRoleID, alice.Token, models.UpdateRoleRequest{Name: &badName})
	if resp.StatusCode == http.StatusOK {
		t.Fatalf("expected failure when renaming @everyone, got 200 OK")
	}

	// 6. Bob joins guild via invite
	invResp, invBody := h.request(t, http.MethodPost, "/v1/guilds/"+guildID+"/invites", alice.Token, models.CreateInviteRequest{})
	if invResp.StatusCode != http.StatusCreated {
		t.Fatalf("failed to create invite: %s", string(invBody))
	}
	var inv models.Invite
	_ = json.Unmarshal(invBody, &inv)

	useResp, useBody := h.request(t, http.MethodPost, "/v1/invites/"+inv.Code+"/use", bob.Token, nil)
	if useResp.StatusCode != http.StatusOK {
		t.Fatalf("failed to use invite: %s", string(useBody))
	}

	// 7. Alice assigns "Lead Mod" role to Bob
	assignResp, assignBody := h.request(t, http.MethodPut, "/v1/guilds/"+guildID+"/members/"+bob.User.ID.String()+"/roles/"+modRole.ID.String(), alice.Token, nil)
	if assignResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK on assign member role, got %d: %s", assignResp.StatusCode, string(assignBody))
	}

	// 8. Bob lists members and verifies his role assignment
	listMemResp, listMemBody := h.request(t, http.MethodGet, "/v1/guilds/"+guildID+"/members", bob.Token, nil)
	if listMemResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK on list members: %s", string(listMemBody))
	}
	var members []models.MemberResponse
	_ = json.Unmarshal(listMemBody, &members)

	var bobMember *models.MemberResponse
	for i := range members {
		if members[i].UserID == bob.User.ID {
			bobMember = &members[i]
			break
		}
	}
	if bobMember == nil {
		t.Fatalf("bob not found in members list")
	}
	hasModRole := false
	for _, rid := range bobMember.Roles {
		if rid == modRole.ID {
			hasModRole = true
			break
		}
	}
	if !hasModRole {
		t.Fatalf("expected bob to have Lead Mod role %s in roles list %v", modRole.ID, bobMember.Roles)
	}

	// 9. Alice removes role from Bob
	remResp, remBody := h.request(t, http.MethodDelete, "/v1/guilds/"+guildID+"/members/"+bob.User.ID.String()+"/roles/"+modRole.ID.String(), alice.Token, nil)
	if remResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK on remove role: %s", string(remBody))
	}

	// 10. Alice deletes custom role
	delResp, delBody := h.request(t, http.MethodDelete, "/v1/guilds/"+guildID+"/roles/"+modRole.ID.String(), alice.Token, nil)
	if delResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK on delete role, got %d: %s", delResp.StatusCode, string(delBody))
	}

	// Cannot delete @everyone
	delEveryResp, _ := h.request(t, http.MethodDelete, "/v1/guilds/"+guildID+"/roles/"+everyoneRoleID, alice.Token, nil)
	if delEveryResp.StatusCode == http.StatusOK {
		t.Fatalf("expected failure deleting @everyone role, got 200 OK")
	}
}

func TestMilestone6_KickAndBanAndInvites(t *testing.T) {
	h := setupTestHarness(t)
	unique := fmt.Sprintf("%d", time.Now().UnixNano())

	alice := registerUserHelper(t, h, "mod_alice_"+unique, "mod_alice_"+unique+"@test.com", "Password123!")
	charlie := registerUserHelper(t, h, "mod_charlie_"+unique, "mod_charlie_"+unique+"@test.com", "Password123!")

	guild := createGuildHelper(t, h, alice.Token, "Moderation Guild "+unique)
	guildID := guild.ID.String()

	// 1. Create invite and Charlie joins
	invResp, invBody := h.request(t, http.MethodPost, "/v1/guilds/"+guildID+"/invites", alice.Token, models.CreateInviteRequest{})
	if invResp.StatusCode != http.StatusCreated {
		t.Fatalf("failed to create invite: %s", string(invBody))
	}
	var inv models.Invite
	_ = json.Unmarshal(invBody, &inv)

	useResp, _ := h.request(t, http.MethodPost, "/v1/invites/"+inv.Code+"/use", charlie.Token, nil)
	if useResp.StatusCode != http.StatusOK {
		t.Fatalf("charlie failed to join guild")
	}

	// 2. Alice kicks Charlie
	kickResp, kickBody := h.request(t, http.MethodDelete, "/v1/guilds/"+guildID+"/members/"+charlie.User.ID.String(), alice.Token, nil)
	if kickResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK on kick member, got %d: %s", kickResp.StatusCode, string(kickBody))
	}

	// Verify Charlie is gone from member list
	_, listBody := h.request(t, http.MethodGet, "/v1/guilds/"+guildID+"/members", alice.Token, nil)
	var members []models.MemberResponse
	_ = json.Unmarshal(listBody, &members)
	for _, m := range members {
		if m.UserID == charlie.User.ID {
			t.Fatalf("charlie should not be present in member list after being kicked")
		}
	}

	// 3. Charlie rejoins via invite
	rejoinResp, rejoinBody := h.request(t, http.MethodPost, "/v1/invites/"+inv.Code+"/use", charlie.Token, nil)
	if rejoinResp.StatusCode != http.StatusOK {
		t.Fatalf("charlie failed to rejoin after kick: %s", string(rejoinBody))
	}

	// 4. Alice bans Charlie
	reason := "Violation of server rules"
	banPayload := models.CreateBanRequest{
		Reason: &reason,
	}
	banResp, banBody := h.request(t, http.MethodPut, "/v1/guilds/"+guildID+"/bans/"+charlie.User.ID.String(), alice.Token, banPayload)
	if banResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK on ban member, got %d: %s", banResp.StatusCode, string(banBody))
	}

	// 5. Alice inspects bans list
	bansResp, bansBody := h.request(t, http.MethodGet, "/v1/guilds/"+guildID+"/bans", alice.Token, nil)
	if bansResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK on list bans, got %d: %s", bansResp.StatusCode, string(bansBody))
	}
	var bans []models.BanResponse
	_ = json.Unmarshal(bansBody, &bans)
	if len(bans) == 0 {
		t.Fatalf("expected at least 1 ban recorded")
	}
	if bans[0].User.ID != charlie.User.ID {
		t.Fatalf("expected charlie to be banned, got %v", bans[0].User.ID)
	}

	// 6. Charlie attempts to use invite while banned -> MUST be rejected with 403 Forbidden
	bannedJoinResp, _ := h.request(t, http.MethodPost, "/v1/invites/"+inv.Code+"/use", charlie.Token, nil)
	if bannedJoinResp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for banned user redeeming invite, got %d", bannedJoinResp.StatusCode)
	}

	// 7. Alice unbans Charlie
	unbanResp, unbanBody := h.request(t, http.MethodDelete, "/v1/guilds/"+guildID+"/bans/"+charlie.User.ID.String(), alice.Token, nil)
	if unbanResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK on unban member, got %d: %s", unbanResp.StatusCode, string(unbanBody))
	}

	// 8. Charlie can now redeem invite successfully
	afterUnbanJoinResp, afterUnbanJoinBody := h.request(t, http.MethodPost, "/v1/invites/"+inv.Code+"/use", charlie.Token, nil)
	if afterUnbanJoinResp.StatusCode != http.StatusOK {
		t.Fatalf("expected charlie to be able to join after unban, got %d: %s", afterUnbanJoinResp.StatusCode, string(afterUnbanJoinBody))
	}
}

func TestMilestone6_ServerUpdate(t *testing.T) {
	h := setupTestHarness(t)
	unique := fmt.Sprintf("%d", time.Now().UnixNano())

	alice := registerUserHelper(t, h, "owner_alice_"+unique, "owner_alice_"+unique+"@test.com", "Password123!")

	guild := createGuildHelper(t, h, alice.Token, "Original Server "+unique)
	guildID := guild.ID.String()

	newName := "Renamed Server " + unique
	newIcon := "https://example.com/icon.png"
	updatePayload := models.UpdateGuildRequest{
		Name: &newName,
		Icon: &newIcon,
	}
	resp, body := h.request(t, http.MethodPatch, "/v1/guilds/"+guildID, alice.Token, updatePayload)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK on patch guild, got %d: %s", resp.StatusCode, string(body))
	}

	var detail models.GuildDetailResponse
	_ = json.Unmarshal(body, &detail)
	if detail.Name != newName {
		t.Fatalf("expected guild name %s, got %s", newName, detail.Name)
	}
	if detail.Icon == nil || *detail.Icon != newIcon {
		t.Fatalf("expected guild icon %s, got %v", newIcon, detail.Icon)
	}
}
