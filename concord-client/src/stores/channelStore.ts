import { create } from "zustand";
import { Channel, ChannelType, CreateChannelPayload } from "../types";
import { api, ApiError } from "../api/client";

export interface ChannelState {
  channels: Channel[];
  channelsByGuild: Record<string, Channel[]>;
  activeChannelId: string | null;
  selectedChannelId: string | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchChannels: (guildId: string) => Promise<Channel[]>;
  selectChannel: (channelId: string) => void;
  createChannel: (guildId: string, payload: CreateChannelPayload) => Promise<Channel>;
  deleteChannel: (channelId: string, guildId?: string) => Promise<void>;
  setChannels: (channels: Channel[], guildId?: string) => void;
  clearError: () => void;
  reset: () => void;
}

export const useChannelStore = create<ChannelState>((set, get) => ({
  channels: [],
  channelsByGuild: {},
  activeChannelId: null,
  selectedChannelId: null,
  isLoading: false,
  error: null,

  fetchChannels: async (guildId: string): Promise<Channel[]> => {
    set({ isLoading: true, error: null });
    try {
      const channels = await api.channels.list(guildId);

      // Auto-selection heuristic:
      // 1. If currently selected channel is in new channel list, keep it.
      // 2. Otherwise prefer `#geral` text channel.
      // 3. Otherwise prefer first text channel (type === 0).
      // 4. Otherwise first channel.
      const currentActive = get().selectedChannelId || get().activeChannelId;
      const channelExists = channels.some((c) => c.id === currentActive);

      let nextActiveId: string | null = null;
      if (channelExists) {
        nextActiveId = currentActive;
      } else if (channels.length > 0) {
        const geralChannel = channels.find((c) => c.type === ChannelType.TEXT && c.name === "geral");
        const firstText = channels.find((c) => c.type === ChannelType.TEXT);
        nextActiveId = geralChannel?.id || firstText?.id || channels[0].id;
      }

      set((state) => ({
        channels,
        channelsByGuild: {
          ...state.channelsByGuild,
          [guildId]: channels,
        },
        activeChannelId: nextActiveId,
        selectedChannelId: nextActiveId,
        isLoading: false,
        error: null,
      }));

      return channels;
    } catch (err: unknown) {
      const message = err instanceof ApiError ? err.message : "Failed to load channels";
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  selectChannel: (channelId: string) => {
    set({
      activeChannelId: channelId,
      selectedChannelId: channelId,
    });
  },

  createChannel: async (guildId: string, payload: CreateChannelPayload): Promise<Channel> => {
    set({ isLoading: true, error: null });
    try {
      const newChannel = await api.channels.create(guildId, payload);

      set((state) => {
        const guildChannels = state.channelsByGuild[guildId] || state.channels || [];
        const updated = [...guildChannels, newChannel];

        // If creating a text channel, immediately select it as active
        const nextActiveId =
          newChannel.type === ChannelType.TEXT ? newChannel.id : state.selectedChannelId;

        return {
          channels: updated,
          channelsByGuild: {
            ...state.channelsByGuild,
            [guildId]: updated,
          },
          activeChannelId: nextActiveId,
          selectedChannelId: nextActiveId,
          isLoading: false,
          error: null,
        };
      });

      return newChannel;
    } catch (err: unknown) {
      const message = err instanceof ApiError ? err.message : "Failed to create channel";
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  deleteChannel: async (channelId: string, guildId?: string) => {
    set({ isLoading: true, error: null });
    try {
      await api.channels.delete(channelId);

      set((state) => {
        const targetGuildId =
          guildId ||
          Object.keys(state.channelsByGuild).find((gid) =>
            state.channelsByGuild[gid]?.some((c) => c.id === channelId)
          );

        const currentChannels = targetGuildId
          ? state.channelsByGuild[targetGuildId] || []
          : state.channels;

        const remaining = currentChannels.filter((c) => c.id !== channelId);
        const wasActive =
          state.selectedChannelId === channelId || state.activeChannelId === channelId;

        let nextActiveId = state.selectedChannelId;
        if (wasActive) {
          const geral = remaining.find((c) => c.type === ChannelType.TEXT && c.name === "geral");
          const firstText = remaining.find((c) => c.type === ChannelType.TEXT);
          nextActiveId = geral?.id || firstText?.id || (remaining[0]?.id || null);
        }

        const newChannelsByGuild = targetGuildId
          ? { ...state.channelsByGuild, [targetGuildId]: remaining }
          : state.channelsByGuild;

        return {
          channels: remaining,
          channelsByGuild: newChannelsByGuild,
          activeChannelId: nextActiveId,
          selectedChannelId: nextActiveId,
          isLoading: false,
          error: null,
        };
      });
    } catch (err: unknown) {
      const message = err instanceof ApiError ? err.message : "Failed to delete channel";
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  setChannels: (channels: Channel[], guildId?: string) => {
    const geral = channels.find((c) => c.type === ChannelType.TEXT && c.name === "geral");
    const firstText = channels.find((c) => c.type === ChannelType.TEXT);
    const nextActiveId = geral?.id || firstText?.id || (channels[0]?.id || null);

    set((state) => ({
      channels,
      channelsByGuild: guildId
        ? { ...state.channelsByGuild, [guildId]: channels }
        : state.channelsByGuild,
      activeChannelId: nextActiveId,
      selectedChannelId: nextActiveId,
      isLoading: false,
      error: null,
    }));
  },

  clearError: () => set({ error: null }),

  reset: () => {
    set({
      channels: [],
      channelsByGuild: {},
      activeChannelId: null,
      selectedChannelId: null,
      isLoading: false,
      error: null,
    });
  },
}));
