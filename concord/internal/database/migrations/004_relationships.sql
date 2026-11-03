-- Migration 004: Relationships & Friends System
-- Supports Friends (1), Blocked (2), Incoming Pending (3), Outgoing Pending (4)

CREATE TABLE IF NOT EXISTS relationships (
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type        INTEGER NOT NULL, -- 1: Friend, 2: Blocked, 3: Pending Incoming, 4: Pending Outgoing
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, target_id)
);

CREATE INDEX IF NOT EXISTS idx_relationships_user_id ON relationships(user_id);
CREATE INDEX IF NOT EXISTS idx_relationships_target_id ON relationships(target_id);
