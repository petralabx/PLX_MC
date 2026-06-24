# MCP Module

## What

First-class **PLX-MC** MCP server for team-distributed agent runtimes: task lifecycle
(checkout / progress / complete), search, audit trail, standardized `{ data, meta }`
envelope, and composed swarm delegation.

## Why

Agents working across `PLX_MC`, `plx-customer-portal`, and `agentic-swarm` need one
compliance-aware path to MC tasks (SharePoint SoR) without session cookies or duplicated
dispatch logic.

## How

| Surface | Path |
|---------|------|
| REST cursor API | `src/app/api/cursor/*` — self-auth via `PLX_MC_MCP_API_KEY` + operator headers |
| Streamable HTTP MCP | `GET/POST/DELETE /api/cursor/mcp` — remote team registration |
| Stdio MCP client | `tools/plx-mc-mcp/index.ts` — local Cursor + Cloud Agents |
| Swarm compose | `tools/plx-mc-mcp/lib/swarm-client.mjs` (shared with legacy `swarm-dispatch-mcp`) |
| Audit | `mcp.tool.invoked` events in `mc_events` via `src/lib/mcp/audit.ts` |
| Capture hook | `scripts/compliance-checkout.mjs` prefers `/api/cursor/checkout` when `MC_MCP_API_KEY` set |

**Enable (opt-in):**

```bash
PLX_MC_MCP_ENABLED=1          # server + client kill switch
MC_MCP_API_KEY=...            # AWS Secrets Manager / prod/ec2-secrets
MC_OPERATOR_EMAIL=vince@...   # allowlisted Petra operator
MC_REPO=taylorvalton/PLX_MC   # repo binding for checkout credentials
MC_BASE_URL=https://mc.plxcustomer.io
```

**PR stamp:** `mc_checkout_task` → `meta.links.checkoutStamp` = `MC-Checkout: dsp_*`

## Dependencies

- `src/lib/compliance/*` — checkout/complete ledger
- `src/lib/sync/*` — task mutations → SharePoint mirror
- `tools/swarm-dispatch-mcp/` — legacy stdio shim (deprecated; use PLX-MC server)
- `@modelcontextprotocol/sdk` — stdio + Streamable HTTP transport

## Owner

Vince
