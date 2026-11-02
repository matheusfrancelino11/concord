package tests

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"concord/internal/api"
	"concord/internal/config"
	"concord/internal/database"
	"concord/internal/middleware"
	"concord/internal/models"
	"concord/internal/service"
	"concord/internal/snowflake"
)

// TestGuildCreation_AtomicRollbackAndDefaults verifies:
// 1. Every guild creation atomically creates the @everyone role (pos 0) and #geral channel (type 0, pos 0).
// 2. If channel or role insertion fails, the entire transaction rolls back completely without orphan rows.
func TestGuildCreation_AtomicRollbackAndDefaults(t *testing.T) {
	cfg := config.Load()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	pool, err := database.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		t.Fatalf("failed to connect to database: %v", err)
	}
	defer pool.Close()

	if err := database.RunMigrations(ctx, pool); err != nil {
		t.Fatalf("failed to run migrations: %v", err)
	}

	sf, err := snowflake.New(cfg.WorkerID, cfg.ProcessID)
	if err != nil {
		t.Fatalf("failed to init snowflake: %v", err)
	}

	authSvc := service.NewAuthService(pool, sf, cfg.JWTSecret)
	guildSvc := service.NewGuildService(pool, sf)

	uniqueSuffix := fmt.Sprintf("%d", time.Now().UnixNano())
	regResp, err := authSvc.Register(ctx, &models.RegisterRequest{
		Email:    "guild_owner_" + uniqueSuffix + "@example.com",
		Username: "guild_owner_" + uniqueSuffix,
		Password: "Password123!",
	})
	if err != nil {
		t.Fatalf("failed to register owner: %v", err)
	}
	ownerID := regResp.User.ID

	// Part 1: Verify defaults on normal guild creation
	guildResp, err := guildSvc.CreateGuild(ctx, ownerID, &models.CreateGuildRequest{
		Name: "Default Test Guild",
	})
	if err != nil {
		t.Fatalf("failed to create guild: %v", err)
	}

	if len(guildResp.Channels) != 1 {
		t.Fatalf("expected exactly 1 channel, got %d", len(guildResp.Channels))
	}
	ch := guildResp.Channels[0]
	if ch.Name != "geral" || ch.Type != 0 || ch.Position != 0 {
		t.Errorf("channel mismatch: name=%s (want 'geral'), type=%d (want 0), pos=%d (want 0)", ch.Name, ch.Type, ch.Position)
	}

	if len(guildResp.Roles) != 1 {
		t.Fatalf("expected exactly 1 role, got %d", len(guildResp.Roles))
	}
	role := guildResp.Roles[0]
	if role.Name != "@everyone" || role.Position != 0 {
		t.Errorf("role mismatch: name=%s (want '@everyone'), pos=%d (want 0)", role.Name, role.Position)
	}

	// Verify in database directly
	var dbRoleCount, dbChannelCount, dbMemberCount int
	err = pool.QueryRow(ctx, "SELECT COUNT(*) FROM roles WHERE guild_id = $1 AND name = '@everyone' AND position = 0", guildResp.ID).Scan(&dbRoleCount)
	if err != nil || dbRoleCount != 1 {
		t.Fatalf("database verification failed for @everyone role: count=%d, err=%v", dbRoleCount, err)
	}

	err = pool.QueryRow(ctx, "SELECT COUNT(*) FROM channels WHERE guild_id = $1 AND name = 'geral' AND type = 0 AND position = 0", guildResp.ID).Scan(&dbChannelCount)
	if err != nil || dbChannelCount != 1 {
		t.Fatalf("database verification failed for #geral channel: count=%d, err=%v", dbChannelCount, err)
	}

	err = pool.QueryRow(ctx, "SELECT COUNT(*) FROM members WHERE guild_id = $1 AND user_id = $2", guildResp.ID, ownerID).Scan(&dbMemberCount)
	if err != nil || dbMemberCount != 1 {
		t.Fatalf("database verification failed for owner membership: count=%d, err=%v", dbMemberCount, err)
	}

	// Part 2: Empirical Atomic Rollback Test
	// Install a trigger that aborts insertion into channels table when guild name is 'ROLLBACK_TRIGGER_TEST'
	rollbackGuildName := "ROLLBACK_TRIGGER_TEST"

	triggerSQL := `
		CREATE OR REPLACE FUNCTION test_abort_channel_insert() RETURNS trigger AS $$
		BEGIN
			IF EXISTS (SELECT 1 FROM guilds WHERE id = NEW.guild_id AND name = 'ROLLBACK_TRIGGER_TEST') THEN
				RAISE EXCEPTION 'adversarial induced failure on channel insert';
			END IF;
			RETURN NEW;
		END;
		$$ LANGUAGE plpgsql;

		DROP TRIGGER IF EXISTS trg_adversarial_channel_fail ON channels;
		CREATE TRIGGER trg_adversarial_channel_fail
			BEFORE INSERT ON channels
			FOR EACH ROW
			EXECUTE FUNCTION test_abort_channel_insert();
	`
	_, err = pool.Exec(ctx, triggerSQL)
	if err != nil {
		t.Fatalf("failed to setup rollback trigger: %v", err)
	}
	defer func() {
		_, _ = pool.Exec(ctx, `
			DROP TRIGGER IF EXISTS trg_adversarial_channel_fail ON channels;
			DROP FUNCTION IF EXISTS test_abort_channel_insert();
		`)
	}()

	// Attempt to create guild with name 'ROLLBACK_TRIGGER_TEST'
	failedGuildResp, err := guildSvc.CreateGuild(ctx, ownerID, &models.CreateGuildRequest{
		Name: rollbackGuildName,
	})
	if err == nil {
		t.Fatalf("expected CreateGuild to fail due to induced channel error, but it succeeded: %+v", failedGuildResp)
	}
	t.Logf("Empirical confirmation: CreateGuild returned expected error: %v", err)

	// Verify complete rollback in PostgreSQL: NO guild, NO member, NO role should exist!
	var guildCount, memberCount, roleCount int
	err = pool.QueryRow(ctx, "SELECT COUNT(*) FROM guilds WHERE name = $1", rollbackGuildName).Scan(&guildCount)
	if err != nil {
		t.Fatalf("failed to query guilds count: %v", err)
	}
	if guildCount != 0 {
		t.Errorf("CRITICAL ATOMICITY FAILURE: found %d guild row(s) after failed transaction!", guildCount)
	}

	// Check if any orphan roles exist named '@everyone' created within the last 10 seconds for this owner
	err = pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM roles r
		JOIN guilds g ON r.guild_id = g.id
		WHERE g.name = $1
	`, rollbackGuildName).Scan(&roleCount)
	if err != nil {
		t.Fatalf("failed to query roles count: %v", err)
	}
	if roleCount != 0 {
		t.Errorf("CRITICAL ATOMICITY FAILURE: found %d orphan role(s) after failed transaction!", roleCount)
	}

	err = pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM members m
		JOIN guilds g ON m.guild_id = g.id
		WHERE g.name = $1
	`, rollbackGuildName).Scan(&memberCount)
	if err != nil {
		t.Fatalf("failed to query members count: %v", err)
	}
	if memberCount != 0 {
		t.Errorf("CRITICAL ATOMICITY FAILURE: found %d orphan member(s) after failed transaction!", memberCount)
	}

	t.Logf("Transaction atomicity verified: guilds=%d, roles=%d, members=%d", guildCount, roleCount, memberCount)
}

