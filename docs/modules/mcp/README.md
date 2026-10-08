# MCP Module

## What

First-class **PLX-MC** MCP server for team-distributed agent runtimes: task lifecycle
(checkout / progress / complete), project and bucket creation, search, audit trail,
standardized `{ data, meta }` envelope, and composed swarm delegation.

## Why

Agents working across `PLX_MC`, `plx-customer-portal`, and `agentic-swarm` need one
compliance-aware path to MC tasks (SharePoint SoR) without session cookies or duplicated
dispatch logic.

## How

| Surface | Path |
|---------|------|
| REST cursor API | `src/app/api/cursor/*` — self-auth via per-agent keys (`PLX_MC_MCP_AGENT_KEYS`) or the legacy shared `PLX_MC_MCP_API_KEY` (retire via `PLX_MC_MCP_SHARED_KEY_ENABLED=0`) + operator headers |
| Planning hierarchy | `mc_create_project` + `mc_create_bucket` + `mc_update_bucket` — capability-gated writes queued through the existing Projects/Roadmap SharePoint mirrors |
| Routing suggest | `POST /api/cursor/routing/suggest` — `mc_suggest_work` (`routing.suggest`) |
| Streamable HTTP MCP | `GET/POST/DELETE /api/cursor/mcp` — remote team registration |
| Stdio MCP client | `tools/plx-mc-mcp/index.ts` — local Cursor + Cloud Agents |
| Swarm compose | `tools/plx-mc-mcp/lib/swarm-client.mjs` (composed into the PLX-MC client) |
| Audit | `mcp.tool.invoked` events in `mc_events` via `src/lib/mcp/audit.ts` |
| Capture hook | `scripts/compliance-checkout.mjs` prefers `/api/cursor/checkout` when `MC_MCP_API_KEY` set; missing `MC_TASK_ID` calls `/api/cursor/routing/suggest` and stops for explicit selection/`MC_CREATE_TASK=1` |
| Agent read tools | `src/lib/mcp/read-actions.ts` — `task.read` only, never a write grant (table below) |
| Tool errors | `installMcpToolErrorEnvelope` (`src/lib/mcp/envelope.ts`) — a thrown `ApiError` returns `isError` + `{ "error": { "code", "message", "hint"? } }`; stdio mirrors it in `tools/plx-mc-mcp/lib/tool-errors.mjs` |
| REST fallback CLI | `node scripts/mc.mjs checkout --task TASK-n --repo owner/name` · `complete --checkout dsp_x --summary … --verify "cmd" --rollback "…"` (refused without ≥1 `--verify` and a `--rollback`) · `status --task TASK-n` — env `MC_BASE_URL`, `MC_MCP_API_KEY`, `MC_OPERATOR_EMAIL`, `MC_REPO`; JSON out, exit 1 with the error code |

**Agent read tools + approval request (wave 4):**

