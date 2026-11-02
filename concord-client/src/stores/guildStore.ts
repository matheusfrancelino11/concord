import { create } from "zustand";
import { Guild, GuildDetail, CreateGuildPayload } from "../types";
import { api, ApiError } from "../api/client";
import { useChannelStore } from "./channelStore";

export interface GuildState {
  guilds: Guild[];
  activeGuildId: string | null;
  selectedGuildId: string | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchGuilds: () => Promise<void>;
  selectGuild: (guildId: string) => void;
  createGuild: (payload: CreateGuildPayload) => Promise<GuildDetail>;
  deleteGuild: (guildId: string) => Promise<void>;
  clearError: () => void;
  reset: () => void;
}

export const useGuildStore = create<GuildState>((set, get) => ({
  guilds: [],
  activeGuildId: null,
  selectedGuildId: null,
  isLoading: false,
  error: null,

  fetchGuilds: async () => {
    set({ isLoading: true, error: null });
    try {
      const guilds = await api.guilds.list();
      const currentActiveId = get().selectedGuildId || get().activeGuildId;

      let nextActiveId: string | null = null;
      if (guilds.length > 0) {
        const stillExists = guilds.some((g) => g.id === currentActiveId);
        nextActiveId = stillExists ? currentActiveId : guilds[0].id;
      }

      set({
        guilds,
        activeGuildId: nextActiveId,
        selectedGuildId: nextActiveId,
        isLoading: false,
        error: null,
      });

      // Synchronize channels for the selected guild
      if (nextActiveId) {
        useChannelStore.getState().fetchChannels(nextActiveId);
      } else {
        useChannelStore.getState().reset();
      }
    } catch (err: unknown) {
      const message = err instanceof ApiError ? err.message : "Failed to load servers";
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  selectGuild: (guildId: string) => {
    if (get().selectedGuildId === guildId) return;

    set({
      activeGuildId: guildId,
      selectedGuildId: guildId,
    });

    // Fetch channels for newly selected guild
    if (guildId) {
      useChannelStore.getState().fetchChannels(guildId);
    } else {
      useChannelStore.getState().reset();
    }
  },

  createGuild: async (payload: CreateGuildPayload): Promise<GuildDetail> => {
    set({ isLoading: true, error: null });
    try {
      const newGuild = await api.guilds.create(payload);

      const summaryGuild: Guild = {
        id: newGuild.id,
        name: newGuild.name,
        icon: newGuild.icon,
        owner_id: newGuild.owner_id,
        created_at: newGuild.created_at,
      };

      set((state) => ({
        guilds: [...state.guilds, summaryGuild],
        activeGuildId: newGuild.id,
        selectedGuildId: newGuild.id,
        isLoading: false,
        error: null,
      }));

      // Invariant: Backend automatically created `#geral` and `@everyone`.
      // Synchronize channelStore directly from newGuild.channels!
      if (newGuild.channels && newGuild.channels.length > 0) {
        useChannelStore.getState().setChannels(newGuild.channels, newGuild.id);
      } else {
        useChannelStore.getState().fetchChannels(newGuild.id);
      }

      return newGuild;
    } catch (err: unknown) {
      const message = err instanceof ApiError ? err.message : "Failed to create server";
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  deleteGuild: async (guildId: string) => {
    set({ isLoading: true, error: null });
    try {
      await api.guilds.delete(guildId);

      const remainingGuilds = get().guilds.filter((g) => g.id !== guildId);
      const wasActive =
        get().selectedGuildId === guildId || get().activeGuildId === guildId;
      const nextActiveId = wasActive
        ? remainingGuilds[0]?.id || null
        : get().selectedGuildId;

      set({
        guilds: remainingGuilds,
        activeGuildId: nextActiveId,
        selectedGuildId: nextActiveId,
        isLoading: false,
        error: null,
      });

      if (nextActiveId) {
        useChannelStore.getState().fetchChannels(nextActiveId);
      } else {
        useChannelStore.getState().reset();
      }
    } catch (err: unknown) {
      const message = err instanceof ApiError ? err.message : "Failed to delete server";
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  clearError: () => set({ error: null }),

  reset: () => {
    set({
      guilds: [],
      activeGuildId: null,
      selectedGuildId: null,
      isLoading: false,
      error: null,
    });
  },
}));
