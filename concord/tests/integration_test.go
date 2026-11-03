package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"concord/internal/api"
	"concord/internal/config"
	"concord/internal/database"
	"concord/internal/gateway"
	"concord/internal/middleware"
	"concord/internal/models"
	"concord/internal/service"
	"concord/internal/snowflake"
)

type testHarness struct {
	server       *httptest.Server
	client       *http.Client
	baseURL      string
	wsURL        string
	cfg          *config.Config
	pool         *pgxpool.Pool
	hubManager   *gateway.HubManager
	sessionStore *gateway.SessionStore
	authService  service.AuthService
	guildService service.GuildService
}

func setupTestHarness(t *testing.T) *testHarness {
	cfg := config.Load()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := database.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		t.Fatalf("setupTestHarness: failed to connect to database: %v", err)
	}

	if err := database.RunMigrations(ctx, pool); err != nil {
		t.Fatalf("setupTestHarness: failed to run migrations: %v", err)
	}

	sf, err := snowflake.New(cfg.WorkerID, cfg.ProcessID)
	if err != nil {
		t.Fatalf("setupTestHarness: failed to initialize snowflake: %v", err)
	}

	hubManager := gateway.NewHubManager()
	sessionStore := gateway.NewSessionStore()
	presenceTracker := gateway.NewPresenceTracker()

	authService := service.NewAuthService(pool, sf, cfg.JWTSecret)
	guildService := service.NewGuildService(pool, sf)
	channelService := service.NewChannelService(pool, sf)
	messageService := service.NewMessageService(pool, sf, hubManager)
	voiceService := service.NewVoiceService(pool, cfg.LiveKitURL, cfg.LiveKitKey, cfg.LiveKitSecret)
	inviteService := service.NewInviteService(pool, guildService)
	authMiddleware := middleware.NewAuthMiddleware(authService)

	gatewayHandler := gateway.NewHandler(hubManager, sessionStore, presenceTracker, authService, guildService, voiceService)
	messageHandler := api.NewMessageHandler(messageService)
	inviteHandler := api.NewInviteHandler(inviteService, hubManager, sessionStore)
	voiceHandler := api.NewVoiceHandler(voiceService)

	router := api.NewRouter(&api.RouterDeps{
		Config:         cfg,
		Pool:           pool,
		AuthHandler:    api.NewAuthHandler(authService),
		GuildHandler:   api.NewGuildHandler(guildService, channelService),
		ChannelHandler: api.NewChannelHandler(channelService),
		MessageHandler: messageHandler,
		InviteHandler:  inviteHandler,
		VoiceHandler:   voiceHandler,
		GatewayHandler: gatewayHandler,
		AuthMiddleware: authMiddleware,
	})

	server := httptest.NewServer(router)

	t.Cleanup(func() {
		server.Close()
		pool.Close()
	})

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")

	return &testHarness{
		server:       server,
		client:       server.Client(),
		baseURL:      server.URL,
		wsURL:        wsURL,
		cfg:          cfg,
		pool:         pool,
		hubManager:   hubManager,
		sessionStore: sessionStore,
		authService:  authService,
		guildService: guildService,
	}
}

func (h *testHarness) request(t *testing.T, method, path string, token string, body interface{}) (*http.Response, []byte) {
	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("failed to marshal request body: %v", err)
		}
		bodyReader = bytes.NewReader(data)
	}

	req, err := http.NewRequest(method, h.baseURL+path, bodyReader)
	if err != nil {
		t.Fatalf("failed to create request: %v", err)
	}

	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := h.client.Do(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}

	respBytes, err := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if err != nil {
		t.Fatalf("failed to read response body: %v", err)
	}

	return resp, respBytes
}

func TestHealthEndpoints(t *testing.T) {
	h := setupTestHarness(t)

	for _, path := range []string{"/health", "/v1/health"} {
		resp, body := h.request(t, http.MethodGet, path, "", nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("path %s expected status 200, got %d. Body: %s", path, resp.StatusCode, string(body))
		}

		var data map[string]interface{}
		if err := json.Unmarshal(body, &data); err != nil {
			t.Fatalf("failed to parse health response: %v", err)
		}

		if data["status"] != "ok" {
			t.Errorf("expected status 'ok', got %v", data["status"])
		}
		if data["db"] != "healthy" {
			t.Errorf("expected db 'healthy', got %v", data["db"])
		}
	}
}