| Tool | REST (stdio proxy) | Auth | Returns |
|------|--------------------|------|---------|
| `mc_get_task` | `GET /api/cursor/tasks/{id}` | `task.read` + project ACL | task (as `mc_get_context` full), `accountableOwner`, `evidence`, `checkouts`, recent `events` (excludes `mcp.tool.invoked`); every `dsp_*` id redacted |
| `mc_list_checkouts` | `GET /api/cursor/checkouts?repo=&taskId=&active=&limit=` | `task.read` + project ACL | dispatches newest first as `checkoutRef` + `taskId`, `repo`, `runtime`, `issuedAt`, `expiresAt`, `active`; `repo` is an exact owner/name slug |
| `mc_search_knowledge` | `GET /api/cursor/knowledge/search?q=&limit=` | `task.read` | Ask the Brain hits with provenance (`id`, `source`, `namespace`, `score`) + honest `status` |
| `mc_verify_pr` | `GET /api/cursor/verify?repo=&pr=` | `task.read` | the `/api/compliance/verify` verdict from GitHub PR stamps/labels/files; `recorded: false` (no check row, no `gate.*` event) |
| `mc_request_approval` | `POST /api/cursor/request-approval` | `approval.request` (write) | `gateId`, `status: pending`, `inputRequired: true` |
| `mc_release_checkout` | `POST /api/cursor/checkouts/release` | `task.checkout` + project ACL + accountable human / admin / Ledger-CoS steward (write) | releases one lease by `checkoutId`, or by `checkoutRef` + `taskId`; returns `checkoutRef`, `releasedAt`, `releasedReason` (`manual: …`), `authz` |
| `mc_release_checkouts` | `POST /api/cursor/checkouts/release-batch` | same, per item | `results[]` with `ok` + `data` or `ok: false` + `error`; `released`, `failed` |
| `mc_report_session_telemetry` | `POST /api/cursor/session-telemetry` | `telemetry.report` (write) | appends one `agent.session_telemetry` event per `sessionId` (replays are no-ops); read back per runtime and per bucket via `GET /api/agent-metrics?rollup=cost` (`src/lib/routing/cost-rollup.ts`); the roll-up applies the caller's project ACL (restricted-project tasks and their telemetry are dropped) and resolves checkout ids missing from the newest-5000 event sample from the `mc_dispatch` ledger. Remaining limit: a task's own `task.completed`/telemetry events older than that sample are not counted |

`mc_list_buckets` now needs only `task.read` (was `bucket.create`), so
read-only principals can discover `BKT-*` ids without a create grant.

**Checkout ids are credentials.** `complete()` accepts any unrevoked, unexpired
`dsp_*` id, and the dispatch row records no minting principal, so the read tools
never return a full id — active or inactive, in checkout rows, event payloads,
or verify reasons. They return `checkoutRef` (`dsp_…` + last 4). An agent
completes with the id from its own `mc_checkout_task` receipt.
`mc_request_approval` applies the same restricted-project guard
(`assertTaskProjectAccess`) as the other task writes.

**Checkout release (TASK-2326):** `mc_release_checkout` and
`mc_release_checkouts` (`src/lib/mcp/checkout-release-actions.ts`) end a stray
or expired lease. One SQL statement sets `released_at` and `released_reason`
(`manual: <reason>`) and appends `checkout.released` with the actor, reason,
`checkoutRef` and authz `reasonCode`. The principal needs `task.checkout`. The
operator must then be the lease's accountable human, a directory owner/admin,
or a Ledger/CoS steward (`CHECKOUT_RELEASE_STEWARDS`, today `cos@petrasoap.com`;
MC has no separate Ledger or CoS service principal). Anyone else gets 403 and a
`checkout.release_denied` event. An already-released lease returns
`already_released` and writes no second event. A revoked lease returns
`checkout_revoked`. A `checkoutRef` needs `taskId`, and two matching leases
return `ambiguous_checkout_ref`. A release never touches the task. A PR reopen
undoes only a `merged`/`closed` release, never a manual one. SOP:
`docs/AGENT-PR-SOP.md` (Ledger hygiene).

**Cancelled end stage (TASK-2529):** `cancelled` is a task stage for work that
will never ship. It is terminal (`TERMINAL_STAGES`) but is never "done": it is
excluded from open/remaining counts (dashboard, project and bucket progress,
`mc_get_context` active counts, `mc_suggest_work` candidates) and never counts as
merged or verified. The reason lives in `entities.cancellation` (column from
migration 033; task rows only):
`{reason: duplicate|obsolete|superseded|delivered_without_pr, replacedBy: TASK-n|null, cancelledAt, cancelledBy, note?}`.
Like `completedAt`, `mc_get_task`, `mc_get_context` `depth:full` and
`mc_search_tasks` (`stage=cancelled` works) return it as `cancellation`; it is never
stored in the jsonb payload.

