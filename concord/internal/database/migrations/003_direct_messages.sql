-- 003_direct_messages.sql
-- Allow guild_id to be NULL for direct message channels (type = 1)
ALTER TABLE channels ALTER COLUMN guild_id DROP NOT NULL;

-- Table to store participants in DM and group DM channels
CREATE TABLE IF NOT EXISTS channel_recipients (
    channel_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (channel_id, user_id)
);

CREATE INDEX IF NOT EXISTS channel_recipients_user_idx ON channel_recipients(user_id);
CREATE INDEX IF NOT EXISTS channels_type_idx ON channels(type);
