-- Rollback for db/migrations/055_vince_personal_mcp_principal.sql (TASK-4015).
-- NOT a numbered migration. Run manually ONLY to undo 055, after the code that
-- lists sp_mcp_vince in types.ts is reverted and its key (if any) is retired.
-- Deletes exactly the one row 055 inserts. Idempotent. No key material touched.

BEGIN;

DELETE FROM service_principals WHERE id = 'sp_mcp_vince';

DELETE FROM schema_migrations WHERE filename = '055_vince_personal_mcp_principal.sql';

COMMIT;
