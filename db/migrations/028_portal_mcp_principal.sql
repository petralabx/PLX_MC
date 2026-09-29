-- Dedicated MCP service principal for the portal's COS delegate tool
-- (agent fleet P8). Its least-privilege grant (create and search tasks only,
-- decision CG-07b) stays in the reviewed code registry
-- (src/lib/permissions/grants.ts).
-- Additive / idempotent only (ON CONFLICT DO NOTHING; no destructive ops).

INSERT INTO service_principals (id, name, status)
VALUES ('sp_mcp_portal', 'PLX MC MCP Portal', 'active')
ON CONFLICT (id) DO NOTHING;