- Cancel: `mc_update_task({taskId, patch:{cancel:{reason, replacedBy?, note?}}})`
  or `mc_report_progress({taskId, stage:"cancelled", cancelReason, replacedBy?, note?})`.
  `reason` is required and must be in the enum; `duplicate` and `superseded`
  require `replacedBy`, which must be an existing, different `TASK-n`. One
  transaction (`src/lib/sync/cancel.ts`) locks the row, sets the stage, writes
  `cancellation`, stamps `completed_at` (write-once) and appends `task.cancelled`
  (reason, replacedBy, previousStage, cancelledBy). `cancel` and `reopen` cannot
  be combined with other patch fields, so cancelling an old unlabeled task needs
  no lane label.
- Reopen: `patch:{reopen:{stage?, note?}}`. Default stage is the one before the
  cancel (from the latest `task.cancelled` event, else `backlog`); terminal
  stages are refused. It sets `cancellation` to NULL, leaves `completed_at`
  untouched and appends `task.reopened`. Cancelling again writes a new object.
- Who: cancel needs `task.cancel` and reopen `task.reopen`, evaluated on the
  authenticated principal (`requireMcpActor`; capabilities from
  `src/lib/permissions/grants.ts`). `X-MC-Operator-Email` is audit context only
  and never authorizes. Human admin/owner roles hold both; no service principal
  does until an operator grants one, and the shared agent bundle never carries
  them. No checkout is needed. Anyone else gets 403 and a
  `task.cancel_denied` / `task.reopen_denied` event.
- `mc_report_progress` on a cancelled task (other than notes/subtasks) returns
  `task_cancelled`: it never silently reopens. `mc_checkout_task` refuses a
  cancelled task (`task_cancelled`, 409). A PR that references a cancelled task
  passes the compliance check with a `warning:` reason and the projection records
  `task.promotion_skipped` instead of promoting it.
- Generic writes (REST PATCH, JSON saves, SharePoint re-sync) never write the
  column: `updateEntity` preserves it, refuses `stage: cancelled` without a
  validated object, and clears it when a task leaves `cancelled` by any path.
- Rollback: run `scripts/reopen-cancelled-tasks.mjs --env uat|staging --approved-db database@host` (dry run;
  `--apply` writes) BEFORE reverting the code PR; the `cancellation` column
  stays until task 2528's down migration.

**Task metadata edits (TASK-2328):** `mc_update_task({taskId, patch})` and
`mc_update_tasks({items:[{taskId, patch}]})` share
`src/lib/mcp/task-update-actions.ts`. Both HTTP MCP and stdio support them;
stdio proxies to `POST /api/cursor/tasks/update` and `/tasks/update-batch`.

- Patch fields: `labels` replaces the entire set; `addLabels` / `removeLabels`
  are incremental and cannot accompany `labels`. Removals happen before adds.
  Labels are trimmed, non-empty and deduplicated; max 128 characters per label,
  100 entries per input list and 100 labels in the final set.
- Exactly one non-empty, case-sensitive `lane:*` label must remain. To change
  lanes, remove the old lane and add the new one in the same call (or replace
  the label set). An unlabeled legacy task must receive a lane in its edit.
- `description` replaces (empty string clears); `appendDescription` appends
  trimmed non-empty text, separated from existing text by two newlines. These
  forms cannot mix. Maximum final description length: 32,000 characters.
  `title` is trimmed, non-empty, max 255 characters. `priority` is
  `urgent | high | medium | low`.
- Empty patches and unknown fields are rejected, including all stage,
  Verified, evidence and checkout fields, at the root and within `patch`.
  The tools never change evidence or checkouts, and change stage only through
  `cancel` / `reopen` (next section).
- Auth: existing MCP key/operator checks, `task.progress` and the task's
  restricted-project ACL. **Hub only**: the portal/consumer principal remains
  excluded by its existing tool allowlist; no capability grants were added.
  Unknown task ids return `not_found` (REST 404).
