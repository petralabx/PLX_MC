# Console cutover — status

**Date:** 2026-07-24  
**Status:** **UNBLOCKED** for inline-MCP verification via Vince **personal** API key  
(stored as `CURSOR_CLOUD_SERVICE_API_KEY`). Team Rules + Team MCP registration also done;
Web UI Team MCP attach remains broken (platform bug).

## What was blocked (historical)

| Path | Result |
|---|---|
| Cursor Admin API (`CURSOR_ADMIN_API_KEY`) | Works for `/teams/members`, `/teams/spend`, `/teams/audit-logs` only |
| Admin API create/update Team Rules | **No endpoint** (docs + probes) |
| Admin API create/update Team MCP | **No endpoint** (docs + probes) |
| Cloud Agents API with Team Admin key | **401** — Admin/spend keys rejected |
| `OTHERMCP` secret as user API key | Invalid |
| Browser login to dashboard | No Cursor session credentials in this VM |

## What Vince completed

1. Team Rules 18212–18215 pasted from `config/cloud-agent-fleet-always-apply.md`
2. Team MCP Hub/Portal confirmed in Integrations
3. Stored **personal** user API key as `CURSOR_CLOUD_SERVICE_API_KEY` in `prod/ec2-secrets`
   (Team Admin key failed; personal key works)
4. Verify agent with inline MCP:
   https://cursor.com/agents/bc-83d3035f-1fa5-4191-acc4-6ccc26b65b9d  
   Catalog: `PLX-MC-Hub`, `PLX-MC-Portal`, `cursor-cloud`, `xai-docs` · `mc_self_check` → `ok`

## Remaining platform gap

Web UI–launched Cloud Agents often still only get `cursor-cloud` (Team MCP attach bug).
Use:

- **Inline launch:** `POST https://api.cursor.com/v1/agents` + `repos` + `mcpServers`
  (see `docs/runbooks/cursor-cloud-service-account-api-key.md`)
- **Dashboard agents interim:** REST `https://mc.plxcustomer.io/api/cursor/*` with
  AWS-hydrated `PLX_MC_MCP_API_KEY`

Optional later: mint an Enterprise **service account** key for shared CI and replace
the personal value under the same secret name.

## Kill switches

- Rotate/delete `CURSOR_CLOUD_SERVICE_API_KEY`
- Disable Hub/Portal in Integrations
- Deactivate Team Rules 18212–18215
