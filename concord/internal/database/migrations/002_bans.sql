-- Migration: 002_bans.sql
-- Description: Server Bans table for Milestone 6 Administration

CREATE TABLE IF NOT EXISTS bans (
    guild_id   BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason     VARCHAR(512),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (guild_id, user_id)
);

CREATE INDEX IF NOT EXISTS bans_guild_id_idx ON bans(guild_id);