- The locked task row, normal `patchTask` mutation and `appendEventTx` commit
  together. Task/project ACL reads reuse that transaction connection; the
  existing-row edit skips fixture bootstrap to avoid borrowing another connection. `mc_events.kind = task.updated`, `actor = runtime:operatorEmail`,
  `repo`, `task_id`, and payload `{servicePrincipalId, workerId, diff}`.
  `diff` contains only changed fields as `{field: {before, after}}`; a no-op
  still writes an event with `diff: {}`. Responses include `eventSeq`, `diff`,
  the four editable `fields`, `taskId` and a task link. Every invocation also
  uses the existing `mcp.tool.invoked` audit wrapper.
- **Labels stay DB-only.** `patchTask` stores them in `entities.data`; a
  labels-only patch succeeds and audits without marking labels dirty or
  enqueueing a SharePoint push. Title, description and priority use the
  existing `PUSHED_FIELDS`, pending/dirty bookkeeping and normal ToDos sweep.
  Existing pending fields stay queued. No Labels column, mapping change,
  schema migration or alternate Graph write path is introduced.
- Batch cap: **1–100 items**, processed in input order. Validation, ACL,
  not-found and internal errors are per item; each item has its own transaction.
  Results contain a compact receipt `{index, ok, taskId, changed, eventSeq}` (full diff: `task.updated` event) or `{index, ok:false, error}`, plus
  `updated` (successful items, including no-ops) and `failed` counts. A bad
  item never aborts siblings; an invalid outer envelope is rejected.
  Appends are not idempotent: inspect task state before retrying an uncertain
  append response. Incremental label additions are safe to replay.

**Enable (opt-in):**

```bash
PLX_MC_MCP_ENABLED=1          # server + client kill switch
PLX_MC_ROUTING_SUGGEST_ENABLED=1  # mc_suggest_work + pre-checkout suggestions
MC_MCP_PRINCIPAL_ID=sp_mcp_claude_code  # reviewed client identity
MC_MCP_API_KEY=...            # matching shared or dedicated AWS key
MC_OPERATOR_EMAIL=vince@...   # operator on PLX_MC_ALLOWED_USERS (audit context only)
MC_REPO=petralabx/PLX_MC   # repo binding for checkout credentials (full GitHub slug)
MC_BASE_URL=https://mc.plxcustomer.io
```

`mc_create_task.repos[]` uses MC registry **ids** (`portal-web`, `plx-mc`,
`agentic-swarm`) — not the `MC_REPO` GitHub slug. See `docs/AGENT-PR-SOP.md`
(two repo namespaces).

The same registry-id rule applies to `mc_create_project.repos[]`,
`mc_create_bucket.repos[]`, and `mc_update_bucket.repos[]`. Every reviewed MCP
runtime principal except `sp_mcp_portal` shares the explicit `project.create` / `bucket.create` /
`bucket.update` grant; human-only administration (`project.update`),
repository approval, and permission management remain denied.

**Agent assignees (agent fleet P8):** a task's `assignee` may name an agent as
`agent:<slug>` (for example `agent:hasitha-fernando`). `mc_create_task` and
`POST /api/cursor/tasks` accept an optional `assignee`. Only a signed-in person
or `sp_mcp_portal` may set an `agent:` assignee. Every other MCP principal,
`sp_mcp_grok` included, gets `forbidden` (403), so outside doors cannot
delegate through MC. The rule lives in `actionCreateTask`; the session route
`PATCH /api/tasks/[id]` applies the same rule. A person or non-agent assignee
stays open to every principal. `mc_search_tasks` (`GET /api/cursor/tasks?assignee=`)
filters by exact assignee, so a runner finds the tasks assigned to its agents.

**Completion date (TASK-2528):** every task returned by `mc_get_task`,
`mc_get_context` `depth:full`, `mc_search_tasks` and the REST task routes carries
`completedAt` (ISO-8601, absent until the task first reaches a terminal stage).
It is read from `entities.completed_at`, never from the jsonb payload.
`mc_search_tasks` (`GET /api/cursor/tasks?completedAfter=&completedBefore=`)
filters on it: `completedAfter` is inclusive, `completedBefore` exclusive, both
ISO-8601; tasks with no `completedAt` never match; a malformed date is rejected
with `invalid_request`. Reporting SQL uses the partial index
`entities_task_completed_at_idx`.

