-- Rollback for db/migrations/052_reporting_goals_pending_shipments.sql. NOT a
-- numbered migration - kept out of db/migrations/ so the migration gate's "one
-- row per numeric prefix" rule is not tripped. Run manually ONLY after the
-- code that writes and reads these tables has been reverted (or set
-- GOALS_PENDING_SHIPMENTS=off first, which stops the writes). Every object
-- below was introduced by 052 and nothing else references it; dropping them
-- loses only the stored pending shipments, which a refresh reads again.

DROP TABLE IF EXISTS report_snap_pending_shipment_summary;
DROP TABLE IF EXISTS report_snap_pending_shipment;
DELETE FROM schema_migrations WHERE filename = '052_reporting_goals_pending_shipments.sql';
