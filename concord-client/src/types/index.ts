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
  members?: Member[];
  presences?: Presence[];
  voice_states?: VoiceState[];
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
  roles?: Snowflake[];
  joined_at: string;
  deaf: boolean;
  mute: boolean;
  flags: number;
  user?: UserSummary;
}

export interface Ban {
  user: UserSummary;
  reason?: string | null;
  created_at: string;
}

export interface CreateRolePayload {
  name: string;
  permissions?: string;
  color?: number;
  hoist?: boolean;
  mentionable?: boolean;
}

export interface UpdateRolePayload {
  name?: string;
  permissions?: string;
  color?: number;
  hoist?: boolean;
  mentionable?: boolean;
  position?: number;
}

export interface UpdateMemberPayload {
  nick?: string | null;
  mute?: boolean;
  deaf?: boolean;
  roles?: Snowflake[];
}

export interface CreateBanPayload {
  reason?: string;
  delete_message_days?: number;
}

export interface UpdateGuildPayload {
  name?: string;
  icon?: string | null;
}

export const Permissions = {
  CREATE_INSTANT_INVITE: 1n << 0n,
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_GUILD: 1n << 5n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
  MUTE_MEMBERS: 1n << 22n,
  DEAFEN_MEMBERS: 1n << 23n,
  MOVE_MEMBERS: 1n << 24n,
  MANAGE_ROLES: 1n << 28n,
} as const;


// ==========================================
// Channel Models
// ==========================================

export const ChannelType = {
  TEXT: 0,
  DM: 1,
  VOICE: 2,
  GROUP_DM: 3,
  CATEGORY: 4,
} as const;

export type ChannelTypeValue = typeof ChannelType[keyof typeof ChannelType];

export interface Channel {
  id: Snowflake;
  guild_id?: Snowflake | null;
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
  recipients?: User[];
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
  VOICE_STATE_UPDATE: "VOICE_STATE_UPDATE",
  PRESENCE_UPDATE: "PRESENCE_UPDATE",
  GUILD_MEMBER_ADD: "GUILD_MEMBER_ADD",
  GUILD_MEMBER_REMOVE: "GUILD_MEMBER_REMOVE",
  GUILD_MEMBER_UPDATE: "GUILD_MEMBER_UPDATE",
  GUILD_ROLE_CREATE: "GUILD_ROLE_CREATE",
  GUILD_ROLE_UPDATE: "GUILD_ROLE_UPDATE",
  GUILD_ROLE_DELETE: "GUILD_ROLE_DELETE",
  GUILD_BAN_ADD: "GUILD_BAN_ADD",
  GUILD_BAN_REMOVE: "GUILD_BAN_REMOVE",
  RELATIONSHIP_ADD: "RELATIONSHIP_ADD",
  RELATIONSHIP_REMOVE: "RELATIONSHIP_REMOVE",
  RELATIONSHIP_UPDATE: "RELATIONSHIP_UPDATE",
  RESUMED: "RESUMED",
} as const;

// ==========================================
// Milestone: Relationships & Friends System
// ==========================================

export const RelationshipType = {
  NONE: 0,
  FRIEND: 1,
  BLOCKED: 2,
  PENDING_INCOMING: 3,
  PENDING_OUTGOING: 4,
} as const;

export type RelationshipType = (typeof RelationshipType)[keyof typeof RelationshipType];

export interface Relationship {
  id: Snowflake; // target user id
  type: RelationshipType;
  user: User;
}

export interface SendFriendRequestPayload {
  username: string;
}

// ==========================================
// Milestone 3: Presence & Voice State Models
// ==========================================

export type UserStatus = "online" | "idle" | "dnd" | "invisible" | "offline";

export interface Presence {
  user_id: Snowflake;
  status: UserStatus;
  guild_id?: Snowflake;
  client_status?: {
    desktop?: UserStatus;
  };
  user?: UserSummary;
}

export interface VoiceState {
  guild_id: Snowflake;
  channel_id: Snowflake | null;
  user_id: Snowflake;
  session_id: string;
  self_mute: boolean;
  self_deaf: boolean;
  self_video?: boolean;
  self_stream?: boolean;
  member?: Member;
}

export interface VoiceStateUpdatePayload {
  guild_id: Snowflake;
  channel_id: Snowflake | null;
  self_mute?: boolean;
  self_deaf?: boolean;
  self_video?: boolean;
  self_stream?: boolean;
}

export interface VoiceTokenResponse {
  token: string;
  url: string;
  room: string;
  channel_id: Snowflake;
}

// ==========================================
// Milestone 3: Invite Models
// ==========================================

export interface Invite {
  code: string;
  guild_id: Snowflake;
  channel_id: Snowflake;
  inviter_id: Snowflake;
  uses: number;
  max_uses: number;
  expires_at: string | null;
  created_at: string;
}

export interface CreateInvitePayload {
  channel_id?: Snowflake;
  max_uses?: number;
  max_age?: number;
}

export interface InviteResponse {
  code: string;
  guild_id: Snowflake;
  channel_id: Snowflake;
  inviter_id: Snowflake;
  uses: number;
  max_uses: number;
  expires_at: string | null;
  created_at: string;
  guild: {
    id: Snowflake;
    name: string;
    icon?: string | null;
    member_count: number;
  };
  channel: {
    id: Snowflake;
    name: string;
    type: number;
  };
  inviter: UserSummary;
}

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

