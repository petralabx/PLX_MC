-- Rollback for db/migrations/051_reporting_goals_credit_notes.sql. NOT a
-- numbered migration - kept out of db/migrations/ so the migration gate's "one
-- row per numeric prefix" rule is not tripped. Run manually ONLY to undo the
-- credit notes' tables, after the code that writes and reads them has been
-- reverted (the refresh writes them in the same transaction as every snapshot,
-- so the old code must be live first). Every object below was introduced by 051
-- and nothing else references it; dropping them loses only the stored credit
-- notes, which the next refresh would read again for its own run.

DROP TABLE IF EXISTS report_snap_credit_note_summary;
DROP TABLE IF EXISTS report_snap_credit_note;
DELETE FROM schema_migrations WHERE filename = '051_reporting_goals_credit_notes.sql';
