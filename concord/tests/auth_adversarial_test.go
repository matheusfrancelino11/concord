package tests

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"

	"concord/internal/database"
	"concord/internal/models"
	"concord/internal/service"
	"concord/internal/snowflake"
)

// Helper to sign custom tokens for adversarial testing
func forgeToken(secret []byte, userID string, tokenType string, exp time.Time, nbf *time.Time, method jwt.SigningMethod) (string, error) {
	rc := jwt.RegisteredClaims{
		Subject:   userID,
		IssuedAt:  jwt.NewNumericDate(time.Now().UTC()),
		ExpiresAt: jwt.NewNumericDate(exp),
	}
	if nbf != nil {
		rc.NotBefore = jwt.NewNumericDate(*nbf)
	}

	claims := service.Claims{
		UserID:           userID,
		TokenType:        tokenType,
		RegisteredClaims: rc,
	}

	token := jwt.NewWithClaims(method, claims)
	return token.SignedString(secret)
}

// 1. JWT Signature Verification and Tampering Attacks
func TestAdversarial_JWTSignatureAndTampering(t *testing.T) {
	h := setupTestHarness(t)
	uniqueSuffix := fmt.Sprintf("%d", time.Now().UnixNano())

	// Register legitimate user Alice
	regResp, body := h.request(t, http.MethodPost, "/v1/auth/register", "", models.RegisterRequest{
		Email:    "alice_jwt_" + uniqueSuffix + "@example.com",
		Username: "alice_jwt_" + uniqueSuffix,
		Password: "validpassword123",
	})
	if regResp.StatusCode != http.StatusCreated {
		t.Fatalf("failed to register Alice: %s", string(body))
	}
	var aliceAuth models.AuthResponse
	_ = json.Unmarshal(body, &aliceAuth)

	// A. Token Tampering: Change user ID in payload without resigning
	validToken := aliceAuth.Token
	parts := strings.Split(validToken, ".")
	if len(parts) != 3 {
		t.Fatalf("expected 3 parts in valid JWT, got %d", len(parts))
	}

	// Decode payload
	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatalf("failed to decode payload: %v", err)
	}
	var payloadMap map[string]interface{}
	if err := json.Unmarshal(payloadBytes, &payloadMap); err != nil {
		t.Fatalf("failed to unmarshal payload map: %v", err)
	}

	// Change user_id to attacker victim ID
	payloadMap["user_id"] = "999999999999999999"
	payloadMap["sub"] = "999999999999999999"
	modifiedPayloadBytes, _ := json.Marshal(payloadMap)
	tamperedPayloadPart := base64.RawURLEncoding.EncodeToString(modifiedPayloadBytes)

	tamperedToken := parts[0] + "." + tamperedPayloadPart + "." + parts[2]

	resp, respBody := h.request(t, http.MethodGet, "/v1/auth/me", tamperedToken, nil)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("SECURITY VIOLATION: tampered payload was accepted! Status: %d, Body: %s", resp.StatusCode, string(respBody))
	}

	// B. None Algorithm Attack: Header { "alg": "none", "typ": "JWT" } with no signature
	noneHeader := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"none","typ":"JWT"}`))
	noneToken := noneHeader + "." + parts[1] + "."
	resp, _ = h.request(t, http.MethodGet, "/v1/auth/me", noneToken, nil)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("SECURITY VIOLATION: 'none' algorithm token was accepted! Status: %d", resp.StatusCode)
	}

	// C. None Algorithm Attack with arbitrary garbage signature
	noneTokenWithSig := noneHeader + "." + parts[1] + ".dGVzdA"
	resp, _ = h.request(t, http.MethodGet, "/v1/auth/me", noneTokenWithSig, nil)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("SECURITY VIOLATION: 'none' algorithm with sig was accepted! Status: %d", resp.StatusCode)
	}

	// D. Token signed with wrong secret key
	wrongSecretToken, err := forgeToken(
		[]byte("attacker_forged_secret_key_12345"),
		aliceAuth.User.ID.String(),
		service.TokenTypeAccess,
		time.Now().Add(1*time.Hour),
		nil,
		jwt.SigningMethodHS256,
	)
	if err != nil {
		t.Fatalf("failed to generate forged token: %v", err)
	}
	resp, _ = h.request(t, http.MethodGet, "/v1/auth/me", wrongSecretToken, nil)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("SECURITY VIOLATION: token signed with wrong secret was accepted! Status: %d", resp.StatusCode)
	}

	// E. Bit flipping in signature
	sigBytes, _ := base64.RawURLEncoding.DecodeString(parts[2])
	if len(sigBytes) > 0 {
		sigBytes[0] ^= 0xFF // flip bits
		corruptedSigPart := base64.RawURLEncoding.EncodeToString(sigBytes)
		corruptedToken := parts[0] + "." + parts[1] + "." + corruptedSigPart
		resp, _ = h.request(t, http.MethodGet, "/v1/auth/me", corruptedToken, nil)
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("SECURITY VIOLATION: token with corrupted signature accepted! Status: %d", resp.StatusCode)
		}
	}

	// F. Malformed and truncated tokens
	malformedTokens := []string{
		"",
		"Bearer",
		"header.only",
		"header.payload.signature.extra",
		"not_a_valid_jwt_at_all",
		"header.payload.",
		".payload.signature",
		"!!!.@@@.###",
	}
	for _, malformed := range malformedTokens {
		resp, _ = h.request(t, http.MethodGet, "/v1/auth/me", malformed, nil)
		if resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("malformed token %q should return 401, got %d", malformed, resp.StatusCode)
		}
	}
}

// 2. Token Type Isolation ("access" vs "refresh")
func TestAdversarial_TokenTypeIsolation(t *testing.T) {
	h := setupTestHarness(t)
	uniqueSuffix := fmt.Sprintf("%d", time.Now().UnixNano())

	regResp, body := h.request(t, http.MethodPost, "/v1/auth/register", "", models.RegisterRequest{
		Email:    "bob_type_" + uniqueSuffix + "@example.com",
		Username: "bob_type_" + uniqueSuffix,
		Password: "validpassword123",
	})
	if regResp.StatusCode != http.StatusCreated {
		t.Fatalf("failed to register Bob: %s", string(body))
	}
	var auth models.AuthResponse
	_ = json.Unmarshal(body, &auth)

	// A. Cross-use: Access token used on Refresh endpoint
	resp, respBody := h.request(t, http.MethodPost, "/v1/auth/refresh", "", models.RefreshRequest{
		RefreshToken: auth.Token, // access token
	})
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("SECURITY VIOLATION: access token was accepted on /v1/auth/refresh! Status: %d, Body: %s", resp.StatusCode, string(respBody))
	}

	// B. Cross-use: Refresh token used on Protected endpoint (/v1/auth/me)
	resp, respBody = h.request(t, http.MethodGet, "/v1/auth/me", auth.RefreshToken, nil)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("SECURITY VIOLATION: refresh token was accepted on /v1/auth/me! Status: %d, Body: %s", resp.StatusCode, string(respBody))
	}
	if !strings.Contains(string(respBody), "INVALID_TOKEN_TYPE") {
		t.Errorf("expected INVALID_TOKEN_TYPE code, got: %s", string(respBody))
	}

	// C. Cross-use: Refresh token used on Guild creation
	resp, respBody = h.request(t, http.MethodPost, "/v1/guilds", auth.RefreshToken, models.CreateGuildRequest{
		Name: "Hacked Guild",
	})
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("SECURITY VIOLATION: refresh token was accepted on /v1/guilds! Status: %d, Body: %s", resp.StatusCode, string(respBody))
	}

	// D. Forged custom token types: "admin", "service", ""
	for _, forgedType := range []string{"admin", "service", "", "refresh_token", "Bearer"} {
		forgedToken, err := forgeToken(
			[]byte(h.cfg.JWTSecret),
			auth.User.ID.String(),
			forgedType,
			time.Now().Add(1*time.Hour),
			nil,
			jwt.SigningMethodHS256,
		)
		if err != nil {
			t.Fatalf("failed to create forged token: %v", err)
		}

		// Attempt on /v1/auth/me (requires "access")
		resp, _ = h.request(t, http.MethodGet, "/v1/auth/me", forgedToken, nil)
		if resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("forged token_type %q was accepted on /v1/auth/me! Status: %d", forgedType, resp.StatusCode)
		}

		// Attempt on /v1/auth/refresh (requires "refresh")
		resp, _ = h.request(t, http.MethodPost, "/v1/auth/refresh", "", models.RefreshRequest{
			RefreshToken: forgedToken,
		})
		if resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("forged token_type %q was accepted on /v1/auth/refresh! Status: %d", forgedType, resp.StatusCode)
		}
	}
}

// 3. Expired Token Rejection
func TestAdversarial_ExpiredTokens(t *testing.T) {
	h := setupTestHarness(t)
	uniqueSuffix := fmt.Sprintf("%d", time.Now().UnixNano())

	regResp, body := h.request(t, http.MethodPost, "/v1/auth/register", "", models.RegisterRequest{
		Email:    "carol_exp_" + uniqueSuffix + "@example.com",
		Username: "carol_exp_" + uniqueSuffix,
		Password: "validpassword123",
	})
	if regResp.StatusCode != http.StatusCreated {
		t.Fatalf("failed to register Carol: %s", string(body))
	}
	var auth models.AuthResponse
	_ = json.Unmarshal(body, &auth)

	// A. Expired Access Token
	expiredAccess, err := forgeToken(
		[]byte(h.cfg.JWTSecret),
		auth.User.ID.String(),
		service.TokenTypeAccess,
		time.Now().Add(-10*time.Minute), // expired 10m ago
		nil,
		jwt.SigningMethodHS256,
	)
	if err != nil {
		t.Fatalf("failed to forge expired access token: %v", err)
	}

	resp, respBody := h.request(t, http.MethodGet, "/v1/auth/me", expiredAccess, nil)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("SECURITY VIOLATION: expired access token accepted! Status: %d, Body: %s", resp.StatusCode, string(respBody))
	}
	if !strings.Contains(string(respBody), "TOKEN_EXPIRED") {
		t.Errorf("expected TOKEN_EXPIRED code, got: %s", string(respBody))
	}

	// B. Expired Refresh Token
	expiredRefresh, err := forgeToken(
		[]byte(h.cfg.JWTSecret),
		auth.User.ID.String(),
		service.TokenTypeRefresh,
		time.Now().Add(-1*time.Hour), // expired 1h ago
		nil,
		jwt.SigningMethodHS256,
	)
	if err != nil {
		t.Fatalf("failed to forge expired refresh token: %v", err)
	}

	resp, respBody = h.request(t, http.MethodPost, "/v1/auth/refresh", "", models.RefreshRequest{
		RefreshToken: expiredRefresh,
	})
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("SECURITY VIOLATION: expired refresh token accepted! Status: %d, Body: %s", resp.StatusCode, string(respBody))
	}
	if !strings.Contains(string(respBody), "TOKEN_EXPIRED") {
		t.Errorf("expected TOKEN_EXPIRED code, got: %s", string(respBody))
	}

	// C. Future Token (NotBefore in the future)
	futureTime := time.Now().Add(1 * time.Hour)
	futureAccess, err := forgeToken(
		[]byte(h.cfg.JWTSecret),
		auth.User.ID.String(),
		service.TokenTypeAccess,
		time.Now().Add(2*time.Hour),
		&futureTime,
		jwt.SigningMethodHS256,
	)
	if err != nil {
		t.Fatalf("failed to forge future access token: %v", err)
	}
	resp, _ = h.request(t, http.MethodGet, "/v1/auth/me", futureAccess, nil)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("SECURITY VIOLATION: token with future nbf accepted! Status: %d", resp.StatusCode)
	}
}

// 4. Bcrypt Cost 12 Verification
func TestAdversarial_BcryptCost12Verification(t *testing.T) {
	h := setupTestHarness(t)
	uniqueSuffix := fmt.Sprintf("%d", time.Now().UnixNano())
	email := "dan_bcrypt_" + uniqueSuffix + "@example.com"
	pass := "mySecretPassword123"

	regResp, body := h.request(t, http.MethodPost, "/v1/auth/register", "", models.RegisterRequest{
		Email:    email,
		Username: "dan_bcrypt_" + uniqueSuffix,
		Password: pass,
	})
	if regResp.StatusCode != http.StatusCreated {
		t.Fatalf("failed to register Dan: %s", string(body))
	}
	var auth models.AuthResponse
	_ = json.Unmarshal(body, &auth)

	// Query database directly for password hash
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var passwordHash string
	query := `SELECT password FROM users WHERE id = $1`
	sfID, err := snowflake.Parse(auth.User.ID.String())
	if err != nil {
		t.Fatalf("failed to parse snowflake: %v", err)
	}

	pool, err := database.NewPool(ctx, h.cfg.DatabaseURL)
	if err != nil {
		t.Fatalf("failed to connect pool: %v", err)
	}
	defer pool.Close()

	if err := pool.QueryRow(ctx, query, sfID).Scan(&passwordHash); err != nil {
		t.Fatalf("failed to query password hash from DB: %v", err)
	}

	// Verify cost
	cost, err := bcrypt.Cost([]byte(passwordHash))
	if err != nil {
		t.Fatalf("failed to extract bcrypt cost from hash %q: %v", passwordHash, err)
	}

	if cost != 12 {
		t.Fatalf("CRITICAL SECURITY VIOLATION: Bcrypt cost is %d, expected strictly 12! Hash: %s", cost, passwordHash)
	}

	// Verify hash structure
	if !strings.HasPrefix(passwordHash, "$2a$12$") && !strings.HasPrefix(passwordHash, "$2b$12$") {
		t.Fatalf("unexpected bcrypt prefix: %s", passwordHash)
	}

	t.Logf("Empirically verified bcrypt cost: %d with prefix %s", cost, passwordHash[:7])
}

// 5. Password Length Boundary Checks (>72 bytes)
func TestAdversarial_PasswordLengthBoundaries(t *testing.T) {
	h := setupTestHarness(t)
	uniqueSuffix := fmt.Sprintf("%d", time.Now().UnixNano())

	// A. Min length: 7 chars -> Rejected (WEAK_PASSWORD)
	resp, body := h.request(t, http.MethodPost, "/v1/auth/register", "", models.RegisterRequest{
		Email:    "weak_" + uniqueSuffix + "@example.com",
		Username: "weak_" + uniqueSuffix,
		Password: "1234567", // 7 chars
	})
	if resp.StatusCode != http.StatusBadRequest || !strings.Contains(string(body), "WEAK_PASSWORD") {
		t.Fatalf("expected 400 WEAK_PASSWORD for 7-char password, got %d: %s", resp.StatusCode, string(body))
	}

	// B. Min length: 8 chars -> Accepted
	resp, body = h.request(t, http.MethodPost, "/v1/auth/register", "", models.RegisterRequest{
		Email:    "eight_" + uniqueSuffix + "@example.com",
		Username: "eight_" + uniqueSuffix,
		Password: "12345678", // 8 chars
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201 Created for 8-char password, got %d: %s", resp.StatusCode, string(body))
	}

	// C. Max length: exactly 72 bytes ASCII -> Accepted
	pass72 := strings.Repeat("A", 72)
	resp, body = h.request(t, http.MethodPost, "/v1/auth/register", "", models.RegisterRequest{
		Email:    "max72_" + uniqueSuffix + "@example.com",
		Username: "max72_" + uniqueSuffix,
		Password: pass72,
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201 Created for 72-byte password, got %d: %s", resp.StatusCode, string(body))
	}

	// Login with the 72-byte password -> must succeed
	loginResp, loginBody := h.request(t, http.MethodPost, "/v1/auth/login", "", models.LoginRequest{
		Email:    "max72_" + uniqueSuffix + "@example.com",
		Password: pass72,
	})
	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK login for 72-byte password, got %d: %s", loginResp.StatusCode, string(loginBody))
	}

	// D. Max length exceeded: 73 bytes ASCII -> Rejected (PASSWORD_TOO_LONG)
	pass73 := strings.Repeat("A", 73)
	resp, body = h.request(t, http.MethodPost, "/v1/auth/register", "", models.RegisterRequest{
		Email:    "over73_" + uniqueSuffix + "@example.com",
		Username: "over73_" + uniqueSuffix,
		Password: pass73,
	})
	if resp.StatusCode != http.StatusBadRequest || !strings.Contains(string(body), "PASSWORD_TOO_LONG") {
		t.Fatalf("expected 400 PASSWORD_TOO_LONG for 73-byte password, got %d: %s", resp.StatusCode, string(body))
	}

	// E. Multi-byte UTF-8 test:
	// 24 3-byte CJK runes: 24 * 3 = 72 bytes -> Accepted
	passCJK72 := strings.Repeat("日", 24)
	if len([]byte(passCJK72)) != 72 {
		t.Fatalf("precondition failed: passCJK72 is %d bytes", len([]byte(passCJK72)))
	}
	resp, body = h.request(t, http.MethodPost, "/v1/auth/register", "", models.RegisterRequest{
		Email:    "cjk72_" + uniqueSuffix + "@example.com",
		Username: "cjk72_" + uniqueSuffix,
		Password: passCJK72,
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201 Created for 72-byte UTF-8 password, got %d: %s", resp.StatusCode, string(body))
	}

	// 25 3-byte CJK runes: 25 * 3 = 75 bytes -> Rejected (PASSWORD_TOO_LONG)
	passCJK75 := strings.Repeat("日", 25)
	if len([]byte(passCJK75)) != 75 {
		t.Fatalf("precondition failed: passCJK75 is %d bytes", len([]byte(passCJK75)))
	}
	resp, body = h.request(t, http.MethodPost, "/v1/auth/register", "", models.RegisterRequest{
		Email:    "cjk75_" + uniqueSuffix + "@example.com",
		Username: "cjk75_" + uniqueSuffix,
		Password: passCJK75,
	})
	if resp.StatusCode != http.StatusBadRequest || !strings.Contains(string(body), "PASSWORD_TOO_LONG") {
		t.Fatalf("expected 400 PASSWORD_TOO_LONG for 75-byte UTF-8 password, got %d: %s", resp.StatusCode, string(body))
	}

	// 18 4-byte emoji runes: 18 * 4 = 72 bytes -> Accepted
	passEmoji72 := strings.Repeat("🔐", 18)
	if len([]byte(passEmoji72)) != 72 {
		t.Fatalf("precondition failed: passEmoji72 is %d bytes", len([]byte(passEmoji72)))
	}
	resp, body = h.request(t, http.MethodPost, "/v1/auth/register", "", models.RegisterRequest{
		Email:    "emoji72_" + uniqueSuffix + "@example.com",
		Username: "emoji72_" + uniqueSuffix,
		Password: passEmoji72,
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201 Created for 72-byte emoji password, got %d: %s", resp.StatusCode, string(body))
	}

	// 19 4-byte emoji runes: 19 * 4 = 76 bytes -> Rejected
	passEmoji76 := strings.Repeat("🔐", 19)
	resp, body = h.request(t, http.MethodPost, "/v1/auth/register", "", models.RegisterRequest{
		Email:    "emoji76_" + uniqueSuffix + "@example.com",
		Username: "emoji76_" + uniqueSuffix,
		Password: passEmoji76,
	})
	if resp.StatusCode != http.StatusBadRequest || !strings.Contains(string(body), "PASSWORD_TOO_LONG") {
		t.Fatalf("expected 400 PASSWORD_TOO_LONG for 76-byte emoji password, got %d: %s", resp.StatusCode, string(body))
	}

	// F. Truncation attack test on Login:
	// User registered with pass72 ("A" * 72).
	// Attacker tries to login with pass72 + "EXTRA_GARBAGE" (e.g. 73 or 85 bytes).
	// Because bcrypt ignores bytes beyond 72 if unchecked, does the login handler reject or accept?
	truncAttackResp, _ := h.request(t, http.MethodPost, "/v1/auth/login", "", models.LoginRequest{
		Email:    "max72_" + uniqueSuffix + "@example.com",
		Password: pass72 + "EXTRA_BYTES",
	})
	if truncAttackResp.StatusCode == http.StatusOK {
		t.Fatalf("CRITICAL SECURITY VULNERABILITY: Bcrypt truncation attack succeeded! User registered with 72 chars was logged in using 83 chars (prefix match)!")
	}
	if truncAttackResp.StatusCode != http.StatusUnauthorized {
		t.Errorf("expected 401 Unauthorized on truncation attack attempt, got %d", truncAttackResp.StatusCode)
	}

	t.Logf("Password length boundaries verified: 7 rejected, 8 accepted, 72 accepted, 73 rejected, UTF-8 byte calculation verified, login truncation attack rejected (%d)", truncAttackResp.StatusCode)
}
