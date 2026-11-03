import { create } from "zustand";
import { Room, RoomEvent, Track, LocalTrackPublication } from "livekit-client";
import { VoiceState } from "../types";
import { api } from "../api/client";
import { getGatewayClient } from "../gateway/GatewayClient";

const EMPTY_VOICE_STATES: VoiceState[] = [];
const EMPTY_SPEAKING_USERS: string[] = [];
const EMPTY_SCREEN_SHARES: ActiveScreenShare[] = [];

export type VoiceConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export interface ActiveScreenShare {
  userId: string;
  userName: string;
  videoTrack: Track;
  audioTrack?: Track;
  isLocal: boolean;
}

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

  // Milestone 5: Screen Sharing State
  isScreenSharing: boolean;
  activeScreenShares: ActiveScreenShare[];
  focusedScreenShareUserId: string | null;

  setGuildVoiceStates: (guildId: string, states: VoiceState[]) => void;
  handleVoiceStateUpdate: (vs: VoiceState) => void;
  joinVoiceChannel: (guildId: string, channelId: string, channelName?: string) => Promise<void>;
  leaveVoiceChannel: () => void;
  toggleMute: () => Promise<void>;
  toggleDeafen: () => Promise<void>;
  toggleScreenShare: () => Promise<void>;
  setFocusedScreenShareUserId: (userId: string | null) => void;
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

  isScreenSharing: false,
  activeScreenShares: EMPTY_SCREEN_SHARES,
  focusedScreenShareUserId: null,

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
      isScreenSharing: false,
      activeScreenShares: EMPTY_SCREEN_SHARES,
      focusedScreenShareUserId: null,
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

      // 4. Register Track Subscribed Event (Audio & Screen Share Video)
      room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
        if (track.kind === Track.Kind.Audio) {
          const isScreenAudio = track.source === Track.Source.ScreenShareAudio;
          const element = track.attach();
          element.dataset.participantId = participant.identity;
          element.dataset.livekitTrack = "true";
          if (isScreenAudio) {
            element.dataset.screenAudio = "true";
          }
          element.muted = get().isDeafened;
          document.body.appendChild(element);

          if (isScreenAudio) {
            set((state) => ({
              activeScreenShares: state.activeScreenShares.map((s) =>
                s.userId === participant.identity ? { ...s, audioTrack: track } : s
              ),
            }));
          }
        } else if (
          track.kind === Track.Kind.Video &&
          track.source === Track.Source.ScreenShare
        ) {
          // Remote participant started screen sharing
          const userId = participant.identity;
          const userName = participant.name || "User";
          set((state) => {
            const exists = state.activeScreenShares.some((s) => s.userId === userId);
            const nextShares = exists
              ? state.activeScreenShares.map((s) =>
                  s.userId === userId ? { ...s, videoTrack: track } : s
                )
              : [
                  ...state.activeScreenShares,
                  { userId, userName, videoTrack: track, isLocal: false },
                ];

            return {
              activeScreenShares: nextShares,
              focusedScreenShareUserId: state.focusedScreenShareUserId || userId,
            };
          });
        }
      });

      // 5. Register Track Unsubscribed Event
      room.on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
        track.detach().forEach((el) => el.remove());

        if (track.source === Track.Source.ScreenShare) {
          set((state) => {
            const nextShares = state.activeScreenShares.filter(
              (s) => s.userId !== participant.identity
            );
            return {
              activeScreenShares: nextShares.length > 0 ? nextShares : EMPTY_SCREEN_SHARES,
              focusedScreenShareUserId:
                state.focusedScreenShareUserId === participant.identity
                  ? nextShares[0]?.userId || null
                  : state.focusedScreenShareUserId,
            };
          });
        } else if (track.source === Track.Source.ScreenShareAudio) {
          document
            .querySelectorAll(
              `audio[data-screen-audio='true'][data-participant-id='${participant.identity}']`
            )
            .forEach((el) => el.remove());
        }
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
          isScreenSharing: false,
          activeScreenShares: EMPTY_SCREEN_SHARES,
          focusedScreenShareUserId: null,
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
          self_stream: false,
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
      const message =
        err instanceof Error ? err.message : "Failed to connect to voice channel";
      set({
        currentRoom: null,
        connectionStatus: "error",
        error: message,
        activeVoiceGuildId: null,
        activeVoiceChannelId: null,
        activeVoiceChannelName: null,
        speakingUserIds: EMPTY_SPEAKING_USERS,
        isScreenSharing: false,
        activeScreenShares: EMPTY_SCREEN_SHARES,
        focusedScreenShareUserId: null,
      });
    }
  },

  leaveVoiceChannel: () => {
    const { currentRoom, activeVoiceGuildId, isScreenSharing } = get();

    if (currentRoom) {
      if (isScreenSharing) {
        try {
          currentRoom.localParticipant.setScreenShareEnabled(false);
        } catch (err) {
          console.warn("[voiceStore] Error disabling screen share on leave:", err);
        }
      }

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
      isScreenSharing: false,
      activeScreenShares: EMPTY_SCREEN_SHARES,
      focusedScreenShareUserId: null,
      error: null,
    });
  },

  toggleMute: async () => {
    const { isMuted, currentRoom, activeVoiceGuildId, activeVoiceChannelId, isDeafened, isScreenSharing } = get();
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
          self_stream: isScreenSharing,
        });
      } catch (err) {
        console.error("[voiceStore] Error updating gateway voice mute state:", err);
      }
    }

    set({ isMuted: nextMuted });
  },

  toggleDeafen: async () => {
    const { isDeafened, isMuted, currentRoom, activeVoiceGuildId, activeVoiceChannelId, isScreenSharing } = get();
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
          self_stream: isScreenSharing,
        });
      } catch (err) {
        console.error("[voiceStore] Error updating gateway voice deafen state:", err);
      }
    }

    set({ isDeafened: nextDeaf, isMuted: nextMute });
  },

  toggleScreenShare: async () => {
    const {
      currentRoom,
      isScreenSharing,
      activeVoiceGuildId,
      activeVoiceChannelId,
      isMuted,
      isDeafened,
    } = get();

    if (!currentRoom) return;

    if (isScreenSharing) {
      // 1. Stop local screen sharing
      try {
        await currentRoom.localParticipant.setScreenShareEnabled(false);
      } catch (err) {
        console.warn("[voiceStore] Error disabling screen share:", err);
      }

      const localId = currentRoom.localParticipant.identity;
      set((state) => {
        const nextShares = state.activeScreenShares.filter((s) => s.userId !== localId);
        return {
          isScreenSharing: false,
          activeScreenShares: nextShares.length > 0 ? nextShares : EMPTY_SCREEN_SHARES,
          focusedScreenShareUserId:
            state.focusedScreenShareUserId === localId
              ? nextShares[0]?.userId || null
              : state.focusedScreenShareUserId,
        };
      });

      // 2. Notify Gateway: self_stream = false
      if (activeVoiceGuildId && activeVoiceChannelId) {
        try {
          getGatewayClient().sendVoiceStateUpdate(activeVoiceGuildId, activeVoiceChannelId, {
            self_mute: isMuted,
            self_deaf: isDeafened,
            self_stream: false,
          });
        } catch (gwErr) {
          console.error("[voiceStore] Failed to notify gateway of screen share stop:", gwErr);
        }
      }
    } else {
      // 1. Start local screen sharing
      try {
        const pub = (await currentRoom.localParticipant.setScreenShareEnabled(true, {
          audio: true,
          selfBrowserSurface: "include",
        })) as LocalTrackPublication | undefined;

        if (pub && pub.track) {
          const localId = currentRoom.localParticipant.identity;
          const localName = currentRoom.localParticipant.name || "You";

          // Listen for user ending the stream natively via OS/browser "Stop sharing" UI
          if (pub.track.mediaStreamTrack) {
            pub.track.mediaStreamTrack.onended = () => {
              get().toggleScreenShare();
            };
          }

          set((state) => {
            const nextShares = [
              ...state.activeScreenShares.filter((s) => s.userId !== localId),
              {
                userId: localId,
                userName: localName,
                videoTrack: pub.track!,
                isLocal: true,
              },
            ];
            return {
              isScreenSharing: true,
              activeScreenShares: nextShares,
              focusedScreenShareUserId: localId,
            };
          });

          // 2. Notify Gateway: self_stream = true
          if (activeVoiceGuildId && activeVoiceChannelId) {
            try {
              getGatewayClient().sendVoiceStateUpdate(
                activeVoiceGuildId,
                activeVoiceChannelId,
                {
                  self_mute: isMuted,
                  self_deaf: isDeafened,
                  self_stream: true,
                }
              );
            } catch (gwErr) {
              console.error(
                "[voiceStore] Failed to notify gateway of screen share start:",
                gwErr
              );
            }
          }
        }
      } catch (err) {
        // User cancelled the screen share picker or permission denied
        console.warn("[voiceStore] Screen share request cancelled or error:", err);
      }
    }
  },

  setFocusedScreenShareUserId: (userId) => {
    set({ focusedScreenShareUserId: userId });
  },

  getVoiceStatesForChannel: (guildId, channelId) => {
    const list = get().voiceStatesByGuild[guildId] || EMPTY_VOICE_STATES;
    return list.filter((vs) => vs.channel_id === channelId);
  },

  isUserSpeaking: (userId: string) => {
    return get().speakingUserIds.includes(userId);
  },
}));
