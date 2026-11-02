import { create } from "zustand";
import { UserStatus } from "../types";
import { getGatewayClient } from "../gateway/GatewayClient";

interface PresenceState {
  presences: Record<string, UserStatus>;
  myStatus: UserStatus;

  setPresence: (userId: string, status: UserStatus) => void;
  setBulkPresences: (presences: Array<{ user_id: string; status: UserStatus }>) => void;
  setMyStatus: (status: UserStatus) => void;
  updateMyStatus: (status: UserStatus) => void;
}

export const usePresenceStore = create<PresenceState>((set) => ({
  presences: {},
  myStatus: "online",

  setPresence: (userId, status) => {
    set((state) => ({
      presences: {
        ...state.presences,
        [userId]: status,
      },
    }));
  },

  setBulkPresences: (items) => {
    set((state) => {
      const next = { ...state.presences };
      for (const item of items) {
        if (item.user_id && item.status) {
          next[item.user_id] = item.status;
        }
      }
      return { presences: next };
    });
  },

  setMyStatus: (status) => {
    set({ myStatus: status });
  },

  updateMyStatus: (status) => {
    set({ myStatus: status });
    try {
      const gw = getGatewayClient();
      gw.sendPresenceUpdate(status);
    } catch (err) {
      console.error("[presenceStore] Failed to send presence update to gateway", err);
    }
  },
}));
