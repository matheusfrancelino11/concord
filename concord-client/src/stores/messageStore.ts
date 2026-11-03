import { create } from "zustand";
import { Message } from "../types";
import { api, ApiError } from "../api/client";
import { useGuildStore } from "./guildStore";
import { useRelationshipStore } from "./relationshipStore";
import { useDMStore } from "./dmStore";

export interface TypingUser {
  userId: string;
  username: string;
  expiresAt: number;
}

export interface MessageState {
  // Messages keyed by channel ID in chronological order (oldest -> newest)
  messagesByChannel: Record<string, Message[]>;
  isLoadingByChannel: Record<string, boolean>;
  isLoadingOlderByChannel: Record<string, boolean>;
  hasMoreByChannel: Record<string, boolean>;

  // Unread badge count for non-active channels
  unreadByChannel: Record<string, number>;

  // Active typing users per channel
  typingByChannel: Record<string, TypingUser[]>;

  // Error state
  error: string | null;

  // Actions
  fetchMessages: (channelId: string, before?: string) => Promise<void>;
  fetchInitialMessages: (channelId: string) => Promise<void>;
  fetchOlderMessages: (channelId: string) => Promise<void>;
  sendMessage: (channelId: string, content: string, replyToId?: string) => Promise<Message>;
  editMessage: (channelId: string, messageId: string, content: string) => Promise<Message>;
  deleteMessage: (channelId: string, messageId: string) => Promise<void>;
  sendTyping: (channelId: string) => Promise<void>;
  clearUnread: (channelId: string) => void;

  // Gateway event ingestion reducers
  handleMessageCreate: (message: Message, activeChannelId?: string | null) => void;
  handleMessageUpdate: (message: Message) => void;
  handleMessageDelete: (payload: { id: string; channel_id?: string; channelId?: string }) => void;
  handleTypingStart: (payload: {
    channel_id?: string;
    channelId?: string;
    user_id?: string;
    userId?: string;
    username?: string;
  }) => void;
  cleanupExpiredTyping: () => void;
  reset: () => void;
}

/**
 * Helper to sort messages chronologically (oldest -> newest)
 */
function sortMessagesChronologically(messages: Message[]): Message[] {
  return [...messages].sort((a, b) => {
    // Primary: created_at timestamp
    const timeA = new Date(a.created_at).getTime();
    const timeB = new Date(b.created_at).getTime();
    if (timeA !== timeB) return timeA - timeB;
    // Secondary: Snowflake ID comparison
    return a.id.localeCompare(b.id);
  });
}

