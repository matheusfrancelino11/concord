/**
 * Concord Milestone 2 Frontend Adversarial Stress Test Suite
 * Executed by Empirical Challenger 2.
 * 
 * Tests the 5 core invariants:
 * 1. Message Deduplication & Ordering
 * 2. Active vs Non-Active Channel Unread Invariant
 * 3. Message Edit & Delete Invariants
 * 4. Typing Indicator Expiration & Resolution
 * 5. 64-bit Snowflake Precision (> 2^53 IEEE-754 Safe Integer Limit)
 */

// Mock localStorage environment before store import
const storage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, val: string) => storage.set(key, String(val)),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
};

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, desc: string, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${desc}`);
  } else {
    failed++;
    const errMsg = `[FAIL] ${desc}${detail ? ` -> ${detail}` : ""}`;
    failures.push(errMsg);
    console.error(`  \x1b[31m✗\x1b[0m ${desc}`);
    if (detail) console.error(`    \x1b[33m${detail}\x1b[0m`);
  }
}

async function runAdversarialTests() {
  console.log("\n=======================================================");
  console.log("  CHALLENGER 2: EMPIRICAL FRONTEND ADVERSARIAL HARNESS");
  console.log("=======================================================\n");

  const { useMessageStore } = await import("../src/stores/messageStore");
  type Message = import("../src/types").Message;

  const store = useMessageStore.getState();

  // =========================================================================
  // TEST SECTION 1: Message Deduplication & Ordering
  // =========================================================================
  console.log("\x1b[36m[TEST 1] Message Deduplication & Ordering\x1b[0m");
  store.reset();

  const channel1 = "channel_dedup_test";
  const msgA: Message = {
    id: "100000000000000001",
    channel_id: channel1,
    content: "Original Message A",
    type: 0,
    author: { id: "user_1", username: "alice" },
    created_at: "2026-11-02T12:00:00.000Z",
    edited_at: null,
    pinned: false,
  };

  const msgB: Message = {
    id: "100000000000000002",
    channel_id: channel1,
    content: "Message B",
    type: 0,
    author: { id: "user_2", username: "bob" },
    created_at: "2026-11-02T12:01:00.000Z",
    edited_at: null,
    pinned: false,
  };

  const msgC: Message = {
    id: "100000000000000003",
    channel_id: channel1,
    content: "Message C",
    type: 0,
    author: { id: "user_3", username: "charlie" },
    created_at: "2026-11-02T12:02:00.000Z",
    edited_at: null,
    pinned: false,
  };

  // 1.1 Ingest msgA and msgB
  store.handleMessageCreate(msgA, channel1);
  store.handleMessageCreate(msgB, channel1);
  let msgs = useMessageStore.getState().messagesByChannel[channel1] || [];
  assert(msgs.length === 2, "Channel contains 2 messages initially");
  assert(msgs[0].id === msgA.id && msgs[1].id === msgB.id, "Messages are in sequential order [A, B]");

  // 1.2 Ingest DUPLICATE of msgA with identical payload
  store.handleMessageCreate(msgA, channel1);
  msgs = useMessageStore.getState().messagesByChannel[channel1] || [];
  assert(msgs.length === 2, "Duplicate MESSAGE_CREATE does not increase array length");
  assert(msgs[0].id === msgA.id && msgs[1].id === msgB.id, "Array order preserved [A, B], A did not jump to end");

  // 1.3 Ingest DUPLICATE of msgA with revised content
  const msgAUpdated: Message = {
    ...msgA,
    content: "Message A updated via duplicate broadcast",
  };
  store.handleMessageCreate(msgAUpdated, channel1);
  msgs = useMessageStore.getState().messagesByChannel[channel1] || [];
  assert(msgs.length === 2, "Updated duplicate does not increase array length");
  assert(msgs[0].content === "Message A updated via duplicate broadcast", "Duplicate MESSAGE_CREATE updates content in-place");
  assert(msgs[0].id === msgA.id && msgs[1].id === msgB.id, "Message A index remains 0");

  // 1.4 Burst duplicates (10 identical creates)
  for (let i = 0; i < 10; i++) {
    store.handleMessageCreate(msgB, channel1);
  }
  msgs = useMessageStore.getState().messagesByChannel[channel1] || [];
  assert(msgs.length === 2, "Burst duplicate replay (10x) yields exact same array size of 2");

  // 1.5 Ordering verification: Chronological (oldest -> newest)
  store.handleMessageCreate(msgC, channel1);
  msgs = useMessageStore.getState().messagesByChannel[channel1] || [];
  assert(msgs.length === 3, "Message C appended");

  const timestamps = msgs.map((m) => new Date(m.created_at).getTime());
  let isSorted = true;
  for (let i = 1; i < timestamps.length; i++) {
    if (timestamps[i] < timestamps[i - 1]) isSorted = false;
  }
  assert(isSorted, "Messages array is strictly chronological (oldest -> newest)");

  // =========================================================================
  // TEST SECTION 2: Active vs Non-Active Channel Unread Invariants
  // =========================================================================
  console.log("\n\x1b[36m[TEST 2] Active vs Non-Active Channel Unread Invariant\x1b[0m");
  store.reset();

  const activeChannel = "ch_active_101";
  const nonActiveChannel1 = "ch_silent_202";
  const nonActiveChannel2 = "ch_silent_303";

  // 2.1 Message arrives for ACTIVE channel
  const activeMsg1: Message = {
    id: "200000000000000001",
    channel_id: activeChannel,
    content: "Active message 1",
    type: 0,
    author: { id: "user_1", username: "alice" },
    created_at: new Date().toISOString(),
    edited_at: null,
    pinned: false,
  };
  store.handleMessageCreate(activeMsg1, activeChannel);

  const activeMsgs = useMessageStore.getState().messagesByChannel[activeChannel] || [];
  const activeUnread = useMessageStore.getState().unreadByChannel[activeChannel] || 0;
  assert(activeMsgs.length === 1, "Active channel feed appended message");
  assert(activeUnread === 0, "Active channel unread count remains 0");

  // 2.2 Message arrives for NON-ACTIVE channel (ch_silent_202)
  const silentMsg1: Message = {
    id: "200000000000000011",
    channel_id: nonActiveChannel1,
    content: "Silent channel message 1",
    type: 0,
    author: { id: "user_2", username: "bob" },
    created_at: new Date().toISOString(),
    edited_at: null,
    pinned: false,
  };
  store.handleMessageCreate(silentMsg1, activeChannel);

  let unreadCh1 = useMessageStore.getState().unreadByChannel[nonActiveChannel1] || 0;
  assert(unreadCh1 === 1, "Non-active channel unread count incremented to 1");

  // Second message to nonActiveChannel1
  const silentMsg2: Message = {
    id: "200000000000000012",
    channel_id: nonActiveChannel1,
    content: "Silent channel message 2",
    type: 0,
    author: { id: "user_2", username: "bob" },
    created_at: new Date().toISOString(),
    edited_at: null,
    pinned: false,
  };
  store.handleMessageCreate(silentMsg2, activeChannel);
  unreadCh1 = useMessageStore.getState().unreadByChannel[nonActiveChannel1] || 0;
  assert(unreadCh1 === 2, "Non-active channel unread count incremented to 2");

  // Message to another non-active channel (ch_silent_303)
  const silentMsg3: Message = {
    id: "200000000000000021",
    channel_id: nonActiveChannel2,
    content: "Third channel message 1",
    type: 0,
    author: { id: "user_3", username: "charlie" },
    created_at: new Date().toISOString(),
    edited_at: null,
    pinned: false,
  };
  store.handleMessageCreate(silentMsg3, activeChannel);
  const unreadCh2 = useMessageStore.getState().unreadByChannel[nonActiveChannel2] || 0;
  assert(unreadCh2 === 1, "Second non-active channel tracked independently (unread = 1)");
  assert(useMessageStore.getState().unreadByChannel[nonActiveChannel1] === 2, "First non-active channel unread preserved at 2");

  // 2.3 clearUnread(channelId) resets count
  store.clearUnread(nonActiveChannel1);
  assert(
    !useMessageStore.getState().unreadByChannel[nonActiveChannel1],
    "clearUnread(ch_silent_202) cleared unread count"
  );
  assert(
    useMessageStore.getState().unreadByChannel[nonActiveChannel2] === 1,
    "clearUnread did not affect other non-active channel"
  );

  // 2.4 Null / Undefined active channel increments unread
  const unreadWhenNoActiveChannelMsg: Message = {
    id: "200000000000000099",
    channel_id: activeChannel,
    content: "Message while user on DM/Overview",
    type: 0,
    author: { id: "user_1", username: "alice" },
    created_at: new Date().toISOString(),
    edited_at: null,
    pinned: false,
  };
  store.handleMessageCreate(unreadWhenNoActiveChannelMsg, null);
  assert(
    useMessageStore.getState().unreadByChannel[activeChannel] === 1,
    "Message with null activeChannelId increments unread count"
  );

  // =========================================================================
  // TEST SECTION 3: Message Edit & Delete Invariants
  // =========================================================================
  console.log("\n\x1b[36m[TEST 3] Message Edit & Delete Invariants\x1b[0m");
  store.reset();

  const editDeleteChannel = "ch_edit_delete";
  const origMsg1: Message = {
    id: "300000000000000001",
    channel_id: editDeleteChannel,
    content: "Original text before edit",
    type: 0,
    author: { id: "user_edit", username: "editor", global_name: "Editor User" },
    created_at: "2026-11-02T13:00:00Z",
    edited_at: null,
    pinned: false,
  };

  const origMsg2: Message = {
    id: "300000000000000002",
    channel_id: editDeleteChannel,
    content: "Second message intact",
    type: 0,
    author: { id: "user_other", username: "other" },
    created_at: "2026-11-02T13:01:00Z",
    edited_at: null,
    pinned: false,
  };

  store.handleMessageCreate(origMsg1, editDeleteChannel);
  store.handleMessageCreate(origMsg2, editDeleteChannel);

  // 3.1 MESSAGE_UPDATE in-place content and edited_at
  const editTimestamp = "2026-11-02T13:05:00Z";
  const updatedPayload: Message = {
    ...origMsg1,
    content: "New edited content!",
    edited_at: editTimestamp,
  };

  store.handleMessageUpdate(updatedPayload);
  let editMsgs = useMessageStore.getState().messagesByChannel[editDeleteChannel];
  assert(editMsgs.length === 2, "Message count unchanged after update");
  assert(editMsgs[0].id === origMsg1.id, "Target message remains at index 0");
  assert(editMsgs[0].content === "New edited content!", "Content updated in-place");
  assert(editMsgs[0].edited_at === editTimestamp, "edited_at updated in-place");
  assert(editMsgs[0].author.username === "editor", "Author profile preserved");
  assert(editMsgs[0].created_at === origMsg1.created_at, "created_at timestamp preserved");
  assert(editMsgs[1].content === "Second message intact", "Adjacent message undisturbed");

  // 3.2 MESSAGE_UPDATE for non-existent message is harmless
  const ghostMsg: Message = {
    id: "300000000000999999",
    channel_id: editDeleteChannel,
    content: "Ghost message",
    type: 0,
    author: { id: "user_ghost", username: "ghost" },
    created_at: new Date().toISOString(),
    edited_at: null,
    pinned: false,
  };
  store.handleMessageUpdate(ghostMsg);
  editMsgs = useMessageStore.getState().messagesByChannel[editDeleteChannel];
  assert(editMsgs.length === 2, "Non-existent message update is safe no-op");

  // 3.3 MESSAGE_DELETE with channel_id
  store.handleMessageDelete({ id: origMsg1.id, channel_id: editDeleteChannel });
  editMsgs = useMessageStore.getState().messagesByChannel[editDeleteChannel];
  assert(editMsgs.length === 1, "Target message removed from channel array");
  assert(editMsgs[0].id === origMsg2.id, "Remaining message intact");

  // 3.4 MESSAGE_DELETE without channel_id (scans all channels)
  store.handleMessageDelete({ id: origMsg2.id });
  editMsgs = useMessageStore.getState().messagesByChannel[editDeleteChannel];
  assert(editMsgs.length === 0, "Scan-all delete removed message successfully");

  // =========================================================================
  // TEST SECTION 4: Typing Indicator Expiration & Multi-User Tracking
  // =========================================================================
  console.log("\n\x1b[36m[TEST 4] Typing Indicator Expiration & Multi-User\x1b[0m");
  store.reset();

  const typingChannel = "ch_typing_test";

  // 4.1 Ingest TYPING_START with explicit username
  store.handleTypingStart({
    channel_id: typingChannel,
    user_id: "user_u1",
    username: "UserOne",
  });

  let typingUsers = useMessageStore.getState().typingByChannel[typingChannel] || [];
  assert(typingUsers.length === 1, "Single typing user registered");
  assert(typingUsers[0].userId === "user_u1", "User ID recorded");
  assert(typingUsers[0].username === "UserOne", "Explicit username recorded");
  assert(typingUsers[0].expiresAt > Date.now(), "expiresAt is set in future (~5000ms)");

  // 4.2 Ingest second TYPING_START from same user: should refresh expiry without duplicating
  const firstExpiry = typingUsers[0].expiresAt;
  // Sleep 10ms to ensure timestamp difference
  await new Promise((r) => setTimeout(r, 10));

  store.handleTypingStart({
    channel_id: typingChannel,
    user_id: "user_u1",
    username: "UserOne",
  });
  typingUsers = useMessageStore.getState().typingByChannel[typingChannel];
  assert(typingUsers.length === 1, "Consecutive typing from same user does NOT create duplicate");
  assert(typingUsers[0].expiresAt >= firstExpiry, "Expiry timestamp refreshed");

  // 4.3 Add a second user
  store.handleTypingStart({
    channel_id: typingChannel,
    user_id: "user_u2",
    username: "UserTwo",
  });
  typingUsers = useMessageStore.getState().typingByChannel[typingChannel];
  assert(typingUsers.length === 2, "Multiple concurrent typing users tracked in same channel");

  // 4.4 Username fallback resolution from cached message
  const cachedAuthorMsg: Message = {
    id: "400000000000000001",
    channel_id: typingChannel,
    content: "Prior message",
    type: 0,
    author: { id: "user_u3", username: "CachedUser3", global_name: "Sir Three" },
    created_at: new Date().toISOString(),
    edited_at: null,
    pinned: false,
  };
  store.handleMessageCreate(cachedAuthorMsg, typingChannel);

  // Ingest typing start for user_u3 with NO username provided
  store.handleTypingStart({
    channel_id: typingChannel,
    user_id: "user_u3",
  });
  typingUsers = useMessageStore.getState().typingByChannel[typingChannel];
  const user3Entry = typingUsers.find((u) => u.userId === "user_u3");
  assert(user3Entry !== undefined, "User 3 added to typing users");
  assert(user3Entry?.username === "Sir Three", "Resolved username from cached author global_name");

  // Ingest typing start for user_unknown with NO cached message -> fallback to "User <last4>"
  store.handleTypingStart({
    channel_id: typingChannel,
    user_id: "9988776655",
  });
  typingUsers = useMessageStore.getState().typingByStore?.[typingChannel] || useMessageStore.getState().typingByChannel[typingChannel];
  const unknownEntry = typingUsers.find((u) => u.userId === "9988776655");
  assert(unknownEntry?.username === "User 6655", "Fallback username correctly generated as 'User 6655'");

  // 4.5 Expiration cleanup: simulate 2 expired and 1 active user
  const now = Date.now();
  useMessageStore.setState({
    typingByChannel: {
      [typingChannel]: [
        { userId: "expired_1", username: "Ghost 1", expiresAt: now - 5000 },
        { userId: "active_1", username: "Live User", expiresAt: now + 4000 },
        { userId: "expired_2", username: "Ghost 2", expiresAt: now - 100 },
      ],
    },
  });

  store.cleanupExpiredTyping();
  typingUsers = useMessageStore.getState().typingByChannel[typingChannel] || [];
  assert(typingUsers.length === 1, "cleanupExpiredTyping purged both expired users");
  assert(typingUsers[0].userId === "active_1", "Active unexpired user preserved");

  // Clean up remaining user
  useMessageStore.setState({
    typingByChannel: {
      [typingChannel]: [
        { userId: "active_1", username: "Live User", expiresAt: now - 1 },
      ],
    },
  });
  store.cleanupExpiredTyping();
  assert(
    !useMessageStore.getState().typingByChannel[typingChannel],
    "cleanupExpiredTyping purged empty channel entry"
  );

  // =========================================================================
  // TEST SECTION 5: 64-bit Snowflake Precision Invariants (> 2^53)
  // =========================================================================
  console.log("\n\x1b[36m[TEST 5] 64-bit Snowflake Precision Invariants (> 2^53)\x1b[0m");
  store.reset();

  const snowflakeChannel = "ch_snowflake_test";

  // Critical IEEE-754 precision boundary:
  // Number.MAX_SAFE_INTEGER = 9007199254740991 (2^53 - 1)
  // In JavaScript:
  // 9007199254740992 === 9007199254740993 is TRUE if parsed as Numbers!
  const snowflakeA = "9007199254740992";
  const snowflakeB = "9007199254740993"; // Differs by 1 beyond safe integer!
  const snowflakeMax64 = "18446744073709551615"; // 2^64 - 1
  const snowflakeConcordEpoch = "1152921504606846976"; // 2^60 Concord Snowflake

  const msgPrecisionA: Message = {
    id: snowflakeA,
    channel_id: snowflakeChannel,
    content: "Precision message A",
    type: 0,
    author: { id: "9007199254740995", username: "userA" },
    created_at: "2026-11-02T14:00:00Z",
    edited_at: null,
    pinned: false,
  };

  const msgPrecisionB: Message = {
    id: snowflakeB,
    channel_id: snowflakeChannel,
    content: "Precision message B",
    type: 0,
    author: { id: "9007199254740996", username: "userB" },
    created_at: "2026-11-02T14:00:01Z",
    edited_at: null,
    pinned: false,
  };

  const msgMaxUint64: Message = {
    id: snowflakeMax64,
    channel_id: snowflakeChannel,
    content: "Max uint64 message",
    type: 0,
    author: { id: "9007199254740997", username: "userMax" },
    created_at: "2026-11-02T14:00:02Z",
    edited_at: null,
    pinned: false,
  };

  // 5.1 Ingest both adjacent > 2^53 snowflakes
  store.handleMessageCreate(msgPrecisionA, snowflakeChannel);
  store.handleMessageCreate(msgPrecisionB, snowflakeChannel);

  let pMsgs = useMessageStore.getState().messagesByChannel[snowflakeChannel] || [];
  assert(pMsgs.length === 2, "Adjacent > 2^53 snowflakes are treated as distinct messages");
  assert(pMsgs[0].id === snowflakeA, "First snowflake preserved verbatim as string: " + snowflakeA);
  assert(pMsgs[1].id === snowflakeB, "Second snowflake preserved verbatim as string: " + snowflakeB);
  assert(pMsgs[0].id !== pMsgs[1].id, "Snowflake string equality strictly preserved without IEEE-754 truncation");

  // 5.2 Max uint64 Snowflake
  store.handleMessageCreate(msgMaxUint64, snowflakeChannel);
  pMsgs = useMessageStore.getState().messagesByChannel[snowflakeChannel];
  assert(pMsgs.length === 3, "Max uint64 snowflake added to channel");
  assert(pMsgs[2].id === "18446744073709551615", "Max uint64 (18446744073709551615) stored verbatim");

  // 5.3 In-place update using exact snowflake string
  const updatePayloadB: Message = {
    ...msgPrecisionB,
    content: "Edited precision message B",
    edited_at: "2026-11-02T14:05:00Z",
  };
  store.handleMessageUpdate(updatePayloadB);
  pMsgs = useMessageStore.getState().messagesByChannel[snowflakeChannel];
  assert(pMsgs[0].content === "Precision message A", "Message A undisturbed");
  assert(pMsgs[1].content === "Edited precision message B", "Message B updated correctly");
  assert(pMsgs[1].id === snowflakeB, "Message B ID untouched");

  // 5.4 Deletion using exact snowflake string
  store.handleMessageDelete({ id: snowflakeB, channel_id: snowflakeChannel });
  pMsgs = useMessageStore.getState().messagesByChannel[snowflakeChannel];
  assert(pMsgs.length === 2, "Target snowflake message deleted");
  assert(pMsgs[0].id === snowflakeA, "Message A intact after deletion of B");
  assert(pMsgs[1].id === snowflakeMax64, "Message Max uint64 intact after deletion of B");

  // 5.5 Concord Epoch Snowflake
  const concordMsg: Message = {
    id: snowflakeConcordEpoch,
    channel_id: snowflakeChannel,
    content: "Concord epoch snowflake message",
    type: 0,
    author: { id: "user_concord", username: "concord_user" },
    created_at: "2026-11-02T14:10:00Z",
    edited_at: null,
    pinned: false,
  };
  store.handleMessageCreate(concordMsg, snowflakeChannel);
  pMsgs = useMessageStore.getState().messagesByChannel[snowflakeChannel];
  assert(pMsgs.some((m) => m.id === snowflakeConcordEpoch), "Concord epoch snowflake preserved verbatim");

  // =========================================================================
  // TEST SECTION 6: UI Component Invariants (Formatting & State Logic)
  // =========================================================================
  console.log("\n\x1b[36m[TEST 6] Chat UI Component Invariants & Edge Cases\x1b[0m");

  // 6.1 Typing Indicator Text Generation Logic
  function generateTypingText(otherTyping: Array<{ username: string }>): string {
    if (otherTyping.length === 0) return "";
    if (otherTyping.length === 1) return `${otherTyping[0].username} is typing...`;
    if (otherTyping.length === 2) return `${otherTyping[0].username} and ${otherTyping[1].username} are typing...`;
    if (otherTyping.length === 3) return `${otherTyping[0].username}, ${otherTyping[1].username}, and ${otherTyping[2].username} are typing...`;
    return "Several people are typing...";
  }

  assert(generateTypingText([]) === "", "Empty typing users produces empty text");
  assert(generateTypingText([{ username: "Alice" }]) === "Alice is typing...", "1 user formatting matches Discord spec");
  assert(generateTypingText([{ username: "Alice" }, { username: "Bob" }]) === "Alice and Bob are typing...", "2 users formatting matches Discord spec");
  assert(
    generateTypingText([{ username: "Alice" }, { username: "Bob" }, { username: "Charlie" }]) ===
      "Alice, Bob, and Charlie are typing...",
    "3 users formatting includes Oxford comma"
  );
  assert(
    generateTypingText([{ username: "Alice" }, { username: "Bob" }, { username: "Charlie" }, { username: "Dave" }]) ===
      "Several people are typing...",
    "4+ users formatting displays 'Several people are typing...'"
  );

  // 6.2 Channel Unread Pill & Badge Logic
  function getChannelBadgeState(channelId: string, activeId: string | null, unreads: Record<string, number>) {
    const isActive = channelId === activeId;
    const count = unreads[channelId] || 0;
    const hasUnread = count > 0 && !isActive;
    return { isActive, count, hasUnread };
  }

  const s1 = getChannelBadgeState("c1", "c1", { c1: 5 });
  assert(!s1.hasUnread, "Active channel does not display unread badge even if unread count > 0");

  const s2 = getChannelBadgeState("c2", "c1", { c2: 3 });
  assert(s2.hasUnread && s2.count === 3, "Inactive channel displays unread badge with exact count of 3");

  const s3 = getChannelBadgeState("c3", "c1", {});
  assert(!s3.hasUnread && s3.count === 0, "Inactive channel with 0 unread displays no badge");

  // =========================================================================
  // TEST SECTION 7: Historical Pagination & REST Invariants (Mocked API)
  // =========================================================================
  console.log("\n\x1b[36m[TEST 7] Historical Pagination & REST API Invariants\x1b[0m");
  const { api } = await import("../src/api/client");
  store.reset();

  const paginationChannel = "ch_paging_test";

  // Mock api.messages.list
  const originalApiMessagesList = api.messages.list;
  let mockListHandler: (channelId: string, before?: string, limit?: number) => Promise<Message[]> = async () => [];
  api.messages.list = (chId: string, before?: string, limit?: number) => mockListHandler(chId, before, limit);

  try {
    // 7.1 Initial fetch: 50 messages
    const mock50Batch: Message[] = Array.from({ length: 50 }, (_, i) => ({
      id: `5000000000000000${String(i).padStart(2, "0")}`,
      channel_id: paginationChannel,
      content: `Message #${i}`,
      type: 0,
      author: { id: "user_p", username: "paginator" },
      created_at: new Date(1762041600000 + i * 1000).toISOString(),
      edited_at: null,
      pinned: false,
    }));

    mockListHandler = async (_chId, before) => {
      if (!before) {
        return mock50Batch;
      }
      return [];
    };

    await store.fetchInitialMessages(paginationChannel);
    let pagedMsgs = useMessageStore.getState().messagesByChannel[paginationChannel] || [];
    assert(pagedMsgs.length === 50, "Initial fetch loaded 50 messages");
    assert(useMessageStore.getState().hasMoreByChannel[paginationChannel] === true, "hasMoreByChannel is true when exactly 50 messages returned");

    // 7.2 Older fetch with pagination and deduplication
    // Return 20 older messages, plus 2 overlapping messages already in store
    const mockOlderBatch: Message[] = Array.from({ length: 20 }, (_, i) => ({
      id: `4000000000000000${String(i).padStart(2, "0")}`,
      channel_id: paginationChannel,
      content: `Older Message #${i}`,
      type: 0,
      author: { id: "user_p", username: "paginator" },
      created_at: new Date(1762041600000 - (20 - i) * 1000).toISOString(),
      edited_at: null,
      pinned: false,
    }));
    // Overlapping message
    mockOlderBatch.push(pagedMsgs[0]);

    mockListHandler = async (_chId, before) => {
      if (before === pagedMsgs[0].id) {
        return mockOlderBatch;
      }
      return [];
    };

    await store.fetchOlderMessages(paginationChannel);
    pagedMsgs = useMessageStore.getState().messagesByChannel[paginationChannel] || [];
    assert(pagedMsgs.length === 70, "Older fetch prepended 20 unique messages without duplicating overlapping message");
    assert(pagedMsgs[0].id === mockOlderBatch[0].id, "Oldest message is now at index 0");
    assert(useMessageStore.getState().hasMoreByChannel[paginationChannel] === false, "hasMoreByChannel is false when < 50 messages returned");

    // Verify overall chronological ordering after pagination prepending
    let isPagingSorted = true;
    for (let i = 1; i < pagedMsgs.length; i++) {
      const prev = new Date(pagedMsgs[i - 1].created_at).getTime();
      const curr = new Date(pagedMsgs[i].created_at).getTime();
      if (curr < prev) isPagingSorted = false;
    }
    assert(isPagingSorted, "Combined feed remains strictly chronological after prepending older batch");
  } finally {
    api.messages.list = originalApiMessagesList;
  }

  // =========================================================================
  // TEST SECTION 8: High-Volume Stress & Rapid Interleaved Mutation
  // =========================================================================
  console.log("\n\x1b[36m[TEST 8] High-Volume Stress & Rapid Interleaved Mutation\x1b[0m");
  store.reset();

  const stressChannel = "ch_stress_test";
  const numMessages = 500;
  const startTime = Date.now();

  // Burst ingest 500 messages with interleaved updates, deletes, and duplicate replays
  for (let i = 0; i < numMessages; i++) {
    const msg: Message = {
      id: `80000000000000${String(i).padStart(4, "0")}`,
      channel_id: stressChannel,
      content: `Stress message ${i}`,
      type: 0,
      author: { id: `u_${i % 10}`, username: `user_${i % 10}` },
      created_at: new Date(1762041600000 + i * 100).toISOString(),
      edited_at: null,
      pinned: false,
    };
    store.handleMessageCreate(msg, stressChannel);

    // Every 50 messages, perform in-place update on previous message
    if (i > 0 && i % 50 === 0) {
      const prevId = `80000000000000${String(i - 1).padStart(4, "0")}`;
      store.handleMessageUpdate({
        id: prevId,
        channel_id: stressChannel,
        content: `Updated stress message ${i - 1}`,
        edited_at: new Date().toISOString(),
        author: { id: `u_${(i - 1) % 10}`, username: `user_${(i - 1) % 10}` },
        type: 0,
        pinned: false,
        created_at: new Date(1762041600000 + (i - 1) * 100).toISOString(),
      });
    }

    // Every 100 messages, replay duplicate
    if (i > 0 && i % 100 === 0) {
      store.handleMessageCreate(msg, stressChannel);
    }
  }

  const elapsedMs = Date.now() - startTime;
  let stressMsgs = useMessageStore.getState().messagesByChannel[stressChannel] || [];
  assert(stressMsgs.length === numMessages, `Ingested ${numMessages} messages under ${elapsedMs}ms without duplication`);

  // Delete 50 messages in rapid succession
  for (let i = 0; i < 50; i++) {
    const delId = `80000000000000${String(i * 10).padStart(4, "0")}`;
    store.handleMessageDelete({ id: delId, channel_id: stressChannel });
  }

  stressMsgs = useMessageStore.getState().messagesByChannel[stressChannel] || [];
  assert(stressMsgs.length === numMessages - 50, "Successfully purged 50 interleaved messages (count = 450)");

  // Clean reset check
  store.reset();
  assert(Object.keys(useMessageStore.getState().messagesByChannel).length === 0, "Store reset cleared all channels");
  assert(Object.keys(useMessageStore.getState().unreadByChannel).length === 0, "Store reset cleared all unreads");
  assert(Object.keys(useMessageStore.getState().typingByChannel).length === 0, "Store reset cleared all typing states");

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log("\n=======================================================");
  console.log(`TOTAL ADVERSARIAL TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log("=======================================================\n");

  if (failures.length > 0) {
    console.error("FAILURES:");
    failures.forEach((f) => console.error("  " + f));
    process.exit(1);
  }
}

runAdversarialTests().catch((err) => {
  console.error("Adversarial test execution error:", err);
  process.exit(1);
});
