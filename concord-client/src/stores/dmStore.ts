import { create } from "zustand";
import { Channel, User } from "../types";
import { api } from "../api/client";

export interface DMState {
  dmChannels: Channel[];
  selectedDMChannelId: string | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchDMs: () => Promise<Channel[]>;
  openDM: (recipientId: string) => Promise<Channel>;
  closeDM: (channelId: string) => Promise<void>;
  selectDMChannel: (channelId: string | null) => void;
  getRecipient: (channel: Channel, currentUserId?: string) => User | undefined;
}

export const useDMStore = create<DMState>((set, get) => ({
  dmChannels: [],
  selectedDMChannelId: null,
  isLoading: false,
  error: null,

  fetchDMs: async () => {
    set({ isLoading: true, error: null });
    try {
      const dms = await api.channels.listDMs();
      set({ dmChannels: dms, isLoading: false });
      return dms;
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : "Failed to load direct messages",
      });
      return [];
    }
  },

  openDM: async (recipientId: string) => {
    set({ isLoading: true, error: null });
    try {
      const channel = await api.channels.createDM(recipientId);
      set((state) => {
        const existing = state.dmChannels.find((c) => c.id === channel.id);
        const nextList = existing
          ? state.dmChannels.map((c) => (c.id === channel.id ? channel : c))
          : [channel, ...state.dmChannels];
        return {
          dmChannels: nextList,
          selectedDMChannelId: channel.id,
          isLoading: false,
        };
      });
      return channel;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to open direct message";
      set({ isLoading: false, error: msg });
      throw err;
    }
  },

  closeDM: async (channelId: string) => {
    set((state) => {
      const nextList = state.dmChannels.filter((c) => c.id !== channelId);
      const nextSelected =
        state.selectedDMChannelId === channelId
          ? null
          : state.selectedDMChannelId;
      return {
        dmChannels: nextList,
        selectedDMChannelId: nextSelected,
      };
    });
  },

  selectDMChannel: (channelId: string | null) => {
    set({ selectedDMChannelId: channelId });
  },

  getRecipient: (channel: Channel, currentUserId?: string): User | undefined => {
    if (!channel.recipients || channel.recipients.length === 0) return undefined;
    return channel.recipients.find((u) => u.id !== currentUserId) || channel.recipients[0];
  },
}));
