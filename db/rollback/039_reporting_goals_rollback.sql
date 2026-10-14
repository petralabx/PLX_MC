-- Rollback for db/migrations/039_reporting_goals.sql. NOT a numbered migration —
-- kept out of db/migrations/ so the migration gate's "one row per numeric prefix"
-- rule is not tripped. Run manually ONLY to undo the Goals & Production tables,
-- after the code that reads them has been reverted. Every object below was
-- introduced by 039 and nothing else references it. Dropping it deletes the
-- manual entries, their history and the uploaded workbooks: export the entries
-- (Goals & production → Export to Excel) first if they are still needed.

DROP TABLE IF EXISTS report_manual_entry_version;
DROP TABLE IF EXISTS report_manual_import;
DROP TABLE IF EXISTS report_manual_entry;
DROP SEQUENCE IF EXISTS report_manual_entry_seq;
DROP TABLE IF EXISTS report_goal_setting;
DROP TABLE IF EXISTS report_ftl_customer;
DROP TABLE IF EXISTS report_holiday;
DROP TABLE IF EXISTS report_fx_rate;
DROP TABLE IF EXISTS report_snap_customer;
DROP TABLE IF EXISTS report_snap_reference;
DROP TABLE IF EXISTS report_snap_batch_history;
DROP TABLE IF EXISTS report_snap_batch;
DROP TABLE IF EXISTS report_snap_shipment;
DROP TABLE IF EXISTS report_snap_revenue;
DROP TABLE IF EXISTS report_snap_truckload;
DROP TABLE IF EXISTS report_snap_daily;
DROP TABLE IF EXISTS report_snap_goal_summary;
DROP TABLE IF EXISTS report_refresh_run;
DELETE FROM schema_migrations WHERE filename = '039_reporting_goals.sql';