// TestAuthorizationAndRBAC_GuildDetailsAndDeletion verifies:
// 1. Non-members cannot inspect guild details (403 Forbidden).
// 2. Non-owners (both non-members and regular members) cannot delete guilds (403 Forbidden).
func TestAuthorizationAndRBAC_GuildDetailsAndDeletion(t *testing.T) {
	h := setupTestHarness(t)
	uniqueSuffix := fmt.Sprintf("%d", time.Now().UnixNano())

	// Register Alice (Owner)
	_, aliceBody := h.request(t, http.MethodPost, "/v1/auth/register", "", models.RegisterRequest{
		Email:    "alice_rbac_" + uniqueSuffix + "@example.com",
		Username: "alice_rbac_" + uniqueSuffix,
		Password: "password123",
	})
	var aliceAuth models.AuthResponse
	_ = json.Unmarshal(aliceBody, &aliceAuth)

	// Register Bob (Non-owner)
	_, bobBody := h.request(t, http.MethodPost, "/v1/auth/register", "", models.RegisterRequest{
		Email:    "bob_rbac_" + uniqueSuffix + "@example.com",
		Username: "bob_rbac_" + uniqueSuffix,
		Password: "password123",
	})
	var bobAuth models.AuthResponse
	_ = json.Unmarshal(bobBody, &bobAuth)

	// Alice creates guild
	resp, body := h.request(t, http.MethodPost, "/v1/guilds", aliceAuth.Token, models.CreateGuildRequest{
		Name: "Alice Secret Guild",
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("failed to create guild: %s", string(body))
	}
	var guild models.GuildDetailResponse
	_ = json.Unmarshal(body, &guild)

	// 1. Bob (non-member) tries to inspect Alice's guild -> 403 Forbidden
	resp, _ = h.request(t, http.MethodGet, "/v1/guilds/"+guild.ID.String(), bobAuth.Token, nil)
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("expected 403 Forbidden for non-member inspect, got %d", resp.StatusCode)
	}

	// 2. Bob (non-member) tries to delete Alice's guild -> 403 Forbidden
	resp, _ = h.request(t, http.MethodDelete, "/v1/guilds/"+guild.ID.String(), bobAuth.Token, nil)
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("expected 403 Forbidden for non-member delete guild, got %d", resp.StatusCode)
	}

	// 3. Now add Bob to members table (simulating Bob joined the guild as a regular member)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	pool, err := database.NewPool(ctx, h.cfg.DatabaseURL)
	if err != nil {
		t.Fatalf("failed to connect pool: %v", err)
	}
	defer pool.Close()

	_, err = pool.Exec(ctx, `INSERT INTO members (guild_id, user_id, nick, joined_at, deaf, mute, flags) VALUES ($1, $2, 'BobMember', NOW(), FALSE, FALSE, 0)`, guild.ID, bobAuth.User.ID)
	if err != nil {
		t.Fatalf("failed to insert Bob into members: %v", err)
	}

	// 4. Bob (now a member) tries to inspect Alice's guild -> 200 OK
	resp, _ = h.request(t, http.MethodGet, "/v1/guilds/"+guild.ID.String(), bobAuth.Token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200 OK for guild member inspect, got %d", resp.StatusCode)
	}

	// 5. Bob (member, but non-owner) tries to delete Alice's guild -> MUST BE 403 Forbidden
	resp, body = h.request(t, http.MethodDelete, "/v1/guilds/"+guild.ID.String(), bobAuth.Token, nil)
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("CRITICAL RBAC FAILURE: expected 403 Forbidden when member (non-owner) deletes guild, got %d. Body: %s", resp.StatusCode, string(body))
	} else {
		t.Logf("Verified: member non-owner cannot delete guild (403 Forbidden)")
	}
}

