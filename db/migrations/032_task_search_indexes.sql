-- Additive search indexes for the JSONB task mirror; no data backfill or new
-- storage. Discussion includes persisted progress-note comments and activity.
CREATE INDEX IF NOT EXISTS entities_task_numeric_id_idx
    ON entities ((COALESCE(substring(id FROM '^TASK-([0-9]+)$')::numeric, 0)), id COLLATE "C")
    WHERE entity_type = 'task';

CREATE INDEX IF NOT EXISTS entities_task_discussion_fts_idx
    ON entities USING gin (jsonb_to_tsvector('simple'::regconfig,
        jsonb_path_query_array(data, '$.comments[*].body') ||
        jsonb_path_query_array(data, '$.activity[*].what'), '["string"]'::jsonb))
    WHERE entity_type = 'task';
