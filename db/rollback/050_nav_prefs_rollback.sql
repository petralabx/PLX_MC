-- Rollback for db/migrations/050_nav_prefs.sql. NOT a numbered migration —
-- kept out of db/migrations/ so the migration gate's "one row per numeric prefix"
-- rule is not tripped. Run manually ONLY to undo the navigation switch, after
-- the code that reads the table has been reverted. 050 introduced the table and
-- nothing else references it. Dropping it forgets every person's switch and
-- tour; people turn the switch on again.

DROP TABLE IF EXISTS nav_prefs;
DELETE FROM schema_migrations WHERE filename = '050_nav_prefs.sql';