**Portal principal (agent fleet P8):** `sp_mcp_portal` is the key the portal's
COS delegate tool uses. Its grant is least privilege (decision CG-07b): it may
create tasks (with an `agent:` assignee) and search tasks. Its grant holds only
`task.create` and `task.read`. Because `task.read` also admits read tools, a
tool allowlist (`src/lib/mcp/tool-allowlist.ts`) limits it to `mc_create_task`
and `mc_search_tasks`. Every other HTTP MCP tool and every other cursor REST
route gives `forbidden` (403) before it runs, reads included (`mc_get_context`,
`mc_list_buckets`, `mc_list_conflicts`, `mc_self_check`). A tool or route added
later is refused too until the allowlist names it. Other principals have no
allowlist. Fleet P8b adds one read: the grant gains `agent_report.read` and the
allowlist gains `mc_list_agent_reports` (`GET /api/cursor/agent-reports`). No
other principal holds that capability. The portal's existing MC key does not change. `mc_search_tasks`
(HTTP MCP and `GET /api/cursor/tasks`) returns the calling principal in
`meta.actor.servicePrincipalId`. Key rotation uses that search to verify the
portal key, because `mc_self_check` stays forbidden to it.

**Agent reports (agent fleet P8, D12):** `POST /api/cursor/agent-report`
records one free-form report per agent run as an `agent.report` event in
`mc_events`. The body is `agentSlug`, `loopId`, `runId`, `title` and `markdown`
(at most 32 KB of UTF-8). Auth is the MCP principal plus `telemetry.report`,
like `session-telemetry`. The dedup key is `report:<agentSlug>:<runId>`, so a
repeat run id adds nothing and the response says `recorded: false`. A signed-in
person reads reports through `GET /api/events?kind=agent.report`. No auth gives
401; a body over 32 KB gives 400.

**Agent-report reader (agent fleet P8b):** `GET /api/cursor/agent-reports`
reads `agent.report` events with the same key auth as `/api/cursor/tasks`,
newest first. Filters: `agentSlug`, `loopId`. `limit` is 1 to 100 (default
20). Pass `cursor=<nextCursor>` for the next page; `hasMore` says whether more
rows exist. Each row has `id` (the event seq), `agentSlug`, `loopId`, `runId`,
`title`, `markdown` and `createdAt`. A malformed or repeated query value gives
400. Auth is the MCP principal plus `agent_report.read`, which only
`sp_mcp_portal` holds; every other principal gets 403.

**Task-create idempotency (agent fleet P8b):** `POST /api/cursor/tasks` and
`mc_create_task` take an optional `idempotencyKey` (1 to 128 letters, digits,
`.`, `_` or `-`). A repeat with the same key from the same principal returns
the original task with `replayed: true` and creates nothing. The same key with
a different payload gets 409 `idempotency_key_reused` (the reporter is not part
of the payload). The key uses `mc_events` dedup keys
(`task.create.idempotency:<principal>:<key>`), so it needs no migration. A
repeat that arrives while the first create still runs waits up to about 5 s,
then gets 409 `idempotency_in_progress`. If the first create failed, a repeat
gets 409 `idempotency_key_failed`: send a new key. A call that fails its auth,
assignee or project checks does not use up the key. The result event commits
in the task's own transaction, so a task never exists without its result. A
claim with no result after 120 s is abandoned: the next repeat closes it and
gets `idempotency_key_failed`. A lock on the claim key keeps a late first call
from committing a task after that. A replay checks the project of the task's
current bucket, so a task that moved into a restricted project gives 403
`project_acl_denied` to a non-member.

