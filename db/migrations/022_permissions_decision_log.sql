-- Permissions decision audit (TASK-620) — one row per enforcement decision
-- with allowed/reason_code/policy_version, the enforcement mode in effect,
-- and the shadow (real-identity) verdict during staged rollout.
-- Additive / idempotent only (IF NOT EXISTS; no destructive operations).

CREATE TABLE IF NOT EXISTS permissions_decision_log (
    id                 bigserial PRIMARY KEY,
    ts                 timestamptz NOT NULL DEFAULT now(),
    site               text NOT NULL,
    actor_kind         text NOT NULL CHECK (actor_kind IN ('human', 'service')),
    actor_id           text NOT NULL,
    capability         text NOT NULL,
    resource_type      text,
    resource_id        text,
    allowed            boolean NOT NULL,
    reason_code        text NOT NULL,
    policy_version     text NOT NULL,
    enforcement_mode   text NOT NULL
                       CHECK (enforcement_mode IN ('off', 'log-only', 'review', 'enforce')),
    -- Shadow verdict: what the hydrated real identity would decide while the
    -- applied outcome still comes from staged (legacy) behavior. NULL once the
    -- applied decision is the real-identity decision.
    shadow_allowed     boolean,
    shadow_reason_code text,
    audit_label        text
);

CREATE INDEX IF NOT EXISTS permissions_decision_log_ts_idx
    ON permissions_decision_log (ts);

CREATE INDEX IF NOT EXISTS permissions_decision_log_denied_idx
    ON permissions_decision_log (ts)
    WHERE NOT allowed;

CREATE INDEX IF NOT EXISTS permissions_decision_log_shadow_denied_idx
    ON permissions_decision_log (ts)
    WHERE shadow_allowed IS FALSE;
