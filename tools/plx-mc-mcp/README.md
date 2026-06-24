# PLX-MC MCP server

Team-distributed MCP for **PLX Mission Control** — task lifecycle, audit trail,
composed swarm delegation.

## Tools

| Tool | Description |
|------|-------------|
| `mc_self_check` | Auth + connectivity probe |
| `mc_get_context` | Tasks/buckets snapshot |
| `mc_search_tasks` | List/search tasks |
| `mc_create_task` | Create task (SharePoint mirror) |
| `mc_checkout_task` | Checkout + `MC-Checkout: dsp_*` stamp |
| `mc_report_progress` | Stage/notes updates |
| `mc_complete_task` | Complete with evidence |
| `dispatch_to_swarm` | COS swarm delegation |
| `list_swarm_teams` / `swarm_health` | Swarm helpers |

## Env

| Variable | Default | Purpose |
|----------|---------|---------|
| `MC_BASE_URL` | `https://mc.plxcustomer.io` | PLX MC API base |
| `MC_MCP_API_KEY` | _(required)_ | Server API key |
| `MC_OPERATOR_EMAIL` | _(required)_ | Allowlisted operator |
| `MC_REPO` | _(required)_ | Repo slug for checkout binding |
| `PLX_MC_MCP_ENABLED` | `0` | Kill switch |
| `SWARM_DISPATCH_ENABLED` | `0` | Swarm compose kill switch |

## Run locally

```bash
cd tools/plx-mc-mcp && npm install
PLX_MC_MCP_ENABLED=1 MC_MCP_API_KEY=... MC_OPERATOR_EMAIL=... MC_REPO=taylorvalton/PLX_MC npx tsx index.ts
```

## Remote HTTP

Register `https://mc.plxcustomer.io/api/cursor/mcp` (Streamable HTTP) — see
`docs/runbooks/plx-mc-mcp-team-registration.md`.

## Governance

Ships **disabled by default**. Module contract: `docs/modules/mcp/README.md`.
