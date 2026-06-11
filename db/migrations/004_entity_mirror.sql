-- Server-side mirror of MC entities (the lens's working copy; SharePoint
-- stays the system of record). Entity payloads keep the canonical TS shapes
-- (src/lib/mc-data/types.ts) as jsonb; sync bookkeeping is relational:
--   sync_state    per-entity register state (drives the UI counts)
--   sp_item_id    Graph listItem id once the first outbound write lands
--   dirty_fields  MC-edited fields not yet pushed — the inbound delta uses
--                 this to raise conflicts instead of overwriting (§6).

CREATE TABLE IF NOT EXISTS entities (
    entity_type  text NOT NULL CHECK (entity_type IN ('task', 'risk', 'file')),
    id           text NOT NULL,
    data         jsonb NOT NULL,
    sync_state   text NOT NULL DEFAULT 'pending'
                 CHECK (sync_state IN ('synced', 'pending', 'conflict', 'error')),
    sync_ts      timestamptz,
    sp_item_id   text,
    dirty_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (entity_type, id)
);

CREATE INDEX IF NOT EXISTS entities_sync_state_idx ON entities (entity_type, sync_state);
