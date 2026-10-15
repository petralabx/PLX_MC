-- PLX Infra MCP principal (read-only: task.read). Grants stay in grants.ts.
INSERT INTO service_principals (id, name, status)
VALUES ('sp_mcp_infra', 'PLX Infra', 'active')
ON CONFLICT (id) DO NOTHING;
