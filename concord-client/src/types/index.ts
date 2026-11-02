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
