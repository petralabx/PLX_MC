-- Rollback for db/migrations/056_person_mcp_principals.sql (TASK-4015).
-- NOT a numbered migration. Run manually ONLY to undo 056, after the code that
-- lists these principals is reverted and their keys (if any) are retired.
-- Deletes exactly the rows 056 inserts. Idempotent. No key material touched.

BEGIN;

DELETE FROM service_principals WHERE id IN ('sp_mcp_person_greg', 'sp_mcp_person_luis', 'sp_mcp_person_oleg', 'sp_mcp_person_ricardo', 'sp_mcp_person_rishi', 'sp_mcp_person_stephen', 'sp_mcp_person_tanush');

DELETE FROM schema_migrations WHERE filename = '056_person_mcp_principals.sql';

COMMIT;
