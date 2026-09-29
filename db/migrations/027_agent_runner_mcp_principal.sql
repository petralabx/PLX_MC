-- Dedicated MCP service principal for the agent fleet runner
-- (petralabx/agent-runner; fleet P6a, D24). Grants remain in the reviewed
-- code registry (src/lib/permissions/grants.ts).
-- Additive / idempotent only (ON CONFLICT DO NOTHING; no destructive ops).

INSERT INTO service_principals (id, name, status)
VALUES ('sp_mcp_agent_runner', 'PLX MC MCP Agent Runner', 'active')
ON CONFLICT (id) DO NOTHING;
