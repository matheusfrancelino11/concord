import { create } from "zustand";
import { persist } from "zustand/middleware";

export type InputMode = "voice_activity" | "push_to_talk";
export type ThemeMode = "dark" | "light";
export type ScreenResolution = "720p" | "1080p" | "1440p";
export type ScreenFps = 15 | 30 | 60;

export interface SettingsState {
  // 1. Audio Input Settings
  inputDeviceId: string;
  inputVolume: number; // 0 - 100
  inputMode: InputMode;
  pushToTalkKey: string; // e.g. "ControlLeft", "KeyV"
  pushToTalkKeyLabel: string; // e.g. "Ctrl Left", "V"
  sensitivity: number; // -100 to 0 dB
  autoSensitivity: boolean;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;

  // 2. Audio Output Settings
  outputDeviceId: string;
  outputVolume: number; // 0 - 200%

  // 3. Individual User Controls (Persistent)
  userVolumes: Record<string, number>; // userId -> 0-200%
  localMutedUsers: Record<string, boolean>; // userId -> boolean

  // 4. Voice Controls & Attenuation
  attenuationEnabled: boolean;
  attenuationPercentage: number; // 0 - 100%

  // 5. Screen Share Settings
  screenShareResolution: ScreenResolution;
  screenShareFps: ScreenFps;
  screenShareVolume: number; // 0 - 200%

  // 6. Desktop & Appearance Preferences
  theme: ThemeMode;
  notificationsEnabled: boolean;
  soundEnabled: boolean;
  minimizeToTray: boolean;
  startWithWindows: boolean;
  lastGuildId: string | null;
  lastChannelId: string | null;
  mutedGuilds: Record<string, boolean>;
  mutedChannels: Record<string, boolean>;

  // Actions - Audio Input
  setInputDeviceId: (id: string) => void;
  setInputVolume: (vol: number) => void;
  setInputMode: (mode: InputMode) => void;
  setPushToTalkKey: (code: string, label: string) => void;
  setSensitivity: (val: number) => void;
  setAutoSensitivity: (enabled: boolean) => void;
  setNoiseSuppression: (enabled: boolean) => void;
  setEchoCancellation: (enabled: boolean) => void;
  setAutoGainControl: (enabled: boolean) => void;

  // Actions - Audio Output
  setOutputDeviceId: (id: string) => void;
  setOutputVolume: (vol: number) => void;

  // Actions - Individual Users
  setUserVolume: (userId: string, volume: number) => void;
  toggleLocalMute: (userId: string) => void;
  getUserVolume: (userId: string) => number;
  isUserLocallyMuted: (userId: string) => boolean;

  // Actions - Attenuation & Reset
  setAttenuationEnabled: (enabled: boolean) => void;
  setAttenuationPercentage: (val: number) => void;
  resetVoiceSettings: () => void;

  // Actions - Screen Share
  setScreenShareResolution: (res: ScreenResolution) => void;
  setScreenShareFps: (fps: ScreenFps) => void;
  setScreenShareVolume: (vol: number) => void;

  // Actions - Desktop & Appearance
  setTheme: (theme: ThemeMode) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setSoundEnabled: (enabled: boolean) => void;
  setMinimizeToTray: (enabled: boolean) => void;
  setStartWithWindows: (enabled: boolean) => void;
  setLastLocation: (guildId: string | null, channelId: string | null) => void;
  toggleMuteGuild: (guildId: string) => void;
  toggleMuteChannel: (channelId: string) => void;
}

