-- TASK-629: a runtime approval gate can block a checkout (dispatch lease), not only its task.
-- approval_gate_id points at the gate (apg_*, stored on the task jsonb); complete() refuses
-- while that gate is pending or rejected. Additive and idempotent; applied transactionally by
-- scripts/migrate.mjs. Lands after the migrations reserved as 034 and 035 by other open PRs.
ALTER TABLE mc_dispatch ADD COLUMN IF NOT EXISTS approval_gate_id text;
ALTER TABLE mc_dispatch ADD COLUMN IF NOT EXISTS approval_blocked_at timestamptz;
