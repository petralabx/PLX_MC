-- Rollback for db/migrations/042_reporting_goals_line1.sql. NOT a numbered migration —
-- kept out of db/migrations/ so the migration gate's "one row per numeric prefix"
-- rule is not tripped. Reverting the code alone is enough (042 only adds); run
-- this manually ONLY after the code that reads the Line 1 settings has been
-- reverted: that code needs both rows, and it writes
-- report_snap_daily without large_done / large_open, so it needs their defaults.
-- The release before it reads 039's large-batch settings and writes those
-- columns itself; 042 dropped neither. Snapshots taken by the Line 1 code have
-- large_done / large_open at 0 and no report_snap_goal_summary row, so the
-- large-batch card reads 0 until the next refresh.

DELETE FROM report_goal_setting WHERE key IN ('line1_kg_per_working_day', 'line1_min_kg');
ALTER TABLE report_snap_daily
    ALTER COLUMN large_done DROP DEFAULT,
    ALTER COLUMN large_open DROP DEFAULT;
DELETE FROM schema_migrations WHERE filename = '042_reporting_goals_line1.sql';