export const useMessageStore = create<MessageState>((set, get) => ({
  messagesByChannel: {},
  isLoadingByChannel: {},
  isLoadingOlderByChannel: {},
  hasMoreByChannel: {},
  unreadByChannel: {},
  typingByChannel: {},
  error: null,

  fetchMessages: async (channelId: string, before?: string) => {
    if (!channelId) return;

    if (before) {
      set((state) => ({
        isLoadingOlderByChannel: { ...state.isLoadingOlderByChannel, [channelId]: true },
        error: null,
      }));
    } else {
      set((state) => ({
        isLoadingByChannel: { ...state.isLoadingByChannel, [channelId]: true },
        error: null,
      }));
    }

    try {
      const fetched = await api.messages.list(channelId, before, 50);
      const sorted = sortMessagesChronologically(fetched);

      set((state) => {
        const currentMessages = state.messagesByChannel[channelId] || [];
        let combined: Message[];

        if (before) {
          // Prepend older messages and filter out duplicates
          const existingIds = new Set(currentMessages.map((m) => m.id));
          const uniqueOlder = sorted.filter((m) => !existingIds.has(m.id));
          combined = [...uniqueOlder, ...currentMessages];
        } else {
          // Initial or refresh load
          combined = sorted;
        }

        return {
          messagesByChannel: {
            ...state.messagesByChannel,
            [channelId]: combined,
          },
          hasMoreByChannel: {
            ...state.hasMoreByChannel,
            [channelId]: fetched.length === 50,
          },
          isLoadingByChannel: {
            ...state.isLoadingByChannel,
            [channelId]: false,
          },
          isLoadingOlderByChannel: {
            ...state.isLoadingOlderByChannel,
            [channelId]: false,
          },
        };
      });
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : "Failed to load messages";
      set((state) => ({
        isLoadingByChannel: { ...state.isLoadingByChannel, [channelId]: false },
        isLoadingOlderByChannel: { ...state.isLoadingOlderByChannel, [channelId]: false },
        error: msg,
      }));
      throw err;
    }
  },

  fetchInitialMessages: async (channelId: string) => {
    return get().fetchMessages(channelId);
  },

  fetchOlderMessages: async (channelId: string) => {
    const channelMsgs = get().messagesByChannel[channelId] || [];
    if (channelMsgs.length === 0) {
      return get().fetchMessages(channelId);
    }
    const oldestId = channelMsgs[0].id;
    return get().fetchMessages(channelId, oldestId);
  },

  sendMessage: async (channelId: string, content: string, replyToId?: string) => {
    try {
      const msg = await api.messages.create(channelId, content, replyToId);
      // Immediately reflect in store
      get().handleMessageCreate(msg, channelId);
      return msg;
    } catch (err: unknown) {
      const errorMsg = err instanceof ApiError ? err.message : "Failed to send message";
      set({ error: errorMsg });
      throw err;
    }
  },

  editMessage: async (channelId: string, messageId: string, content: string) => {
    try {
      const updated = await api.messages.edit(channelId, messageId, content);
      get().handleMessageUpdate(updated);
      return updated;
    } catch (err: unknown) {
      const errorMsg = err instanceof ApiError ? err.message : "Failed to edit message";
      set({ error: errorMsg });
      throw err;
    }
  },

  deleteMessage: async (channelId: string, messageId: string) => {
    try {
      await api.messages.delete(channelId, messageId);
      get().handleMessageDelete({ id: messageId, channelId });
    } catch (err: unknown) {
      const errorMsg = err instanceof ApiError ? err.message : "Failed to delete message";
      set({ error: errorMsg });
      throw err;
    }
  },

  sendTyping: async (channelId: string) => {
    try {
      await api.channels.typing(channelId);
    } catch {
      // Ephemeral typing failure is non-fatal
    }
  },

  clearUnread: (channelId: string) => {
    set((state) => {
      if (!state.unreadByChannel[channelId]) return state;
      const nextUnread = { ...state.unreadByChannel };
      delete nextUnread[channelId];
      return { unreadByChannel: nextUnread };
    });
  },

  handleMessageCreate: (message: Message, activeChannelId?: string | null) => {
    const channelId = message.channel_id;
    if (!channelId) return;

    set((state) => {
      const current = state.messagesByChannel[channelId] || [];
      const existingIdx = current.findIndex((m) => m.id === message.id);

      let nextList: Message[];
      if (existingIdx >= 0) {
        // In-place update / deduplicate
        nextList = [...current];
        nextList[existingIdx] = message;
      } else {
        // Append new message
        nextList = [...current, message];
      }

      // If message is in non-active channel, increment unread count
      const isCurrentChannel =
        activeChannelId !== undefined && activeChannelId !== null
          ? channelId === activeChannelId
          : false;

      let nextUnread = state.unreadByChannel;
      if (!isCurrentChannel) {
        nextUnread = {
          ...state.unreadByChannel,
          [channelId]: (state.unreadByChannel[channelId] || 0) + 1,
        };
      }

      return {
        messagesByChannel: {
          ...state.messagesByChannel,
          [channelId]: nextList,
        },
        unreadByChannel: nextUnread,
      };
    });
  },

  handleMessageUpdate: (message: Message) => {
    const channelId = message.channel_id;
    if (!channelId) return;

    set((state) => {
      const current = state.messagesByChannel[channelId];
      if (!current) return state;

      const idx = current.findIndex((m) => m.id === message.id);
      if (idx === -1) return state;

      const updated = [...current];
      updated[idx] = { ...updated[idx], ...message };

      return {
        messagesByChannel: {
          ...state.messagesByChannel,
          [channelId]: updated,
        },
      };
    });
  },

  handleMessageDelete: (payload: { id: string; channel_id?: string; channelId?: string }) => {
    const messageId = payload.id;
    const targetChannelId = payload.channel_id || payload.channelId;

    set((state) => {
      if (targetChannelId && state.messagesByChannel[targetChannelId]) {
        const filtered = state.messagesByChannel[targetChannelId].filter(
          (m) => m.id !== messageId
        );
        return {
          messagesByChannel: {
            ...state.messagesByChannel,
            [targetChannelId]: filtered,
          },
        };
      }

      // If channel ID not provided, scan all channels
      let modified = false;
      const nextMap: Record<string, Message[]> = {};
      for (const [chId, msgs] of Object.entries(state.messagesByChannel)) {
        const filtered = msgs.filter((m) => m.id !== messageId);
        if (filtered.length !== msgs.length) {
          modified = true;
        }
        nextMap[chId] = filtered;
      }

      return modified ? { messagesByChannel: nextMap } : state;
    });
  },

  handleTypingStart: (payload: {
    channel_id?: string;
    channelId?: string;
    user_id?: string;
    userId?: string;
    username?: string;
    global_name?: string;
  }) => {
    const channelId = payload.channel_id || payload.channelId;
    const userId = payload.user_id || payload.userId;
    if (!channelId || !userId) return;

    // Resolve user's actual display name
    let username = payload.global_name || payload.username;

    if (!username) {
      // 1. Try finding in server members (for guild nick or global name)
      const allMembers = useGuildStore.getState().membersByGuild;
      for (const members of Object.values(allMembers)) {
        const found = members.find((m) => m.user_id === userId);
        if (found) {
          username = found.nick || found.user?.global_name || found.user?.username;
          if (username) break;
        }
      }
    }

    if (!username) {
      // 2. Try finding in friend relationships
      const rels = useRelationshipStore.getState().relationships;
      const foundRel = rels.find((r) => r.user?.id === userId || r.id === userId);
      if (foundRel && foundRel.user) {
        username = foundRel.user.global_name || foundRel.user.username;
      }
    }

    if (!username) {
      // 3. Try finding in DM channels
      const dms = useDMStore.getState().dmChannels;
      for (const dm of dms) {
        const recip = (dm.recipients || []).find((u) => u.id === userId);
        if (recip) {
          username = recip.global_name || recip.username;
          if (username) break;
        }
      }
    }

    if (!username) {
      // 4. Try finding in cached messages
      const cachedMsgs = get().messagesByChannel[channelId] || [];
      const userMsg = cachedMsgs.find((m) => m.author && m.author.id === userId);
      if (userMsg && userMsg.author) {
        username = userMsg.author.global_name || userMsg.author.username;
      }
    }

    if (!username) {
      username = payload.username || "Alguém";
    }

    const expiresAt = Date.now() + 5000;

    set((state) => {
      const currentTyping = state.typingByChannel[channelId] || [];
      const filtered = currentTyping.filter((u) => u.userId !== userId);
      return {
        typingByChannel: {
          ...state.typingByChannel,
          [channelId]: [...filtered, { userId, username, expiresAt }],
        },
      };
    });
  },

  cleanupExpiredTyping: () => {
    const now = Date.now();
    set((state) => {
      let changed = false;
      const nextTyping: Record<string, TypingUser[]> = {};

      for (const [chId, users] of Object.entries(state.typingByChannel)) {
        const active = users.filter((u) => u.expiresAt > now);
        if (active.length !== users.length) {
          changed = true;
        }
        if (active.length > 0) {
          nextTyping[chId] = active;
        }
      }

      return changed ? { typingByChannel: nextTyping } : state;
    });
  },

  reset: () => {
    set({
      messagesByChannel: {},
      isLoadingByChannel: {},
      isLoadingOlderByChannel: {},
      hasMoreByChannel: {},
      unreadByChannel: {},
      typingByChannel: {},
      error: null,
    });
  },
}));
