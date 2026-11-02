/**
 * Concord Milestone 2 GatewayClient Comprehensive Adversarial & Empirical Test Harness
 * 
 * Verifies:
 * 1. Connection lifecycle (DISCONNECTED -> CONNECTING -> HANDSHAKING -> CONNECTED)
 * 2. IDENTIFY frame construction & auth token injection
 * 3. Sequence tracking & session_id persistence
 * 4. Heartbeat periodicity & jitter handling
 * 5. Zombie connection detection & termination upon missed HEARTBEAT_ACK
 * 6. Server-initiated HEARTBEAT response
 * 7. Reconnection with RESUME frame (op 6, session_id, last seq)
 * 8. RESUMED dispatch transition to CONNECTED
 * 9. Event dispatching, wildcard subscription, and listener unregistration
 * 10. Listener error isolation (throwing listener does not break event loop)
 * 11. Close code 4004 (Authentication Failed) halts reconnect & resets session
 * 12. Opcode 9 INVALID_SESSION (d: false) clears session & forces IDENTIFY
 * 13. Opcode 7 RECONNECT request handling
 * 14. Malformed frame resiliency
 * 15. Real End-to-End WebSocket connection with live Concord Go backend
 */

// 1. Mount mock localStorage BEFORE importing client modules
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
};
(globalThis as any).localStorage = localStorageMock;

