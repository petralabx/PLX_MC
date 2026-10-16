-- Goals & Production: Line 1 bulk kg replaces the large-batch goal (TASK-3142).
-- Additive and idempotent (expand only).
--
-- The business's rule (Vince Alton, 2026-10-16): 20,000 kg of Line 1 bulk per
-- working day, and a batch of 5,000 kg or more is assumed to run on Line 1
-- (FileMaker's line field is not used). The page works the Line 1 figures out
-- from the batch snapshot (report_snap_batch), so no new snapshot table.
--
-- Retired, not dropped: 039's large_batches_per_working_day and
-- large_batch_min_kg settings, report_snap_goal_summary, and report_snap_daily's
-- large_done / large_open columns. Production applies this migration before the
-- new code deploys, and the release still live then reads those settings and
-- writes those columns; a code rollback needs them too. A later migration can
-- drop them once this release has settled. The new code no longer writes
-- large_done / large_open, hence their defaults below.
-- Rollback: db/rollback/042_reporting_goals_line1_rollback.sql.

INSERT INTO report_goal_setting (key, value, note, updated_by) VALUES
    ('line1_kg_per_working_day', 20000, 'Line 1 bulk kg per working day', 'migration:042'),
    ('line1_min_kg', 5000, 'A batch of this many kg or more is assumed to run on Line 1', 'migration:042')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE report_snap_daily
    ALTER COLUMN large_done SET DEFAULT 0,
    ALTER COLUMN large_open SET DEFAULT 0;
