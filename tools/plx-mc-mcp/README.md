# PLX-MC MCP server

Team-distributed MCP for **PLX Mission Control** — task lifecycle, audit trail,
composed swarm delegation.

## Tools

| Tool | Description |
|------|-------------|
| `mc_self_check` | Auth + connectivity probe |
| `mc_get_context` | Tasks/buckets snapshot |
| `mc_search_tasks` | List/search tasks (filters incl. `completedAfter`/`completedBefore`; rows carry `completedAt`) |
| `mc_suggest_work` | Suggest existing Tasks + `routingSessionId` (no create/link) |
| `mc_create_project` | Create project (SharePoint Projects mirror) |
| `mc_list_projects` | List projects by `status` (active default, closed, all) with owner, health and bucket/task counts |
| `mc_update_project` | Steward edit of a project (`status` active/closed, owner, description, name, note) |
| `mc_create_bucket` | Create bucket/initiative, optionally under a project (SharePoint Roadmap mirror) |
| `mc_update_bucket` | Patch an existing bucket (`prd`, health, owner, description, name, target, repos, project) |
| `mc_create_task` | Create task (SharePoint mirror) |
| `mc_checkout_task` | Checkout + `MC-Checkout: dsp_*` stamp |
| `mc_report_progress` | Stage/notes updates; `stage=cancelled` + `cancelReason` / `replacedBy` / `note` cancels (needs `task.cancel`; reopen needs `task.reopen`) |
| `mc_update_task` | Audited `{taskId, patch}` metadata edit; labels stay DB-only; `patch.cancel` / `patch.reopen` end or restore a task (audited `task.cancelled` / `task.reopened`) |
| `mc_update_tasks` | Batch metadata edits, 1–100 `{taskId, patch}` items with independent outcomes |
| `mc_complete_task` | Complete with evidence |
| `mc_get_task` | One task + accountable owner, evidence, checkouts, recent events; checkout ids redacted to `checkoutRef` (read-only) |
| `mc_list_checkouts` | Checkouts as `checkoutRef` (`dsp_…` + last 4, never the usable id) filtered by `repo` (owner/name), `taskId`, `active` (read-only) |
| `mc_search_knowledge` | Ask the Brain search; hits carry provenance (read-only) |
| `mc_verify_pr` | Compliance-gate verdict for `repo` + `pr`, not recorded (read-only) |
| `mc_request_approval` | Raise a runtime approval gate on a task (optional `checkoutId` block + structured `proposal`) |
| `mc_get_approval_gate` | Read a gate's state; optional `waitSeconds` (max 25) long-poll |
| `mc_release_checkout` | Release a stray or expired lease by `checkoutId`, or `checkoutRef` + `taskId`, with a `reason`; never changes the task |
| `mc_release_checkouts` | Batch form of `mc_release_checkout` with per-item outcomes |
| `mc_report_session_telemetry` | Report session token usage and cost (cents) at close; one row per `sessionId` |
| `dispatch_to_swarm` | COS swarm delegation |
| `list_swarm_teams` / `swarm_health` | Swarm helpers |

Failed tools return `isError` + `{ "error": { "code", "message" } }` JSON
(`lib/tool-errors.mjs`), keeping the cursor REST error code. When this client
is unavailable, `node scripts/mc.mjs checkout|complete|status` calls the same
REST routes (see `docs/modules/mcp/README.md`).

Suggestion tools register via `routing-suggest-tools.ts` (`registerRoutingTools`).
Confirmed mutation tools will register through the same seam in a later phase.

## Env

| Variable | Default | Purpose |
|----------|---------|---------|
| `MC_BASE_URL` | `https://mc.plxcustomer.io` | PLX MC API base |
| `MC_MCP_PRINCIPAL_ID` | inferred from known runtime; otherwise `sp_mcp_cursor` | Reviewed durable service-principal identity |
| `MC_MCP_API_KEY` | AWS fallback when unset | Key matching `MC_MCP_PRINCIPAL_ID` |
| `MC_OPERATOR_EMAIL` | _(required)_ | Allowlisted operator (audit context) |
| `MC_REPO` | _(required)_ | Repo slug for checkout binding |
| `PLX_MC_MCP_ENABLED` | `0` | Kill switch |
| `PLX_MC_ROUTING_SUGGEST_ENABLED` | `0` | Enables `mc_suggest_work` on the server |
| `SWARM_DISPATCH_ENABLED` | `0` | Swarm compose kill switch |