// TestAuthorizationAndRBAC_ChannelDeletion_Adversarial tests channel deletion authorization:
// - Non-owners / unauthorized members cannot delete channels
// - Default #geral channel cannot be deleted if it is the only text channel
func TestAuthorizationAndRBAC_ChannelDeletion_Adversarial(t *testing.T) {
	h := setupTestHarness(t)
	uniqueSuffix := fmt.Sprintf("%d", time.Now().UnixNano())

	// Register Alice (Owner)
	_, aliceBody := h.request(t, http.MethodPost, "/v1/auth/register", "", models.RegisterRequest{
		Email:    "alice_ch_" + uniqueSuffix + "@example.com",
		Username: "alice_ch_" + uniqueSuffix,
		Password: "password123",
	})
	var aliceAuth models.AuthResponse
	_ = json.Unmarshal(aliceBody, &aliceAuth)

	// Register Bob (Regular member)
	_, bobBody := h.request(t, http.MethodPost, "/v1/auth/register", "", models.RegisterRequest{
		Email:    "bob_ch_" + uniqueSuffix + "@example.com",
		Username: "bob_ch_" + uniqueSuffix,
		Password: "password123",
	})
	var bobAuth models.AuthResponse
	_ = json.Unmarshal(bobBody, &bobAuth)

	// Alice creates guild
	resp, body := h.request(t, http.MethodPost, "/v1/guilds", aliceAuth.Token, models.CreateGuildRequest{
		Name: "Channel RBAC Guild",
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("failed to create guild: %s", string(body))
	}
	var guild models.GuildDetailResponse
	_ = json.Unmarshal(body, &guild)
	geralChID := guild.Channels[0].ID

	// Alice creates custom text channel "announcements"
	resp, body = h.request(t, http.MethodPost, "/v1/guilds/"+guild.ID.String()+"/channels", aliceAuth.Token, models.CreateChannelRequest{
		Name: "announcements",
		Type: models.ChannelTypeText,
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("failed to create announcements: %s", string(body))
	}
	var customCh models.ChannelResponse
	_ = json.Unmarshal(body, &customCh)

	// Alice creates voice channel "voice-lounge"
	resp, body = h.request(t, http.MethodPost, "/v1/guilds/"+guild.ID.String()+"/channels", aliceAuth.Token, models.CreateChannelRequest{
		Name: "voice-lounge",
		Type: models.ChannelTypeVoice,
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("failed to create voice-lounge: %s", string(body))
	}
	var voiceCh models.ChannelResponse
	_ = json.Unmarshal(body, &voiceCh)

	// Case 1: Non-member Bob tries to delete "announcements" -> 403 Forbidden
	resp, _ = h.request(t, http.MethodDelete, "/v1/channels/"+customCh.ID.String(), bobAuth.Token, nil)
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("expected 403 Forbidden for non-member channel deletion, got %d", resp.StatusCode)
	}

	// Add Bob as a regular member of the guild
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	pool, err := database.NewPool(ctx, h.cfg.DatabaseURL)
	if err != nil {
		t.Fatalf("failed to connect pool: %v", err)
	}
	defer pool.Close()

	_, err = pool.Exec(ctx, `INSERT INTO members (guild_id, user_id, nick, joined_at, deaf, mute, flags) VALUES ($1, $2, 'BobMember', NOW(), FALSE, FALSE, 0)`, guild.ID, bobAuth.User.ID)
	if err != nil {
		t.Fatalf("failed to insert Bob into members: %v", err)
	}

	// Case 2: Bob (now a member, but NOT owner and NOT authorized) tries to delete "announcements"
	// Per Requirement: "non-owners/unauthorized members cannot delete channels"
	resp, body = h.request(t, http.MethodDelete, "/v1/channels/"+customCh.ID.String(), bobAuth.Token, nil)
	t.Logf("Bob (regular member) delete custom channel result: Status=%d, Body=%s", resp.StatusCode, string(body))
	if resp.StatusCode == http.StatusNoContent {
		t.Errorf("CRITICAL RBAC DEFECT: Bob (regular non-owner member without MANAGE_CHANNELS permission) successfully DELETED channel %s! Status: %d", customCh.ID, resp.StatusCode)
	} else if resp.StatusCode != http.StatusForbidden {
		t.Errorf("expected 403 Forbidden when unauthorized member deletes channel, got %d", resp.StatusCode)
	}

	// Case 3: Bob tries to delete "voice-lounge"
	resp, body = h.request(t, http.MethodDelete, "/v1/channels/"+voiceCh.ID.String(), bobAuth.Token, nil)
	t.Logf("Bob (regular member) delete voice channel result: Status=%d, Body=%s", resp.StatusCode, string(body))
	if resp.StatusCode == http.StatusNoContent {
		t.Errorf("CRITICAL RBAC DEFECT: Bob (regular non-owner member) successfully DELETED voice channel %s! Status: %d", voiceCh.ID, resp.StatusCode)
	}

	// Case 4: Default #geral channel protection:
	// Bob tries to delete #geral
	resp, _ = h.request(t, http.MethodDelete, "/v1/channels/"+geralChID.String(), bobAuth.Token, nil)
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("expected 403 Forbidden when non-owner deletes #geral, got %d", resp.StatusCode)
	}

	// Case 5: When #geral is the ONLY text channel left, Alice (owner) tries to delete #geral
	// Ensure custom channel is gone or delete it as Alice if it wasn't deleted
	_, _ = h.request(t, http.MethodDelete, "/v1/channels/"+customCh.ID.String(), aliceAuth.Token, nil)

	// Now only #geral is the remaining text channel
	resp, body = h.request(t, http.MethodDelete, "/v1/channels/"+geralChID.String(), aliceAuth.Token, nil)
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400 Bad Request when owner tries to delete the only text channel #geral, got %d. Body: %s", resp.StatusCode, string(body))
	}
	if !strings.Contains(string(body), "CANNOT_DELETE_LAST_CHANNEL") {
		t.Errorf("expected error code CANNOT_DELETE_LAST_CHANNEL, got: %s", string(body))
	}

	// Case 6: Edge Case — What if owner creates a custom channel "random", deletes "#geral",
	// and then tries to delete "random" when it is the ONLY text channel remaining?
	resp, body = h.request(t, http.MethodPost, "/v1/guilds/"+guild.ID.String()+"/channels", aliceAuth.Token, models.CreateChannelRequest{
		Name: "random",
		Type: models.ChannelTypeText,
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("failed to create random: %s", string(body))
	}
	var randomCh models.ChannelResponse
	_ = json.Unmarshal(body, &randomCh)

	// Now there are 2 text channels: #geral and #random.
	// Owner deletes #geral -> succeeds because count was 2
	resp, _ = h.request(t, http.MethodDelete, "/v1/channels/"+geralChID.String(), aliceAuth.Token, nil)
	t.Logf("Owner delete #geral (when #random exists) status: %d", resp.StatusCode)

	// Now #random is the ONLY remaining text channel!
	// Owner tries to delete #random:
	resp, body = h.request(t, http.MethodDelete, "/v1/channels/"+randomCh.ID.String(), aliceAuth.Token, nil)
	t.Logf("Owner delete last remaining channel #random status: %d, body: %s", resp.StatusCode, string(body))
	if resp.StatusCode == http.StatusNoContent {
		t.Logf("OBSERVATION: When channel is named other than 'geral', DeleteChannel allowed deleting the last remaining text channel, leaving the guild with 0 text channels!")
	}
}

// TestPersistence_AcrossSimulatedRestarts verifies:
// Full database persistence of users, guilds, default channels, custom channels, and roles across complete pool and service teardown / restart.
func TestPersistence_AcrossSimulatedRestarts(t *testing.T) {
	cfg := config.Load()
	uniqueSuffix := fmt.Sprintf("%d", time.Now().UnixNano())

	var registeredUser models.UserResponse
	var userToken string
	var createdGuild models.GuildDetailResponse
	var customChannel models.ChannelResponse

	// Session 1: Create everything, then shutdown
	{
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		pool1, err := database.NewPool(ctx, cfg.DatabaseURL)
		if err != nil {
			t.Fatalf("Session 1: failed to connect: %v", err)
		}
		if err := database.RunMigrations(ctx, pool1); err != nil {
			t.Fatalf("Session 1: failed migrations: %v", err)
		}

		sf, _ := snowflake.New(cfg.WorkerID, cfg.ProcessID)
		authSvc := service.NewAuthService(pool1, sf, cfg.JWTSecret)
		guildSvc := service.NewGuildService(pool1, sf)
		channelSvc := service.NewChannelService(pool1, sf)

		// Register
		authResp, err := authSvc.Register(ctx, &models.RegisterRequest{
			Email:    "restart_" + uniqueSuffix + "@example.com",
			Username: "restart_" + uniqueSuffix,
			Password: "MyPassword123!",
		})
		if err != nil {
			t.Fatalf("Session 1: register failed: %v", err)
		}
		registeredUser = authResp.User
		userToken = authResp.Token

		// Create guild
		gResp, err := guildSvc.CreateGuild(ctx, registeredUser.ID, &models.CreateGuildRequest{
			Name: "Restart Guild",
		})
		if err != nil {
			t.Fatalf("Session 1: create guild failed: %v", err)
		}
		createdGuild = *gResp

		// Create channel
		chResp, err := channelSvc.CreateChannel(ctx, registeredUser.ID, createdGuild.ID, &models.CreateChannelRequest{
			Name: "persisted-chat",
			Type: models.ChannelTypeText,
		})
		if err != nil {
			t.Fatalf("Session 1: create channel failed: %v", err)
		}
		customChannel = *chResp

		// Close pool1 completely
		pool1.Close()
	}

	// Simulate downtime
	time.Sleep(100 * time.Millisecond)

	// Session 2: Fresh pool, fresh router, fresh services (simulating server reboot)
	{
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		pool2, err := database.NewPool(ctx, cfg.DatabaseURL)
		if err != nil {
			t.Fatalf("Session 2: failed to connect: %v", err)
		}
		defer pool2.Close()

		sf, _ := snowflake.New(cfg.WorkerID, cfg.ProcessID)
		authSvc := service.NewAuthService(pool2, sf, cfg.JWTSecret)
		guildSvc := service.NewGuildService(pool2, sf)
		channelSvc := service.NewChannelService(pool2, sf)
		authMiddleware := middleware.NewAuthMiddleware(authSvc)

		router := api.NewRouter(&api.RouterDeps{
			Config:         cfg,
			Pool:           pool2,
			AuthHandler:    api.NewAuthHandler(authSvc),
			GuildHandler:   api.NewGuildHandler(guildSvc, channelSvc),
			ChannelHandler: api.NewChannelHandler(channelSvc),
			AuthMiddleware: authMiddleware,
		})
		server := httptest.NewServer(router)
		defer server.Close()

		h := &testHarness{
			server:  server,
			client:  server.Client(),
			baseURL: server.URL,
			cfg:     cfg,
		}

		// 1. Verify User Profile via HTTP GET /auth/me with previous token
		resp, body := h.request(t, http.MethodGet, "/v1/auth/me", userToken, nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("Session 2: /auth/me failed with status %d: %s", resp.StatusCode, string(body))
		}
		var meResp models.MeResponse
		_ = json.Unmarshal(body, &meResp)
		if meResp.User.ID != registeredUser.ID || meResp.User.Email != registeredUser.Email {
			t.Errorf("Session 2: User profile mismatch: got %+v, want %+v", meResp.User, registeredUser)
		}

		// 2. Verify Login with original password succeeds on fresh service
		loginResp, loginBody := h.request(t, http.MethodPost, "/v1/auth/login", "", models.LoginRequest{
			Email:    "restart_" + uniqueSuffix + "@example.com",
			Password: "MyPassword123!",
		})
		if loginResp.StatusCode != http.StatusOK {
			t.Fatalf("Session 2: login failed with status %d: %s", loginResp.StatusCode, string(loginBody))
		}

		// 3. Verify Guild Details persisted with all channels and roles
		resp, body = h.request(t, http.MethodGet, "/v1/guilds/"+createdGuild.ID.String(), userToken, nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("Session 2: get guild details failed with status %d: %s", resp.StatusCode, string(body))
		}
		var loadedGuild models.GuildDetailResponse
		_ = json.Unmarshal(body, &loadedGuild)

		if loadedGuild.ID != createdGuild.ID || loadedGuild.Name != "Restart Guild" {
			t.Errorf("Session 2: Guild data corrupted: %+v", loadedGuild)
		}

		// Verify channels: should have 2 channels (#geral and #persisted-chat)
		if len(loadedGuild.Channels) != 2 {
			t.Fatalf("Session 2: expected 2 persisted channels, got %d", len(loadedGuild.Channels))
		}

		foundGeral := false
		foundCustom := false
		for _, c := range loadedGuild.Channels {
			if c.Name == "geral" && c.Type == 0 && c.Position == 0 {
				foundGeral = true
			}
			if c.ID == customChannel.ID && c.Name == "persisted-chat" {
				foundCustom = true
			}
		}
		if !foundGeral {
			t.Errorf("Session 2: default channel #geral was lost across restart!")
		}
		if !foundCustom {
			t.Errorf("Session 2: custom channel #persisted-chat was lost across restart!")
		}

		// Verify role persisted
		if len(loadedGuild.Roles) != 1 || loadedGuild.Roles[0].Name != "@everyone" {
			t.Errorf("Session 2: roles lost across restart: %+v", loadedGuild.Roles)
		}

		t.Logf("Persistence verified successfully across restart: User %s, Guild %s, Channels: %d, Roles: %d",
			registeredUser.ID, loadedGuild.ID, len(loadedGuild.Channels), len(loadedGuild.Roles))
	}
}

// TestStress_ConcurrentGuildAndChannelCreation exercises the database pool, Snowflake ID generator,
// and transaction management under heavy concurrent load.
func TestStress_ConcurrentGuildAndChannelCreation(t *testing.T) {
	h := setupTestHarness(t)
	const concurrency = 15
	errCh := make(chan error, concurrency)

	for i := 0; i < concurrency; i++ {
		go func(workerIdx int) {
			uniqueName := fmt.Sprintf("stress_%d_%d", workerIdx, time.Now().UnixNano())
			_, regBody := h.request(t, http.MethodPost, "/v1/auth/register", "", models.RegisterRequest{
				Email:    uniqueName + "@stress.test",
				Username: uniqueName,
				Password: "StrongPassword123!",
			})
			var auth models.AuthResponse
			if err := json.Unmarshal(regBody, &auth); err != nil {
				errCh <- fmt.Errorf("worker %d: parse auth: %w", workerIdx, err)
				return
			}

			// Create guild
			resp, gBody := h.request(t, http.MethodPost, "/v1/guilds", auth.Token, models.CreateGuildRequest{
				Name: fmt.Sprintf("Stress Guild %d", workerIdx),
			})
			if resp.StatusCode != http.StatusCreated {
				errCh <- fmt.Errorf("worker %d: create guild status %d: %s", workerIdx, resp.StatusCode, string(gBody))
				return
			}
			var g models.GuildDetailResponse
			_ = json.Unmarshal(gBody, &g)

			// Concurrently create 3 channels in this guild
			for c := 0; c < 3; c++ {
				cResp, cBody := h.request(t, http.MethodPost, fmt.Sprintf("/v1/guilds/%s/channels", g.ID.String()), auth.Token, models.CreateChannelRequest{
					Name: fmt.Sprintf("chan-%d-%d", workerIdx, c),
					Type: models.ChannelTypeText,
				})
				if cResp.StatusCode != http.StatusCreated {
					errCh <- fmt.Errorf("worker %d: create channel %d status %d: %s", workerIdx, c, cResp.StatusCode, string(cBody))
					return
				}
			}

			errCh <- nil
		}(i)
	}

	for i := 0; i < concurrency; i++ {
		if err := <-errCh; err != nil {
			t.Fatalf("concurrency stress failed: %v", err)
		}
	}
	t.Logf("Stress test passed: %d concurrent workers created guilds and channels with zero collisions or deadlocks", concurrency)
}

// TestAdversarial_InputBoundaryAndSanitization stress-tests edge-case inputs, Unicode boundaries,
// and SQL injection resilience.
func TestAdversarial_InputBoundaryAndSanitization(t *testing.T) {
	h := setupTestHarness(t)
	uniqueSuffix := fmt.Sprintf("%d", time.Now().UnixNano())

	_, regBody := h.request(t, http.MethodPost, "/v1/auth/register", "", models.RegisterRequest{
		Email:    "sanitize_" + uniqueSuffix + "@example.com",
		Username: "sanitize_" + uniqueSuffix,
		Password: "Password123!",
	})
	var auth models.AuthResponse
	_ = json.Unmarshal(regBody, &auth)

	// 1. Guild Name Boundaries
	// 1 char -> 400
	resp, _ := h.request(t, http.MethodPost, "/v1/guilds", auth.Token, models.CreateGuildRequest{Name: "A"})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400 for 1-char guild name, got %d", resp.StatusCode)
	}

	// Whitespace only -> 400
	resp, _ = h.request(t, http.MethodPost, "/v1/guilds", auth.Token, models.CreateGuildRequest{Name: "   "})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400 for whitespace guild name, got %d", resp.StatusCode)
	}

	// 101 chars -> 400
	longGuildName := strings.Repeat("A", 101)
	resp, _ = h.request(t, http.MethodPost, "/v1/guilds", auth.Token, models.CreateGuildRequest{Name: longGuildName})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400 for 101-char guild name, got %d", resp.StatusCode)
	}

	// Exactly 100 chars -> 201
	valid100 := strings.Repeat("A", 100)
	resp, gBody := h.request(t, http.MethodPost, "/v1/guilds", auth.Token, models.CreateGuildRequest{Name: valid100})
	if resp.StatusCode != http.StatusCreated {
		t.Errorf("expected 201 for 100-char guild name, got %d. Body: %s", resp.StatusCode, string(gBody))
	}
	var guild models.GuildDetailResponse
	_ = json.Unmarshal(gBody, &guild)

	// SQL Injection Attempt in Guild Name -> parameterized query safely stores it
	sqlInjGuildName := "Test'; DROP TABLE users; --"
	resp, injBody := h.request(t, http.MethodPost, "/v1/guilds", auth.Token, models.CreateGuildRequest{Name: sqlInjGuildName})
	if resp.StatusCode != http.StatusCreated {
		t.Errorf("expected 201 for SQL injection string, got %d", resp.StatusCode)
	}
	var injGuild models.GuildDetailResponse
	_ = json.Unmarshal(injBody, &injGuild)
	if injGuild.Name != sqlInjGuildName {
		t.Errorf("name mismatch for SQL injection test: got %q", injGuild.Name)
	}

	// 2. Channel Name Boundaries
	// Empty channel name -> 400
	resp, _ = h.request(t, http.MethodPost, fmt.Sprintf("/v1/guilds/%s/channels", guild.ID.String()), auth.Token, models.CreateChannelRequest{
		Name: "   ",
		Type: models.ChannelTypeText,
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400 for empty channel name, got %d", resp.StatusCode)
	}

	// Slug normalization: text channel with accents and whitespace
	resp, chBody := h.request(t, http.MethodPost, fmt.Sprintf("/v1/guilds/%s/channels", guild.ID.String()), auth.Token, models.CreateChannelRequest{
		Name: "  Novos   Avisos   &   Regras  ",
		Type: models.ChannelTypeText,
	})
	if resp.StatusCode != http.StatusCreated {
		t.Errorf("expected 201 for channel with spaces, got %d", resp.StatusCode)
	}
	var normCh models.ChannelResponse
	_ = json.Unmarshal(chBody, &normCh)
	if normCh.Name != "novos-avisos-&-regras" {
		t.Errorf("expected slug 'novos-avisos-&-regras', got %q", normCh.Name)
	}

	// Invalid Channel Type (99) -> 400
	resp, _ = h.request(t, http.MethodPost, fmt.Sprintf("/v1/guilds/%s/channels", guild.ID.String()), auth.Token, models.CreateChannelRequest{
		Name: "invalid-type",
		Type: 99,
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400 for invalid channel type 99, got %d", resp.StatusCode)
	}

	t.Logf("Boundary and sanitization tests passed successfully")
}
