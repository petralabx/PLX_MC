-- Dedicated MCP service principal for ChatGPT (the chat product, not Codex).
-- Grants remain in the reviewed code registry (src/lib/permissions/grants.ts).
-- Additive / idempotent only (ON CONFLICT DO NOTHING; no destructive ops).

INSERT INTO service_principals (id, name, status)
VALUES ('sp_mcp_chatgpt', 'PLX MC MCP ChatGPT', 'active')
ON CONFLICT (id) DO NOTHING;
