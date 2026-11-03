import {
  AuthResponse,
  Channel,
  CreateChannelPayload,
  CreateGuildPayload,
  Guild,
  GuildDetail,
  LoginPayload,
  MeResponse,
  RegisterPayload,
  TokenResponse,
  User,
  ApiErrorResponse,
  Message,
  Member,
  Invite,
  InviteResponse,
  CreateInvitePayload,
  VoiceTokenResponse,
} from "../types";

// Base URL configuration with Vite env fallback
const RAW_BASE_URL = (import.meta.env && import.meta.env.VITE_API_URL) || "http://localhost:8080/v1";
export const API_BASE_URL = RAW_BASE_URL.replace(/\/+$/, "");

/**
 * Standardized API Error class capturing status code, backend error code, and message
 */
export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

// ==========================================
// 401 Mutex & Request Queue Mechanism
// ==========================================

let isRefreshing = false;
let refreshSubscribers: Array<{
  resolve: (token: string) => void;
  reject: (err: unknown) => void;
}> = [];

function subscribeTokenRefresh(cb: {
  resolve: (token: string) => void;
  reject: (err: unknown) => void;
}) {
  refreshSubscribers.push(cb);
}

function onRefreshed(token: string) {
  refreshSubscribers.forEach(({ resolve }) => resolve(token));
  refreshSubscribers = [];
}

function onRefreshFailed(error: unknown) {
  refreshSubscribers.forEach(({ reject }) => reject(error));
  refreshSubscribers = [];
}

/**
 * Token accessor reading from localStorage
 */
export function getAccessToken(): string | null {
  return localStorage.getItem("concord_token");
}

export function getRefreshToken(): string | null {
  return localStorage.getItem("concord_refresh_token");
}

export function setTokens(accessToken: string, refreshToken?: string): void {
  localStorage.setItem("concord_token", accessToken);
  if (refreshToken) {
    localStorage.setItem("concord_refresh_token", refreshToken);
  }
}

export function clearTokens(): void {
  localStorage.removeItem("concord_token");
  localStorage.removeItem("concord_refresh_token");
}

// Callback registered by authStore to perform full store logout on unrecoverable session expiry
let onUnauthorizedCallback: (() => void) | null = null;
export function setUnauthorizedCallback(cb: () => void) {
  onUnauthorizedCallback = cb;
}

// Request options extension with retry tracking
interface RequestOptions extends RequestInit {
  _retry?: boolean;
  skipAuth?: boolean;
}

/**
 * Core HTTP Request Function with auto-Bearer, mutex 401 refresh, and error normalization
 */
async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  const headers = new Headers(options.headers || {});

  // 1. Automatic Content-Type injection
  if (!headers.has("Content-Type") && options.body && typeof options.body === "string") {
    headers.set("Content-Type", "application/json");
  }

  // 2. Automatic Bearer token injection
  if (!options.skipAuth) {
    const token = getAccessToken();
    if (token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }

  let response: Response;
  try {
    response = await fetch(url, { ...options, headers });
  } catch (netErr: unknown) {
    throw new ApiError(0, "NETWORK_ERROR", "Unable to connect to Concord server. Please check your connection.");
  }

  // 3. Handle 401 Unauthorized with Mutex Refresh
  if (response.status === 401 && !options._retry) {
    // Avoid infinite loop if auth endpoints themselves return 401
    const isAuthEndpoint =
      endpoint.startsWith("/auth/login") ||
      endpoint.startsWith("/auth/register") ||
      endpoint.startsWith("/auth/refresh");

    if (isAuthEndpoint) {
      const errData = await parseErrorBody(response);
      throw new ApiError(response.status, errData.code, errData.error);
    }

    // If refresh is already in-flight, queue this request
    if (isRefreshing) {
      return new Promise<T>((resolve, reject) => {
        subscribeTokenRefresh({
          resolve: (newToken: string) => {
            const retryHeaders = new Headers(options.headers || {});
            retryHeaders.set("Authorization", `Bearer ${newToken}`);
            request<T>(endpoint, {
              ...options,
              headers: retryHeaders,
              _retry: true,
            })
              .then(resolve)
              .catch(reject);
          },
          reject: (err: unknown) => {
            reject(err);
          },
        });
      });
    }

    // First request to encounter 401 locks the mutex
    isRefreshing = true;
    const currentRefreshToken = getRefreshToken();

    if (!currentRefreshToken) {
      isRefreshing = false;
      clearTokens();
      if (onUnauthorizedCallback) onUnauthorizedCallback();
      throw new ApiError(401, "UNAUTHORIZED", "Session expired. Please log in again.");
    }

    try {
      // Execute raw fetch for refresh to bypass interceptor
      const refreshResponse = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: currentRefreshToken }),
      });

      if (!refreshResponse.ok) {
        const errData = await parseErrorBody(refreshResponse);
        throw new ApiError(refreshResponse.status, errData.code, errData.error);
      }

      const refreshData: TokenResponse = await refreshResponse.json();
      const newAccessToken = refreshData.token;

      // Update stored access token
      setTokens(newAccessToken);

      isRefreshing = false;
      onRefreshed(newAccessToken);

      // Re-execute original request with new access token
      const retryHeaders = new Headers(options.headers || {});
      retryHeaders.set("Authorization", `Bearer ${newAccessToken}`);
      return request<T>(endpoint, {
        ...options,
        headers: retryHeaders,
        _retry: true,
      });
    } catch (refreshErr) {
      isRefreshing = false;
      clearTokens();
      onRefreshFailed(refreshErr);
      if (onUnauthorizedCallback) onUnauthorizedCallback();
      throw refreshErr;
    }
  }

  // 4. Handle non-2xx HTTP errors
  if (!response.ok) {
    const errData = await parseErrorBody(response);
    throw new ApiError(response.status, errData.code, errData.error);
  }

  // 5. Handle 204 No Content
  if (response.status === 204) {
    return undefined as unknown as T;
  }

  // 6. Parse and return JSON payload
  return (await response.json()) as T;
}

