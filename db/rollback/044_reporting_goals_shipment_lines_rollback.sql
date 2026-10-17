-- Rollback for db/migrations/044_reporting_goals_shipment_lines.sql. NOT a
-- numbered migration — kept out of db/migrations/ so the migration gate's "one
-- row per numeric prefix" rule is not tripped. Run manually ONLY to undo the
-- invoice lines' tables, after the code that writes and reads them has been
-- reverted (the refresh writes them in the same transaction as every snapshot,
-- so the old code must be live first). Every object below was introduced by 044
-- and nothing else references it; dropping them loses only the stored invoice
-- lines, which the next refresh would read again for its own run.

DROP TABLE IF EXISTS report_snap_shipment_line_summary;
DROP TABLE IF EXISTS report_snap_shipment_line;
DELETE FROM schema_migrations WHERE filename = '044_reporting_goals_shipment_lines.sql';
