-- Rollback for db/migrations/049_nav_stars.sql. NOT a numbered migration —
-- kept out of db/migrations/ so the migration gate's "one row per numeric prefix"
-- rule is not tripped. Run manually ONLY to undo Starred, after the code that
-- reads the table has been reverted. 049 introduced the table and nothing else
-- references it. Dropping it deletes every person's stars; they cannot be
-- restored, and people star again.

DROP TABLE IF EXISTS nav_stars;
DELETE FROM schema_migrations WHERE filename = '049_nav_stars.sql';
