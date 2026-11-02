import { create } from "zustand";
import { Guild, GuildDetail, CreateGuildPayload, Member } from "../types";
import { api, ApiError } from "../api/client";
import { useChannelStore } from "./channelStore";

export const EMPTY_MEMBERS: Member[] = [];

export interface GuildState {
  guilds: Guild[];
  activeGuildId: string | null;
  selectedGuildId: string | null;
  membersByGuild: Record<string, Member[]>;
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchGuilds: () => Promise<void>;
  selectGuild: (guildId: string) => void;
  createGuild: (payload: CreateGuildPayload) => Promise<GuildDetail>;
  deleteGuild: (guildId: string) => Promise<void>;
  joinGuildWithInvite: (code: string) => Promise<GuildDetail>;
  fetchMembers: (guildId: string) => Promise<void>;
  setMembers: (guildId: string, members: Member[]) => void;
  addMember: (guildId: string, member: Member) => void;
  addGuildFromGateway: (guild: GuildDetail) => void;
  clearError: () => void;
  reset: () => void;
}

export const useGuildStore = create<GuildState>((set, get) => ({
  guilds: [],
  activeGuildId: null,
  selectedGuildId: null,
  membersByGuild: {},
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

      // Synchronize channels and members for the selected guild
      if (nextActiveId) {
        useChannelStore.getState().fetchChannels(nextActiveId);
        get().fetchMembers(nextActiveId);
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

    // Fetch channels and members for newly selected guild
    if (guildId) {
      useChannelStore.getState().fetchChannels(guildId);
      get().fetchMembers(guildId);
    } else {
      useChannelStore.getState().reset();
    }
  },

  fetchMembers: async (guildId: string) => {
    try {
      const members = await api.members.list(guildId);
      set((state) => ({
        membersByGuild: {
          ...state.membersByGuild,
          [guildId]: members || EMPTY_MEMBERS,
        },
      }));
    } catch (err) {
      console.error(`[guildStore] Failed to fetch members for guild ${guildId}:`, err);
    }
  },

  setMembers: (guildId: string, members: Member[]) => {
    set((state) => ({
      membersByGuild: {
        ...state.membersByGuild,
        [guildId]: members || EMPTY_MEMBERS,
      },
    }));
  },

  addMember: (guildId: string, member: Member) => {
    set((state) => {
      const current = state.membersByGuild[guildId] || EMPTY_MEMBERS;
      if (current.some((m) => m.user_id === member.user_id)) {
        return state;
      }
      return {
        membersByGuild: {
          ...state.membersByGuild,
          [guildId]: [...current, member],
        },
      };
    });
  },

  joinGuildWithInvite: async (code: string): Promise<GuildDetail> => {
    set({ isLoading: true, error: null });
    try {
      const guild = await api.invites.use(code);

      const summaryGuild: Guild = {
        id: guild.id,
        name: guild.name,
        icon: guild.icon,
        owner_id: guild.owner_id,
        created_at: guild.created_at,
      };

      set((state) => {
        const alreadyInList = state.guilds.some((g) => g.id === guild.id);
        const nextGuilds = alreadyInList ? state.guilds : [...state.guilds, summaryGuild];
        return {
          guilds: nextGuilds,
          activeGuildId: guild.id,
          selectedGuildId: guild.id,
          membersByGuild: {
            ...state.membersByGuild,
            [guild.id]: guild.members || EMPTY_MEMBERS,
          },
          isLoading: false,
          error: null,
        };
      });

      if (guild.channels && guild.channels.length > 0) {
        useChannelStore.getState().setChannels(guild.channels, guild.id);
      } else {
        useChannelStore.getState().fetchChannels(guild.id);
      }

      return guild;
    } catch (err: unknown) {
      const message = err instanceof ApiError ? err.message : "Failed to join server with invite";
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  addGuildFromGateway: (guild: GuildDetail) => {
    const summaryGuild: Guild = {
      id: guild.id,
      name: guild.name,
      icon: guild.icon,
      owner_id: guild.owner_id,
      created_at: guild.created_at,
    };

    set((state) => {
      const exists = state.guilds.some((g) => g.id === guild.id);
      const nextGuilds = exists ? state.guilds : [...state.guilds, summaryGuild];
      return {
        guilds: nextGuilds,
        membersByGuild: {
          ...state.membersByGuild,
          [guild.id]: guild.members || state.membersByGuild[guild.id] || EMPTY_MEMBERS,
        },
      };
    });

    if (guild.channels && guild.channels.length > 0) {
      useChannelStore.getState().setChannels(guild.channels, guild.id);
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
        membersByGuild: {
          ...state.membersByGuild,
          [newGuild.id]: newGuild.members || EMPTY_MEMBERS,
        },
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
        get().fetchMembers(nextActiveId);
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
      membersByGuild: {},
      isLoading: false,
      error: null,
    });
  },
}));
