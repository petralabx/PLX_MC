-- Project entity above Bucket (P2 / scoping Axis A). Operators expect
-- Project → Bucket → Task → Sub-task, but the model stopped at Bucket. This adds
-- a nullable Project parent: additive and reversible (no destructive change), so
-- existing buckets/tasks are untouched and compliance MC_BUCKET auto-create stays
-- valid (Project is purely an organizing parent).
--
-- Mirrors the buckets table (007): the full Project shape lives in `data` (jsonb),
-- seeded idempotently by the engine from the PROJECTS fixture
-- (src/lib/mc-data/data.ts) — the single source of truth, not duplicated in SQL.
-- sync_state / sp_item_id are carried for the FUTURE projects ↔ Roadmap mirror
-- (deferred, exactly like buckets today).

CREATE TABLE IF NOT EXISTS projects (
    id          text PRIMARY KEY,
    data        jsonb NOT NULL,
    sync_state  text NOT NULL DEFAULT 'pending'
                CHECK (sync_state IN ('synced', 'pending', 'conflict', 'error')),
    sp_item_id  text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Nullable FK from bucket → project. Nullable so the column is additive (every
-- existing bucket stays valid with NULL until backfilled) and ON DELETE SET NULL
-- so removing a project never cascades into deleting initiatives/tasks (DB-safety:
-- no destructive delete of owned rows).
ALTER TABLE buckets
    ADD COLUMN IF NOT EXISTS project_id text
    REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS buckets_project_id_idx ON buckets (project_id);

-- Idempotent backfill: every current bucket is PLX Portal go-live work (EN-002),
-- so attach any unparented bucket to the default project. The project row itself
-- is seeded by the engine from the PROJECTS fixture; create a minimal row here so
-- the FK backfill is self-contained even if the engine seed has not run yet.
INSERT INTO projects (id, data, sync_state)
VALUES (
    'PRJ-PORTAL-GOLIVE',
    '{"id":"PRJ-PORTAL-GOLIVE","name":"PLX Portal Go-Live","owner":"vince","health":"track","target":"Oct 01","started":"2026.06.11","desc":"Umbrella project for all PLX Portal go-live initiatives.","repos":["portal-web"],"sync":{"state":"pending","ts":"—","sp":"Roadmap · unprovisioned"},"prd":null}'::jsonb,
    'pending'
)
ON CONFLICT (id) DO NOTHING;

UPDATE buckets
    SET project_id = 'PRJ-PORTAL-GOLIVE'
    WHERE project_id IS NULL;