func TestAuthLifecycle(t *testing.T) {
	h := setupTestHarness(t)
	uniqueSuffix := fmt.Sprintf("%d", time.Now().UnixNano())

	aliceEmail := "alice_" + uniqueSuffix + "@example.com"
	aliceUser := "alice_" + uniqueSuffix
	alicePass := "supersecret123"

	// 1. Register Alice
	regReq := models.RegisterRequest{
		Email:    aliceEmail,
		Username: aliceUser,
		Password: alicePass,
	}
	resp, body := h.request(t, http.MethodPost, "/v1/auth/register", "", regReq)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201 Created on register, got %d. Body: %s", resp.StatusCode, string(body))
	}

	var authResp models.AuthResponse
	if err := json.Unmarshal(body, &authResp); err != nil {
		t.Fatalf("failed to unmarshal register response: %v", err)
	}
	if authResp.Token == "" || authResp.RefreshToken == "" {
		t.Fatalf("expected non-empty access and refresh tokens")
	}
	if authResp.User.Email != aliceEmail || authResp.User.Username != aliceUser {
		t.Fatalf("user profile mismatch: %+v", authResp.User)
	}
	if authResp.User.ID == 0 {
		t.Fatalf("expected non-zero snowflake user ID")
	}

	// 2. Duplicate registration
	resp, _ = h.request(t, http.MethodPost, "/v1/auth/register", "", regReq)
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("expected 409 Conflict on duplicate registration, got %d", resp.StatusCode)
	}

	// 3. Weak password registration (< 8 chars)
	weakReq := models.RegisterRequest{
		Email:    "weak_" + uniqueSuffix + "@example.com",
		Username: "weak_" + uniqueSuffix,
		Password: "123",
	}
	resp, _ = h.request(t, http.MethodPost, "/v1/auth/register", "", weakReq)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request on weak password, got %d", resp.StatusCode)
	}

	// 4. Invalid email registration
	invEmailReq := models.RegisterRequest{
		Email:    "invalid-email-format",
		Username: "user_" + uniqueSuffix,
		Password: "password123",
	}
	resp, _ = h.request(t, http.MethodPost, "/v1/auth/register", "", invEmailReq)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request on invalid email, got %d", resp.StatusCode)
	}

	// 5. Login Alice with correct credentials
	loginReq := models.LoginRequest{
		Email:    aliceEmail,
		Password: alicePass,
	}
	resp, body = h.request(t, http.MethodPost, "/v1/auth/login", "", loginReq)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK on login, got %d. Body: %s", resp.StatusCode, string(body))
	}
	var loginResp models.AuthResponse
	if err := json.Unmarshal(body, &loginResp); err != nil {
		t.Fatalf("failed to unmarshal login response: %v", err)
	}
	if loginResp.Token == "" {
		t.Fatalf("expected access token on login")
	}

	// 6. Login Alice with wrong password
	wrongLoginReq := models.LoginRequest{
		Email:    aliceEmail,
		Password: "wrongpassword",
	}
	resp, _ = h.request(t, http.MethodPost, "/v1/auth/login", "", wrongLoginReq)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized on wrong password, got %d", resp.StatusCode)
	}

	// 7. Token Refresh
	refreshReq := models.RefreshRequest{
		RefreshToken: authResp.RefreshToken,
	}
	resp, body = h.request(t, http.MethodPost, "/v1/auth/refresh", "", refreshReq)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK on refresh, got %d. Body: %s", resp.StatusCode, string(body))
	}
	var tokenResp models.TokenResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		t.Fatalf("failed to unmarshal token response: %v", err)
	}
	if tokenResp.Token == "" {
		t.Fatalf("expected fresh access token")
	}

	// 8. Refresh with access token (wrong token_type)
	resp, _ = h.request(t, http.MethodPost, "/v1/auth/refresh", "", models.RefreshRequest{
		RefreshToken: authResp.Token, // access token passed as refresh
	})
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized when passing access token to refresh, got %d", resp.StatusCode)
	}

	// 9. Profile /auth/me with valid access token
	resp, body = h.request(t, http.MethodGet, "/v1/auth/me", tokenResp.Token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK on /auth/me, got %d. Body: %s", resp.StatusCode, string(body))
	}
	var meResp models.MeResponse
	if err := json.Unmarshal(body, &meResp); err != nil {
		t.Fatalf("failed to parse /auth/me response: %v", err)
	}
	if meResp.User.Email != aliceEmail {
		t.Fatalf("me user email mismatch: got %s, expected %s", meResp.User.Email, aliceEmail)
	}

	// 10. Root aliased /auth/me
	resp, _ = h.request(t, http.MethodGet, "/auth/me", tokenResp.Token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK on root /auth/me, got %d", resp.StatusCode)
	}

	// 11. Profile without token
	resp, _ = h.request(t, http.MethodGet, "/v1/auth/me", "", nil)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized on missing token, got %d", resp.StatusCode)
	}

	// 12. Profile with refresh token (wrong token_type)
	resp, _ = h.request(t, http.MethodGet, "/v1/auth/me", authResp.RefreshToken, nil)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized when passing refresh token to /auth/me, got %d", resp.StatusCode)
	}
}

