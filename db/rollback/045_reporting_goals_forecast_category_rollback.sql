-- Rollback for db/migrations/045_reporting_goals_forecast_category.sql. NOT a
-- numbered migration — kept out of db/migrations/ so the migration gate's "one
-- row per numeric prefix" rule is not tripped. Run manually ONLY to undo the
-- forecast's item categories, after the code that writes and reads them has
-- been reverted (the refresh writes them in the same transaction as every
-- snapshot, so the old code must be live first). Both columns were introduced
-- by 045 and nothing else references them; dropping them loses only the stored
-- categories, which the next refresh would read again for its own run.

ALTER TABLE report_snap_forecast_summary DROP COLUMN IF EXISTS category_missing;
ALTER TABLE report_snap_forecast_line DROP COLUMN IF EXISTS category;
DELETE FROM schema_migrations WHERE filename = '045_reporting_goals_forecast_category.sql';
