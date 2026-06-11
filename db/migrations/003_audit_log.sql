-- Sync audit log (SHAREPOINT_INTEGRATION.md §5.3 + SOUL.md non-negotiable):
-- every reconciliation (push, pull, conflict resolution, error retry) appends
-- a timestamped, actor-attributed row. Append-only; rendered newest-first.
-- Timestamps are UTC (timestamptz) — rendering localizes.

CREATE TABLE IF NOT EXISTS sync_audit_log (
    id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ts    timestamptz NOT NULL DEFAULT now(),
    actor text NOT NULL,
    body  text NOT NULL,
    state text NOT NULL CHECK (state IN ('synced', 'pending', 'conflict', 'error'))
);

CREATE INDEX IF NOT EXISTS sync_audit_log_ts_idx ON sync_audit_log (ts DESC);
