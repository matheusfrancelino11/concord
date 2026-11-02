/**
 * Concord Frontend Empirical Adversarial Test Suite
 * 
 * Verifies:
 * 1. 401 Refresh Token Interceptor Concurrency (mutex queue, single-flight thundering herd)
 * 2. Refresh Loop Termination (401 on refresh aborts, clears tokens, no infinite loops)
 * 3. Snowflake ID Integrity (IDs > 2^53 - 1 preserved without numeric truncation)
 */

import http from "node:http";
import { AddressInfo } from "node:net";

// ==========================================
// 1. Environment Polyfills
// ==========================================

const storage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string): string | null => storage.get(key) ?? null,
  setItem: (key: string, value: string): void => {
    storage.set(key, String(value));
  },
  removeItem: (key: string): void => {
    storage.delete(key);
  },
  clear: (): void => {
    storage.clear();
  },
  get length(): number {
    return storage.size;
  },
  key: (i: number): string | null => Array.from(storage.keys())[i] ?? null,
};

// Mount global localStorage
(globalThis as unknown as { localStorage: typeof localStorageMock }).localStorage = localStorageMock;

// Dynamic imports after localStorage is mounted
let api: typeof import("../src/api/client").api;
let ApiError: typeof import("../src/api/client").ApiError;
let getAccessToken: typeof import("../src/api/client").getAccessToken;
let getRefreshToken: typeof import("../src/api/client").getRefreshToken;
let setTokens: typeof import("../src/api/client").setTokens;
let clearTokens: typeof import("../src/api/client").clearTokens;
let useAuthStore: typeof import("../src/stores/authStore").useAuthStore;
let useGuildStore: typeof import("../src/stores/guildStore").useGuildStore;
let useChannelStore: typeof import("../src/stores/channelStore").useChannelStore;
let ChannelType: typeof import("../src/types").ChannelType;

// ==========================================
// 2. Mock HTTP Server & Router
// ==========================================

interface RecordedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

type RouteHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: string
) => Promise<void> | void;

let requestLog: RecordedRequest[] = [];
let routeHandlers: Array<{
  matcher: (method: string, url: string) => boolean;
  handler: RouteHandler;
}> = [];

function resetServerState() {
  requestLog = [];
  routeHandlers = [];
}

function addRoute(
  matcher: (method: string, url: string) => boolean,
  handler: RouteHandler
) {
  routeHandlers.push({ matcher, handler });
}

const server = http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const body = Buffer.concat(chunks).toString("utf-8");

  requestLog.push({
    method: req.method || "GET",
    url: req.url || "/",
    headers: req.headers,
    body,
  });

  const matched = routeHandlers.find((r) =>
    r.matcher(req.method || "GET", req.url || "/")
  );

  if (matched) {
    await matched.handler(req, res, body);
  } else {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Route not found", code: "NOT_FOUND" }));
  }
});

