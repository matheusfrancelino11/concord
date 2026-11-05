import { create } from "zustand";
import { UserSummary } from "../types";

interface ProfileModalOptions {
  nick?: string | null;
  joinedAt?: string;
  roles?: Array<{ id: string; name: string; color: number }>;
  inVoice?: boolean;
}

interface ProfileModalStore {
  isOpen: boolean;
  user: UserSummary | null;
  options: ProfileModalOptions;
  openProfile: (user: UserSummary, options?: ProfileModalOptions) => void;
  closeProfile: () => void;
}

export const useProfileModalStore = create<ProfileModalStore>((set) => ({
  isOpen: false,
  user: null,
  options: {},
  openProfile: (user, options = {}) =>
    set({
      isOpen: true,
      user,
      options,
    }),
  closeProfile: () =>
    set({
      isOpen: false,
      user: null,
      options: {},
    }),
}));
