import { useSettingsStore } from "../stores/settingsStore";

export type SoundEffect =
  | "join"
  | "leave"
  | "move"
  | "mute"
  | "unmute"
  | "deafen"
  | "undeafen"
  | "disconnect"
  | "message"
  | "ptt_on"
  | "ptt_off"
  | "outgoing_call"
  | "incoming_call"
  | "bot_mute"
  | "secret_ringtone";

class SoundManager {
  private cache: Map<SoundEffect, HTMLAudioElement> = new Map();

  play(effect: SoundEffect, volumeOverride?: number) {
    if (typeof window === "undefined") return;

    const settings = useSettingsStore.getState();
    if (!settings.soundEnabled) return;

    try {
      let audio = this.cache.get(effect);
      if (!audio) {
        audio = new Audio(`/sounds/${effect}.mp3`);
        this.cache.set(effect, audio);
      }

      audio.currentTime = 0;
      const baseVol =
        typeof settings.outputVolume === "number" ? settings.outputVolume / 100 : 0.8;
      audio.volume = typeof volumeOverride === "number" ? volumeOverride : Math.min(1, Math.max(0, baseVol));

      audio.play().catch(() => {
        // Ignored if browser blocks autoplay or user didn't interact yet
      });
    } catch (err) {
      console.warn(`[SoundManager] Failed to play ${effect}:`, err);
    }
  }

  stop(effect: SoundEffect) {
    const audio = this.cache.get(effect);
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
  }
}

export const sound = new SoundManager();
