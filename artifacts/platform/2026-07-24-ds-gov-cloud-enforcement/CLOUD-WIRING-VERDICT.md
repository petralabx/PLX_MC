# CLOUD-WIRING-VERDICT — TASK-682

**Date:** 2026-07-24  
**SPEC:** approved (Vince, 2026-07-24T12:01:00Z)  
**Environment:** `2d1524f6-8755-11f1-a7d1-d6b4613131ce`  
**Run:** https://cursor.com/agents/bc-ac2127f2-cc87-4c48-9746-40925d4e4f06

## Verdict

**TEAM RULES: PASS** · **TEAM MCP REGISTERED: PASS** · **TEAM MCP ATTACHED TO CLOUD RUNS: FAIL (Cursor platform)** · **GOVERNANCE FALLBACK: PASS (REST)**

| Check | Result | Evidence |
|---|---|---|
| Team Rules 18212–18215 | PASS | Audit create 2026-07-24T12:19–12:21Z |
| Hub/Portal in Integrations UI | PASS | Screenshot 2026-07-24 — both HTTP @ `mc.plxcustomer.io/api/cursor/mcp` |
| Fresh Cloud Agent MCP catalog | FAIL | `1hr-after +9` agent: only `cursor-cloud`; Gap notes Hub/Portal missing |
| This run MCP catalog | FAIL | Only `cursor-cloud` |
| REST `mc_self_check` / checkout | PASS | Hydrated `PLX_MC_MCP_API_KEY` from AWS → MC API |

## Root cause (not a PLX misconfig)

Cursor Cloud Agents currently often **do not attach** dashboard Team/HTTP MCP servers
to the run tool catalog even when Integrations lists them and the UI says they are
“available to cloud agents.” Known class of bug:

- https://forum.cursor.com/t/cloud-agent-run-cannot-see-enabled-team-mcp-servers-server-notion-not-found/156948
- https://forum.cursor.com/t/cloud-agents-not-accessing-enabled-mcps/156262

No further Team MCP dashboard clicks will fix attachment until Cursor ships a fix
(or a service-account launch with inline `mcpServers` works — needs a user/service
API key, not the Admin spend key).

## Interim enforcement path (works today)

Cloud Agents should use the **REST fallback** already proven in this program:

1. Hydrate `PLX_MC_MCP_API_KEY` from `prod/ec2-secrets` (role
   `cursor-cloud-agent-prod-ec2-secrets-read` is already on the team).
2. Call `https://mc.plxcustomer.io/api/cursor/*` (`self-check`, `checkout`,
   `progress`, `complete`) with `x-api-key` + operator/repo headers.
3. Or `COMPLIANCE_CAPTURE=1` + `scripts/compliance-checkout.mjs` when key is present.

Team Rule 4 (“PLX-MC MCP expected”) still applies: prefer MCP tools when present;
if the catalog lacks Hub/Portal, **record the gap and use REST** — never invent
`MC-Checkout` stamps.

## Remaining / follow-ups

- [x] Team Rules paste
- [x] Team MCP Hub/Portal registered
- [ ] Cursor platform: Team MCP attach to Cloud runs (external)
- [ ] Optional: provision Cloud Agents **service account API key** for inline `mcpServers` launches
- [ ] Optional: update Rule 4 text to name the REST fallback explicitly
- [ ] Proceed program to TASK-683 (portal ADR-005) under REST/MCP-when-available

## Kill switches

- Disable Team MCP entries in Integrations
- Vercel `PLX_MC_MCP_ENABLED=0`
- Deactivate Team Rules 18212–18215
