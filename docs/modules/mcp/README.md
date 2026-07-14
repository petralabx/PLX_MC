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
| Routing suggest | `POST /api/cursor/routing/suggest` — `mc_suggest_work` (`routing.suggest`) |
| Streamable HTTP MCP | `GET/POST/DELETE /api/cursor/mcp` — remote team registration |
| Stdio MCP client | `tools/plx-mc-mcp/index.ts` — local Cursor + Cloud Agents |
| Swarm compose | `tools/plx-mc-mcp/lib/swarm-client.mjs` (composed into the PLX-MC client) |
| Audit | `mcp.tool.invoked` events in `mc_events` via `src/lib/mcp/audit.ts` |
| Capture hook | `scripts/compliance-checkout.mjs` prefers `/api/cursor/checkout` when `MC_MCP_API_KEY` set; missing `MC_TASK_ID` calls `/api/cursor/routing/suggest` and stops for explicit selection/`MC_CREATE_TASK=1` |

**Enable (opt-in):**

```bash
PLX_MC_MCP_ENABLED=1          # server + client kill switch
PLX_MC_ROUTING_SUGGEST_ENABLED=1  # mc_suggest_work + pre-checkout suggestions
MC_MCP_API_KEY=...            # AWS Secrets Manager / prod/ec2-secrets
MC_OPERATOR_EMAIL=vince@...   # allowlisted Petra operator (audit context only)
MC_REPO=petralabx/PLX_MC   # repo binding for checkout credentials
MC_BASE_URL=https://mc.plxcustomer.io
```

**PR stamp:** `mc_checkout_task` → `meta.links.checkoutStamp` = `MC-Checkout: dsp_*`

**Routing suggestion:** `mc_suggest_work` authorizes `routing.suggest` for the durable MCP
service principal (`sp_mcp_cursor`). Operator email is admission/audit context only
and never grants human capabilities. Returns `routingSessionId` (`rtx_*`), top
candidates with reasons and deep links, and `MC-Routing: rtx_*` — without creating
or linking Tasks. Modular registration (`registerRoutingTools`) leaves a seam for
later confirmed-mutation tools (P8).

**Compliance handshake (hard mode):** an agent PR that carries a `MC-Checkout` stamp
is held to the tier bundle. `mc_complete_task` writes the task's `evidence`
(`summary` + a done checklist + `rollback`) so the gate is satisfiable through the
MCP flow — pass `rollback` (and `verificationCommands`) when completing. The verify
gate matches `repo` on the **bare** GitHub name (`github.event.repository.name`), so
a checkout minted with either `MC_REPO=PLX_MC` or `MC_REPO=petralabx/PLX_MC`
resolves. The capture hook requests suggestions via `/api/cursor/routing/suggest`
when `MC_TASK_ID` is missing; set `MC_CREATE_TASK=1` (plus title/bucket) only for
explicit creation intent.

**High-risk (full-tier) changes** — migrations (`db/migrations/**`), auth, infra —
additionally require change-appropriate proof: pass a `testRun`
(`{ suite, passed, failed }` → written as `evidence.qa`) or `shots` (screenshots) to
`mc_complete_task`. Without one, the gate blocks a high-tier PR even with a complete
standard bundle.

## Dependencies

- `src/lib/compliance/*` — checkout/complete ledger
- `src/lib/sync/*` — task mutations → SharePoint mirror
- swarm delegation runs through the composed `swarm-client.mjs` in the PLX-MC client
  (the standalone `swarm-dispatch-mcp` shim was removed in P5)
- `@modelcontextprotocol/sdk` — stdio + Streamable HTTP transport

## Owner

Vince
