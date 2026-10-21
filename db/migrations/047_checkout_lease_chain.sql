-- TASK-3410: checkout lease chain. A checkout records the principal that minted
-- it (launcher_id), the commit its work starts from (base_sha) and, when the
-- launcher took it, its launch record (launch_id). mc_dispatch_heads is the
-- ordered chain of PR heads recorded for the checkout: by the owning launcher on
-- push, by the pull_request webhook on a fast-forward, or by the gate when the PR
-- commits still contain a recorded head. Additive and idempotent; applied
-- transactionally by scripts/migrate.mjs.
ALTER TABLE mc_dispatch ADD COLUMN IF NOT EXISTS launcher_id text;
ALTER TABLE mc_dispatch ADD COLUMN IF NOT EXISTS base_sha text;
ALTER TABLE mc_dispatch ADD COLUMN IF NOT EXISTS launch_id text;

CREATE TABLE IF NOT EXISTS mc_dispatch_heads (
    seq         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    dispatch_id text NOT NULL REFERENCES mc_dispatch (id),
    head_sha    text NOT NULL,
    before_sha  text,
    pr          integer,
    source      text NOT NULL CHECK (source IN ('launcher', 'webhook', 'gate')),
    recorded_by text NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (dispatch_id, head_sha)
);
