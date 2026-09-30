-- TASK-1642: close obsolete conflicts without selecting either frozen value.
-- resolved_at remains the open-queue predicate; winner stays NULL on dismissal.
ALTER TABLE sync_conflicts
    ADD COLUMN IF NOT EXISTS dismissed_at timestamptz,
    ADD COLUMN IF NOT EXISTS dismissed_by text,
    ADD COLUMN IF NOT EXISTS dismissal_reason text;
