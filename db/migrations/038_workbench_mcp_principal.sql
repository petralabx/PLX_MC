-- PLX Agent Workbench MCP principal (read-only: task.read). Grants stay in grants.ts.
INSERT INTO service_principals (id, name, status)
VALUES ('sp_mcp_workbench', 'PLX MC MCP Agent Workbench', 'active')
ON CONFLICT (id) DO NOTHING;
