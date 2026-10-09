-- TASK-2532. Additive, forward-only; lands after reserved 034 (#297).
-- Match 031: JSON is the existing write authority; generated columns expose
-- stamps for SQL without a second mutable copy. ISO stamps are stored as text.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at text GENERATED ALWAYS AS (data->>'archivedAt') STORED;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_by text GENERATED ALWAYS AS (data->>'archivedBy') STORED;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS archive_reason text GENERATED ALWAYS AS (data->>'archiveReason') STORED;
ALTER TABLE buckets ADD COLUMN IF NOT EXISTS archived_at text GENERATED ALWAYS AS (data->>'archivedAt') STORED;
ALTER TABLE buckets ADD COLUMN IF NOT EXISTS archived_by text GENERATED ALWAYS AS (data->>'archivedBy') STORED;
ALTER TABLE buckets ADD COLUMN IF NOT EXISTS archive_reason text GENERATED ALWAYS AS (data->>'archiveReason') STORED;

-- Preserve the former health=off nav exclusions; cascade retired projects.
-- Keep health unchanged so it resumes its health meaning on unarchive.
WITH retired AS (
  UPDATE projects SET data = data || jsonb_build_object('archivedAt', now()::text, 'archivedBy', 'migration:035', 'archiveReason', 'migrated from health=off'), sync_state = 'pending'
  WHERE data->>'health' = 'off' AND archived_at IS NULL
  RETURNING id
)
INSERT INTO mc_events (kind, actor, payload)
SELECT 'project.archived', 'migration:035', jsonb_build_object('projectId', id, 'reason', 'migrated from health=off') FROM retired;

WITH retired AS (
  UPDATE buckets SET data = data || jsonb_build_object('archivedAt', now()::text, 'archivedBy', 'migration:035', 'archiveReason', 'migrated from health=off'), sync_state = 'pending'
  WHERE archived_at IS NULL AND (data->>'health' = 'off' OR project_id IN (SELECT id FROM projects WHERE archived_at IS NOT NULL))
  RETURNING id, project_id
)
INSERT INTO mc_events (kind, actor, payload)
SELECT 'bucket.archived', 'migration:035', jsonb_build_object('bucketId', id, 'projectId', project_id, 'reason', 'migrated from health=off') FROM retired;

CREATE INDEX IF NOT EXISTS projects_archived_at_idx ON projects (archived_at);
CREATE INDEX IF NOT EXISTS buckets_archived_at_idx ON buckets (archived_at);

-- Close the create/check race and protect non-MCP creation paths too. AFTER
-- INSERT fires only for genuinely new rows (not ON CONFLICT updates), so
-- existing tasks in retired buckets continue syncing without interference.
CREATE OR REPLACE FUNCTION reject_archived_container_create() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_bucket buckets%ROWTYPE;
  parent_project projects%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'entities' THEN
    IF NEW.entity_type <> 'task' THEN RETURN NEW; END IF;
    SELECT * INTO parent_bucket FROM buckets WHERE id = NEW.data->>'bucket' FOR SHARE;
    IF parent_bucket.archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'bucket is archived' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO parent_project FROM projects WHERE id = parent_bucket.project_id FOR SHARE;
  ELSE
    SELECT * INTO parent_project FROM projects WHERE id = NEW.project_id FOR SHARE;
  END IF;
  IF parent_project.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'project is archived' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS entities_reject_archived_create ON entities;
CREATE TRIGGER entities_reject_archived_create AFTER INSERT ON entities FOR EACH ROW EXECUTE FUNCTION reject_archived_container_create();
DROP TRIGGER IF EXISTS buckets_reject_archived_create ON buckets;
CREATE TRIGGER buckets_reject_archived_create AFTER INSERT ON buckets FOR EACH ROW EXECUTE FUNCTION reject_archived_container_create();
