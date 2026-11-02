/**
 * Concord Core Shared Types
 * Strictly enforces 64-bit Snowflake IDs as strings to prevent IEEE-754 precision loss.
 */

export type Snowflake = string;

// ==========================================
// User Models
// ==========================================

export interface User {
  id: Snowflake;
  username: string;
  email: string;
  avatar?: string | null;
  global_name?: string | null;
  flags: number;
  created_at: string;
}

export interface UserSummary {
  id: Snowflake;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
}

// ==========================================
// Guild (Server) Models
// ==========================================

export interface Guild {
  id: Snowflake;
  name: string;
  icon?: string | null;
  owner_id: Snowflake;
  created_at: string;
}

export interface GuildDetail extends Guild {
  afk_channel_id?: Snowflake | null;
  afk_timeout?: number;
  channels: Channel[];
  roles: Role[];
}

export interface Role {
  id: Snowflake;
  guild_id: Snowflake;
  name: string;
  permissions: string; // Bitfield serialized as string from Go backend
  position: number;
  color: number;
  hoist: boolean;
  mentionable: boolean;
  managed: boolean;
}

export interface Member {
  guild_id: Snowflake;
  user_id: Snowflake;
  nick?: string | null;
  joined_at: string;
  deaf: boolean;
  mute: boolean;
  flags: number;
  user?: UserSummary;
}

// ==========================================
// Channel Models
// ==========================================

export const ChannelType = {
  TEXT: 0,
  VOICE: 2,
  CATEGORY: 4,
} as const;

export type ChannelTypeValue = typeof ChannelType[keyof typeof ChannelType];

export interface Channel {
  id: Snowflake;
  guild_id: Snowflake;
  type: ChannelTypeValue;
  name: string;
  topic?: string | null;
  position: number;
  parent_id?: Snowflake | null;
  bitrate?: number | null;
  user_limit?: number | null;
  rate_limit: number;
  nsfw: boolean;
  created_at: string;
}

// ==========================================
// Authentication & API Payloads
// ==========================================

export interface RegisterPayload {
  email: string;
  username: string;
  password: string;
  global_name?: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RefreshPayload {
  refresh_token: string;
}

export interface AuthResponse {
  user: User;
  token: string;
  refresh_token: string;
}

export interface TokenResponse {
  token: string;
}

export interface MeResponse {
  user: User;
}

export interface CreateGuildPayload {
  name: string;
  icon?: string;
}

export interface CreateChannelPayload {
  name: string;
  type: ChannelTypeValue;
  topic?: string;
  parent_id?: Snowflake;
  bitrate?: number;
  user_limit?: number;
}

// ==========================================
// Standard Error Response
// ==========================================

export interface ApiErrorResponse {
  error: string;
  code: string;
}

// ==========================================
// Gateway Opcodes & Events
// ==========================================

export enum GatewayOpcode {
  DISPATCH = 0,          // Server -> Client: Event dispatch
  HEARTBEAT = 1,         // Client <-> Server: Ping/Pong keepalive
  IDENTIFY = 2,          // Client -> Server: Handshake with JWT token
  PRESENCE_UPDATE = 3,   // Client -> Server: Presence status update
  VOICE_STATE_UPDATE = 4,// Client -> Server: Voice channel connection
  RESUME = 6,            // Client -> Server: Session resume
  RECONNECT = 7,         // Server -> Client: Server requests reconnect
  INVALID_SESSION = 9,   // Server -> Client: Re-identify required
  HELLO = 10,            // Server -> Client: Initial greeting with interval
  HEARTBEAT_ACK = 11,    // Server -> Client: Heartbeat acknowledgment
}

export const GatewayEvent = {
  READY: "READY",
  GUILD_CREATE: "GUILD_CREATE",
  GUILD_UPDATE: "GUILD_UPDATE",
  GUILD_DELETE: "GUILD_DELETE",
  CHANNEL_CREATE: "CHANNEL_CREATE",
  CHANNEL_UPDATE: "CHANNEL_UPDATE",
  CHANNEL_DELETE: "CHANNEL_DELETE",
  MESSAGE_CREATE: "MESSAGE_CREATE",
  MESSAGE_UPDATE: "MESSAGE_UPDATE",
  MESSAGE_DELETE: "MESSAGE_DELETE",
  TYPING_START: "TYPING_START",
  RESUMED: "RESUMED",
} as const;

export type GatewayEventType = (typeof GatewayEvent)[keyof typeof GatewayEvent];

export interface GatewayPayload<T = unknown> {
  op: GatewayOpcode;
  d: T;
  s?: number | null;
  t?: GatewayEventType | string | null;
}

export type GatewayMessage<T = unknown> = GatewayPayload<T>;

export interface IdentifyPayload {
  token: string;
  properties?: {
    os?: string;
    browser?: string;
    device?: string;
  };
}

export interface ResumePayload {
  token: string;
  session_id: string;
  seq: number;
}

export interface HelloPayload {
  heartbeat_interval: number;
}

export interface ReadyPayload {
  v: number;
  user: User;
  session_id: string;
  guilds: Array<{ id: string; unavailable: boolean }>;
}

// ==========================================
// Message Models
// ==========================================

export type Author = UserSummary;

export interface Message {
  id: Snowflake;
  channel_id: Snowflake;
  guild_id?: Snowflake;
  author: UserSummary;
  author_id?: Snowflake;
  content: string;
  type: number;
  edited_at: string | null;
  pinned: boolean;
  reply_to_id?: Snowflake | null;
  created_at: string;
}

export interface CreateMessagePayload {
  content: string;
  reply_to_id?: Snowflake | null;
}

export interface UpdateMessagePayload {
  content: string;
}

export interface MessageDeletePayload {
  id: Snowflake;
  channel_id: Snowflake;
  guild_id?: Snowflake;
}

export interface TypingStartPayload {
  channel_id: Snowflake;
  guild_id?: Snowflake;
  user_id: Snowflake;
  username?: string;
  timestamp?: number;
}

export type TypingPayload = TypingStartPayload;

