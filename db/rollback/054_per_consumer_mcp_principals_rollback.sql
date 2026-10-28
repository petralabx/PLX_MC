-- Rollback for db/migrations/054_per_consumer_mcp_principals.sql (TASK-4015, PR #484).
-- NOT a numbered migration — kept out of db/migrations/ so the migration gate's
-- "one row per numeric prefix" rule is not tripped. Run manually ONLY to undo 054,
-- after the code that lists these principals in types.ts / grants.ts is reverted.
--
-- Deletes exactly the 26 service_principals rows 054 inserts. None of these ids
-- existed before 054 (checked against main c61d5224). Idempotent: re-running
-- deletes nothing. No key material is touched.

BEGIN;

DELETE FROM service_principals
WHERE id IN (
    'sp_mcp_cursor_team',
    'sp_mcp_infra_bot',
    'sp_mcp_plx_cos',
    'sp_mcp_cip',
    'sp_mcp_steward',
    'sp_mcp_uat',
    'sp_mcp_harness',
    'sp_mcp_bc_golive',
    'sp_mcp_azure',
    'sp_mcp_aws_gh',
    'sp_mcp_books',
    'sp_mcp_mmm',
    'sp_mcp_haggle',
    'sp_mcp_recap',
    'sp_mcp_cursor_helper',
    'sp_mcp_taylo_infra',
    'sp_mcp_nightly_audit',
    'sp_mcp_lane_claude_cos',
    'sp_mcp_lane_claude_uat',
    'sp_mcp_lane_claude_vince',
    'sp_mcp_lane_codex_cos',
    'sp_mcp_lane_codex_uat',
    'sp_mcp_lane_codex_vince',
    'sp_mcp_lane_cursor_cos',
    'sp_mcp_lane_cursor_uat',
    'sp_mcp_lane_cursor_vince'
);

DELETE FROM schema_migrations WHERE filename = '054_per_consumer_mcp_principals.sql';

COMMIT;
