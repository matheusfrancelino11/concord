import { create } from "zustand";
import {
  Guild,
  GuildDetail,
  CreateGuildPayload,
  Member,
  Role,
  Ban,
  CreateRolePayload,
  UpdateRolePayload,
  UpdateMemberPayload,
  CreateBanPayload,
  UpdateGuildPayload,
} from "../types";
import { api, ApiError } from "../api/client";
import { useChannelStore } from "./channelStore";

export const EMPTY_MEMBERS: Member[] = [];
export const EMPTY_ROLES: Role[] = [];

export interface GuildState {
  guilds: Guild[];
  activeGuildId: string | null;
  selectedGuildId: string | null;
  membersByGuild: Record<string, Member[]>;
  rolesByGuild: Record<string, Role[]>;
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchGuilds: () => Promise<void>;
  selectGuild: (guildId: string) => void;
  createGuild: (payload: CreateGuildPayload) => Promise<GuildDetail>;
  updateGuild: (guildId: string, payload: UpdateGuildPayload) => Promise<GuildDetail>;
  deleteGuild: (guildId: string) => Promise<void>;
  joinGuildWithInvite: (code: string) => Promise<GuildDetail>;
  fetchMembers: (guildId: string) => Promise<void>;
  fetchRoles: (guildId: string) => Promise<Role[]>;
  setMembers: (guildId: string, members: Member[]) => void;
  setRoles: (guildId: string, roles: Role[]) => void;
  addMember: (guildId: string, member: Member) => void;
  addGuildFromGateway: (guild: GuildDetail) => void;

  // Role Management
  createRole: (guildId: string, payload: CreateRolePayload) => Promise<Role>;
  updateRole: (guildId: string, roleId: string, payload: UpdateRolePayload) => Promise<Role>;
  deleteRole: (guildId: string, roleId: string) => Promise<void>;

  // Member Management & Moderation
  addMemberRole: (guildId: string, userId: string, roleId: string) => Promise<void>;
  removeMemberRole: (guildId: string, userId: string, roleId: string) => Promise<void>;
  updateMember: (guildId: string, userId: string, payload: UpdateMemberPayload) => Promise<Member>;
  kickMember: (guildId: string, userId: string) => Promise<void>;
  banMember: (guildId: string, userId: string, payload?: CreateBanPayload) => Promise<void>;
  unbanMember: (guildId: string, userId: string) => Promise<void>;
  fetchBans: (guildId: string) => Promise<Ban[]>;

  // Gateway event handlers
  handleGuildUpdate: (guild: Partial<GuildDetail> & { id: string }) => void;
  handleRoleCreate: (guildId: string, role: Role) => void;
  handleRoleUpdate: (guildId: string, role: Role) => void;
  handleRoleDelete: (guildId: string, roleId: string) => void;
  handleMemberUpdate: (member: Member) => void;
  handleMemberRemove: (guildId: string, userId: string) => void;

  clearError: () => void;
  reset: () => void;
}