const DEFAULT_VOICE_SETTINGS = {
  inputDeviceId: "default",
  inputVolume: 100,
  inputMode: "voice_activity" as InputMode,
  pushToTalkKey: "ControlLeft",
  pushToTalkKeyLabel: "Left Ctrl",
  sensitivity: -50,
  autoSensitivity: true,
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,

  outputDeviceId: "default",
  outputVolume: 100,

  attenuationEnabled: false,
  attenuationPercentage: 50,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_VOICE_SETTINGS,

      // Individual user audio states
      userVolumes: {},
      localMutedUsers: {},

      // Screen share options
      screenShareResolution: "1080p",
      screenShareFps: 30,
      screenShareVolume: 100,

      // Desktop & theme defaults
      theme: "dark",
      notificationsEnabled: true,
      soundEnabled: true,
      minimizeToTray: false,
      startWithWindows: false,
      lastGuildId: null,
      lastChannelId: null,
      mutedGuilds: {},
      mutedChannels: {},

      // Input actions
      setInputDeviceId: (id) => set({ inputDeviceId: id }),
      setInputVolume: (vol) => set({ inputVolume: Math.max(0, Math.min(100, vol)) }),
      setInputMode: (mode) => set({ inputMode: mode }),
      setPushToTalkKey: (code, label) =>
        set({ pushToTalkKey: code, pushToTalkKeyLabel: label }),
      setSensitivity: (val) => set({ sensitivity: Math.max(-100, Math.min(0, val)) }),
      setAutoSensitivity: (enabled) => set({ autoSensitivity: enabled }),
      setNoiseSuppression: (enabled) => set({ noiseSuppression: enabled }),
      setEchoCancellation: (enabled) => set({ echoCancellation: enabled }),
      setAutoGainControl: (enabled) => set({ autoGainControl: enabled }),

      // Output actions
      setOutputDeviceId: (id) => set({ outputDeviceId: id }),
      setOutputVolume: (vol) => set({ outputVolume: Math.max(0, Math.min(200, vol)) }),

      // User audio actions
      setUserVolume: (userId, volume) =>
        set((state) => ({
          userVolumes: {
            ...state.userVolumes,
            [userId]: Math.max(0, Math.min(200, volume)),
          },
        })),

      toggleLocalMute: (userId) =>
        set((state) => ({
          localMutedUsers: {
            ...state.localMutedUsers,
            [userId]: !state.localMutedUsers[userId],
          },
        })),

      getUserVolume: (userId) => {
        const vol = get().userVolumes[userId];
        return vol !== undefined ? vol : 100;
      },

      isUserLocallyMuted: (userId) => {
        return Boolean(get().localMutedUsers[userId]);
      },

      // Attenuation & Voice Reset
      setAttenuationEnabled: (enabled) => set({ attenuationEnabled: enabled }),
      setAttenuationPercentage: (val) =>
        set({ attenuationPercentage: Math.max(0, Math.min(100, val)) }),
      resetVoiceSettings: () => set(DEFAULT_VOICE_SETTINGS),

      // Screen share actions
      setScreenShareResolution: (res) => set({ screenShareResolution: res }),
      setScreenShareFps: (fps) => set({ screenShareFps: fps }),
      setScreenShareVolume: (vol) =>
        set({ screenShareVolume: Math.max(0, Math.min(200, vol)) }),

      // Desktop actions
      setTheme: (theme) => set({ theme }),
      setNotificationsEnabled: (enabled) => set({ notificationsEnabled: enabled }),
      setSoundEnabled: (enabled) => set({ soundEnabled: enabled }),
      setMinimizeToTray: (enabled) => set({ minimizeToTray: enabled }),
      setStartWithWindows: (enabled) => set({ startWithWindows: enabled }),
      setLastLocation: (guildId, channelId) =>
        set({ lastGuildId: guildId, lastChannelId: channelId }),

      toggleMuteGuild: (guildId) =>
        set((state) => ({
          mutedGuilds: {
            ...state.mutedGuilds,
            [guildId]: !state.mutedGuilds[guildId],
          },
        })),

      toggleMuteChannel: (channelId) =>
        set((state) => ({
          mutedChannels: {
            ...state.mutedChannels,
            [channelId]: !state.mutedChannels[channelId],
          },
        })),
    }),
    {
      name: "concord_user_settings",
    }
  )
);
