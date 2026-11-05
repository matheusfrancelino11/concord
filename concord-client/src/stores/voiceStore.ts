import { create } from "zustand";
import { Room, RoomEvent, Track, LocalTrackPublication } from "livekit-client";
import { invoke } from "@tauri-apps/api/core";
import { VoiceState } from "../types";
import { api } from "../api/client";
import { getGatewayClient } from "../gateway/GatewayClient";
import { useSettingsStore } from "./settingsStore";
import { sound } from "../utils/sound";

export const EMPTY_VOICE_STATES: VoiceState[] = [];
export const EMPTY_SPEAKING_USERS: string[] = [];
export const EMPTY_SCREEN_SHARES: ActiveScreenShare[] = [];

// Real-time Local VAD (Voice Activity Detection) state
let localVadContext: AudioContext | null = null;
let localVadInterval: ReturnType<typeof setInterval> | null = null;
let localSpeakingHoldTimeout: ReturnType<typeof setTimeout> | null = null;
let isLocalSpeaking = false;
let remoteSpeakingIds: string[] = [];

function isPermissionError(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === "object") {
    const e = err as { name?: string; message?: string };
    if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") return true;
    if (
      e.message &&
      (e.message.includes("Permission denied") ||
        e.message.includes("NotAllowedError") ||
        e.message.includes("permission"))
    ) {
      return true;
    }
  }
  return false;
}

function syncSpeakingState(localUserId: string | null) {
  const currentStore = useVoiceStore.getState();
  const ids = [...remoteSpeakingIds];

  const shouldIncludeLocal =
    isLocalSpeaking &&
    Boolean(localUserId) &&
    !currentStore.isMuted &&
    !currentStore.isDeafened;

  if (shouldIncludeLocal && localUserId) {
    if (!ids.includes(localUserId)) {
      ids.push(localUserId);
    }
  } else if (localUserId) {
    const idx = ids.indexOf(localUserId);
    if (idx !== -1) {
      ids.splice(idx, 1);
    }
  }

  useVoiceStore.setState({
    speakingUserIds: ids.length > 0 ? ids : EMPTY_SPEAKING_USERS,
  });
}

function setupLocalVad(track: MediaStreamTrack, localUserId: string) {
  stopLocalVad();
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.2;
    source.connect(analyser);

    localVadContext = ctx;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    localVadInterval = setInterval(() => {
      const state = useVoiceStore.getState();
      if (state.isMuted || state.isDeafened) {
        if (isLocalSpeaking) {
          isLocalSpeaking = false;
          syncSpeakingState(localUserId);
        }
        return;
      }

      analyser.getByteTimeDomainData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const val = (dataArray[i] - 128) / 128;
        sum += val * val;
      }
      const rms = Math.sqrt(sum / dataArray.length);

      // Sensitivity threshold ~ -40dB (clean vocal detection)
      if (rms > 0.015) {
        if (localSpeakingHoldTimeout) {
          clearTimeout(localSpeakingHoldTimeout);
          localSpeakingHoldTimeout = null;
        }
        if (!isLocalSpeaking) {
          isLocalSpeaking = true;
          syncSpeakingState(localUserId);
        }
      } else if (isLocalSpeaking && !localSpeakingHoldTimeout) {
        // Natural speech hold decay (350ms): hold green ring steady while talking continuously
        localSpeakingHoldTimeout = setTimeout(() => {
          isLocalSpeaking = false;
          localSpeakingHoldTimeout = null;
          syncSpeakingState(localUserId);
        }, 350);
      }
    }, 40); // 25 checks per second = ultra-low latency response
  } catch (err) {
    console.warn("[voiceStore] Could not start local VAD:", err);
  }
}

