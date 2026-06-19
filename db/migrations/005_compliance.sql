-- EN-007 P1b: the enforced-system-of-record tables (docs/product/SYSTEM_OF_RECORD.md).
-- All additive + idempotent (CREATE TABLE IF NOT EXISTS); no DROP/ALTER of
-- existing schema. Timestamps are UTC (timestamptz); rendering localizes.

-- mc_events — the first-class, append-only event log and Second-Brain substrate
-- (decision 13). A superset of sync_audit_log: every governed action appends one
-- typed row. Append-only by convention (no UPDATE/DELETE); `seq` is the export
-- cursor for keyset pagination (GET /api/events?after=<seq>).
CREATE TABLE IF NOT EXISTS mc_events (
    seq     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ts      timestamptz NOT NULL DEFAULT now(),
    kind    text NOT NULL,
    actor   text NOT NULL,
    repo    text,
    task_id text,
    pr      text,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS mc_events_kind_ts_idx ON mc_events (kind, ts DESC);

-- mc_dispatch — the dispatch ledger (the "registry" of credentials, decision 9).
-- A checkout mints one row tying a per-dispatch credential to {task, accountable
-- human, repo}; ephemeral sub-agents reuse the parent's id.
CREATE TABLE IF NOT EXISTS mc_dispatch (
    id                text PRIMARY KEY,
    actor_kind        text NOT NULL CHECK (actor_kind IN ('agent', 'operator')),
    runtime           text NOT NULL,
    task_id           text NOT NULL,
    accountable_human text NOT NULL,
    repo              text NOT NULL,
    issued_at         timestamptz NOT NULL DEFAULT now(),
    expires_at        timestamptz NOT NULL,
    revoked           boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS mc_dispatch_task_idx ON mc_dispatch (task_id);

-- mc_compliance_check — the verdict ledger: one row per verify call on a PR
-- (upserted on re-verify of the same check id).
CREATE TABLE IF NOT EXISTS mc_compliance_check (
    id          text PRIMARY KEY,
    repo        text NOT NULL,
    pr_number   integer NOT NULL,
    head_sha    text NOT NULL,
    task_id     text,
    actor_kind  text NOT NULL CHECK (actor_kind IN ('agent', 'operator')),
    verdict     text NOT NULL CHECK (verdict IN ('pass', 'block', 'pending')),
    reasons     jsonb NOT NULL DEFAULT '[]'::jsonb,
    queued_at   timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS mc_compliance_check_pr_idx ON mc_compliance_check (repo, pr_number);