/**
 * Safely parse error response body
 */
async function parseErrorBody(response: Response): Promise<ApiErrorResponse> {
  try {
    const body = await response.json();
    return {
      error: body.error || `Request failed with status ${response.status}`,
      code: body.code || "UNKNOWN_ERROR",
    };
  } catch {
    return {
      error: response.statusText || `Request failed with status ${response.status}`,
      code: "UNKNOWN_ERROR",
    };
  }
}

// ==========================================
// Strongly-Typed API Client Methods
// ==========================================

export const api = {
  auth: {
    register: async (payload: RegisterPayload): Promise<AuthResponse> => {
      return request<AuthResponse>("/auth/register", {
        method: "POST",
        body: JSON.stringify(payload),
        skipAuth: true,
      });
    },

    login: async (payload: LoginPayload): Promise<AuthResponse> => {
      return request<AuthResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify(payload),
        skipAuth: true,
      });
    },

    refresh: async (refreshToken: string): Promise<TokenResponse> => {
      return request<TokenResponse>("/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ refresh_token: refreshToken }),
        skipAuth: true,
      });
    },

    me: async (): Promise<User> => {
      const res = await request<MeResponse>("/auth/me", {
        method: "GET",
      });
      return res.user;
    },
  },

  guilds: {
    list: async (): Promise<Guild[]> => {
      return request<Guild[]>("/guilds", {
        method: "GET",
      });
    },

    create: async (payload: CreateGuildPayload): Promise<GuildDetail> => {
      return request<GuildDetail>("/guilds", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },

    get: async (guildId: string): Promise<GuildDetail> => {
      return request<GuildDetail>(`/guilds/${guildId}`, {
        method: "GET",
      });
    },

    delete: async (guildId: string): Promise<void> => {
      return request<void>(`/guilds/${guildId}`, {
        method: "DELETE",
      });
    },
  },

  channels: {
    list: async (guildId: string): Promise<Channel[]> => {
      return request<Channel[]>(`/guilds/${guildId}/channels`, {
        method: "GET",
      });
    },

    create: async (guildId: string, payload: CreateChannelPayload): Promise<Channel> => {
      return request<Channel>(`/guilds/${guildId}/channels`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },

    delete: async (channelId: string): Promise<void> => {
      return request<void>(`/channels/${channelId}`, {
        method: "DELETE",
      });
    },

    typing: async (channelId: string): Promise<void> => {
      return request<void>(`/channels/${channelId}/typing`, {
        method: "POST",
      });
    },
  },

  messages: {
    list: async (channelId: string, before?: string, limit: number = 50): Promise<Message[]> => {
      let query = `?limit=${limit}`;
      if (before) {
        query += `&before=${encodeURIComponent(before)}`;
      }
      return request<Message[]>(`/channels/${channelId}/messages${query}`, {
        method: "GET",
      });
    },

    create: async (channelId: string, content: string, replyToId?: string): Promise<Message> => {
      return request<Message>(`/channels/${channelId}/messages`, {
        method: "POST",
        body: JSON.stringify({
          content,
          ...(replyToId ? { reply_to_id: replyToId } : {}),
        }),
      });
    },

    edit: async (channelId: string, messageId: string, content: string): Promise<Message> => {
      return request<Message>(`/channels/${channelId}/messages/${messageId}`, {
        method: "PATCH",
        body: JSON.stringify({ content }),
      });
    },

    update: async (channelId: string, messageId: string, content: string): Promise<Message> => {
      return request<Message>(`/channels/${channelId}/messages/${messageId}`, {
        method: "PATCH",
        body: JSON.stringify({ content }),
      });
    },

    delete: async (channelId: string, messageId: string): Promise<void> => {
      return request<void>(`/channels/${channelId}/messages/${messageId}`, {
        method: "DELETE",
      });
    },
  },

  invites: {
    create: async (guildId: string, payload?: CreateInvitePayload): Promise<Invite> => {
      return request<Invite>(`/guilds/${guildId}/invites`, {
        method: "POST",
        body: JSON.stringify(payload || {}),
      });
    },

    get: async (code: string): Promise<InviteResponse> => {
      return request<InviteResponse>(`/invites/${code}`, {
        method: "GET",
      });
    },

    use: async (code: string): Promise<GuildDetail> => {
      return request<GuildDetail>(`/invites/${code}/use`, {
        method: "POST",
      });
    },
  },

  members: {
    list: async (guildId: string): Promise<Member[]> => {
      return request<Member[]>(`/guilds/${guildId}/members`, {
        method: "GET",
      });
    },
  },

  voice: {
    getToken: async (channelId: string): Promise<VoiceTokenResponse> => {
      return request<VoiceTokenResponse>(`/channels/${channelId}/voice/token`, {
        method: "POST",
      });
    },
  },
};
