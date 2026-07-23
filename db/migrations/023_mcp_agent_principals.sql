-- Per-agent MCP service principals (TASK-619) — one durable principal per
-- agent runtime so per-agent API keys replace the shared sp_mcp_cursor key.
-- Grants stay in the reviewed code registry (src/lib/permissions/grants.ts).
-- Additive / idempotent only (ON CONFLICT DO NOTHING; no destructive ops).

INSERT INTO service_principals (id, name, status)
VALUES ('sp_mcp_claude_code', 'PLX MC MCP Claude Code', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO service_principals (id, name, status)
VALUES ('sp_mcp_codex', 'PLX MC MCP Codex', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO service_principals (id, name, status)
VALUES ('sp_mcp_swarm', 'PLX MC MCP Swarm', 'active')
ON CONFLICT (id) DO NOTHING;
