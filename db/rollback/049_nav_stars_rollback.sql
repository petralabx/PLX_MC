-- Rollback for db/migrations/049_nav_stars.sql. NOT a numbered migration —
-- kept out of db/migrations/ so the migration gate's "one row per numeric prefix"
-- rule is not tripped. Run manually ONLY to undo Starred, after the code that
-- reads the table has been reverted. 049 introduced the table and nothing else
-- references it. Dropping it deletes every person's stars; they cannot be
-- restored, and people star again. Dropping the table also undoes 053 (the
-- 10-star cap), so its ledger row goes too and the runner applies both again.

DROP TABLE IF EXISTS nav_stars;
DELETE FROM schema_migrations WHERE filename IN ('049_nav_stars.sql', '053_nav_stars_cap_10.sql');
