-- TASK-2530: project lifecycle status (active | closed). Orthogonal to health.
--
-- The Project shape lives in projects.data (jsonb); status, closedAt and
-- closedBy are written there by patchProject, so the app has one write path.
-- This migration only exposes status as a queryable, constrained column:
-- a STORED generated column derived from data->>'status', defaulting to
-- 'active' for every existing row and for rows that never set it. Additive and
-- forward-only: no data is rewritten, and unused it changes no behavior.
ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS status text
    GENERATED ALWAYS AS (COALESCE(data->>'status', 'active')) STORED;

ALTER TABLE projects
    DROP CONSTRAINT IF EXISTS projects_status_check;
ALTER TABLE projects
    ADD CONSTRAINT projects_status_check CHECK (status IN ('active', 'closed'));

CREATE INDEX IF NOT EXISTS projects_status_idx ON projects (status);