## Run locally

```bash
cd tools/plx-mc-mcp && npm install
PLX_MC_MCP_ENABLED=1 MC_MCP_PRINCIPAL_ID=sp_mcp_claude_code MC_MCP_API_KEY=... MC_OPERATOR_EMAIL=... MC_REPO=petralabx/PLX_MC npx tsx index.ts
```

The shared search schema lives in `task-search-schema.ts`; the web MCP module
re-exports it. Zod resolves from this tool install (via the SDK dependency) or
from the repository root in a web-only install. From the repository root, run
`node scripts/check-mcp-stdio-standalone.mjs` to check startup and search-tool
registration with an isolated tool-only `npm ci` under `/tmp`.

`launch.mjs` uses `prod/ec2-secrets` only for `sp_mcp_cursor`. Dedicated
principals are selected from `plx/prod/mc/mcp-agent-keys/v1`; a missing entry
fails closed without shared-key fallback.

## Remote HTTP

Register `https://mc.plxcustomer.io/api/cursor/mcp` (Streamable HTTP) — see
`docs/runbooks/plx-mc-mcp-team-registration.md`.

## Governance

Ships **disabled by default**. Module contract: `docs/modules/mcp/README.md`.

## Task metadata edits (Hub only)

`mc_update_task({taskId, patch})` accepts `labels` (replace) or
`addLabels` / `removeLabels` (incremental), `description` (replace/clear) or
`appendDescription` (non-empty, two-newline append), `title` and `priority`
(`urgent | high | medium | low`). Mutually exclusive forms cannot mix.
Labels are trimmed and deduplicated, max 128 characters each and 100 per list
and final set; title is non-empty after trimming, max 255 characters;
description max 32,000 characters after append. Exactly one non-empty
`lane:*` must remain: remove an old lane in the same call when adding a new
one, and supply a lane when editing an unlabeled legacy task. Exceptions: a
lane-less task may only gain/lose closure labels in a label-only patch (`closed:duplicate`,
`closed:obsolete`, `closed:superseded`, `closed:delivered`, `closed:wontfix`,
`not-needed`), be moved by `bucket` alone, or be `merged`/`verified`.
`patch.bucket` (`BKT-*`, optional `note`) moves the task and audits `task.moved`.

Unknown fields, stage/Verified, evidence and checkout fields are rejected.
Auth is the existing MCP principal/operator admission, `task.progress` and
project ACL; portal/consumer allowlists do not admit these tools. Each update
uses the normal task patch path and commits a `task.updated` event with
`actor`, `task_id`, `repo` and `{servicePrincipalId, workerId, diff}` in its
payload. Diff entries contain only changed fields as `{before, after}`;
no-ops have an empty diff. The response includes `eventSeq`.

**Labels stay DB-only** in the task JSONB. Labels-only edits audit successfully
without adding a SharePoint push; title, description and priority use the
existing ToDos pending/dirty sync path. No Labels column or outbound mapping
change is needed.

`mc_update_tasks({items:[{taskId, patch}]})` accepts 1–100 items. Items run in
order, each in its own transaction, and return a compact receipt `{index, ok, taskId, changed, eventSeq}` or
`{index, ok:false, error}` plus `updated` and `failed` totals. Invalid patches,
unknown tasks (REST 404), denied tasks and internal failures do not abort
siblings. Empty/oversized batches are rejected. Inspect each outcome; inspect
current description before retrying an uncertain append (appends are not
idempotent). The stdio client proxies to `/api/cursor/tasks/update` and
`/api/cursor/tasks/update-batch`; HTTP MCP calls the same actions. See
`docs/AGENT-PR-SOP.md` for Ledger backfill hygiene.

Task search supports `cursor`/`limit` (default 50, max 200), exact `label`,
`searchComments` or explicit `in: ["title", "description", "comments", "notes"]`,
and `fields: "compact"`. Both MCP transports return `data.nextCursor` (null at
end) and the exact visible filtered `data.total`. Reuse the returned cursor
with unchanged filters/identity; numeric task-ID ordering and the first-page
insert boundary prevent new tasks from shifting pages. Discussion matches
full-text words; title/description and IDs keep substring matching. Query
results include `matchFields`. See the [Hub search contract](../../docs/modules/mcp/README.md#task-search-pagination-and-discussion-search)
for REST encoding, cursor limitations and compact timestamp behavior.
