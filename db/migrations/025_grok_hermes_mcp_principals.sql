-- Dedicated MCP service principals for Grok and Hermes agent runtimes.
-- Grants remain in the reviewed code registry (src/lib/permissions/grants.ts).

INSERT INTO service_principals (id, name, status)
VALUES ('sp_mcp_grok', 'PLX MC MCP Grok', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO service_principals (id, name, status)
VALUES ('sp_mcp_hermes', 'PLX MC MCP Hermes', 'active')
ON CONFLICT (id) DO NOTHING;
