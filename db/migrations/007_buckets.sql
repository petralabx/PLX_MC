-- Flexible buckets / initiatives (EN-005). Buckets were a static fixture with no
-- create path; persist them so user-created initiatives survive a reload. The 8
-- fixture buckets are seeded idempotently by the engine from the BUCKETS fixture
-- (src/lib/mc-data/data.ts) — the single source of truth, not duplicated in SQL.
--
-- The full Bucket shape lives in `data` (jsonb), like the entities mirror;
-- sync_state / sp_item_id are carried for the FUTURE buckets ↔ Roadmap list
-- mirror (deferred — the engine does not mirror the Roadmap list yet, so buckets
-- are app-persistent for now, exactly as the repo registry shipped DB-first).

CREATE TABLE IF NOT EXISTS buckets (
    id          text PRIMARY KEY,
    data        jsonb NOT NULL,
    sync_state  text NOT NULL DEFAULT 'pending'
                CHECK (sync_state IN ('synced', 'pending', 'conflict', 'error')),
    sp_item_id  text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
