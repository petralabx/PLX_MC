-- EN-007 P2: the fail-closed reconciliation queue (decision 10). When MC/the DB
-- is degraded, verification + ingestion work is enqueued here and replayed on
-- recovery (reuses the sync push-error/sweep posture). Additive + idempotent.

CREATE TABLE IF NOT EXISTS mc_reconcile_queue (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind        text NOT NULL CHECK (kind IN ('verify', 'ingest')),
    payload     jsonb NOT NULL,
    attempts    integer NOT NULL DEFAULT 0,
    last_error  text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS mc_reconcile_queue_pending_idx
    ON mc_reconcile_queue (created_at) WHERE resolved_at IS NULL;