**Patch bucket (TASK-1594):** `mc_update_bucket` (`PATCH /api/cursor/buckets`)
takes required `id` plus at least one of `prd`, `health`, `owner`,
`description`, `name`, `target`, `started`, `repos`, `project`. Auth is the MCP
principal + existing `bucket.update` (same grant as Entra `PATCH /api/buckets/{id}`),
not a new capability. Unknown ids return 404; principals without the grant
return 403. Use this to set a missing `prd` on an existing `BKT-*` without
the Entra UI.

**Restricted projects (TASK-1527):** `mc_create_project` accepts optional
`visibility` (`shared` | `restricted`) and `members[]` (emails, Entra oids,
directory ids, or reviewed `sp_mcp_*` ids). Restricted projects fail-close
`mc_get_context` / `mc_search_tasks` / `mc_list_buckets` / task mutate for
non-members and are omitted from the SharePoint Projects mirror. Shared remains
the default. Rails should create a restricted project after merge with
`visibility=restricted` and `members` including `vince@petrasoap.com`,
`tanush@petrasoap.com` (TASK-1527 mailbox; not in the in-repo HUMANS fixture),
and the Hub agent principals that need access (`sp_mcp_cursor`,
`sp_mcp_claude_code`, …). The creating principal is auto-added. Create
restricted from the start — restrict-after-push leaves any already-mirrored
SharePoint rows org-visible (see permissions module residual).

**Accountable owner defaulting:** `mc_create_task` defaults a missing
`accountableOwner` to the human operator behind the session — the allowlisted
`MC_OPERATOR_EMAIL` / `X-MC-Operator-Email` resolved to a directory id via
`resolveHumanAccountableOwner` (`src/lib/mc-data/policy.ts`) — so agent-created
tasks are not stranded at the EN-003 Planned gate. An explicit
`accountableOwner` in the request still wins.

**PR stamp:** `mc_checkout_task` → `meta.links.checkoutStamp` = `MC-Checkout: dsp_*`.
The checkout receipt also includes `taskId` and `actor.repo` (the slug bound on
the credential). One Hub connector stamps every petralabx repo: optional `repo`
on checkout is a GitHub slug that may override the connector `X-MC-Repo` for
allowlisted consumers (`petralabx/local-inference`, `petralabx/skills`,
`petralabx/1hr-after`, `petralabx/furgenics`, `petralabx/for-and-against`,
`petralabx/agentic-swarm`, `petralabx/plx-customer-portal`); omitted `repo`
keeps the connector default (Hub stays `petralabx/PLX_MC`). Unknown slugs fail
closed. Portal is no longer Portal-connector-only. Callers must refuse a
receipt whose `actor.repo` does not match the repo under edit.

**Sync conflict list + resolve (TASK-1467 / TASK-1473):** `mc_list_conflicts`
(`GET /api/cursor/conflicts`) returns open Sync rows from `repo.listOpenConflicts()`
(`id`, `entityType`, `entityId`, `field`, `mc_val`, `sp_val`, `detected_at`, plus
the `openConflicts()` UI fields). Optional filters: `entityId` / `taskId`
(aliases), `field`, `limit`. Auth is the MCP principal + `task.read`, not Entra.
`mc_get_context` still returns only a conflicts **count**. Ids follow
`cf-{entityId.lower}-{field}-{detectedAtMs}` (e.g. `cf-task-123-stage-…`).
`mc_resolve_conflict` / `mc_resolve_conflicts` (`POST /api/cursor/conflicts/resolve`)
call `resolveConflict` in the sync engine. Args: conflict id(s) + required
`resolution` `keep_mc` \| `keep_sp`. Auth is the MCP principal + `sync.mutate`,
not browser Entra. Ledger owns Keep MC for stage-lag leftovers; never silent
`keep_sp`; agents never mark a task Verified. The Sync console
`POST /api/sync/conflicts/{id}/resolve` stays Entra-gated. The Sync badge
(`counts.conflict + counts.error`) and review-queue label
(`openConflicts + openErrors`) can disagree; this tool lists open conflict
rows only.

