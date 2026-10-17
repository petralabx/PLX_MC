-- Rollback for db/migrations/043_reporting_goals_forecast.sql. NOT a numbered
-- migration — kept out of db/migrations/ so the migration gate's "one row per
-- numeric prefix" rule is not tripped. Run manually ONLY to undo the revenue
-- forecast's tables, after the code that writes and reads them has been
-- reverted (the refresh writes them in the same transaction as every snapshot,
-- so the old code must be live first). Every object below was introduced by 043
-- and nothing else references it; dropping them loses only forecast snapshots,
-- which the next refresh would rebuild for its own run.

DROP TABLE IF EXISTS report_snap_forecast_summary;
DROP TABLE IF EXISTS report_snap_forecast_ao;
DROP TABLE IF EXISTS report_snap_forecast_line;
DELETE FROM schema_migrations WHERE filename = '043_reporting_goals_forecast.sql';
