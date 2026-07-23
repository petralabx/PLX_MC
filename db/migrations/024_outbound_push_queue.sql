-- Durable outbound push retry ledger (TASK-622) — a transient Graph failure
-- (429/5xx) on one entity defers that entity with exponential backoff instead
-- of aborting the whole sweep. Terminal after MAX attempts (parked in the
-- error register). Additive / idempotent only.

CREATE TABLE IF NOT EXISTS outbound_push_retries (
    entity_kind      text NOT NULL
                     CHECK (entity_kind IN ('task', 'risk', 'repo', 'project', 'bucket')),
    entity_id        text NOT NULL,
    attempts         integer NOT NULL DEFAULT 0,
    next_attempt_at  timestamptz NOT NULL,
    last_status      integer,
    last_error       text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (entity_kind, entity_id)
);

CREATE INDEX IF NOT EXISTS outbound_push_retries_due_idx
    ON outbound_push_retries (next_attempt_at);