**Approval gates (TASK-629):** `mc_request_approval` (`POST /api/cursor/request-approval`, and the HTTP/stdio MCP tool — both call `actionRequestApproval` in `src/lib/mcp/approval-actions.ts`) raises a runtime approval gate on a task (`approval.request`); the task freezes input-required until a human decides in the Approvals inbox.
Checkout also backfills a missing task `accountableOwner` through the same
resolver. Operator/service aliases that are not people
(for example `cos@petrasoap.com`) resolve to the PLX default accountable human,
Vince; an owner already on the task is never replaced.

**Routing suggestion:** `mc_suggest_work` authorizes `routing.suggest` for the
resolved durable MCP service principal (`sp_mcp_cursor`,
`sp_mcp_claude_code`, `sp_mcp_codex`, `sp_mcp_chatgpt`, `sp_mcp_grok`, `sp_mcp_hermes`,
`sp_mcp_swarm`, or `sp_mcp_agent_runner`; `sp_mcp_portal` holds no
`routing.suggest`). Operator email is admission/audit context only and never
grants human capabilities. Returns `routingSessionId` (`rtx_*`), top
candidates with reasons and deep links, and `MC-Routing: rtx_*` — without creating
or linking Tasks. Modular registration (`registerRoutingTools`) leaves a seam for
later confirmed-mutation tools (P8).

**Compliance handshake (hard mode):** an agent PR that carries a `MC-Checkout` stamp
is held to the tier bundle. `mc_complete_task` writes the task's `evidence`
(`summary` + a done checklist + `rollback`) so the gate is satisfiable through the
MCP flow. Non-empty `verificationCommands` and `rollback` are required on every
transport (HTTP MCP, stdio, `POST /api/cursor/complete`); a completion missing
either is rejected before it reaches the task. The stdio tool exposes the same
`rollback`, `testRun`, and `shots` evidence fields as `POST /api/cursor/complete`.
Every HTTP MCP tool call is audited as `mcp.tool.invoked`, like the REST wrapper. The verify
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

- `src/lib/compliance/*` — checkout/complete ledger, verifier (`verifyPr({ record: false })`), approvals, PR loader (`github-pr.ts`)
- `src/lib/sync/*` — task mutations → SharePoint mirror
- `src/lib/brain-ask` — `mc_search_knowledge` (VMC knowledge search)
- `src/lib/github-app` — `mc_verify_pr` reads PR metadata + files via `resolveGithubToken`
- swarm delegation runs through the composed `swarm-client.mjs` in the PLX-MC client
  (the standalone `swarm-dispatch-mcp` shim was removed in P5)
- `@modelcontextprotocol/sdk` — stdio + Streamable HTTP transport

## Owner

Vince

### Dismiss obsolete Sync conflicts (TASK-1642)

Use Hub `mc_dismiss_conflict(conflictId, reason?)` or
`mc_dismiss_conflicts(conflictIds, reason?)` when a conflict is obsolete and
neither frozen side should be applied. For example, TASK-1134 is already merged
while its old conflict records progress/specced. Dismiss only closes the queue
row: it does not change the live task stage, dirty fields, or SharePoint.
Use `keep_mc` when the live Hub value actually needs to be pushed to SharePoint;
dismiss does not repair drift. Never set tasks to Verified.

Both transports require the existing `sync.mutate` permission. The stdio route
is `POST /api/cursor/conflicts/dismiss`. The row stores `resolved_at`,
`dismissed_at`, `dismissed_by`, and optional `dismissal_reason`; its frozen
values and winner remain unchanged. A sync audit entry is committed in the
same transaction. Missing or already-closed IDs return a clear error (batch:
per-ID failure and `dismissedCount`). Batches accept 1–500 IDs and reasons
1–2000 characters. Each successful ID commits independently; retrying a batch
cannot dismiss an already-closed row again.
