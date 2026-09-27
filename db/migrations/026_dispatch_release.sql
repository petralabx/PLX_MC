-- TASK-2011: PR close/merge releases a checkout without revoking its attribution.
-- Additive and idempotent; applied transactionally by scripts/migrate.mjs.
ALTER TABLE mc_dispatch ADD COLUMN IF NOT EXISTS released_at timestamptz;
ALTER TABLE mc_dispatch ADD COLUMN IF NOT EXISTS released_reason text;
