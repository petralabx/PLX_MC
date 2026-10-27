-- TASK-4015 personal MCP principal for Vince's own coding tools (Claude, Cursor).
-- Vince approved 2026-10-27 5:25 AM ET: same access as sp_mcp_claude_code.
-- No key material. Grants stay in grants.ts (default MCP_AGENT_CAPABILITIES).
-- Independent of 054 (#484); only its number follows it.
INSERT INTO service_principals (id, name, status)
VALUES ('sp_mcp_vince', 'PLX MC Vince personal (Claude, Cursor)', 'active')
ON CONFLICT (id) DO NOTHING;
