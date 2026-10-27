-- Rollback for db/migrations/056_drafts.sql. NOT a numbered migration — kept out
-- of db/migrations/ so the migration gate's "one row per numeric prefix" rule is
-- not tripped. Run manually ONLY to undo Draft Projects, after the code that
-- reads these tables has been reverted (or PLX_MC_DRAFTS_ENABLED is off). 056
-- added both tables, the sequence and the trigger function, and nothing else
-- references them. Dropping them deletes every draft and every frozen version;
-- they cannot be restored. Records an Accept already created stay: they are
-- ordinary projects, buckets and tasks.

DROP TABLE IF EXISTS draft_versions;
DROP TABLE IF EXISTS drafts;
DROP FUNCTION IF EXISTS draft_versions_immutable();
DROP SEQUENCE IF EXISTS mc_draft_id_seq;
DELETE FROM schema_migrations WHERE filename = '056_drafts.sql';