func TestGuildAndChannelLifecycle(t *testing.T) {
	h := setupTestHarness(t)
	uniqueSuffix := fmt.Sprintf("%d", time.Now().UnixNano())

	// Register Alice (guild owner)
	aliceResp, aliceBody := h.request(t, http.MethodPost, "/v1/auth/register", "", models.RegisterRequest{
		Email:    "alice_guild_" + uniqueSuffix + "@example.com",
		Username: "alice_guild_" + uniqueSuffix,
		Password: "password123",
	})
	if aliceResp.StatusCode != http.StatusCreated {
		t.Fatalf("failed to register Alice: %s", string(aliceBody))
	}
	var aliceAuth models.AuthResponse
	_ = json.Unmarshal(aliceBody, &aliceAuth)

	// Register Bob (non-member initially)
	bobResp, bobBody := h.request(t, http.MethodPost, "/v1/auth/register", "", models.RegisterRequest{
		Email:    "bob_guild_" + uniqueSuffix + "@example.com",
		Username: "bob_guild_" + uniqueSuffix,
		Password: "password123",
	})
	if bobResp.StatusCode != http.StatusCreated {
		t.Fatalf("failed to register Bob: %s", string(bobBody))
	}
	var bobAuth models.AuthResponse
	_ = json.Unmarshal(bobBody, &bobAuth)

	// 1. Alice creates guild "Gaming Lounge"
	createGuildReq := models.CreateGuildRequest{
		Name: "Gaming Lounge",
	}
	resp, body := h.request(t, http.MethodPost, "/v1/guilds", aliceAuth.Token, createGuildReq)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201 Created on create guild, got %d. Body: %s", resp.StatusCode, string(body))
	}

	var guildResp models.GuildDetailResponse
	if err := json.Unmarshal(body, &guildResp); err != nil {
		t.Fatalf("failed to parse create guild response: %v", err)
	}
	if guildResp.Name != "Gaming Lounge" {
		t.Errorf("guild name mismatch: got %s", guildResp.Name)
	}
	if guildResp.OwnerID != aliceAuth.User.ID {
		t.Errorf("guild owner mismatch: got %d, expected %d", guildResp.OwnerID, aliceAuth.User.ID)
	}

	// Verify auto-created #geral channel
	if len(guildResp.Channels) != 1 {
		t.Fatalf("expected exactly 1 auto-created channel, got %d", len(guildResp.Channels))
	}
	geralCh := guildResp.Channels[0]
	if geralCh.Name != "geral" || geralCh.Type != models.ChannelTypeText || geralCh.Position != 0 {
		t.Fatalf("invalid auto-created channel: %+v", geralCh)
	}

	// Verify auto-created @everyone role
	if len(guildResp.Roles) != 1 {
		t.Fatalf("expected exactly 1 auto-created role, got %d", len(guildResp.Roles))
	}
	everyoneRole := guildResp.Roles[0]
	if everyoneRole.Name != "@everyone" || everyoneRole.Position != 0 {
		t.Fatalf("invalid auto-created role: %+v", everyoneRole)
	}

	guildID := guildResp.ID

	// 2. Alice lists guilds
	resp, body = h.request(t, http.MethodGet, "/v1/guilds", aliceAuth.Token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK on list guilds, got %d", resp.StatusCode)
	}
	var aliceGuilds []models.GuildSummaryResponse
	if err := json.Unmarshal(body, &aliceGuilds); err != nil {
		t.Fatalf("failed to parse guilds list: %v", err)
	}
	if len(aliceGuilds) != 1 || aliceGuilds[0].ID != guildID {
		t.Fatalf("expected guild %d in Alice's guilds list, got %+v", guildID, aliceGuilds)
	}

	// 3. Bob lists guilds (should be empty array)
	resp, body = h.request(t, http.MethodGet, "/v1/guilds", bobAuth.Token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK on Bob's list guilds, got %d", resp.StatusCode)
	}
	var bobGuilds []models.GuildSummaryResponse
	if err := json.Unmarshal(body, &bobGuilds); err != nil {
		t.Fatalf("failed to parse Bob's guilds list: %v", err)
	}
	if len(bobGuilds) != 0 {
		t.Fatalf("expected Bob to belong to 0 guilds, got %d", len(bobGuilds))
	}

	// 4. Alice fetches guild details
	resp, body = h.request(t, http.MethodGet, fmt.Sprintf("/v1/guilds/%s", guildID.String()), aliceAuth.Token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK on get guild details, got %d", resp.StatusCode)
	}

	// 5. Bob attempts to fetch Alice's guild details (forbidden)
	resp, _ = h.request(t, http.MethodGet, fmt.Sprintf("/v1/guilds/%s", guildID.String()), bobAuth.Token, nil)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for non-member, got %d", resp.StatusCode)
	}

	// 6. Non-existent guild
	resp, _ = h.request(t, http.MethodGet, "/v1/guilds/999999999999999", aliceAuth.Token, nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 Not Found for non-existent guild, got %d", resp.StatusCode)
	}

	// 7. Invalid snowflake format in path
	resp, _ = h.request(t, http.MethodGet, "/v1/guilds/invalid-id", aliceAuth.Token, nil)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for invalid id, got %d", resp.StatusCode)
	}

	// 8. Alice creates text channel "Novidades e Avisos" (slug normalized to "novidades-e-avisos")
	createTxtReq := models.CreateChannelRequest{
		Name: "Novidades e Avisos",
		Type: models.ChannelTypeText,
	}
	resp, body = h.request(t, http.MethodPost, fmt.Sprintf("/v1/guilds/%s/channels", guildID.String()), aliceAuth.Token, createTxtReq)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201 Created on create text channel, got %d. Body: %s", resp.StatusCode, string(body))
	}
	var txtCh models.ChannelResponse
	if err := json.Unmarshal(body, &txtCh); err != nil {
		t.Fatalf("failed to parse text channel response: %v", err)
	}
	if txtCh.Name != "novidades-e-avisos" {
		t.Errorf("expected normalized slug name 'novidades-e-avisos', got %s", txtCh.Name)
	}
	if txtCh.Position != 1 {
		t.Errorf("expected position 1, got %d", txtCh.Position)
	}

	// 9. Alice creates voice channel "Sala de Jogos"
	createVoiceReq := models.CreateChannelRequest{
		Name:    "Sala de Jogos",
		Type:    models.ChannelTypeVoice,
		Bitrate: intPtr(96000),
	}
	resp, body = h.request(t, http.MethodPost, fmt.Sprintf("/v1/guilds/%s/channels", guildID.String()), aliceAuth.Token, createVoiceReq)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201 Created on create voice channel, got %d. Body: %s", resp.StatusCode, string(body))
	}
	var voiceCh models.ChannelResponse
	if err := json.Unmarshal(body, &voiceCh); err != nil {
		t.Fatalf("failed to parse voice channel response: %v", err)
	}
	if voiceCh.Name != "Sala de Jogos" {
		t.Errorf("voice channel name altered: %s", voiceCh.Name)
	}
	if voiceCh.Bitrate == nil || *voiceCh.Bitrate != 96000 {
		t.Errorf("bitrate mismatch: %v", voiceCh.Bitrate)
	}
	if voiceCh.Position != 2 {
		t.Errorf("expected position 2, got %d", voiceCh.Position)
	}

	// 10. List all channels
	resp, body = h.request(t, http.MethodGet, fmt.Sprintf("/v1/guilds/%s/channels", guildID.String()), aliceAuth.Token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK on list channels, got %d", resp.StatusCode)
	}
	var channels []models.ChannelResponse
	if err := json.Unmarshal(body, &channels); err != nil {
		t.Fatalf("failed to parse channels list: %v", err)
	}
	if len(channels) != 3 {
		t.Fatalf("expected 3 channels, got %d", len(channels))
	}

	// 11. Bob attempts to delete a channel (forbidden)
	resp, _ = h.request(t, http.MethodDelete, fmt.Sprintf("/v1/channels/%s", txtCh.ID.String()), bobAuth.Token, nil)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden when non-member tries to delete channel, got %d", resp.StatusCode)
	}

	// 12. Alice deletes text channel "novidades-e-avisos"
	resp, _ = h.request(t, http.MethodDelete, fmt.Sprintf("/v1/channels/%s", txtCh.ID.String()), aliceAuth.Token, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("expected 204 No Content on delete channel, got %d", resp.StatusCode)
	}

	// 13. Now #geral is the LAST text channel remaining in the guild!
	// Alice attempts to delete #geral -> must be rejected with 400 Bad Request
	resp, body = h.request(t, http.MethodDelete, fmt.Sprintf("/v1/channels/%s", geralCh.ID.String()), aliceAuth.Token, nil)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request when trying to delete the last text channel, got %d. Body: %s", resp.StatusCode, string(body))
	}
	if !strings.Contains(string(body), "CANNOT_DELETE_LAST_CHANNEL") {
		t.Errorf("expected CANNOT_DELETE_LAST_CHANNEL error code, got: %s", string(body))
	}

	// 14. Alice deletes voice channel
	resp, _ = h.request(t, http.MethodDelete, fmt.Sprintf("/v1/channels/%s", voiceCh.ID.String()), aliceAuth.Token, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("expected 204 No Content on delete voice channel, got %d", resp.StatusCode)
	}

	// 15. Bob attempts to delete Alice's guild (forbidden)
	resp, _ = h.request(t, http.MethodDelete, fmt.Sprintf("/v1/guilds/%s", guildID.String()), bobAuth.Token, nil)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden when non-owner deletes guild, got %d", resp.StatusCode)
	}

	// 16. Alice deletes her guild
	resp, _ = h.request(t, http.MethodDelete, fmt.Sprintf("/v1/guilds/%s", guildID.String()), aliceAuth.Token, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("expected 204 No Content on delete guild, got %d", resp.StatusCode)
	}

	// Subsequent lookup should return 404 Not Found
	resp, _ = h.request(t, http.MethodGet, fmt.Sprintf("/v1/guilds/%s", guildID.String()), aliceAuth.Token, nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 Not Found after guild deletion, got %d", resp.StatusCode)
	}
}

