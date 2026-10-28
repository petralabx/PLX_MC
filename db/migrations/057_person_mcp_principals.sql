-- TASK-4015 personal MCP principals for every active mc_users human without one.
-- Numbered 057 because 056_drafts.sql is already on main.
-- Vince 2026-10-27 4:30 PM ET: "provision everyone and every bots key".
-- Member-scoped (MEMBER_CAPABILITIES in grants.ts). vince@ uses sp_mcp_vince (055).
-- No key material. Keys are minted separately with Vince's approval.
INSERT INTO service_principals (id, name, status)
VALUES
  ('sp_mcp_person_greg', 'PLX MC personal: Greg Mitchell (greg.m@petrasoap.com)', 'active'),
  ('sp_mcp_person_luis', 'PLX MC personal: Luis (luis@petrasoap.com)', 'active'),
  ('sp_mcp_person_oleg', 'PLX MC personal: Oleg Okayev (oleg@petrasoap.com)', 'active'),
  ('sp_mcp_person_ricardo', 'PLX MC personal: Ricardo Savelli Fuzito (ricardo@petrasoap.com)', 'active'),
  ('sp_mcp_person_rishi', 'PLX MC personal: Rishi (rishi@petrasoap.com)', 'active'),
  ('sp_mcp_person_stephen', 'PLX MC personal: Stephen Alton (stephen@petrasoap.com)', 'active'),
  ('sp_mcp_person_tanush', 'PLX MC personal: Tanush Shah (tanush@petrasoap.com)', 'active')
ON CONFLICT (id) DO NOTHING;
