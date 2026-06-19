-- EN-007 review hardening (S3 idempotency + S5 export index). Additive + idempotent.
-- dedup_key lets reconciliation replays be idempotent: an event carrying a key is
-- inserted ON CONFLICT DO NOTHING, so replaying the same queued work never
-- duplicates a gate/pr.* row. NULL keys (e.g. checkout) are unconstrained.

ALTER TABLE mc_events ADD COLUMN IF NOT EXISTS dedup_key text;

CREATE UNIQUE INDEX IF NOT EXISTS mc_events_dedup_key_uidx
    ON mc_events (dedup_key) WHERE dedup_key IS NOT NULL;

-- The export query is `WHERE seq > $1 AND kind = $3 ORDER BY seq ASC`; the
-- (kind, ts) index can't serve that keyset scan. (kind, seq) does.
CREATE INDEX IF NOT EXISTS mc_events_kind_seq_idx ON mc_events (kind, seq);
