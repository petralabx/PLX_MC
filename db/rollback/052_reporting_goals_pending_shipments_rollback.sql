-- Rollback for db/migrations/052_reporting_goals_pending_shipments.sql. NOT a
-- numbered migration - kept out of db/migrations/ so the migration gate's "one
-- row per numeric prefix" rule is not tripped. Every object below was
-- introduced by 052 and nothing else references it; dropping them loses only
-- the stored pending shipments, which a refresh reads again.
--
-- Order: revert the code first, then run this. The code with 052 reads these
-- tables on every page load and its migration manifest requires 052, so
-- dropping them under it breaks the page and turns every API to
-- 503 schema_behind. GOALS_PENDING_SHIPMENTS=off is NOT a substitute: it stops
-- only the refresh's writes.
--   1. Deploy the code and manifest from before 052.
--   2. Run one refresh on it, so the newest good run has no pending summary.
--   3. Run this file, saying step 1 is done:
--      PGOPTIONS='-c plx.code_reverted=052_reporting_goals_pending_shipments.sql' \
--        psql -v ON_ERROR_STOP=1 -f db/rollback/052_reporting_goals_pending_shipments_rollback.sql
-- It refuses without that setting, or while the newest good refresh run still
-- has a pending summary (the code with 052 wrote it). One block, so a refusal
-- drops nothing even without ON_ERROR_STOP.

DO $$
BEGIN
    IF coalesce(current_setting('plx.code_reverted', true), '') <> '052_reporting_goals_pending_shipments.sql' THEN
        RAISE EXCEPTION 'report_snap_pending_shipment: revert the code and manifest from before 052 first, then set plx.code_reverted = ''052_reporting_goals_pending_shipments.sql'' and run this again';
    END IF;
    -- Nested, so a run of this file after the tables are gone still clears the ledger.
    IF to_regclass('public.report_snap_pending_shipment_summary') IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM report_snap_pending_shipment_summary
            WHERE run_id = (SELECT max(id) FROM report_refresh_run WHERE status = 'succeeded')
        ) THEN
            RAISE EXCEPTION 'report_snap_pending_shipment: the newest good refresh run has a pending summary, so the code with 052 is still live; revert it and run one refresh first';
        END IF;
    END IF;
    DROP TABLE IF EXISTS report_snap_pending_shipment_summary;
    DROP TABLE IF EXISTS report_snap_pending_shipment;
    DELETE FROM schema_migrations WHERE filename = '052_reporting_goals_pending_shipments.sql';
END $$;
