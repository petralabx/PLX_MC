-- Chief of Staff MCP principal (task.cancel + task.link_merged_pr). Grants stay in grants.ts.
INSERT INTO service_principals (id, name, status)
VALUES ('sp_mcp_cos', 'PLX MC MCP Chief of Staff', 'active')
ON CONFLICT (id) DO NOTHING;
