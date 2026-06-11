-- Conflict review queue + one-sided push errors (SHAREPOINT_INTEGRATION.md §5).
-- Conflicts are two-sided (same field edited on both sides since last sync)
-- and are ONLY resolved by a human picking a winner — never automatically.
-- Push errors are outbound writes SharePoint rejected (e.g. invalid Choice).
-- Resolved rows are kept (resolved_at set) — the queue is also history.

CREATE TABLE IF NOT EXISTS sync_conflicts (
    id          text PRIMARY KEY,
    list_key    text NOT NULL,
    entity_type text NOT NULL,
    entity_id   text NOT NULL,
    field       text NOT NULL,
    mc_val      text,
    sp_val      text,
    detected_at timestamptz NOT NULL DEFAULT now(),
    detected_by text NOT NULL DEFAULT '',
    note        text NOT NULL DEFAULT '',
    resolved_at timestamptz,
    winner      text CHECK (winner IN ('mc', 'sp'))
);

CREATE INDEX IF NOT EXISTS sync_conflicts_open_idx
    ON sync_conflicts (list_key) WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS sync_push_errors (
    id          text PRIMARY KEY,
    list_key    text NOT NULL,
    entity_type text NOT NULL,
    entity_id   text NOT NULL,
    field       text NOT NULL,
    value       text,
    reason      text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS sync_push_errors_open_idx
    ON sync_push_errors (list_key) WHERE resolved_at IS NULL;