function stopLocalVad() {
  if (localVadInterval) {
    clearInterval(localVadInterval);
    localVadInterval = null;
  }
  if (localSpeakingHoldTimeout) {
    clearTimeout(localSpeakingHoldTimeout);
    localSpeakingHoldTimeout = null;
  }
  isLocalSpeaking = false;
  if (localVadContext) {
    localVadContext.close().catch(() => {});
    localVadContext = null;
  }
}

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
  micPermissionBlocked: boolean;

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
  switchInputDevice: (deviceId: string) => Promise<void>;
  switchOutputDevice: (deviceId: string) => Promise<void>;
  syncUserAudio: (userId: string) => void;
  syncAllAudio: () => void;
  setMicPermissionBlocked: (blocked: boolean) => void;
  repairMicPermissions: () => Promise<boolean>;
  openWindowsMicSettings: () => Promise<void>;
  restartApp: () => Promise<void>;
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
  micPermissionBlocked: false,

  setMicPermissionBlocked: (blocked) => set({ micPermissionBlocked: blocked }),

  repairMicPermissions: async () => {
    try {
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        await invoke("reset_mic_permissions");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      set({ micPermissionBlocked: false });
      return true;
    } catch (err) {
      console.warn("[voiceStore] Mic still blocked after repair attempt:", err);
      return false;
    }
  },

  openWindowsMicSettings: async () => {
    try {
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        await invoke("open_windows_mic_settings");
      }
    } catch (err) {
      console.warn("[voiceStore] Failed to open Windows settings:", err);
    }
  },

  restartApp: async () => {
    try {
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        await invoke("restart_app");
      }
    } catch (err) {
      console.warn("[voiceStore] Failed to restart app:", err);
    }
  },

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
    const { activeVoiceChannelId } = get();
    if (activeVoiceChannelId) {
      const prevInChannel = (get().voiceStatesByGuild[vs.guild_id] || []).some(
        (s) => s.user_id === vs.user_id && s.channel_id === activeVoiceChannelId
      );
      const nowInChannel = vs.channel_id === activeVoiceChannelId;

      if (!prevInChannel && nowInChannel) {
        sound.play("join");
      } else if (prevInChannel && !nowInChannel) {
        sound.play("leave");
      }
    }

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
        const localId = room.localParticipant.identity;
        remoteSpeakingIds = speakers
          .map((s) => s.identity)
          .filter((id) => id !== localId);
        syncSpeakingState(localId);
      });

      // 3b. Register Connection Lifecycle Events for Stability
      room.on(RoomEvent.Reconnecting, () => {
        set({ connectionStatus: "reconnecting" });
      });

      room.on(RoomEvent.Reconnected, () => {
        set({ connectionStatus: "connected" });
        get().syncAllAudio();
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

          const settings = useSettingsStore.getState();
          const isLocallyMuted = settings.isUserLocallyMuted(participant.identity);
          element.muted = get().isDeafened || isLocallyMuted;

          const userVol = isScreenAudio
            ? settings.screenShareVolume
            : settings.getUserVolume(participant.identity);
          const masterOut = settings.outputVolume / 100;
          element.volume = Math.max(0, Math.min(1, (userVol / 100) * masterOut));

          // Set sinkId if non-default output device is configured
          if (
            settings.outputDeviceId &&
            settings.outputDeviceId !== "default" &&
            "setSinkId" in element &&
            typeof (element as any).setSinkId === "function"
          ) {
            (element as any).setSinkId(settings.outputDeviceId).catch(console.warn);
          }

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

      const settings = useSettingsStore.getState();

      // Switch to configured audio devices if non-default
      if (settings.inputDeviceId && settings.inputDeviceId !== "default") {
        room.switchActiveDevice("audioinput", settings.inputDeviceId).catch(console.warn);
      }
      if (settings.outputDeviceId && settings.outputDeviceId !== "default") {
        room.switchActiveDevice("audiooutput", settings.outputDeviceId).catch(console.warn);
      }

      // If Push-to-Talk is enabled, user starts muted until key is held
      const shouldMuteInitially = isMuted || isDeafened || settings.inputMode === "push_to_talk";

      // 8. Publish local microphone track if not muted
      if (!shouldMuteInitially) {
        try {
          const pub = (await room.localParticipant.setMicrophoneEnabled(true, {
            deviceId: settings.inputDeviceId !== "default" ? settings.inputDeviceId : undefined,
            echoCancellation: settings.echoCancellation,
            noiseSuppression: settings.noiseSuppression,
            autoGainControl: settings.autoGainControl,
          })) as LocalTrackPublication | undefined;
          if (pub?.track?.mediaStreamTrack) {
            setupLocalVad(pub.track.mediaStreamTrack, room.localParticipant.identity);
            set({ micPermissionBlocked: false });
          }
        } catch (micErr) {
          console.warn("[voiceStore] Could not enable microphone:", micErr);
          if (isPermissionError(micErr)) {
            set({ micPermissionBlocked: true });
          }
        }
      } else if (settings.inputMode === "push_to_talk" && !isMuted) {
        // Prepare microphone track in disabled state for instant PTT response
        try {
          await room.localParticipant.setMicrophoneEnabled(false);
          set({ micPermissionBlocked: false });
        } catch (micErr) {
          console.warn("[voiceStore] Could not prepare PTT mic:", micErr);
          if (isPermissionError(micErr)) {
            set({ micPermissionBlocked: true });
          }
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
      sound.play("join");
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
    sound.play("disconnect");
    stopLocalVad();
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
    const { isMuted, currentRoom, activeVoiceGuildId, activeVoiceChannelId, isDeafened, isScreenSharing, voiceStatesByGuild } = get();
    const nextMuted = !isMuted;

    if (nextMuted) {
      sound.play("mute");
    } else {
      sound.play("unmute");
    }

    const localUserId = currentRoom?.localParticipant.identity;
    set({ isMuted: nextMuted });
    if (nextMuted) {
      isLocalSpeaking = false;
      syncSpeakingState(localUserId || null);
    }

    // Optimistically update voiceStatesByGuild for instant UI feedback
    if (activeVoiceGuildId && localUserId) {
      const currentList = voiceStatesByGuild[activeVoiceGuildId] || EMPTY_VOICE_STATES;
      const nextList = currentList.map((item) =>
        item.user_id === localUserId ? { ...item, self_mute: nextMuted } : item
      );
      set({
        voiceStatesByGuild: {
          ...voiceStatesByGuild,
          [activeVoiceGuildId]: nextList,
        },
      });
    }

    if (currentRoom) {
      try {
        const pub = currentRoom.localParticipant.getTrackPublication(Track.Source.Microphone);
        if (pub?.track) {
          pub.track.mediaStreamTrack.enabled = !nextMuted;
          if (nextMuted) {
            await pub.mute();
          } else {
            await pub.unmute();
          }
        } else if (!nextMuted) {
          const settings = useSettingsStore.getState();
          const pubNew = (await currentRoom.localParticipant.setMicrophoneEnabled(true, {
            deviceId: settings.inputDeviceId !== "default" ? settings.inputDeviceId : undefined,
            echoCancellation: settings.echoCancellation,
            noiseSuppression: settings.noiseSuppression,
            autoGainControl: settings.autoGainControl,
          })) as LocalTrackPublication | undefined;
          if (pubNew?.track?.mediaStreamTrack) {
            setupLocalVad(pubNew.track.mediaStreamTrack, currentRoom.localParticipant.identity);
            set({ micPermissionBlocked: false });
          }
        }
      } catch (err) {
        console.warn("[voiceStore] Error toggling microphone in LiveKit:", err);
        if (isPermissionError(err)) {
          set({ micPermissionBlocked: true });
        }
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
  },

  toggleDeafen: async () => {
    const { isDeafened, isMuted, currentRoom, activeVoiceGuildId, activeVoiceChannelId, isScreenSharing, voiceStatesByGuild } = get();
    const nextDeaf = !isDeafened;
    // When deafened, auto-mute microphone as well
    const nextMute = nextDeaf ? true : isMuted;

    if (nextDeaf) {
      sound.play("deafen");
    } else {
      sound.play("undeafen");
    }

    // Mute/unmute all subscribed remote audio elements
    document.querySelectorAll("audio[data-livekit-track='true']").forEach((el) => {
      (el as HTMLAudioElement).muted = nextDeaf;
    });

    const localUserId = currentRoom?.localParticipant.identity;
    set({ isDeafened: nextDeaf, isMuted: nextMute });
    if (nextMute) {
      isLocalSpeaking = false;
      syncSpeakingState(localUserId || null);
    }

    // Optimistically update voiceStatesByGuild
    if (activeVoiceGuildId && localUserId) {
      const currentList = voiceStatesByGuild[activeVoiceGuildId] || EMPTY_VOICE_STATES;
      const nextList = currentList.map((item) =>
        item.user_id === localUserId
          ? { ...item, self_deaf: nextDeaf, self_mute: nextMute }
          : item
      );
      set({
        voiceStatesByGuild: {
          ...voiceStatesByGuild,
          [activeVoiceGuildId]: nextList,
        },
      });
    }

    if (currentRoom) {
      try {
        const pub = currentRoom.localParticipant.getTrackPublication(Track.Source.Microphone);
        if (pub?.track) {
          pub.track.mediaStreamTrack.enabled = !nextMute;
          if (nextMute) {
            await pub.mute();
          } else {
            await pub.unmute();
          }
        }
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
      // 1. Start local screen sharing with configured resolution & framerate
      try {
        const settings = useSettingsStore.getState();
        const res = settings.screenShareResolution;
        const width = res === "1440p" ? 2560 : res === "1080p" ? 1920 : 1280;
        const height = res === "1440p" ? 1440 : res === "1080p" ? 1080 : 720;
        const fps = settings.screenShareFps;

        const pub = (await currentRoom.localParticipant.setScreenShareEnabled(true, {
          audio: true,
          selfBrowserSurface: "include",
          resolution: {
            width,
            height,
            frameRate: fps,
          },
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

  switchInputDevice: async (deviceId: string) => {
    const { currentRoom } = get();
    if (currentRoom) {
      try {
        await currentRoom.switchActiveDevice("audioinput", deviceId);
      } catch (err) {
        console.warn("[voiceStore] switchActiveDevice audioinput error:", err);
      }
    }
  },

  switchOutputDevice: async (deviceId: string) => {
    const { currentRoom } = get();
    if (currentRoom) {
      try {
        await currentRoom.switchActiveDevice("audiooutput", deviceId);
      } catch (err) {
        console.warn("[voiceStore] switchActiveDevice audiooutput error:", err);
      }
    }
    // Update sinkId of active audio elements
    document.querySelectorAll("audio[data-livekit-track='true']").forEach((el) => {
      if ("setSinkId" in el && typeof (el as any).setSinkId === "function") {
        (el as any).setSinkId(deviceId === "default" ? "" : deviceId).catch(console.warn);
      }
    });
  },

  syncUserAudio: (userId: string) => {
    const settings = useSettingsStore.getState();
    const isLocallyMuted = settings.isUserLocallyMuted(userId);
    const userVol = settings.getUserVolume(userId);
    const masterOut = settings.outputVolume / 100;

    document.querySelectorAll(`audio[data-participant-id='${userId}']`).forEach((el) => {
      const audioEl = el as HTMLAudioElement;
      audioEl.muted = get().isDeafened || isLocallyMuted;
      audioEl.volume = Math.max(0, Math.min(1, (userVol / 100) * masterOut));
    });
  },

  syncAllAudio: () => {
    const settings = useSettingsStore.getState();
    const masterOut = settings.outputVolume / 100;

    document.querySelectorAll("audio[data-livekit-track='true']").forEach((el) => {
      const audioEl = el as HTMLAudioElement;
      const isScreen = audioEl.dataset.screenAudio === "true";
      const pId = audioEl.dataset.participantId;
      if (!pId) return;

      const isLocallyMuted = settings.isUserLocallyMuted(pId);
      const userVol = isScreen ? settings.screenShareVolume : settings.getUserVolume(pId);

      audioEl.muted = get().isDeafened || isLocallyMuted;
      audioEl.volume = Math.max(0, Math.min(1, (userVol / 100) * masterOut));
    });
  },
}));