func TestDataPersistence(t *testing.T) {
	cfg := config.Load()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// 1. Initial pool
	pool1, err := database.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		t.Fatalf("failed to connect pool1: %v", err)
	}
	if err := database.RunMigrations(ctx, pool1); err != nil {
		t.Fatalf("failed to run migrations on pool1: %v", err)
	}

	sf, _ := snowflake.New(cfg.WorkerID, cfg.ProcessID)
	authSvc1 := service.NewAuthService(pool1, sf, cfg.JWTSecret)
	guildSvc1 := service.NewGuildService(pool1, sf)

	uniqueSuffix := fmt.Sprintf("%d", time.Now().UnixNano())
	regResp, err := authSvc1.Register(ctx, &models.RegisterRequest{
		Email:    "persist_" + uniqueSuffix + "@example.com",
		Username: "persist_" + uniqueSuffix,
		Password: "password12345",
	})
	if err != nil {
		t.Fatalf("failed to register user in pool1: %v", err)
	}

	guildResp, err := guildSvc1.CreateGuild(ctx, regResp.User.ID, &models.CreateGuildRequest{
		Name: "Persistent Guild",
	})
	if err != nil {
		t.Fatalf("failed to create guild in pool1: %v", err)
	}

	// Close pool1 completely (simulating server shutdown)
	pool1.Close()

	// 2. Open new pool2 (simulating server reboot)
	pool2, err := database.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		t.Fatalf("failed to connect pool2: %v", err)
	}
	defer pool2.Close()

	authSvc2 := service.NewAuthService(pool2, sf, cfg.JWTSecret)
	guildSvc2 := service.NewGuildService(pool2, sf)

	// Verify user profile persisted
	user, err := authSvc2.GetCurrentUser(ctx, regResp.User.ID)
	if err != nil {
		t.Fatalf("failed to load user from pool2: %v", err)
	}
	if user.Email != regResp.User.Email {
		t.Fatalf("user email mismatch after restart: got %s, expected %s", user.Email, regResp.User.Email)
	}

	// Verify guild details persisted
	guild, err := guildSvc2.GetGuildDetails(ctx, user.ID, guildResp.ID)
	if err != nil {
		t.Fatalf("failed to load guild from pool2: %v", err)
	}
	if guild.Name != "Persistent Guild" {
		t.Fatalf("guild name mismatch after restart: got %s", guild.Name)
	}
	if len(guild.Channels) != 1 || guild.Channels[0].Name != "geral" {
		t.Fatalf("guild channels mismatch after restart: %+v", guild.Channels)
	}
}

func intPtr(n int) *int {
	return &n
}