// Helper for JSON responses
function sendJSON(res: http.ServerResponse, status: number, data: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

// Sleep helper
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ==========================================
// 3. Test Runner & Assertion Harness
// ==========================================

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  \x1b[32m✓\x1b[0m ${testName}`);
  } else {
    failedTests++;
    console.error(`  \x1b[31m✗\x1b[0m ${testName}`);
    if (detail) {
      console.error(`    \x1b[33mDetail: ${detail}\x1b[0m`);
    }
  }
}

// ==========================================
// 4. Test Suites Execution
// ==========================================

async function runTestSuite() {
  console.log("\n=======================================================");
  console.log("  CONCORD FRONTEND ADVERSARIAL TEST SUITE");
  console.log("=======================================================\n");

  const clientMod = await import("../src/api/client");
  api = clientMod.api;
  ApiError = clientMod.ApiError;
  getAccessToken = clientMod.getAccessToken;
  getRefreshToken = clientMod.getRefreshToken;
  setTokens = clientMod.setTokens;
  clearTokens = clientMod.clearTokens;

  const authStoreMod = await import("../src/stores/authStore");
  useAuthStore = authStoreMod.useAuthStore;

  const guildStoreMod = await import("../src/stores/guildStore");
  useGuildStore = guildStoreMod.useGuildStore;

  const channelStoreMod = await import("../src/stores/channelStore");
  useChannelStore = channelStoreMod.useChannelStore;

  const typesMod = await import("../src/types");
  ChannelType = typesMod.ChannelType;

  // Start HTTP mock server on port 8080 (where client points)
  await new Promise<void>((resolve) => {
    server.listen(8080, "127.0.0.1", () => {
      resolve();
    });
  });

  try {
    // -----------------------------------------------------------
    // SUITE 1: 401 Refresh Token Interceptor Concurrency
    // -----------------------------------------------------------
    console.log("\x1b[36m[SUITE 1] 401 Refresh Token Interceptor Concurrency\x1b[0m");

    // Test 1.1: Simultaneous 10 requests with expired access token (Mutex & Queue)
    {
      resetServerState();
      localStorageMock.clear();
      setTokens("expired_access_token_1", "valid_refresh_token_1");

      let refreshCallsCount = 0;
      let refreshDelayMs = 40;

      addRoute(
        (method, url) => method === "POST" && url === "/v1/auth/refresh",
        async (_req, res, body) => {
          refreshCallsCount++;
          const parsed = JSON.parse(body);
          assert(
            parsed.refresh_token === "valid_refresh_token_1",
            "Test 1.1: /auth/refresh received correct refresh token"
          );
          await sleep(refreshDelayMs);
          sendJSON(res, 200, { token: "refreshed_access_token_1" });
        }
      );

      addRoute(
        (method, url) => method === "GET" && url === "/v1/guilds",
        (_req, res) => {
          const auth = _req.headers["authorization"];
          if (auth === "Bearer refreshed_access_token_1") {
            sendJSON(res, 200, [{ id: "1001", name: "Alpha", owner_id: "999", created_at: "" }]);
          } else {
            sendJSON(res, 401, { error: "Token expired", code: "TOKEN_EXPIRED" });
          }
        }
      );

      addRoute(
        (method, url) => method === "GET" && url.startsWith("/v1/guilds/"),
        (_req, res) => {
          const auth = _req.headers["authorization"];
          if (auth === "Bearer refreshed_access_token_1") {
            sendJSON(res, 200, { id: "1001", name: "Alpha", owner_id: "999", channels: [], roles: [] });
          } else {
            sendJSON(res, 401, { error: "Token expired", code: "TOKEN_EXPIRED" });
          }
        }
      );

      // Fire 10 concurrent requests at the exact same instant
      const promises = [
        api.guilds.list(),
        api.guilds.list(),
        api.guilds.get("1001"),
        api.guilds.list(),
        api.guilds.get("1001"),
        api.guilds.list(),
        api.guilds.get("1001"),
        api.guilds.list(),
        api.guilds.list(),
        api.guilds.get("1001"),
      ];

      const results = await Promise.all(promises);

      assert(
        results.length === 10,
        "Test 1.1: All 10 concurrent requests resolved successfully"
      );
      assert(
        refreshCallsCount === 1,
        "Test 1.1: Exactly ONE /auth/refresh call was made across 10 concurrent 401s (Mutex protection verified)",
        `Expected 1 call, got ${refreshCallsCount}`
      );
      assert(
        getAccessToken() === "refreshed_access_token_1",
        "Test 1.1: Local storage updated with new access token"
      );
      assert(
        getRefreshToken() === "valid_refresh_token_1",
        "Test 1.1: Refresh token remained intact in local storage"
      );

      // Check retried request headers
      const retryRequests = requestLog.filter(
        (r) => r.headers["authorization"] === "Bearer refreshed_access_token_1"
      );
      assert(
        retryRequests.length === 10,
        "Test 1.1: All 10 retried requests used the new Bearer token",
        `Expected 10 retries, found ${retryRequests.length}`
      );
    }

    // Test 1.2: Extreme High-Load Thundering Herd (50 Simultaneous Requests)
    {
      resetServerState();
      localStorageMock.clear();
      setTokens("expired_token_highload", "refresh_token_highload");

      let refreshCalls = 0;
      addRoute(
        (method, url) => method === "POST" && url === "/v1/auth/refresh",
        async (_req, res) => {
          refreshCalls++;
          await sleep(50);
          sendJSON(res, 200, { token: "token_highload_refreshed" });
        }
      );

      addRoute(
        (method, url) => method === "GET" && url === "/v1/guilds",
        (_req, res) => {
          if (_req.headers["authorization"] === "Bearer token_highload_refreshed") {
            sendJSON(res, 200, []);
          } else {
            sendJSON(res, 401, { error: "Token expired", code: "TOKEN_EXPIRED" });
          }
        }
      );

      const count = 50;
      const batch = Array.from({ length: count }, () => api.guilds.list());
      const batchResults = await Promise.all(batch);

      assert(
        batchResults.length === count,
        `Test 1.2: All ${count} high-concurrency requests resolved without error`
      );
      assert(
        refreshCalls === 1,
        `Test 1.2: Thundering herd of ${count} requests triggered exactly ONE /auth/refresh call`,
        `Expected 1 call, got ${refreshCalls}`
      );
      assert(
        getAccessToken() === "token_highload_refreshed",
        "Test 1.2: Access token in local storage matches refreshed token"
      );
    }

    // Test 1.3: Interleaved Requests During In-Flight Refresh
    {
      resetServerState();
      localStorageMock.clear();
      setTokens("expired_token_interleave", "refresh_token_interleave");

      let refreshCalls = 0;
      addRoute(
        (method, url) => method === "POST" && url === "/v1/auth/refresh",
        async (_req, res) => {
          refreshCalls++;
          await sleep(80); // Long in-flight window
          sendJSON(res, 200, { token: "token_interleave_refreshed" });
        }
      );

      addRoute(
        (method, url) => method === "GET" && url === "/v1/guilds",
        (_req, res) => {
          if (_req.headers["authorization"] === "Bearer token_interleave_refreshed") {
            sendJSON(res, 200, []);
          } else {
            sendJSON(res, 401, { error: "Token expired", code: "TOKEN_EXPIRED" });
          }
        }
      );

      // Launch Batch A
      const batchA = [api.guilds.list(), api.guilds.list()];

      // Wait 30ms so refresh is in-flight, then launch Batch B
      await sleep(30);
      const batchB = [api.guilds.list(), api.guilds.list(), api.guilds.list()];

      const combinedResults = await Promise.all([...batchA, ...batchB]);

      assert(
        combinedResults.length === 5,
        "Test 1.3: All interleaved requests (Batch A and Batch B) completed successfully"
      );
      assert(
        refreshCalls === 1,
        "Test 1.3: Interleaved requests joined in-flight refresh without initiating a new refresh call",
        `Expected 1, got ${refreshCalls}`
      );
    }

    // Test 1.4: Post-Refresh Request Directly Uses Updated Token
    {
      // Using tokens from Test 1.3 ("token_interleave_refreshed")
      const postRefreshResult = await api.guilds.list();
      assert(
        Array.isArray(postRefreshResult),
        "Test 1.4: Subsequent request after refresh succeeds immediately without 401"
      );
      const lastRequest = requestLog[requestLog.length - 1];
      assert(
        lastRequest.headers["authorization"] === "Bearer token_interleave_refreshed",
        "Test 1.4: Subsequent request used new token on first attempt"
      );
    }

    // -----------------------------------------------------------
    // SUITE 2: Refresh Loop Termination & State Transitions
    // -----------------------------------------------------------
    console.log("\n\x1b[36m[SUITE 2] Refresh Loop Termination & State Transitions\x1b[0m");

    // Test 2.1: Refresh Token Expired / Rejected on Server (Intercepted 401)
    {
      resetServerState();
      localStorageMock.clear();
      setTokens("expired_access_token_2", "invalid_refresh_token_2");

      // Set initial authStore state
      useAuthStore.setState({
        user: { id: "100", username: "alice", email: "a@a.com", flags: 0, created_at: "" },
        token: "expired_access_token_2",
        refreshToken: "invalid_refresh_token_2",
        isAuthenticated: true,
        isLoading: false,
      });

      let refreshAttempts = 0;
      addRoute(
        (method, url) => method === "POST" && url === "/v1/auth/refresh",
        (_req, res) => {
          refreshAttempts++;
          sendJSON(res, 401, {
            error: "Refresh token has expired",
            code: "TOKEN_EXPIRED",
          });
        }
      );

      addRoute(
        (method, url) => method === "GET" && url === "/v1/guilds",
        (_req, res) => {
          sendJSON(res, 401, { error: "Access token expired", code: "TOKEN_EXPIRED" });
        }
      );

      let caughtError: unknown = null;
      try {
        await api.guilds.list();
      } catch (err) {
        caughtError = err;
      }

      assert(
        caughtError instanceof ApiError && caughtError.status === 401,
        "Test 2.1: Request threw ApiError with 401 status on refresh failure"
      );
      assert(
        caughtError instanceof ApiError && caughtError.code === "TOKEN_EXPIRED",
        "Test 2.1: Error preserved backend error code 'TOKEN_EXPIRED'"
      );
      assert(
        refreshAttempts === 1,
        "Test 2.1: Exactly ONE /auth/refresh attempt made — NO infinite refresh loop!",
        `Expected 1, got ${refreshAttempts}`
      );
      assert(
        getAccessToken() === null && getRefreshToken() === null,
        "Test 2.1: Tokens cleared from localStorage on unrecoverable 401"
      );
      assert(
        useAuthStore.getState().isAuthenticated === false,
        "Test 2.1: authStore transitioned to isAuthenticated === false"
      );
      assert(
        useAuthStore.getState().user === null,
        "Test 2.1: authStore cleared active user"
      );
      assert(
        useAuthStore.getState().token === null && useAuthStore.getState().refreshToken === null,
        "Test 2.1: authStore wiped store tokens"
      );
    }

    // Test 2.2: Concurrent Requests All Reject Gracefully on Refresh 401
    {
      resetServerState();
      localStorageMock.clear();
      setTokens("expired_token_multireject", "bad_refresh_token");

      useAuthStore.setState({
        isAuthenticated: true,
        user: { id: "200", username: "bob", email: "b@b.com", flags: 0, created_at: "" },
      });

      let refreshAttempts = 0;
      addRoute(
        (method, url) => method === "POST" && url === "/v1/auth/refresh",
        async (_req, res) => {
          refreshAttempts++;
          await sleep(30);
          sendJSON(res, 401, { error: "Invalid refresh token", code: "INVALID_TOKEN" });
        }
      );

      addRoute(
        (method, url) => method === "GET" && url === "/v1/guilds",
        (_req, res) => {
          sendJSON(res, 401, { error: "Token expired", code: "TOKEN_EXPIRED" });
        }
      );

      const promises = [
        api.guilds.list(),
        api.guilds.list(),
        api.guilds.list(),
        api.guilds.list(),
      ];

      const settled = await Promise.allSettled(promises);

      const allRejected = settled.every((s) => s.status === "rejected");
      assert(
        allRejected,
        "Test 2.2: All concurrent requests rejected when refresh returned 401"
      );
      assert(
        refreshAttempts === 1,
        "Test 2.2: Exactly ONE refresh call made despite 4 concurrent callers",
        `Expected 1, got ${refreshAttempts}`
      );
      assert(
        useAuthStore.getState().isAuthenticated === false,
        "Test 2.2: authStore transitioned to unauthenticated"
      );
    }

    // Test 2.3: Direct Call to api.auth.refresh Returning 401 (Auth Endpoint Loop Guard)
    {
      resetServerState();
      localStorageMock.clear();

      let refreshAttempts = 0;
      addRoute(
        (method, url) => method === "POST" && url === "/v1/auth/refresh",
        (_req, res) => {
          refreshAttempts++;
          sendJSON(res, 401, { error: "Invalid refresh token", code: "INVALID_TOKEN" });
        }
      );

      let directErr: unknown = null;
      try {
        await api.auth.refresh("invalid_direct_refresh_jwt");
      } catch (err) {
        directErr = err;
      }

      assert(
        directErr instanceof ApiError && directErr.status === 401,
        "Test 2.3: Direct api.auth.refresh call threw 401 ApiError"
      );
      assert(
        refreshAttempts === 1,
        "Test 2.3: Endpoint guard prevented recursive interceptor loop on auth route",
        `Expected 1, got ${refreshAttempts}`
      );
    }

    // Test 2.4: Protected Endpoint 401 When Refresh Token Is Missing
    {
      resetServerState();
      localStorageMock.clear();
      localStorageMock.setItem("concord_token", "expired_token_without_refresh");
      // Notice: NO refresh token set!

      useAuthStore.setState({ isAuthenticated: true });

      let refreshCalls = 0;
      addRoute(
        (method, url) => method === "POST" && url === "/v1/auth/refresh",
        (_req, res) => {
          refreshCalls++;
          sendJSON(res, 200, { token: "unused" });
        }
      );

      addRoute(
        (method, url) => method === "GET" && url === "/v1/guilds",
        (_req, res) => {
          sendJSON(res, 401, { error: "Token expired", code: "TOKEN_EXPIRED" });
        }
      );

      let missingRefreshErr: unknown = null;
      try {
        await api.guilds.list();
      } catch (err) {
        missingRefreshErr = err;
      }

      assert(
        missingRefreshErr instanceof ApiError && missingRefreshErr.status === 401,
        "Test 2.4: Threw 401 when refresh token was missing"
      );
      assert(
        refreshCalls === 0,
        "Test 2.4: Zero refresh calls attempted when no refresh token was available",
        `Expected 0, got ${refreshCalls}`
      );
      assert(
        getAccessToken() === null,
        "Test 2.4: Stored token cleared on missing refresh token"
      );
      assert(
        useAuthStore.getState().isAuthenticated === false,
        "Test 2.4: authStore reset to unauthenticated"
      );
    }

    // Test 2.5: Retried Request Returning 401 Guard (_retry = true)
    {
      resetServerState();
      localStorageMock.clear();
      setTokens("expired_token_r5", "valid_refresh_r5");

      let refreshCount = 0;
      let guildCalls = 0;

      addRoute(
        (method, url) => method === "POST" && url === "/v1/auth/refresh",
        (_req, res) => {
          refreshCount++;
          sendJSON(res, 200, { token: "token_still_rejected_401" });
        }
      );

      addRoute(
        (method, url) => method === "GET" && url === "/v1/guilds",
        (_req, res) => {
          guildCalls++;
          // Always return 401 even with refreshed token
          sendJSON(res, 401, { error: "Token still rejected", code: "TOKEN_REJECTED" });
        }
      );

      let loopError: unknown = null;
      try {
        await api.guilds.list();
      } catch (err) {
        loopError = err;
      }

      assert(
        loopError instanceof ApiError && loopError.status === 401,
        "Test 2.5: Threw ApiError when retried request failed with 401"
      );
      assert(
        refreshCount === 1,
        "Test 2.5: _retry guard prevented secondary refresh loop when retried request failed 401",
        `Expected 1 refresh call, got ${refreshCount}`
      );
      assert(
        guildCalls === 2,
        "Test 2.5: Exactly 2 calls made to /guilds (initial + 1 retry, no further retries)",
        `Expected 2, got ${guildCalls}`
      );
    }

    // Test 2.6: authStore.checkAuth() Lifecycle on Session Expiry
    {
      resetServerState();
      localStorageMock.clear();
      setTokens("expired_boot_token", "expired_boot_refresh");

      useAuthStore.setState({
        user: null,
        token: "expired_boot_token",
        refreshToken: "expired_boot_refresh",
        isAuthenticated: false,
        isLoading: true,
      });

      addRoute(
        (method, url) => method === "GET" && url === "/v1/auth/me",
        (_req, res) => {
          sendJSON(res, 401, { error: "Token expired", code: "TOKEN_EXPIRED" });
        }
      );

      addRoute(
        (method, url) => method === "POST" && url === "/v1/auth/refresh",
        (_req, res) => {
          sendJSON(res, 401, { error: "Refresh expired", code: "TOKEN_EXPIRED" });
        }
      );

      // checkAuth should complete cleanly without throwing uncaught error to UI
      await useAuthStore.getState().checkAuth();

      const authState = useAuthStore.getState();
      assert(
        authState.isAuthenticated === false,
        "Test 2.6: checkAuth() set isAuthenticated === false"
      );
      assert(
        authState.isLoading === false,
        "Test 2.6: checkAuth() set isLoading === false (loading spinner dismissed)"
      );
      assert(
        authState.user === null && authState.token === null,
        "Test 2.6: checkAuth() purged invalid session"
      );
      assert(
        getAccessToken() === null && getRefreshToken() === null,
        "Test 2.6: localStorage wiped by checkAuth()"
      );
    }

    // Test 2.7: Server Error 500 on Refresh (Unlocks Mutex and Rejects Subscribers)
    {
      resetServerState();
      localStorageMock.clear();
      setTokens("expired_token_27", "refresh_token_27");

      addRoute(
        (method, url) => method === "POST" && url === "/v1/auth/refresh",
        (_req, res) => {
          sendJSON(res, 500, { error: "Database unavailable", code: "DB_DOWN" });
        }
      );

      addRoute(
        (method, url) => method === "GET" && url === "/v1/guilds",
        (_req, res) => {
          sendJSON(res, 401, { error: "Expired", code: "TOKEN_EXPIRED" });
        }
      );

      let err500: unknown = null;
      try {
        await api.guilds.list();
      } catch (err) {
        err500 = err;
      }

      assert(
        err500 instanceof ApiError && err500.status === 500,
        "Test 2.7: Interceptor propagated 500 server error from refresh endpoint"
      );
      assert(
        getAccessToken() === null,
        "Test 2.7: Tokens cleared on fatal refresh failure"
      );

      // Verify that the mutex was released so subsequent requests do not hang
      resetServerState();
      addRoute(
        (method, url) => method === "POST" && url === "/v1/auth/login",
        (_req, res) => {
          sendJSON(res, 200, {
            user: { id: "1", username: "u", email: "e@e.com", flags: 0, created_at: "" },
            token: "fresh_token",
            refresh_token: "fresh_refresh",
          });
        }
      );

      const loginRes = await api.auth.login({ email: "e@e.com", password: "pw" });
      assert(
        loginRes.token === "fresh_token",
        "Test 2.7: Subsequent API calls succeed normally (mutex lock was properly released)"
      );
    }

    // Test 2.8: Non-JSON / HTML Error Response on 401 Refresh (Graceful Fallback)
    {
      resetServerState();
      localStorageMock.clear();
      setTokens("expired_token_28", "refresh_token_28");

      addRoute(
        (method, url) => method === "POST" && url === "/v1/auth/refresh",
        (_req, res) => {
          res.statusCode = 502;
          res.setHeader("Content-Type", "text/html");
          res.end("<html><body>502 Bad Gateway</body></html>");
        }
      );

      addRoute(
        (method, url) => method === "GET" && url === "/v1/guilds",
        (_req, res) => {
          sendJSON(res, 401, { error: "Expired", code: "TOKEN_EXPIRED" });
        }
      );

      let htmlErr: unknown = null;
      try {
        await api.guilds.list();
      } catch (err) {
        htmlErr = err;
      }

      assert(
        htmlErr instanceof ApiError && htmlErr.status === 502,
        "Test 2.8: Handled non-JSON/HTML 502 response from reverse proxy without JSON.parse crash"
      );
      assert(
        htmlErr instanceof ApiError && htmlErr.code === "UNKNOWN_ERROR",
        "Test 2.8: Correctly assigned UNKNOWN_ERROR code for HTML response"
      );
    }

    // -----------------------------------------------------------
    // SUITE 3: Snowflake ID Integrity (> 2^53 - 1)
    // -----------------------------------------------------------
    console.log("\n\x1b[36m[SUITE 3] Snowflake ID Precision & String Integrity\x1b[0m");

    // Test 3.1: Mathematical Proof of IEEE-754 Truncation (Oracle Baseline)
    {
      const largeSnowflakes = [
        "132519825904898048",
        "132519825904898049",
        "9007199254740993",
        "1762041600000000001",
        "18446744073709551615",
      ];

      // Verify that these snowflakes exceed Number.MAX_SAFE_INTEGER
      const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
      for (const id of largeSnowflakes) {
        assert(
          BigInt(id) > maxSafe,
          `Test 3.1: Snowflake "${id}" strictly exceeds Number.MAX_SAFE_INTEGER (9007199254740991)`
        );
      }

      // Prove that converting "132519825904898049" to Number causes data corruption
      const corruptedFloat = Number("132519825904898049");
      const corruptedString = String(corruptedFloat);
      assert(
        corruptedString !== "132519825904898049",
        `Test 3.1: Proved IEEE-754 corruption: Number("132519825904898049") becomes "${corruptedString}"`
      );
    }

    // Test 3.2: API Deserialization & Response Processing Integrity
    {
      resetServerState();
      localStorageMock.clear();
      setTokens("valid_token_32");

      const LARGE_USER_ID = "132519825904898049";
      const LARGE_GUILD_ID = "1762041600000000001";
      const LARGE_CHANNEL_ID = "9007199254740993";
      const LARGE_ROLE_ID = "18446744073709551615";

      addRoute(
        (method, url) => method === "GET" && url === "/v1/auth/me",
        (_req, res) => {
          sendJSON(res, 200, {
            user: {
              id: LARGE_USER_ID,
              username: "snowflake_user",
              email: "sf@example.com",
              flags: 0,
              created_at: "2026-11-02T16:00:00Z",
            },
          });
        }
      );

      addRoute(
        (method, url) => method === "GET" && url === `/v1/guilds/${LARGE_GUILD_ID}`,
        (_req, res) => {
          sendJSON(res, 200, {
            id: LARGE_GUILD_ID,
            name: "Snowflake Guild",
            owner_id: LARGE_USER_ID,
            created_at: "2026-11-02T16:00:00Z",
            channels: [
              {
                id: LARGE_CHANNEL_ID,
                guild_id: LARGE_GUILD_ID,
                type: ChannelType.TEXT,
                name: "geral",
                position: 0,
                rate_limit: 0,
                nsfw: false,
                created_at: "2026-11-02T16:00:00Z",
              },
            ],
            roles: [
              {
                id: LARGE_ROLE_ID,
                guild_id: LARGE_GUILD_ID,
                name: "@everyone",
                permissions: "0",
                position: 0,
                color: 0,
                hoist: false,
                mentionable: false,
                managed: false,
              },
            ],
          });
        }
      );

      const user = await api.auth.me();
      assert(
        typeof user.id === "string",
        "Test 3.2: User ID received as string type"
      );
      assert(
        user.id === LARGE_USER_ID,
        `Test 3.2: User ID preserved exact value "${LARGE_USER_ID}"`,
        `Received: ${user.id}`
      );

      const guildDetail = await api.guilds.get(LARGE_GUILD_ID);
      assert(
        guildDetail.id === LARGE_GUILD_ID,
        `Test 3.2: Guild ID preserved exact value "${LARGE_GUILD_ID}"`
      );
      assert(
        guildDetail.owner_id === LARGE_USER_ID,
        `Test 3.2: Guild owner_id preserved exact value "${LARGE_USER_ID}"`
      );
      assert(
        guildDetail.channels[0].id === LARGE_CHANNEL_ID,
        `Test 3.2: Channel ID preserved exact value "${LARGE_CHANNEL_ID}"`
      );
      assert(
        guildDetail.roles[0].id === LARGE_ROLE_ID,
        `Test 3.2: Role ID preserved exact value "${LARGE_ROLE_ID}"`
      );
    }

    // Test 3.3: URL Path Parameter Serialization
    {
      resetServerState();
      localStorageMock.clear();
      setTokens("valid_token_33");

      const LARGE_ID_TARGET = "132519825904898049";
      let receivedGuildGetUrl = "";
      let receivedGuildDeleteUrl = "";
      let receivedChannelDeleteUrl = "";

      addRoute(
        (method, url) => method === "GET" && url.startsWith("/v1/guilds/"),
        (_req, res) => {
          receivedGuildGetUrl = _req.url || "";
          sendJSON(res, 200, { id: LARGE_ID_TARGET, name: "Test", owner_id: "1", channels: [], roles: [] });
        }
      );

      addRoute(
        (method, url) => method === "DELETE" && url.startsWith("/v1/guilds/"),
        (_req, res) => {
          receivedGuildDeleteUrl = _req.url || "";
          res.statusCode = 204;
          res.end();
        }
      );

      addRoute(
        (method, url) => method === "DELETE" && url.startsWith("/v1/channels/"),
        (_req, res) => {
          receivedChannelDeleteUrl = _req.url || "";
          res.statusCode = 204;
          res.end();
        }
      );

      await api.guilds.get(LARGE_ID_TARGET);
      assert(
        receivedGuildGetUrl === `/v1/guilds/${LARGE_ID_TARGET}`,
        `Test 3.3: api.guilds.get URL path preserved Snowflake string: ${receivedGuildGetUrl}`
      );

      await api.guilds.delete(LARGE_ID_TARGET);
      assert(
        receivedGuildDeleteUrl === `/v1/guilds/${LARGE_ID_TARGET}`,
        `Test 3.3: api.guilds.delete URL path preserved Snowflake string: ${receivedGuildDeleteUrl}`
      );

      const CHANNEL_SNOWFLAKE = "9007199254740993";
      await api.channels.delete(CHANNEL_SNOWFLAKE);
      assert(
        receivedChannelDeleteUrl === `/v1/channels/${CHANNEL_SNOWFLAKE}`,
        `Test 3.3: api.channels.delete URL path preserved Snowflake string: ${receivedChannelDeleteUrl}`
      );
    }

    // Test 3.4: Zustand Store State & Lookup Integrity
    {
      const SNOWFLAKE_G1 = "132519825904898048";
      const SNOWFLAKE_G2 = "132519825904898049"; // Notice: differs only by 1 in LSB!
      const SNOWFLAKE_C1 = "9007199254740993";

      // Test GuildStore string exact matching
      useGuildStore.setState({
        guilds: [
          { id: SNOWFLAKE_G1, name: "Guild 48", owner_id: "1", created_at: "" },
          { id: SNOWFLAKE_G2, name: "Guild 49", owner_id: "1", created_at: "" },
        ],
        activeGuildId: SNOWFLAKE_G1,
        selectedGuildId: SNOWFLAKE_G1,
      });

      // Select G2
      useGuildStore.getState().selectGuild(SNOWFLAKE_G2);
      assert(
        useGuildStore.getState().selectedGuildId === SNOWFLAKE_G2,
        `Test 3.4: selectedGuildId is exact string "${SNOWFLAKE_G2}"`
      );

      // Verify channelStore cache dictionary keying
      const channel1 = {
        id: SNOWFLAKE_C1,
        guild_id: SNOWFLAKE_G2,
        type: ChannelType.TEXT,
        name: "geral",
        position: 0,
        rate_limit: 0,
        nsfw: false,
        created_at: "",
      };

      useChannelStore.getState().setChannels([channel1], SNOWFLAKE_G2);
      const cached = useChannelStore.getState().channelsByGuild[SNOWFLAKE_G2];
      assert(
        Array.isArray(cached) && cached[0].id === SNOWFLAKE_C1,
        `Test 3.4: channelStore cached channels under dictionary key "${SNOWFLAKE_G2}"`
      );

      // Test deleting SNOWFLAKE_G1 does NOT accidentally delete SNOWFLAKE_G2
      // (If coerced to float, both would collide into 132519825904898048!)
      resetServerState();
      addRoute(
        (method, url) => method === "DELETE" && url === `/v1/guilds/${SNOWFLAKE_G1}`,
        (_req, res) => {
          res.statusCode = 204;
          res.end();
        }
      );
      addRoute(
        (method, url) => method === "GET" && url === `/v1/guilds/${SNOWFLAKE_G2}/channels`,
        (_req, res) => {
          sendJSON(res, 200, []);
        }
      );

      await useGuildStore.getState().deleteGuild(SNOWFLAKE_G1);
      // Wait for background channel sync triggered by deleteGuild to settle
      await sleep(50);

      const remaining = useGuildStore.getState().guilds;
      assert(
        remaining.length === 1 && remaining[0].id === SNOWFLAKE_G2,
        "Test 3.4: Distinct Snowflake IDs (differing only in LSB > 2^53) do not collide in store operations"
      );
    }

    // Test 3.5: Request Body Payload Snowflake Integrity (e.g. parent_id > 2^53)
    {
      resetServerState();
      localStorageMock.clear();
      setTokens("valid_token_35");

      const LARGE_GUILD_ID = "1762041600000000001";
      const LARGE_PARENT_ID = "132519825904898049";
      let receivedRequestBody = "";

      addRoute(
        (method, url) => method === "POST" && url === `/v1/guilds/${LARGE_GUILD_ID}/channels`,
        (_req, res, body) => {
          receivedRequestBody = body;
          sendJSON(res, 201, {
            id: "9007199254740993",
            guild_id: LARGE_GUILD_ID,
            type: ChannelType.TEXT,
            name: "sub-channel",
            position: 1,
            parent_id: LARGE_PARENT_ID,
            rate_limit: 0,
            nsfw: false,
            created_at: "",
          });
        }
      );

      const created = await api.channels.create(LARGE_GUILD_ID, {
        name: "sub-channel",
        type: ChannelType.TEXT,
        parent_id: LARGE_PARENT_ID,
      });

      const parsedPayload = JSON.parse(receivedRequestBody);
      assert(
        parsedPayload.parent_id === LARGE_PARENT_ID,
        `Test 3.5: Channel creation request body preserved Snowflake parent_id "${LARGE_PARENT_ID}" without numeric truncation`
      );
      assert(
        created.parent_id === LARGE_PARENT_ID,
        `Test 3.5: Channel response preserved Snowflake parent_id "${LARGE_PARENT_ID}"`
      );
    }
  } finally {
    // Flush any pending microtasks
    await sleep(50);
    // Gracefully stop HTTP server
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  // ==========================================
  // Summary Report
  // ==========================================
  console.log("\n=======================================================");
  console.log(`  TEST RESULTS: ${passedTests}/${totalTests} PASSED`);
  if (failedTests > 0) {
    console.log(`  \x1b[31mFAILED: ${failedTests} test(s)\x1b[0m`);
    process.exitCode = 1;
  } else {
    console.log("  \x1b[32mALL ADVERSARIAL STRESS TESTS PASSED SUCCESSFULLY!\x1b[0m");
    console.log("=======================================================\n");
  }
}

runTestSuite().catch((err) => {
  console.error("FATAL ERROR IN TEST SUITE:", err);
  process.exit(1);
});
