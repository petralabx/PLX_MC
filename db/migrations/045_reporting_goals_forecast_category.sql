-- Revenue forecast filters on Goals & Production (TASK-3177): Sage's item
-- category on each stored order line, and which category columns the read-only
-- login lacked. Additive and idempotent (expand only).
--
-- category is NULL when Sage's is blank or the login may not read it yet.
-- category_missing lists the columns it lacked (schema.table.column; empty when
-- it read them) and stays NULL on runs stored before this migration, so the page
-- can say categories fill in at the next refresh. Nothing here writes to
-- FileMaker, Sage or Business Central.
-- Rollback: db/rollback/045_reporting_goals_forecast_category_rollback.sql.

ALTER TABLE report_snap_forecast_line ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE report_snap_forecast_summary ADD COLUMN IF NOT EXISTS category_missing jsonb;
