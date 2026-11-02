/**
 * Concord Milestone 2 Frontend Comprehensive Unit & Behavioral Test Suite
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

let passed = 0;
let failed = 0;

function assert(condition: boolean, desc: string, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${desc}`);
  } else {
    failed++;
    console.error(`  \x1b[31m✗\x1b[0m ${desc}`);
    if (detail) console.error(`    \x1b[33m${detail}\x1b[0m`);
  }
}

async function runTests() {
  console.log("\n=======================================================");
  console.log("  CONCORD M2 FRONTEND UNIT & INTEGRATION TEST HARNESS");
  console.log("=======================================================\n");

  // Dynamic imports after localStorage is mounted
  const { GatewayOpcode, GatewayEvent } = await import("../src/types");
  const { GatewayClient } = await import("../src/gateway/GatewayClient");
  const { useMessageStore } = await import("../src/stores/messageStore");
  type Message = import("../src/types").Message;
  type Snowflake = import("../src/types").Snowflake;

  // -------------------------------------------------------------
  // SUITE 1: GatewayClient Event Dispatch & State Machine
  // -------------------------------------------------------------
  console.log("\x1b[36m[SUITE 1] GatewayClient Event Dispatch & Lifecycle\x1b[0m");

  const client = new GatewayClient();
  assert(client.getStatus() === "DISCONNECTED", "Client starts in DISCONNECTED status");

  // Mock WebSocket class for client testing
  let sentFrames: string[] = [];
  let mockSocketInstance: any = null;

  class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    public readyState = 1; // OPEN
    public onopen: any = null;
    public onmessage: any = null;
    public onerror: any = null;
    public onclose: any = null;

    constructor(public url: string) {
      mockSocketInstance = this;
      setTimeout(() => {
        if (this.onopen) this.onopen({});
      }, 0);
    }

    send(data: string) {
      sentFrames.push(data);
    }

    close(code?: number, reason?: string) {
      this.readyState = 3; // CLOSED
      if (this.onclose) this.onclose({ code: code || 1000, reason: reason || "" });
    }
  }

  (globalThis as any).WebSocket = MockWebSocket;
  localStorage.setItem("concord_token", "mock_jwt_token_123");

  // 1.1 Connect & HELLO Handshake
  client.connect("ws://localhost:8080/v1/gateway");
  await new Promise((r) => setTimeout(r, 20));

  assert(client.getStatus() === "HANDSHAKING", "Client transitions to HANDSHAKING on socket open");

  // Server sends HELLO
  sentFrames = [];
  mockSocketInstance.onmessage({
    data: JSON.stringify({
      op: GatewayOpcode.HELLO,
      d: { heartbeat_interval: 1000 },
    }),
  });

  // Client should respond with IDENTIFY (Opcode 2)
  assert(sentFrames.length > 0, "Client sent frame after HELLO");
  const identifyFrame = JSON.parse(sentFrames[0]);
  assert(identifyFrame.op === GatewayOpcode.IDENTIFY, "Opcode is IDENTIFY (2)");
  assert(identifyFrame.d.token === "mock_jwt_token_123", "Identify frame contains valid JWT");

  // 1.2 READY Dispatch
  sentFrames = [];
  mockSocketInstance.onmessage({
    data: JSON.stringify({
      op: GatewayOpcode.DISPATCH,
      t: GatewayEvent.READY,
      s: 1,
      d: {
        v: 1,
        session_id: "test_session_abc123",
        user: { id: "1001", username: "alice" },
        guilds: [],
      },
    }),
  });

  assert(client.getStatus() === "CONNECTED", "Client transitions to CONNECTED upon READY");
  assert(client.getSessionId() === "test_session_abc123", "Session ID stored correctly");
  assert(client.getSequence() === 1, "Sequence number updated to 1");

  // 1.3 Event Emitter: MESSAGE_CREATE
  let receivedMessage: any = null;
  const unsub = client.on<Message>(GatewayEvent.MESSAGE_CREATE, (data) => {
    receivedMessage = data;
  });

  mockSocketInstance.onmessage({
    data: JSON.stringify({
      op: GatewayOpcode.DISPATCH,
      t: GatewayEvent.MESSAGE_CREATE,
      s: 2,
      d: {
        id: "900000000000000001",
        channel_id: "5001",
        content: "Hello from test!",
        type: 0,
        author: { id: "1001", username: "alice" },
        created_at: new Date().toISOString(),
        edited_at: null,
        pinned: false,
      },
    }),
  });

  assert(receivedMessage !== null, "Registered listener received MESSAGE_CREATE event");
  assert(receivedMessage.id === "900000000000000001", "Message Snowflake preserved verbatim");
  assert(receivedMessage.content === "Hello from test!", "Message content matched");
  assert(client.getSequence() === 2, "Sequence updated to 2");

  // Unsubscribe test
  unsub();
  receivedMessage = null;
  mockSocketInstance.onmessage({
    data: JSON.stringify({
      op: GatewayOpcode.DISPATCH,
      t: GatewayEvent.MESSAGE_CREATE,
      s: 3,
      d: { id: "900000000000000002", content: "Second message" },
    }),
  });
  assert(receivedMessage === null, "Unsubscribed listener did not receive subsequent message");

  // 1.5 Session Resume (Opcode 6) on reconnect
  const resumeClient = new GatewayClient();
  // Simulate having an active session
  (resumeClient as any).sessionId = "resume_session_xyz789";
  (resumeClient as any).sequence = 42;

  resumeClient.connect("ws://localhost:8080/v1/gateway");
  await new Promise((r) => setTimeout(r, 20));

  sentFrames = [];
  mockSocketInstance.onmessage({
    data: JSON.stringify({
      op: GatewayOpcode.HELLO,
      d: { heartbeat_interval: 1000 },
    }),
  });

  assert(sentFrames.length > 0, "Resume client sent frame after HELLO");
  const resumeFrame = JSON.parse(sentFrames[0]);
  assert(resumeFrame.op === GatewayOpcode.RESUME, "Opcode is RESUME (6)");
  assert(resumeFrame.d.session_id === "resume_session_xyz789", "Resume payload has session_id");
  assert(resumeFrame.d.seq === 42, "Resume payload has sequence 42");

  // Server sends RESUMED dispatch
  mockSocketInstance.onmessage({
    data: JSON.stringify({
      op: GatewayOpcode.DISPATCH,
      t: GatewayEvent.RESUMED,
      s: 43,
      d: {},
    }),
  });
  assert(resumeClient.getStatus() === "CONNECTED", "Client transitions to CONNECTED upon RESUMED");

  resumeClient.disconnect();
  client.disconnect();
  assert(client.getStatus() === "DISCONNECTED", "Client disconnected cleanly");

  // -------------------------------------------------------------
  // SUITE 2: Zustand Message Store Reducers & State Management
  // -------------------------------------------------------------
  console.log("\n\x1b[36m[SUITE 2] Zustand Message Store Invariants\x1b[0m");

  const store = useMessageStore.getState();
  store.reset();

  const mockMsg1: Message = {
    id: "900000000000000010",
    channel_id: "channel_alpha",
    content: "First message in alpha",
    type: 0,
    author: { id: "2001", username: "bob" },
    created_at: "2026-11-02T10:00:00Z",
    edited_at: null,
    pinned: false,
  };

  const mockMsg2: Message = {
    id: "900000000000000020",
    channel_id: "channel_alpha",
    content: "Second message in alpha",
    type: 0,
    author: { id: "2002", username: "charlie" },
    created_at: "2026-11-02T10:05:00Z",
    edited_at: null,
    pinned: false,
  };

  // 2.1 Append to active channel
  store.handleMessageCreate(mockMsg1, "channel_alpha");
  let alphaMsgs = useMessageStore.getState().messagesByChannel["channel_alpha"] || [];
  assert(alphaMsgs.length === 1, "Appended message to active channel");
  assert(alphaMsgs[0].id === mockMsg1.id, "Correct message appended");
  assert(
    !useMessageStore.getState().unreadByChannel["channel_alpha"],
    "Active channel did NOT increment unread count"
  );

  // 2.2 Deduplication check
  store.handleMessageCreate(mockMsg1, "channel_alpha");
  alphaMsgs = useMessageStore.getState().messagesByChannel["channel_alpha"];
  assert(alphaMsgs.length === 1, "Deduplication: existing message id not duplicated");

  // 2.3 Unread indicator on non-active channel
  const mockMsgBeta: Message = {
    id: "900000000000000030",
    channel_id: "channel_beta",
    content: "Message in beta channel",
    type: 0,
    author: { id: "2001", username: "bob" },
    created_at: "2026-11-02T10:10:00Z",
    edited_at: null,
    pinned: false,
  };

  store.handleMessageCreate(mockMsgBeta, "channel_alpha"); // Active is alpha, msg is in beta
  const unreadBeta = useMessageStore.getState().unreadByChannel["channel_beta"];
  assert(unreadBeta === 1, "Non-active channel incremented unread count to 1");

  // Clear unread
  store.clearUnread("channel_beta");
  assert(
    !useMessageStore.getState().unreadByChannel["channel_beta"],
    "clearUnread resets channel unread count"
  );

  // 2.4 In-place update (MESSAGE_UPDATE)
  const updatedMsg1: Message = {
    ...mockMsg1,
    content: "First message in alpha (edited content)",
    edited_at: "2026-11-02T10:02:00Z",
  };
  store.handleMessageUpdate(updatedMsg1);
  alphaMsgs = useMessageStore.getState().messagesByChannel["channel_alpha"];
  assert(alphaMsgs[0].content === "First message in alpha (edited content)", "Message updated in-place");
  assert(alphaMsgs[0].edited_at === "2026-11-02T10:02:00Z", "edited_at updated in-place");

  // 2.5 Delete message (MESSAGE_DELETE)
  store.handleMessageCreate(mockMsg2, "channel_alpha");
  assert(
    useMessageStore.getState().messagesByChannel["channel_alpha"].length === 2,
    "Channel alpha has 2 messages before delete"
  );

  store.handleMessageDelete({ id: mockMsg1.id, channelId: "channel_alpha" });
  alphaMsgs = useMessageStore.getState().messagesByChannel["channel_alpha"];
  assert(alphaMsgs.length === 1, "Deleted message removed from store");
  assert(alphaMsgs[0].id === mockMsg2.id, "Remaining message intact");

  // 2.6 Typing start and expiration
  store.handleTypingStart({
    channel_id: "channel_alpha",
    user_id: "2001",
    username: "bob",
  });

  let typingAlpha = useMessageStore.getState().typingByChannel["channel_alpha"] || [];
  assert(typingAlpha.length === 1, "Typing user added to channel");
  assert(typingAlpha[0].userId === "2001", "Correct typing userId recorded");
  assert(typingAlpha[0].username === "bob", "Correct typing username recorded");
  assert(typingAlpha[0].expiresAt > Date.now(), "Typing expiresAt in the future (~5s)");

  // Expired typing sweep
  useMessageStore.setState({
    typingByChannel: {
      channel_alpha: [{ userId: "2001", username: "bob", expiresAt: Date.now() - 1000 }],
    },
  });

  store.cleanupExpiredTyping();
  typingAlpha = useMessageStore.getState().typingByChannel["channel_alpha"] || [];
  assert(typingAlpha.length === 0, "cleanupExpiredTyping successfully purged expired user");

  // -------------------------------------------------------------
  // SUITE 3: 64-bit Snowflake Precision Integrity
  // -------------------------------------------------------------
  console.log("\n\x1b[36m[SUITE 3] 64-bit Snowflake Precision Integrity\x1b[0m");

  const bigSnowflake: Snowflake = "1152921504606846976"; // 2^60 (greater than MAX_SAFE_INTEGER 9007199254740991)
  const bigSnowflakeMsg: Message = {
    id: bigSnowflake,
    channel_id: "channel_gamma",
    content: "Large snowflake test",
    type: 0,
    author: { id: "999999999999999999", username: "dave" },
    created_at: new Date().toISOString(),
    edited_at: null,
    pinned: false,
  };

  store.handleMessageCreate(bigSnowflakeMsg, "channel_gamma");
  const gammaMsgs = useMessageStore.getState().messagesByChannel["channel_gamma"];
  assert(gammaMsgs[0].id === bigSnowflake, "64-bit Snowflake ID string preserved without precision loss");

  // -------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------
  console.log("\n=======================================================");
  console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log("=======================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