// Save native WebSocket before mocking
const NativeWebSocket = globalThis.WebSocket;

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failureDetails: string[] = [];

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  \x1b[32m✓\x1b[0m ${testName}`);
  } else {
    failedTests++;
    console.error(`  \x1b[31m✗\x1b[0m ${testName}`);
    if (detail) {
      console.error(`    \x1b[33mError detail: ${detail}\x1b[0m`);
      failureDetails.push(`${testName}: ${detail}`);
    } else {
      failureDetails.push(testName);
    }
  }
}

// Mock WebSocket implementation for controlled unit & adversarial testing
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  public readyState: number = MockWebSocket.CONNECTING;
  public onopen: ((ev: any) => void) | null = null;
  public onmessage: ((ev: { data: string }) => void) | null = null;
  public onerror: ((ev: any) => void) | null = null;
  public onclose: ((ev: { code: number; reason: string }) => void) | null = null;

  public sent: string[] = [];
  public closedWith?: { code: number; reason: string };

  public static activeInstances: MockWebSocket[] = [];
  public static lastCreated: MockWebSocket | null = null;
  public static autoOpen: boolean = true;
  public static openDelayMs: number = 5;

  constructor(public url: string) {
    MockWebSocket.activeInstances.push(this);
    MockWebSocket.lastCreated = this;

    if (MockWebSocket.autoOpen) {
      setTimeout(() => {
        if (this.readyState === MockWebSocket.CONNECTING) {
          this.readyState = MockWebSocket.OPEN;
          if (this.onopen) this.onopen({});
        }
      }, MockWebSocket.openDelayMs);
    }
  }

  send(data: string) {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error("Cannot send frame: WebSocket is not open");
    }
    this.sent.push(data);
  }

  close(code: number = 1000, reason: string = "") {
    this.readyState = MockWebSocket.CLOSED;
    this.closedWith = { code, reason };
    if (this.onclose) {
      this.onclose({ code, reason });
    }
  }

  // Helper for server-to-client frame simulation
  serverSend(obj: any) {
    if (this.onmessage) {
      this.onmessage({ data: typeof obj === "string" ? obj : JSON.stringify(obj) });
    }
  }
}

async function runAdversarialHarness() {
  console.log("\n===============================================================================");
  console.log("   CONCORD GATEWAY CLIENT — EMPIRICAL CHALLENGER ADVERSARIAL TEST HARNESS");
  console.log("===============================================================================\n");

  const { GatewayOpcode, GatewayEvent } = await import("../src/types");
  const { GatewayClient } = await import("../src/gateway/GatewayClient");

  // Activate MockWebSocket for Suites 1-5
  (globalThis as any).WebSocket = MockWebSocket;

  // ===========================================================================
  // SUITE 1: Connection Lifecycle & IDENTIFY Handshake
  // ===========================================================================
  console.log("\x1b[36m[SUITE 1] Connection Lifecycle & Handshake Verification\x1b[0m");
  {
    const client = new GatewayClient();
    assert(client.getStatus() === "DISCONNECTED", "1.1 Client initial state is DISCONNECTED");
    assert(client.getSessionId() === null, "1.1 Client initial sessionId is null");
    assert(client.getSequence() === null, "1.1 Client initial sequence is null");

    // 1.2 Connect with no token
    localStorageMock.clear();
    client.connect("ws://localhost:8080/v1/gateway");
    assert(client.getStatus() === "DISCONNECTED", "1.2 Connect with no token remains DISCONNECTED");
    assert(MockWebSocket.lastCreated === null, "1.2 No WebSocket instance created without token");

    // 1.3 Connect with valid token
    localStorageMock.setItem("concord_token", "jwt_valid_test_token_100");
    MockWebSocket.lastCreated = null;

    const statusChanges: string[] = [];
    const unsubStatus = client.onStatusChange((s) => statusChanges.push(s));

    client.connect("ws://localhost:8080/v1/gateway");
    assert(statusChanges.includes("CONNECTING"), "1.3 Transitions through CONNECTING status");

    await new Promise((r) => setTimeout(r, 20));
    const ws1 = MockWebSocket.lastCreated!;
    assert(ws1 !== null, "1.3 WebSocket instance created");
    assert(client.getStatus() === "HANDSHAKING", "1.3 Transitions to HANDSHAKING upon socket open");
    assert(statusChanges.includes("HANDSHAKING"), "1.3 Status listener notified of HANDSHAKING");

    // 1.4 Receive HELLO -> Check IDENTIFY frame
    ws1.serverSend({
      op: GatewayOpcode.HELLO,
      d: { heartbeat_interval: 41250 },
    });

    assert(ws1.sent.length === 1, "1.4 Sent exactly 1 frame in response to HELLO");
    const identifyFrame = JSON.parse(ws1.sent[0]);
    assert(identifyFrame.op === GatewayOpcode.IDENTIFY, "1.4 Frame opcode is IDENTIFY (2)");
    assert(identifyFrame.d.token === "jwt_valid_test_token_100", "1.4 IDENTIFY frame contains valid token from auth storage");
    assert(identifyFrame.d.properties?.browser === "Concord Client", "1.4 IDENTIFY frame includes client browser property");

    // 1.5 Receive READY dispatch
    ws1.serverSend({
      op: GatewayOpcode.DISPATCH,
      t: GatewayEvent.READY,
      s: 1,
      d: {
        session_id: "session_m2_test_999",
        user: { id: "user_101", username: "test_challenger" },
        guilds: [],
      },
    });

    assert(client.getStatus() === "CONNECTED", "1.5 Transitions to CONNECTED upon READY");
    assert(client.getSessionId() === "session_m2_test_999", "1.5 Session ID stored correctly from READY");
    assert(client.getSequence() === 1, "1.5 Sequence tracked as 1 from READY");

    // 1.6 Idempotent connect() calls
    const prevSocket = MockWebSocket.lastCreated;
    client.connect("ws://localhost:8080/v1/gateway");
    assert(MockWebSocket.lastCreated === prevSocket, "1.6 Calling connect() while OPEN is a no-op");

    unsubStatus();
    client.disconnect();
    assert(client.getStatus() === "DISCONNECTED", "1.7 Clean disconnect returns to DISCONNECTED");
  }

  // ===========================================================================
  // SUITE 2: Event Dispatching, Wildcards, and Listener Isolation
  // ===========================================================================
  console.log("\n\x1b[36m[SUITE 2] Event Dispatching & Listener Resilience\x1b[0m");
  {
    localStorageMock.setItem("concord_token", "jwt_valid_test_token_100");
    const client = new GatewayClient();
    client.connect("ws://localhost:8080/v1/gateway");
    await new Promise((r) => setTimeout(r, 15));
    const ws = MockWebSocket.lastCreated!;

    ws.serverSend({
      op: GatewayOpcode.HELLO,
      d: { heartbeat_interval: 41250 },
    });
    ws.serverSend({
      op: GatewayOpcode.DISPATCH,
      t: GatewayEvent.READY,
      s: 1,
      d: { session_id: "session_dispatch_test", user: { id: "u1" } },
    });

    // 2.1 Named event registration & Snowflake ID string preservation
    let messageReceived: any = null;
    const unsubMessage = client.on(GatewayEvent.MESSAGE_CREATE, (data) => {
      messageReceived = data;
    });

    // 2.2 Wildcard listener registration
    let wildcardEvents: Array<{ event: string; data: any }> = [];
    const unsubWildcard = client.on("*", (payload) => {
      wildcardEvents.push(payload);
    });

    // 2.3 Throwing listener to test fault tolerance
    let faultTolerantExecuted = false;
    client.on(GatewayEvent.MESSAGE_CREATE, () => {
      throw new Error("Simulated faulty third-party listener error");
    });
    client.on(GatewayEvent.MESSAGE_CREATE, () => {
      faultTolerantExecuted = true;
    });

    // Dispatch MESSAGE_CREATE with high-order Snowflake ID (> 2^53 - 1)
    const largeSnowflakeId = "900719925474099312"; // Max safe int + 23
    ws.serverSend({
      op: GatewayOpcode.DISPATCH,
      t: GatewayEvent.MESSAGE_CREATE,
      s: 2,
      d: {
        id: largeSnowflakeId,
        channel_id: "channel_101",
        content: "Hello adversarial world!",
      },
    });

    assert(messageReceived !== null, "2.1 Named listener received MESSAGE_CREATE");
    assert(messageReceived.id === largeSnowflakeId, "2.1 64-bit Snowflake ID preserved as string without truncation");
    assert(client.getSequence() === 2, "2.1 Sequence incremented to 2");
    assert(wildcardEvents.length === 1, "2.2 Wildcard listener caught event");
    assert(wildcardEvents[0].event === GatewayEvent.MESSAGE_CREATE, "2.2 Wildcard payload has correct event name");
    assert(wildcardEvents[0].data.id === largeSnowflakeId, "2.2 Wildcard payload has correct data");
    assert(faultTolerantExecuted === true, "2.3 Subsequent listener executed despite earlier listener throwing");

    // 2.4 Listener unregistration
    unsubMessage();
    messageReceived = null;
    ws.serverSend({
      op: GatewayOpcode.DISPATCH,
      t: GatewayEvent.MESSAGE_CREATE,
      s: 3,
      d: { id: "900719925474099313", content: "Second dispatch" },
    });
    assert(messageReceived === null, "2.4 Unregistered listener did not receive subsequent dispatch");
    assert(client.getSequence() === 3, "2.4 Sequence updated to 3 even after listener unsubscribed");

    unsubWildcard();
    client.disconnect();
  }

  // ===========================================================================
  // SUITE 3: Heartbeat Interval, Keepalive ACK & Zombie Eviction
  // ===========================================================================
  console.log("\n\x1b[36m[SUITE 3] Heartbeat Loop & Zombie Connection Detection\x1b[0m");
  {
    // 3.1 & 3.2 Periodic Heartbeats with ACKs
    localStorageMock.setItem("concord_token", "jwt_valid_test_token_100");
    const client = new GatewayClient();
    client.connect("ws://localhost:8080/v1/gateway");
    await new Promise((r) => setTimeout(r, 15));
    const ws = MockWebSocket.lastCreated!;

    // Send HELLO with fast 40ms interval for empirical timing test
    const fastIntervalMs = 40;
    ws.sent = [];

    // Hook auto-ACK on mock socket to simulate healthy server response
    const origSend = ws.send.bind(ws);
    let autoAckEnabled = true;
    ws.send = (data: string) => {
      origSend(data);
      const parsed = JSON.parse(data);
      if (parsed.op === GatewayOpcode.HEARTBEAT && autoAckEnabled) {
        setTimeout(() => {
          ws.serverSend({ op: GatewayOpcode.HEARTBEAT_ACK });
        }, 5);
      }
    };

    ws.serverSend({
      op: GatewayOpcode.HELLO,
      d: { heartbeat_interval: fastIntervalMs },
    });

    // Client sends IDENTIFY immediately
    assert(ws.sent.length === 1 && JSON.parse(ws.sent[0]).op === GatewayOpcode.IDENTIFY, "3.1 Sent IDENTIFY after HELLO");

    // Advance READY
    ws.serverSend({
      op: GatewayOpcode.DISPATCH,
      t: GatewayEvent.READY,
      s: 5,
      d: { session_id: "session_heartbeat_1", user: { id: "u1" } },
    });

    // Wait for periodic heartbeats with auto-ACK active (~120ms to cover 2-3 intervals)
    await new Promise((r) => setTimeout(r, 120));
    const heartbeatsSent = ws.sent.filter((f) => JSON.parse(f).op === GatewayOpcode.HEARTBEAT);
    assert(heartbeatsSent.length >= 2, "3.1 Multiple periodic heartbeats (op 1) sent over interval");
    const hb1Payload = JSON.parse(heartbeatsSent[0]);
    assert(hb1Payload.d === 5, "3.1 Heartbeat includes current sequence (5)");
    assert(ws.readyState === MockWebSocket.OPEN, "3.2 Socket remains OPEN when ACKs are acknowledged");

    client.disconnect();

    // 3.3 Zombie Connection Eviction when HEARTBEAT_ACK is missed
    const zombieClient = new GatewayClient();
    zombieClient.connect("ws://localhost:8080/v1/gateway");
    await new Promise((r) => setTimeout(r, 15));
    const zombieWs = MockWebSocket.lastCreated!;

    zombieWs.sent = [];
    // Fast 40ms interval
    zombieWs.serverSend({
      op: GatewayOpcode.HELLO,
      d: { heartbeat_interval: 40 },
    });

    // Wait for first heartbeat (jitter <40ms)
    await new Promise((r) => setTimeout(r, 55));
    const zombieHb = zombieWs.sent.filter((f) => JSON.parse(f).op === GatewayOpcode.HEARTBEAT);
    assert(zombieHb.length >= 1, "3.3 Zombie test: First heartbeat sent");

    // DO NOT send HEARTBEAT_ACK. Wait for next interval tick (~40ms).
    // The setInterval check should detect !heartbeatAckReceived and close the socket!
    await new Promise((r) => setTimeout(r, 60));

    assert(zombieWs.readyState === MockWebSocket.CLOSED, "3.3 Zombie connection terminated by client on missed ACK");
    assert(zombieWs.closedWith?.code === 4000, "3.3 Zombie socket closed with code 4000");
    assert(
      zombieWs.closedWith?.reason.includes("Zombie Connection Timeout"),
      "3.3 Zombie socket closed with 'Zombie Connection Timeout' reason"
    );

    zombieClient.disconnect();

    // 3.4 Server-Initiated Heartbeat ping/pong
    const pingClient = new GatewayClient();
    pingClient.connect("ws://localhost:8080/v1/gateway");
    await new Promise((r) => setTimeout(r, 15));
    const pingWs = MockWebSocket.lastCreated!;

    pingWs.serverSend({
      op: GatewayOpcode.DISPATCH,
      t: GatewayEvent.READY,
      s: 7,
      d: { session_id: "s7", user: { id: "u7" } },
    });

    pingWs.sent = [];
    // Server requests client heartbeat via opcode 1
    pingWs.serverSend({
      op: GatewayOpcode.HEARTBEAT,
    });

    assert(pingWs.sent.length === 1, "3.4 Client answered server HEARTBEAT immediately");
    const pingResponse = JSON.parse(pingWs.sent[0]);
    assert(pingResponse.op === GatewayOpcode.HEARTBEAT, "3.4 Client response is Opcode 1 HEARTBEAT");
    assert(pingResponse.d === 7, "3.4 Heartbeat response echoed current sequence 7");

    pingClient.disconnect();
  }

  // ===========================================================================
  // SUITE 4: Session Resumption (Opcode 6 RESUME) on Reconnect
  // ===========================================================================
  console.log("\n\x1b[36m[SUITE 4] Session Resume & Reconnection\x1b[0m");
  {
    localStorageMock.setItem("concord_token", "jwt_valid_test_token_100");
    const client = new GatewayClient();
    client.connect("ws://localhost:8080/v1/gateway");
    await new Promise((r) => setTimeout(r, 15));
    let ws = MockWebSocket.lastCreated!;

    // Complete initial handshake
    ws.serverSend({
      op: GatewayOpcode.HELLO,
      d: { heartbeat_interval: 30000 },
    });
    ws.serverSend({
      op: GatewayOpcode.DISPATCH,
      t: GatewayEvent.READY,
      s: 15,
      d: { session_id: "session_to_resume_abc123", user: { id: "u1" } },
    });

    assert(client.getStatus() === "CONNECTED", "4.1 Initial connection established");
    assert(client.getSessionId() === "session_to_resume_abc123", "4.1 Session ID stored");
    assert(client.getSequence() === 15, "4.1 Sequence is 15");

    // Receive another message to advance sequence to 16
    ws.serverSend({
      op: GatewayOpcode.DISPATCH,
      t: GatewayEvent.MESSAGE_CREATE,
      s: 16,
      d: { id: "msg_16", content: "Test" },
    });
    assert(client.getSequence() === 16, "4.1 Sequence advanced to 16");

    // Simulate unexpected network drop (close code 1006)
    MockWebSocket.lastCreated = null;
    ws.close(1006, "Abnormal Network Loss");

    assert(client.getStatus() === "RECONNECTING", "4.1 Status transitioned to RECONNECTING after drop");

    // Client has a reconnect backoff timer (1000ms + jitter).
    // Let's wait for reconnect timer to fire (~1.5s) to test real backoff scheduling!
    await new Promise((r) => setTimeout(r, 2200));

    const reconnectWs = MockWebSocket.lastCreated!;
    assert(reconnectWs !== null && reconnectWs !== ws, "4.2 New WebSocket created automatically by reconnect timer");
    assert(client.getStatus() === "HANDSHAKING", "4.2 Reconnected socket transitioned to HANDSHAKING on open");

    // Server sends HELLO on the new socket
    reconnectWs.sent = [];
    reconnectWs.serverSend({
      op: GatewayOpcode.HELLO,
      d: { heartbeat_interval: 30000 },
    });

    assert(reconnectWs.sent.length === 1, "4.2 Sent frame in response to HELLO");
    const resumeFrame = JSON.parse(reconnectWs.sent[0]);
    assert(resumeFrame.op === GatewayOpcode.RESUME, "4.2 Sent RESUME frame (op 6), NOT IDENTIFY");
    assert(resumeFrame.d.session_id === "session_to_resume_abc123", "4.2 RESUME contains stored session_id");
    assert(resumeFrame.d.seq === 16, "4.2 RESUME contains last sequence (16)");
    assert(resumeFrame.d.token === "jwt_valid_test_token_100", "4.2 RESUME contains valid token");

    // Server acknowledges with RESUMED dispatch
    reconnectWs.serverSend({
      op: GatewayOpcode.DISPATCH,
      t: GatewayEvent.RESUMED,
      s: 17,
      d: {},
    });

    assert(client.getStatus() === "CONNECTED", "4.3 Transitions to CONNECTED upon RESUMED");
    assert(client.getSequence() === 17, "4.3 Sequence updated to 17 from RESUMED");

    // 4.4 Explicit disconnect prevents auto-reconnect
    MockWebSocket.lastCreated = null;
    client.disconnect();
    assert(client.getStatus() === "DISCONNECTED", "4.4 Explicit disconnect sets DISCONNECTED");
    assert(reconnectWs.closedWith?.code === 1000, "4.4 Explicit disconnect closed with 1000 Normal Closure");

    // Wait 2.5s to verify NO reconnect occurs
    await new Promise((r) => setTimeout(r, 2200));
    assert(MockWebSocket.lastCreated === null, "4.4 No reconnect scheduled after explicit disconnect");
  }

  // ===========================================================================
  // SUITE 5: Adversarial Edge Cases & Protocol Error Recovery
  // ===========================================================================
  console.log("\n\x1b[36m[SUITE 5] Adversarial Edge Cases & Protocol Error Recovery\x1b[0m");
  {
    // 5.1 Close code 4004 (Authentication Failed)
    localStorageMock.setItem("concord_token", "expired_token_4004");
    const client4004 = new GatewayClient();
    client4004.connect("ws://localhost:8080/v1/gateway");
    await new Promise((r) => setTimeout(r, 15));
    const ws4004 = MockWebSocket.lastCreated!;

    (client4004 as any).sessionId = "stale_session";
    (client4004 as any).sequence = 99;

    MockWebSocket.lastCreated = null;
    // Server closes with 4004
    ws4004.close(4004, "Authentication Failed");

    assert(client4004.getStatus() === "DISCONNECTED", "5.1 Close code 4004 immediately halts into DISCONNECTED");
    assert(client4004.getSessionId() === null, "5.1 Close code 4004 wipes sessionId");
    assert(client4004.getSequence() === null, "5.1 Close code 4004 wipes sequence");

    // Wait to verify no reconnect happens
    await new Promise((r) => setTimeout(r, 1500));
    assert(MockWebSocket.lastCreated === null, "5.1 Close code 4004 does NOT schedule reconnect");
    client4004.disconnect();

    // 5.2 Opcode 9 INVALID_SESSION (d: false)
    localStorageMock.setItem("concord_token", "jwt_valid_test_token_100");
    const clientInvalid = new GatewayClient();
    clientInvalid.connect("ws://localhost:8080/v1/gateway");
    await new Promise((r) => setTimeout(r, 15));
    const wsInvalid = MockWebSocket.lastCreated!;

    (clientInvalid as any).sessionId = "unresumable_sess";
    (clientInvalid as any).sequence = 50;

    wsInvalid.sent = [];
    // Server sends opcode 9 with d: false
    wsInvalid.serverSend({
      op: GatewayOpcode.INVALID_SESSION,
      d: false,
    });

    assert(clientInvalid.getSessionId() === null, "5.2 INVALID_SESSION (d: false) wipes sessionId");
    assert(clientInvalid.getSequence() === null, "5.2 INVALID_SESSION (d: false) wipes sequence");

    // GatewayClient waits 1000ms before re-identifying
    await new Promise((r) => setTimeout(r, 1200));
    assert(wsInvalid.sent.length === 1, "5.2 Sent new frame after INVALID_SESSION timeout");
    const reidentify = JSON.parse(wsInvalid.sent[0]);
    assert(reidentify.op === GatewayOpcode.IDENTIFY, "5.2 Sent fresh IDENTIFY (op 2), NOT RESUME");
    clientInvalid.disconnect();

    // 5.3 Opcode 7 RECONNECT
    const clientReconnect = new GatewayClient();
    clientReconnect.connect("ws://localhost:8080/v1/gateway");
    await new Promise((r) => setTimeout(r, 15));
    const wsReconnect = MockWebSocket.lastCreated!;

    wsReconnect.serverSend({
      op: GatewayOpcode.RECONNECT,
    });
    assert(wsReconnect.readyState === MockWebSocket.CLOSED, "5.3 Server RECONNECT closed the socket");
    assert(wsReconnect.closedWith?.code === 4000, "5.3 Socket closed with code 4000");
    assert(clientReconnect.getStatus() === "RECONNECTING", "5.3 Client transitioned to RECONNECTING");
    clientReconnect.disconnect();

    // 5.4 Malformed Frame Resiliency
    const clientMalformed = new GatewayClient();
    clientMalformed.connect("ws://localhost:8080/v1/gateway");
    await new Promise((r) => setTimeout(r, 15));
    const wsMalformed = MockWebSocket.lastCreated!;

    // Send broken JSON frame
    wsMalformed.serverSend("{ broken json !@#$%^&*(");
    assert(wsMalformed.readyState === MockWebSocket.OPEN, "5.4 Client did not crash on malformed JSON frame");

    clientMalformed.disconnect();
  }

  // ===========================================================================
  // SUITE 6: Live Backend End-to-End WebSocket Verification
  // ===========================================================================
  console.log("\n\x1b[36m[SUITE 6] Live Concord Go Backend End-to-End Integration\x1b[0m");
  {
    // Restore native WebSocket for live network testing
    (globalThis as any).WebSocket = NativeWebSocket;

    // First obtain a fresh access token from the live backend
    let liveToken = "";
    try {
      const email = `challenger_${Date.now()}@example.com`;
      const res = await fetch("http://127.0.0.1:8080/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "challenger_live",
          email,
          password: "Password123!",
        }),
      });

      if (res.ok) {
        const body = await res.json();
        liveToken = body.token;
      }
    } catch (err) {
      console.warn("Live register failed, attempting login:", err);
    }

    if (!liveToken) {
      console.warn("Could not register fresh user, trying challenger login...");
      try {
        const res = await fetch("http://127.0.0.1:8080/v1/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: "challenger@example.com",
            password: "Password123!",
          }),
        });
        if (res.ok) {
          const body = await res.json();
          liveToken = body.token;
        }
      } catch (err) {
        console.error("Login also failed:", err);
      }
    }

    assert(Boolean(liveToken), "6.0 Acquired valid JWT token from live Concord Go backend");

    if (liveToken) {
      localStorageMock.setItem("concord_token", liveToken);

      const liveClient = new GatewayClient();
      let liveConnected = false;
      let liveReadyReceived = false;
      let liveGuildCreateReceived = false;
      let liveHeartbeatAckReceived = false;

      liveClient.onStatusChange((status) => {
        if (status === "CONNECTED") {
          liveConnected = true;
        }
      });

      liveClient.on(GatewayEvent.READY, (data) => {
        liveReadyReceived = true;
      });

      liveClient.on(GatewayEvent.GUILD_CREATE, (data) => {
        liveGuildCreateReceived = true;
      });

      // Wildcard listener to detect live HEARTBEAT_ACK or dispatch
      liveClient.on("*", (event) => {
        // Can inspect all live events
      });

      // Connect to live backend
      liveClient.connect("ws://127.0.0.1:8080/v1/gateway");

      // Wait for handshake to complete over live network
      const startWait = Date.now();
      while (!liveConnected && Date.now() - startWait < 5000) {
        await new Promise((r) => setTimeout(r, 100));
      }

      assert(liveConnected === true, "6.1 Live WebSocket handshake succeeded (status: CONNECTED)");
      assert(liveClient.getSessionId() !== null, "6.1 Live session_id assigned by Go backend");
      assert(typeof liveClient.getSessionId() === "string", "6.1 Live session_id is a valid UUID string");
      assert((liveClient.getSequence() ?? 0) >= 1, "6.1 Live sequence initialized from READY");
      assert(liveReadyReceived === true, "6.1 Live READY dispatch received and handled");

      // Test manual heartbeat to live backend and verify ACK
      (liveClient as any).sendHeartbeat();
      // Wait for live server to return HEARTBEAT_ACK
      await new Promise((r) => setTimeout(r, 300));
      assert((liveClient as any).heartbeatAckReceived === true, "6.2 Live HEARTBEAT_ACK (op 11) received from Go backend");

      liveClient.disconnect();
      assert(liveClient.getStatus() === "DISCONNECTED", "6.3 Live WebSocket disconnected cleanly");
    }
  }

  // ===========================================================================
  // HARNESS SUMMARY
  // ===========================================================================
  console.log("\n===============================================================================");
  console.log(`TOTAL TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
  if (failedTests > 0) {
    console.log("FAILURES:");
    failureDetails.forEach((f) => console.log(`  - ${f}`));
  }
  console.log("===============================================================================\n");

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAdversarialHarness().catch((err) => {
  console.error("FATAL UNCAUGHT ERROR IN HARNESS:", err);
  process.exit(1);
});
