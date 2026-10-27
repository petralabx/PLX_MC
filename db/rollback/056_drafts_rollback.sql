-- Rollback for db/migrations/056_drafts.sql. NOT a numbered migration — kept out
-- of db/migrations/ so the migration gate's "one row per numeric prefix" rule is
-- not tripped. Run manually ONLY to undo Draft Projects, and only after the code
-- that reads these tables, and 056's entry in src/lib/db/migration-manifest.json,
-- have been reverted and deployed. Turning PLX_MC_DRAFTS_ENABLED off is NOT
-- enough: every API route checks the database against the manifest, so with
-- 056 still listed this rollback answers every route 503 schema_behind, and the
-- next migration run puts the tables back. 056
-- added both tables, the sequence and the trigger function, and nothing else
-- references them. Dropping them deletes every draft and every frozen version;
-- they cannot be restored. Records an Accept already created stay: they are
-- ordinary projects, buckets and tasks.

DROP TABLE IF EXISTS draft_versions;
DROP TABLE IF EXISTS drafts;
DROP FUNCTION IF EXISTS draft_versions_immutable();
DROP SEQUENCE IF EXISTS mc_draft_id_seq;
DELETE FROM schema_migrations WHERE filename = '056_drafts.sql';
