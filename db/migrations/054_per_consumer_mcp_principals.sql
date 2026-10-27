-- TASK-4015 per-consumer MCP principals (Vince 2026-10-27 4:22 and 4:30 AM ET).
-- No key material. Grants stay in grants.ts.
INSERT INTO service_principals (id, name, status)
VALUES
  ('sp_mcp_cursor_team', 'PLX MC Cursor Team Connectors (interim)', 'active'),
  ('sp_mcp_infra_bot', 'PLX Infra Bot', 'active'),
  ('sp_mcp_plx_cos', 'PLX COS Bot', 'active'),
  ('sp_mcp_cip', 'PLX CIP Bot', 'active'),
  ('sp_mcp_steward', 'PLX Steward Bot', 'active'),
  ('sp_mcp_uat', 'PLX UAT Testing Bot', 'active'),
  ('sp_mcp_harness', 'PLX Harness Bot', 'active'),
  ('sp_mcp_bc_golive', 'PLX BC Go-Live Steward Bot', 'active'),
  ('sp_mcp_azure', 'PLX Azure Bot', 'active'),
  ('sp_mcp_aws_gh', 'PLX AWS_GH Bot', 'active'),
  ('sp_mcp_books', 'PLX Books Bot', 'active'),
  ('sp_mcp_mmm', 'PLX MMM Bot', 'active'),
  ('sp_mcp_haggle', 'PLX Haggle Bot', 'active'),
  ('sp_mcp_recap', 'PLX Recap Tasks Bot', 'active'),
  ('sp_mcp_cursor_helper', 'PLX Cursor Helper Bot', 'active'),
  ('sp_mcp_taylo_infra', 'PLX Taylo Laptop Infra Bot', 'active'),
  ('sp_mcp_nightly_audit', 'PLX Nightly Audit Engineer Bot', 'active'),
  ('sp_mcp_lane_claude_cos', 'PLX coding-1 lane claude-cos', 'active'),
  ('sp_mcp_lane_claude_uat', 'PLX coding-1 lane claude-uat', 'active'),
  ('sp_mcp_lane_claude_vince', 'PLX coding-1 lane claude-vince', 'active'),
  ('sp_mcp_lane_codex_cos', 'PLX coding-1 lane codex-cos', 'active'),
  ('sp_mcp_lane_codex_uat', 'PLX coding-1 lane codex-uat', 'active'),
  ('sp_mcp_lane_codex_vince', 'PLX coding-1 lane codex-vince', 'active'),
  ('sp_mcp_lane_cursor_cos', 'PLX coding-1 lane cursor-cos', 'active'),
  ('sp_mcp_lane_cursor_uat', 'PLX coding-1 lane cursor-uat', 'active'),
  ('sp_mcp_lane_cursor_vince', 'PLX coding-1 lane cursor-vince', 'active')
ON CONFLICT (id) DO NOTHING;
