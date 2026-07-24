# CLOUD-WIRING-VERDICT — TASK-682

**Date:** 2026-07-24  
**Status:** **ACCEPTED + SERVICE KEY VERIFIED**

## Verdict

| Layer | Result |
|---|---|
| Team Rules (18212–18215) | **PASS** |
| Team MCP Hub/Portal registered | **PASS** |
| Web UI Cloud Agent Team MCP attach | **FAIL** (Cursor platform bug) |
| Personal API key `CURSOR_CLOUD_SERVICE_API_KEY` | **PASS** (`GET /v1/me` → vince@petrasoap.com) |
| Inline `mcpServers` launch (`POST /v1/agents`) | **PASS** |
| Verify agent MCP catalog | **PASS** — Hub + Portal + cursor-cloud + xai-docs |
| `PLX-MC-Hub` → `mc_self_check` | **PASS** — `ok: true` |

## Evidence

- Verify agent: https://cursor.com/agents/bc-83d3035f-1fa5-4191-acc4-6ccc26b65b9d
- Owner key: Vince personal API key stored as `CURSOR_CLOUD_SERVICE_API_KEY` in `prod/ec2-secrets`
- Create shape: `POST https://api.cursor.com/v1/agents` with `repos` + `mcpServers` (v0 rejects `mcpServers`)
- Interim for dashboard-launched agents: REST `/api/cursor/*` with AWS-hydrated `PLX_MC_MCP_API_KEY`

## Operator notes

- Do **not** use Team Admin/spend keys for Cloud Agents API.
- Prefer Enterprise service-account key later for shared CI; personal key is valid for now.
- Optionally refresh Team Rule 4 from `config/cloud-agent-fleet-always-apply.md`.

## Kill switches

- Rotate/delete `CURSOR_CLOUD_SERVICE_API_KEY`
- Disable Hub/Portal in Integrations
- Deactivate Team Rules 18212–18215
