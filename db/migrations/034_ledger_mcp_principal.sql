-- Steward MCP principal for Ledger (mc_link_merged_pr, TASK-2559).
-- Numbered 034: PLX_MC #291 owns 033 (completed_at re-land); this lands after #291.
-- Grants remain in the reviewed code registry (src/lib/permissions/grants.ts).
-- Additive / idempotent only (ON CONFLICT DO NOTHING; no destructive ops).

INSERT INTO service_principals (id, name, status)
VALUES ('sp_mcp_ledger', 'PLX MC MCP Ledger', 'active')
ON CONFLICT (id) DO NOTHING;
