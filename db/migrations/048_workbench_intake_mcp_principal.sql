-- PLX Workbench intake MCP principal (task.read + task.create). Grants stay in grants.ts.
-- Lands after 047, reserved by open PR #385.
INSERT INTO service_principals (id, name, status)
VALUES ('sp_mcp_workbench_intake', 'PLX MC MCP Workbench Intake', 'active')
ON CONFLICT (id) DO NOTHING;
