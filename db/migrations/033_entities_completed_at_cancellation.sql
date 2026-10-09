-- TASK-2528: real completion date on tasks. Tasks live as jsonb rows in
-- `entities` (entity_type = 'task'), so the date is a nullable column there,
-- not a field in `data` (the column is the source of truth; read paths merge
-- it into the task as completedAt). The second column, `cancellation`, is
-- added here so the cancelled-stage task (2529) ships no schema of its own.
--   completed_at  first entry into a terminal stage; written once by the
--                 stage-transition path (COALESCE guard) — never overwritten.
--   cancellation  {reason, replacedBy, cancelledAt, cancelledBy, note?}.
-- Both stay NULL for every entity_type <> 'task' (CHECK below).
--
-- The runner (scripts/migrate.mjs) wraps each file in a transaction, so the
-- index is a plain CREATE INDEX (CONCURRENTLY cannot run inside a transaction).
-- The entities table is small; the build lock is brief.
--
-- ROLLBACK (no down-migration framework in this repo; run in this order):
--   DROP INDEX IF EXISTS entities_task_completed_at_idx;
--   ALTER TABLE entities DROP CONSTRAINT IF EXISTS entities_task_only_completion_chk;
--   ALTER TABLE entities DROP COLUMN IF EXISTS cancellation;
--   ALTER TABLE entities DROP COLUMN IF EXISTS completed_at;
--   DELETE FROM schema_migrations WHERE filename = '033_entities_completed_at_cancellation.sql';
-- Revert the cancelled-stage task first if it has shipped. Column data is
-- lost on drop; scripts/backfill-task-completed-at.mjs can be re-run after.

ALTER TABLE entities
    ADD COLUMN IF NOT EXISTS completed_at timestamptz,
    ADD COLUMN IF NOT EXISTS cancellation jsonb;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'entities_task_only_completion_chk'
           AND conrelid = 'entities'::regclass
    ) THEN
        ALTER TABLE entities
            ADD CONSTRAINT entities_task_only_completion_chk
            CHECK (entity_type = 'task' OR (completed_at IS NULL AND cancellation IS NULL));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS entities_task_completed_at_idx
    ON entities (completed_at)
    WHERE entity_type = 'task' AND completed_at IS NOT NULL;
