-- Migration: 001_init.sql
-- Description: Concord Foundation Schema (11 tables)

-- 1. USERS
CREATE TABLE IF NOT EXISTS users (
    id          BIGINT PRIMARY KEY,
    username    VARCHAR(32) NOT NULL UNIQUE,
    email       VARCHAR(255) NOT NULL UNIQUE,
    password    VARCHAR(255) NOT NULL,          -- bcrypt hash (cost 12)
    avatar      VARCHAR(255),
    global_name VARCHAR(32),
    flags       INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users(LOWER(email));
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users(LOWER(username));

-- 2. GUILDS
CREATE TABLE IF NOT EXISTS guilds (
    id              BIGINT PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    icon            VARCHAR(255),
    owner_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    afk_channel_id  BIGINT,                     -- FK added below after channels table
    afk_timeout     INTEGER NOT NULL DEFAULT 300,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS guilds_owner_id_idx ON guilds(owner_id);

-- 3. CHANNELS
CREATE TABLE IF NOT EXISTS channels (
    id              BIGINT PRIMARY KEY,
    guild_id        BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    type            SMALLINT NOT NULL,          -- 0=text, 2=voice, 4=category
    name            VARCHAR(100) NOT NULL,
    topic           VARCHAR(1024),
    position        INTEGER NOT NULL DEFAULT 0,
    parent_id       BIGINT REFERENCES channels(id) ON DELETE SET NULL,
    bitrate         INTEGER DEFAULT 64000,
    user_limit      INTEGER DEFAULT 0,
    rate_limit      INTEGER NOT NULL DEFAULT 0,
    nsfw            BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS channels_guild_id_position_idx ON channels(guild_id, position ASC);

-- 3.1 CIRCULAR FK RESOLUTION: guilds.afk_channel_id -> channels.id
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_guilds_afk_channel'
    ) THEN
        ALTER TABLE guilds 
            ADD CONSTRAINT fk_guilds_afk_channel 
            FOREIGN KEY (afk_channel_id) 
            REFERENCES channels(id) 
            ON DELETE SET NULL;
    END IF;
END $$;

-- 4. MESSAGES
CREATE TABLE IF NOT EXISTS messages (
    id              BIGINT PRIMARY KEY,
    channel_id      BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    author_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content         TEXT NOT NULL DEFAULT '',
    type            SMALLINT NOT NULL DEFAULT 0, -- 0=default, 19=reply
    edited_at       TIMESTAMPTZ,
    pinned          BOOLEAN NOT NULL DEFAULT FALSE,
    reply_to_id     BIGINT REFERENCES messages(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS messages_channel_created ON messages(channel_id, created_at DESC);

-- 5. MEMBERS
CREATE TABLE IF NOT EXISTS members (
    guild_id    BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nick        VARCHAR(32),
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deaf        BOOLEAN NOT NULL DEFAULT FALSE,
    mute        BOOLEAN NOT NULL DEFAULT FALSE,
    flags       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
);

CREATE INDEX IF NOT EXISTS members_user_id_idx ON members(user_id);

-- 6. ROLES
CREATE TABLE IF NOT EXISTS roles (
    id          BIGINT PRIMARY KEY,
    guild_id    BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    name        VARCHAR(100) NOT NULL,
    permissions BIGINT NOT NULL DEFAULT 0,
    position    INTEGER NOT NULL DEFAULT 0,
    color       INTEGER NOT NULL DEFAULT 0,
    hoist       BOOLEAN NOT NULL DEFAULT FALSE,
    mentionable BOOLEAN NOT NULL DEFAULT FALSE,
    managed     BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS roles_guild_id_idx ON roles(guild_id, position ASC);

-- 7. MEMBER_ROLES
CREATE TABLE IF NOT EXISTS member_roles (
    guild_id BIGINT NOT NULL,
    user_id  BIGINT NOT NULL,
    role_id  BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (guild_id, user_id, role_id),
    FOREIGN KEY (guild_id, user_id) REFERENCES members(guild_id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS member_roles_role_id_idx ON member_roles(role_id);

-- 8. PERMISSION_OVERWRITES
CREATE TABLE IF NOT EXISTS permission_overwrites (
    channel_id  BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    target_id   BIGINT NOT NULL,                -- role_id or user_id
    target_type SMALLINT NOT NULL,              -- 0=role, 1=member
    allow       BIGINT NOT NULL DEFAULT 0,
    deny        BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (channel_id, target_id, target_type)
);

-- 9. VOICE_STATES
CREATE TABLE IF NOT EXISTS voice_states (
    guild_id    BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    channel_id  BIGINT REFERENCES channels(id) ON DELETE SET NULL,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id  VARCHAR(36) NOT NULL,
    self_mute   BOOLEAN NOT NULL DEFAULT FALSE,
    self_deaf   BOOLEAN NOT NULL DEFAULT FALSE,
    self_video  BOOLEAN NOT NULL DEFAULT FALSE,
    self_stream BOOLEAN NOT NULL DEFAULT FALSE,
    server_mute BOOLEAN NOT NULL DEFAULT FALSE,
    server_deaf BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (guild_id, user_id)
);

CREATE INDEX IF NOT EXISTS voice_states_channel_id_idx ON voice_states(channel_id);

-- 10. INVITES
CREATE TABLE IF NOT EXISTS invites (
    code        VARCHAR(10) PRIMARY KEY,
    guild_id    BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    channel_id  BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    inviter_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    uses        INTEGER NOT NULL DEFAULT 0,
    max_uses    INTEGER NOT NULL DEFAULT 0,
    expires_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS invites_guild_id_idx ON invites(guild_id);

-- 11. ATTACHMENTS
CREATE TABLE IF NOT EXISTS attachments (
    id           BIGINT PRIMARY KEY,
    message_id   BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    filename     VARCHAR(255) NOT NULL,
    size         INTEGER NOT NULL,
    url          VARCHAR(500) NOT NULL,
    content_type VARCHAR(100),
    width        INTEGER,
    height       INTEGER
);

CREATE INDEX IF NOT EXISTS attachments_message_id_idx ON attachments(message_id);
