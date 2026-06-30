-- Rollback for db/migrations/011_projects.sql (P2). NOT a numbered migration —
-- kept out of db/migrations/ so the migration gate's "one row per numeric prefix"
-- rule is not tripped. Run manually ONLY to undo the Project entity after 011 was
-- applied. Safe: the column + table were introduced by 011 and nothing else
-- references them; buckets/tasks rows are untouched.
--
-- Order matters: drop the FK column before the table it references.

ALTER TABLE buckets DROP COLUMN IF EXISTS project_id;

DROP TABLE IF EXISTS projects;
