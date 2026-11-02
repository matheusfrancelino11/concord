import { create } from "zustand";
import { VoiceState } from "../types";
import { getGatewayClient } from "../gateway/GatewayClient";

const EMPTY_VOICE_STATES: VoiceState[] = [];

interface VoiceStoreState {
  voiceStatesByGuild: Record<string, VoiceState[]>;
  activeVoiceChannelId: string | null;
  activeVoiceGuildId: string | null;

  setGuildVoiceStates: (guildId: string, states: VoiceState[]) => void;
  handleVoiceStateUpdate: (vs: VoiceState) => void;
  joinVoiceChannel: (guildId: string, channelId: string) => void;
  leaveVoiceChannel: () => void;
  getVoiceStatesForChannel: (guildId: string, channelId: string) => VoiceState[];
}

export const useVoiceStore = create<VoiceStoreState>((set, get) => ({
  voiceStatesByGuild: {},
  activeVoiceChannelId: null,
  activeVoiceGuildId: null,

  setGuildVoiceStates: (guildId, states) => {
    set((state) => ({
      voiceStatesByGuild: {
        ...state.voiceStatesByGuild,
        [guildId]: states || EMPTY_VOICE_STATES,
      },
    }));
  },

  handleVoiceStateUpdate: (vs) => {
    set((state) => {
      const guildId = vs.guild_id;
      const currentList = state.voiceStatesByGuild[guildId] || EMPTY_VOICE_STATES;

      let nextList: VoiceState[];
      if (!vs.channel_id) {
        // User left voice channel
        nextList = currentList.filter((item) => item.user_id !== vs.user_id);
      } else {
        // Upsert voice state
        const exists = currentList.some((item) => item.user_id === vs.user_id);
        if (exists) {
          nextList = currentList.map((item) =>
            item.user_id === vs.user_id ? { ...item, ...vs } : item
          );
        } else {
          nextList = [...currentList, vs];
        }
      }

      return {
        voiceStatesByGuild: {
          ...state.voiceStatesByGuild,
          [guildId]: nextList,
        },
      };
    });
  },

  joinVoiceChannel: (guildId, channelId) => {
    set({
      activeVoiceGuildId: guildId,
      activeVoiceChannelId: channelId,
    });
    try {
      const gw = getGatewayClient();
      gw.sendVoiceStateUpdate(guildId, channelId);
    } catch (err) {
      console.error("[voiceStore] Failed to send voice state update to gateway", err);
    }
  },

  leaveVoiceChannel: () => {
    const { activeVoiceGuildId } = get();
    if (activeVoiceGuildId) {
      try {
        const gw = getGatewayClient();
        gw.sendVoiceStateUpdate(activeVoiceGuildId, null);
      } catch (err) {
        console.error("[voiceStore] Failed to leave voice channel on gateway", err);
      }
    }
    set({
      activeVoiceGuildId: null,
      activeVoiceChannelId: null,
    });
  },

  getVoiceStatesForChannel: (guildId, channelId) => {
    const list = get().voiceStatesByGuild[guildId] || EMPTY_VOICE_STATES;
    return list.filter((vs) => vs.channel_id === channelId);
  },
}));
