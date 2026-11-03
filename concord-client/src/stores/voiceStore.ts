import { create } from "zustand";
import { Room, RoomEvent, Track } from "livekit-client";
import { VoiceState } from "../types";
import { api } from "../api/client";
import { getGatewayClient } from "../gateway/GatewayClient";

const EMPTY_VOICE_STATES: VoiceState[] = [];
const EMPTY_SPEAKING_USERS: string[] = [];

export type VoiceConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

interface VoiceStoreState {
  voiceStatesByGuild: Record<string, VoiceState[]>;
  activeVoiceChannelId: string | null;
  activeVoiceGuildId: string | null;
  activeVoiceChannelName: string | null;
  connectionStatus: VoiceConnectionStatus;
  isMuted: boolean;
  isDeafened: boolean;
  speakingUserIds: string[];
  currentRoom: Room | null;
  error: string | null;

  setGuildVoiceStates: (guildId: string, states: VoiceState[]) => void;
  handleVoiceStateUpdate: (vs: VoiceState) => void;
  joinVoiceChannel: (guildId: string, channelId: string, channelName?: string) => Promise<void>;
  leaveVoiceChannel: () => void;
  toggleMute: () => Promise<void>;
  toggleDeafen: () => Promise<void>;
  getVoiceStatesForChannel: (guildId: string, channelId: string) => VoiceState[];
  isUserSpeaking: (userId: string) => boolean;
}