export const useGuildStore = create<GuildState>((set, get) => ({
  guilds: [],
  activeGuildId: null,
  selectedGuildId: null,
  membersByGuild: {},
  rolesByGuild: {},
  isLoading: false,
  error: null,

  fetchGuilds: async () => {
    set({ isLoading: true, error: null });
    try {
      const guilds = await api.guilds.list();
      const currentActiveId = get().selectedGuildId || get().activeGuildId;

      let nextActiveId: string | null = currentActiveId;
      if (currentActiveId) {
        const stillExists = guilds.some((g) => g.id === currentActiveId);
        if (!stillExists) {
          nextActiveId = guilds.length > 0 ? guilds[0].id : null;
        }
      }

      set({
        guilds,
        activeGuildId: nextActiveId,
        selectedGuildId: nextActiveId,
        isLoading: false,
        error: null,
      });

      // Synchronize channels, members, and roles for selected guild
      if (nextActiveId) {
        useChannelStore.getState().fetchChannels(nextActiveId);
        get().fetchMembers(nextActiveId);
        get().fetchRoles(nextActiveId);
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
    const nextId = guildId || null;
    if (get().selectedGuildId === nextId) return;

    set({
      activeGuildId: nextId,
      selectedGuildId: nextId,
    });

    // Fetch channels, members, and roles for newly selected guild
    if (nextId) {
      useChannelStore.getState().fetchChannels(nextId);
      get().fetchMembers(nextId);
      get().fetchRoles(nextId);
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

  fetchRoles: async (guildId: string): Promise<Role[]> => {
    try {
      const roles = await api.roles.list(guildId);
      set((state) => ({
        rolesByGuild: {
          ...state.rolesByGuild,
          [guildId]: roles || EMPTY_ROLES,
        },
      }));
      return roles || EMPTY_ROLES;
    } catch (err) {
      console.error(`[guildStore] Failed to fetch roles for guild ${guildId}:`, err);
      return EMPTY_ROLES;
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

  setRoles: (guildId: string, roles: Role[]) => {
    set((state) => ({
      rolesByGuild: {
        ...state.rolesByGuild,
        [guildId]: roles || EMPTY_ROLES,
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
          rolesByGuild: {
            ...state.rolesByGuild,
            [guild.id]: guild.roles || EMPTY_ROLES,
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
        rolesByGuild: {
          ...state.rolesByGuild,
          [guild.id]: guild.roles || state.rolesByGuild[guild.id] || EMPTY_ROLES,
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
        rolesByGuild: {
          ...state.rolesByGuild,
          [newGuild.id]: newGuild.roles || EMPTY_ROLES,
        },
        isLoading: false,
        error: null,
      }));

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

  updateGuild: async (guildId: string, payload: UpdateGuildPayload): Promise<GuildDetail> => {
    set({ isLoading: true, error: null });
    try {
      const updated = await api.guilds.update(guildId, payload);
      set((state) => ({
        guilds: state.guilds.map((g) =>
          g.id === guildId ? { ...g, name: updated.name, icon: updated.icon } : g
        ),
        isLoading: false,
        error: null,
      }));
      return updated;
    } catch (err: unknown) {
      const message = err instanceof ApiError ? err.message : "Failed to update server";
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
        get().fetchRoles(nextActiveId);
      } else {
        useChannelStore.getState().reset();
      }
    } catch (err: unknown) {
      const message = err instanceof ApiError ? err.message : "Failed to delete server";
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  // Roles API actions
  createRole: async (guildId: string, payload: CreateRolePayload): Promise<Role> => {
    const role = await api.roles.create(guildId, payload);
    set((state) => {
      const current = state.rolesByGuild[guildId] || EMPTY_ROLES;
      return {
        rolesByGuild: {
          ...state.rolesByGuild,
          [guildId]: [...current, role],
        },
      };
    });
    return role;
  },

  updateRole: async (guildId: string, roleId: string, payload: UpdateRolePayload): Promise<Role> => {
    const role = await api.roles.update(guildId, roleId, payload);
    set((state) => {
      const current = state.rolesByGuild[guildId] || EMPTY_ROLES;
      return {
        rolesByGuild: {
          ...state.rolesByGuild,
          [guildId]: current.map((r) => (r.id === roleId ? role : r)),
        },
      };
    });
    return role;
  },

  deleteRole: async (guildId: string, roleId: string): Promise<void> => {
    await api.roles.delete(guildId, roleId);
    set((state) => {
      const current = state.rolesByGuild[guildId] || EMPTY_ROLES;
      return {
        rolesByGuild: {
          ...state.rolesByGuild,
          [guildId]: current.filter((r) => r.id !== roleId),
        },
      };
    });
  },

  // Member API actions
  addMemberRole: async (guildId: string, userId: string, roleId: string): Promise<void> => {
    await api.members.addRole(guildId, userId, roleId);
    set((state) => {
      const members = state.membersByGuild[guildId] || EMPTY_MEMBERS;
      return {
        membersByGuild: {
          ...state.membersByGuild,
          [guildId]: members.map((m) => {
            if (m.user_id !== userId) return m;
            const currentRoles = m.roles || [];
            if (currentRoles.includes(roleId)) return m;
            return { ...m, roles: [...currentRoles, roleId] };
          }),
        },
      };
    });
  },

  removeMemberRole: async (guildId: string, userId: string, roleId: string): Promise<void> => {
    await api.members.removeRole(guildId, userId, roleId);
    set((state) => {
      const members = state.membersByGuild[guildId] || EMPTY_MEMBERS;
      return {
        membersByGuild: {
          ...state.membersByGuild,
          [guildId]: members.map((m) => {
            if (m.user_id !== userId) return m;
            return {
              ...m,
              roles: (m.roles || []).filter((r) => r !== roleId),
            };
          }),
        },
      };
    });
  },

  updateMember: async (guildId: string, userId: string, payload: UpdateMemberPayload): Promise<Member> => {
    const updated = await api.members.update(guildId, userId, payload);
    set((state) => {
      const members = state.membersByGuild[guildId] || EMPTY_MEMBERS;
      return {
        membersByGuild: {
          ...state.membersByGuild,
          [guildId]: members.map((m) => (m.user_id === userId ? updated : m)),
        },
      };
    });
    return updated;
  },

  kickMember: async (guildId: string, userId: string): Promise<void> => {
    await api.members.kick(guildId, userId);
    set((state) => {
      const members = state.membersByGuild[guildId] || EMPTY_MEMBERS;
      return {
        membersByGuild: {
          ...state.membersByGuild,
          [guildId]: members.filter((m) => m.user_id !== userId),
        },
      };
    });
  },

  banMember: async (guildId: string, userId: string, payload?: CreateBanPayload): Promise<void> => {
    await api.bans.create(guildId, userId, payload);
    set((state) => {
      const members = state.membersByGuild[guildId] || EMPTY_MEMBERS;
      return {
        membersByGuild: {
          ...state.membersByGuild,
          [guildId]: members.filter((m) => m.user_id !== userId),
        },
      };
    });
  },

  unbanMember: async (guildId: string, userId: string): Promise<void> => {
    await api.bans.remove(guildId, userId);
  },

  fetchBans: async (guildId: string): Promise<Ban[]> => {
    return api.bans.list(guildId);
  },

  // Gateway event handlers
  handleGuildUpdate: (guild: Partial<GuildDetail> & { id: string }) => {
    set((state) => ({
      guilds: state.guilds.map((g) => (g.id === guild.id ? { ...g, ...guild } : g)),
    }));
  },

  handleRoleCreate: (guildId: string, role: Role) => {
    set((state) => {
      const current = state.rolesByGuild[guildId] || EMPTY_ROLES;
      if (current.some((r) => r.id === role.id)) return state;
      return {
        rolesByGuild: {
          ...state.rolesByGuild,
          [guildId]: [...current, role],
        },
      };
    });
  },

  handleRoleUpdate: (guildId: string, role: Role) => {
    set((state) => {
      const current = state.rolesByGuild[guildId] || EMPTY_ROLES;
      return {
        rolesByGuild: {
          ...state.rolesByGuild,
          [guildId]: current.map((r) => (r.id === role.id ? role : r)),
        },
      };
    });
  },

  handleRoleDelete: (guildId: string, roleId: string) => {
    set((state) => {
      const current = state.rolesByGuild[guildId] || EMPTY_ROLES;
      return {
        rolesByGuild: {
          ...state.rolesByGuild,
          [guildId]: current.filter((r) => r.id !== roleId),
        },
      };
    });
  },

  handleMemberUpdate: (member: Member) => {
    set((state) => {
      const current = state.membersByGuild[member.guild_id] || EMPTY_MEMBERS;
      return {
        membersByGuild: {
          ...state.membersByGuild,
          [member.guild_id]: current.map((m) =>
            m.user_id === member.user_id ? { ...m, ...member } : m
          ),
        },
      };
    });
  },

  handleMemberRemove: (guildId: string, userId: string) => {
    set((state) => {
      const current = state.membersByGuild[guildId] || EMPTY_MEMBERS;
      return {
        membersByGuild: {
          ...state.membersByGuild,
          [guildId]: current.filter((m) => m.user_id !== userId),
        },
      };
    });
  },

  clearError: () => set({ error: null }),

  reset: () => {
    set({
      guilds: [],
      activeGuildId: null,
      selectedGuildId: null,
      membersByGuild: {},
      rolesByGuild: {},
      isLoading: false,
      error: null,
    });
  },
}));
