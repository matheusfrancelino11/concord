import { create } from "zustand";
import { User, LoginPayload, RegisterPayload } from "../types";
import { useVoiceStore } from "./voiceStore";
import {
  api,
  ApiError,
  getAccessToken,
  getRefreshToken,
  setTokens,
  clearTokens,
  setUnauthorizedCallback,
} from "../api/client";

export interface AuthState {
  user: User | null;
  token: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  login: (payload: LoginPayload) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<void>;
  clearError: () => void;
  setToken: (token: string) => void;
  updateUser: (user: Partial<User>) => void;
}

export const useAuthStore = create<AuthState>((set) => {
  // Register unauthorized callback so API client 401 failures trigger UI logout
  setUnauthorizedCallback(() => {
    try {
      useVoiceStore.getState().leaveVoiceChannel();
    } catch (err) {
      console.warn("[authStore] Failed to leave voice channel on unauthorized:", err);
    }
    set({
      user: null,
      token: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,
    });
  });

  return {
    user: null,
    token: getAccessToken(),
    refreshToken: getRefreshToken(),
    isAuthenticated: false,
    isLoading: true, // true on initial load while checkAuth verifies session
    error: null,

    login: async (payload: LoginPayload) => {
      set({ isLoading: true, error: null });
      try {
        const data = await api.auth.login(payload);
        setTokens(data.token, data.refresh_token);
        set({
          user: data.user,
          token: data.token,
          refreshToken: data.refresh_token,
          isAuthenticated: true,
          isLoading: false,
          error: null,
        });
      } catch (err: unknown) {
        const message = err instanceof ApiError ? err.message : "Failed to log in";
        set({ isLoading: false, error: message });
        throw err;
      }
    },

    register: async (payload: RegisterPayload) => {
      set({ isLoading: true, error: null });
      try {
        const data = await api.auth.register(payload);
        setTokens(data.token, data.refresh_token);
        set({
          user: data.user,
          token: data.token,
          refreshToken: data.refresh_token,
          isAuthenticated: true,
          isLoading: false,
          error: null,
        });
      } catch (err: unknown) {
        const message = err instanceof ApiError ? err.message : "Failed to register";
        set({ isLoading: false, error: message });
        throw err;
      }
    },

    logout: () => {
      try {
        useVoiceStore.getState().leaveVoiceChannel();
      } catch (err) {
        console.warn("[authStore] Failed to leave voice channel on logout:", err);
      }
      clearTokens();
      set({
        user: null,
        token: null,
        refreshToken: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
      });
    },

    checkAuth: async () => {
      const token = getAccessToken();
      const refreshToken = getRefreshToken();

      if (!token && !refreshToken) {
        set({ isAuthenticated: false, isLoading: false });
        return;
      }

      set({ isLoading: true, error: null });
      try {
        const user = await api.auth.me();
        set({
          user,
          token: getAccessToken(),
          refreshToken: getRefreshToken(),
          isAuthenticated: true,
          isLoading: false,
          error: null,
        });
      } catch {
        // If /auth/me and token refresh both fail, wipe invalid tokens
        clearTokens();
        set({
          user: null,
          token: null,
          refreshToken: null,
          isAuthenticated: false,
          isLoading: false,
          error: null,
        });
      }
    },

    clearError: () => {
      set({ error: null });
    },

    setToken: (token: string) => {
      setTokens(token);
      set({ token });
    },

    updateUser: (updatedFields: Partial<User>) => {
      set((state) => ({
        user: state.user ? { ...state.user, ...updatedFields } : null,
      }));
    },
  };
});