export const useVoiceStore = create<VoiceStoreState>((set, get) => ({
  voiceStatesByGuild: {},
  activeVoiceChannelId: null,
  activeVoiceGuildId: null,
  activeVoiceChannelName: null,
  connectionStatus: "disconnected",
  isMuted: false,
  isDeafened: false,
  speakingUserIds: EMPTY_SPEAKING_USERS,
  currentRoom: null,
  error: null,

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

  joinVoiceChannel: async (guildId: string, channelId: string, channelName?: string) => {
    const { activeVoiceChannelId, currentRoom, leaveVoiceChannel, isMuted, isDeafened } = get();

    // If already in this channel, do nothing
    if (activeVoiceChannelId === channelId && currentRoom) {
      return;
    }

    // If currently connected to another channel, disconnect cleanly first
    if (activeVoiceChannelId || currentRoom) {
      leaveVoiceChannel();
    }

    set({
      connectionStatus: "connecting",
      activeVoiceGuildId: guildId,
      activeVoiceChannelId: channelId,
      activeVoiceChannelName: channelName || "Voice Channel",
      error: null,
      speakingUserIds: EMPTY_SPEAKING_USERS,
    });

    try {
      // 1. Fetch signed LiveKit JWT token from Concord API
      const tokenResp = await api.voice.getToken(channelId);

      // 2. Initialize LiveKit Room instance
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });

      // 3. Register Active Speakers Event
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        const ids = speakers.map((s) => s.identity);
        if (
          room.localParticipant.isSpeaking &&
          !ids.includes(room.localParticipant.identity)
        ) {
          ids.push(room.localParticipant.identity);
        }
        set({ speakingUserIds: ids.length > 0 ? ids : EMPTY_SPEAKING_USERS });
      });

      // 4. Register Audio Track Subscription
      room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
        if (track.kind === Track.Kind.Audio) {
          const element = track.attach();
          element.dataset.participantId = participant.identity;
          element.dataset.livekitTrack = "true";
          element.muted = get().isDeafened;
          document.body.appendChild(element);
        }
      });

      // 5. Register Audio Track Unsubscription
      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        track.detach().forEach((el) => el.remove());
      });

      // 6. Handle Disconnection
      room.on(RoomEvent.Disconnected, () => {
        document
          .querySelectorAll("audio[data-livekit-track='true']")
          .forEach((el) => el.remove());
        set({
          currentRoom: null,
          connectionStatus: "disconnected",
          activeVoiceGuildId: null,
          activeVoiceChannelId: null,
          activeVoiceChannelName: null,
          speakingUserIds: EMPTY_SPEAKING_USERS,
        });
      });

      // 7. Connect to LiveKit Server
      await room.connect(tokenResp.url, tokenResp.token);

      // 8. Publish local microphone track if not muted
      if (!isMuted && !isDeafened) {
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
        } catch (micErr) {
          console.warn("[voiceStore] Could not enable microphone:", micErr);
          set({ isMuted: true });
        }
      }

      // 9. Send Concord Gateway Voice State Update
      try {
        const gw = getGatewayClient();
        gw.sendVoiceStateUpdate(guildId, channelId, {
          self_mute: get().isMuted,
          self_deaf: get().isDeafened,
        });
      } catch (gwErr) {
        console.error("[voiceStore] Failed to notify gateway:", gwErr);
      }

      set({
        currentRoom: room,
        connectionStatus: "connected",
      });
    } catch (err: unknown) {
      console.error("[voiceStore] Voice connection failed:", err);
      const message = err instanceof Error ? err.message : "Failed to connect to voice channel";
      set({
        currentRoom: null,
        connectionStatus: "error",
        error: message,
        activeVoiceGuildId: null,
        activeVoiceChannelId: null,
        activeVoiceChannelName: null,
        speakingUserIds: EMPTY_SPEAKING_USERS,
      });
    }
  },

  leaveVoiceChannel: () => {
    const { currentRoom, activeVoiceGuildId } = get();

    if (currentRoom) {
      try {
        currentRoom.disconnect();
      } catch (err) {
        console.error("[voiceStore] Error disconnecting LiveKit room:", err);
      }
    }

    document
      .querySelectorAll("audio[data-livekit-track='true']")
      .forEach((el) => el.remove());

    if (activeVoiceGuildId) {
      try {
        const gw = getGatewayClient();
        gw.sendVoiceStateUpdate(activeVoiceGuildId, null);
      } catch (err) {
        console.error("[voiceStore] Error leaving voice on gateway:", err);
      }
    }

    set({
      currentRoom: null,
      activeVoiceGuildId: null,
      activeVoiceChannelId: null,
      activeVoiceChannelName: null,
      connectionStatus: "disconnected",
      speakingUserIds: EMPTY_SPEAKING_USERS,
      error: null,
    });
  },

  toggleMute: async () => {
    const { isMuted, currentRoom, activeVoiceGuildId, activeVoiceChannelId, isDeafened } = get();
    const nextMuted = !isMuted;

    if (currentRoom) {
      try {
        await currentRoom.localParticipant.setMicrophoneEnabled(!nextMuted);
      } catch (err) {
        console.warn("[voiceStore] Error toggling microphone:", err);
      }
    }

    if (activeVoiceGuildId && activeVoiceChannelId) {
      try {
        getGatewayClient().sendVoiceStateUpdate(activeVoiceGuildId, activeVoiceChannelId, {
          self_mute: nextMuted,
          self_deaf: isDeafened,
        });
      } catch (err) {
        console.error("[voiceStore] Error updating gateway voice mute state:", err);
      }
    }

    set({ isMuted: nextMuted });
  },

  toggleDeafen: async () => {
    const { isDeafened, isMuted, currentRoom, activeVoiceGuildId, activeVoiceChannelId } = get();
    const nextDeaf = !isDeafened;
    // When deafened, auto-mute microphone as well
    const nextMute = nextDeaf ? true : isMuted;

    // Mute/unmute all subscribed remote audio elements
    document.querySelectorAll("audio[data-livekit-track='true']").forEach((el) => {
      (el as HTMLAudioElement).muted = nextDeaf;
    });

    if (currentRoom) {
      try {
        await currentRoom.localParticipant.setMicrophoneEnabled(!nextMute);
      } catch (err) {
        console.warn("[voiceStore] Error toggling microphone for deafen:", err);
      }
    }

    if (activeVoiceGuildId && activeVoiceChannelId) {
      try {
        getGatewayClient().sendVoiceStateUpdate(activeVoiceGuildId, activeVoiceChannelId, {
          self_mute: nextMute,
          self_deaf: nextDeaf,
        });
      } catch (err) {
        console.error("[voiceStore] Error updating gateway voice deafen state:", err);
      }
    }

    set({ isDeafened: nextDeaf, isMuted: nextMute });
  },

  getVoiceStatesForChannel: (guildId, channelId) => {
    const list = get().voiceStatesByGuild[guildId] || EMPTY_VOICE_STATES;
    return list.filter((vs) => vs.channel_id === channelId);
  },

  isUserSpeaking: (userId: string) => {
    return get().speakingUserIds.includes(userId);
  },
}));
