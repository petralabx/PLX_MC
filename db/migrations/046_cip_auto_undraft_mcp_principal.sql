-- PLX CIP Auto-Undraft MCP principal (read-only: task.read). Grants stay in grants.ts.
INSERT INTO service_principals (id, name, status)
VALUES ('sp_mcp_cip_auto_undraft', 'PLX CIP Auto-Undraft', 'active')
ON CONFLICT (id) DO NOTHING;
