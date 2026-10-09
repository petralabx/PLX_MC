# Module: sync

## What

The system-of-record side of Mission Control: SharePoint provisioning, the
two-way Graph sync engine (outbound push, inbound delta, conflict queue, audit
log), and the canonical bounded-staleness freshness API used by routing.
Owns `config/sharepoint-schema.json`, `scripts/provision-sharepoint.py`, and
`src/lib/sync/**`. It is NOT the UI (web).

## Why

SharePoint is the canonical system of record (SOUL.md non-negotiable) for human
planning data. Agents must not overwrite newer attributable human edits.
Routing mutations fail closed when required registers are stale.

## How

### Bounded-staleness guarantee

- Required routing registers: **Projects**, **Roadmap**, **ToDos**.
- Freshness is a **complete successful inbound delta** timestamp per register
  (`sync_register_freshness`), **not** `max(delta_links.updated_at)`.
- Maximum age: **360,000 ms** (six minutes). Older or missing → fail-closed
  `sync_stale` with explicit `missing_register:*` / `stale_register:*` reasons.
- Cadence: five-minute cron / in-app scheduler remains the recovery path.
  Graph change-notification delivery is **out of scope for P4** (P11).

### Authority matrix (routing-relevant)

| Register | Two-way fields | MC-push-only (preserved) |
|---|---|---|
| Projects | name, health, started, target, desc | Owner, PRD Link, Archived |
| Roadmap | name, health, started, target, progress, project | Owner, PRD Link, Archived |
| ToDos | title, stage, assignee, priority, due, bucket, description | Accountable Owner, Reporter, reqs, estimate, repos, targetEnv, evidence, subtasks |

- Human-created SharePoint rows with valid unique IDs (`PRJ-*`, `BKT-*`,
  `TASK-*`) are **adoptable inbound** after validation. Invalid rows are
  audited and skipped — never fabricated ownership, never silent delete.
- Imported numeric `TASK-*` IDs reconcile `mc_task_id_seq` without moving
  backward.
- Inbound always runs before outbound in every sweep.
- Newer SharePoint edits attributed to a **human** beat older **service**
  pending edits on routing fields (audited). Human-vs-human and unknown /
  ambiguous conflicts stay in the manual review queue.

### Live freshness (Phase 3 — TASK-626/627/628)

- **Subscriptions (TASK-626)**: `/api/cron/sync-subscriptions` now ensures +
  renews change-notification subscriptions for todos/risks/projects/roadmap
  (`ensureAllListSubscriptions`). Live Graph create/renew is double-gated:
  `PLX_MC_GRAPH_SUBSCRIPTIONS_LIVE=1` AND `boringGateMet` (checked at runtime);
  otherwise rows stay `sub_local_*` placeholders. Going live replaces
  placeholders with real Graph subscriptions idempotently.
- **Targeted delta (TASK-627)**: the notification queue's default runner is
  `runScopedListDelta(listKey)` — one register's inbound pull, not a full
  sweep — and the webhook drains the queue post-ack via `after()`
  (`PLX_MC_GRAPH_NOTIFICATION_INLINE_DRAIN`, default on when the webhook is
  enabled; =0 falls back to the hourly cron drain). Edit-to-UI target <60s;
  the 5-minute sweep remains the correctness recovery path.
- **Task completion date (TASK-2528)**: `entities.completed_at` (task rows only;
  CHECK-enforced) is stamped once by `updateEntity` on the first move from a
  non-terminal into a terminal stage (`TERMINAL_STAGES`, `src/lib/mc-data/policy.ts`)
  — covering UI, MCP, compliance projection (PR merge time) and SharePoint
  inbound stage changes — and also at creation for a task created directly in a
  terminal stage. It is write-once (`COALESCE`), merged into the task as
  `completedAt` on read, and stripped from the jsonb payload on every write. The
  ToDos `CompletedAt` column is outbound-only (not in `inboundPatches`), so a
  SharePoint edit is ignored and never raises a conflict. A first population
  (inbound move or backfill `--apply`) queues `completedAt` as an outbound dirty
  field, so the next sweep writes only that column. The `cancellation`
  column ships in the same migration for the cancelled-stage task. Existing rows
  are filled by `scripts/backfill-task-completed-at.mjs` (dry run by default;
  UAT/staging only; it dates a task only from a PR merge or an observed
  transition from a known non-terminal stage, and lists the rest as unresolved).
  Required: `--env uat|staging` (report label only) and
  `--approved-db <database>@<host>`. Before any read or write the shared guard
  `scripts/lib/db-identity.mjs` (`assertApprovedNonProdDb`) requires the URL
  host/database and the live `current_database()` to equal `--approved-db`, and
  always refuses the runtime database (`plx_mc` on `plx-postgres-staging*`).
  **Deploy order:** at deploy, before this PR's code goes live, run
  `scripts/provision-sharepoint.py` with MC's own sync identity (the same app
  identity the sync engine uses, `MICROSOFT_GRAPH_*`; not a personal account),
  first against /sites/plx-mission-control-dev (staging), then
  /sites/plx-mission-control (production). The script creates `CompletedAt` as an
  optional date-and-time column with no default, hidden from the edit form, or
  updates an existing one to that definition (idempotent; column listings select `hidden`, which Graph otherwise omits).
  Per site: dry run
  `python scripts/provision-sharepoint.py --env <staging|production>`, apply
  `python scripts/provision-sharepoint.py --env <staging|production> --apply`,
  check `python scripts/provision-sharepoint.py --env <staging|production> --verify`.
- **Project Documents increment (TASK-628)**: inbound-only mirror of the
  Project Documents drive (`/drives/{id}/root/delta`) into `file` entities,
  behind `PLX_MC_DOCUMENTS_SYNC_ENABLED` (default off). Deletions are audited
  and skipped — the mirror never deletes; a documents failure never breaks
  the core sweep.
  - **Initiative/task links**: files under `/{Initiative}/{PRD|Evidence|Deeds|
    Reports}/…` are linked from the folder path alone (no new column, no
    SharePoint metadata): `file.bucket` (folder matches a bucket id, a `BKT-*`
    token, or the bucket name), `file.docType`, `file.task` (a `TASK-n` token in
    the file name or folder) and `file.webUrl`. A mirrored PRD also sets the
    bucket's `prd` (`buckets.data` JSON) and re-queues the Roadmap push so
    `PRDLink` reaches SharePoint. A PRD link set by hand is never replaced —
    only an empty one or one the mirror wrote. `/Shared` and unknown folders
    stay unlinked. Graph's drive delta omits `parentReference.path`, so folder
    ancestry is resolved by `parentReference.id` through stored folder rows +
    the delta batch (unresolvable chain → unlinked, never guessed); a moved file
    has its links cleared (and a mirror-owned bucket `prd` with them; MC-side only — the push omits an empty `PRDLink`, so SharePoint's column keeps the stale URL until overwritten). Known limit: renaming/moving a *folder* re-links its
    children only when they next appear in a delta. Test: `tests/sync-documents.test.ts` (fake drive delta →
    real `runSweep`).

- **Restricted tombstone (TASK-1534)**: a project marked restricted after it
  was pushed keeps its mirrored Projects/Roadmap/ToDos items. With
  `PLX_MC_SP_RESTRICTED_TOMBSTONE=1` (default off) the sweep deletes exactly
  those items by recorded `spItemId` (`deleteListItem`: one Graph DELETE per
  id; 404 = already gone; 429/5xx deferred via the push retry ledger) and
  clears the local link. Gate off: only logs what it would delete. Local rows
  are never deleted. Test: `tests/sync-restricted-tombstone.test.ts`.

### Reliability (Phase 2 — TASK-622/623/624)

- **Outbound push retry queue** (`outbound_push_retries`, migration 024): a
  transient Graph failure (429/5xx) on one entity defers that entity with
  exponential backoff (5 min base, ×2 per attempt, 6 h cap, `Retry-After`
  honored) instead of aborting the sweep. Terminal after 8 attempts → parked
  in the error register like a 4xx. Ledger failures are fail-open (legacy
  retry-every-tick behavior). A tick with deferrals is not "boring"
  (`graphOk=false` resets the streak).
- **DB TLS verification is ON** (`src/lib/db/tls.ts` + `scripts/lib/db-ssl.mjs`):
  verify against the vendored AWS RDS CA bundle
  (`config/certs/aws-rds-global-bundle.pem`); override via
  `PLX_MC_DB_CA_CERT` / `PLX_MC_DB_CA_CERT_PATH`; break-glass
  `PLX_MC_DB_TLS_INSECURE=1` (loud).
- **Missed-tick watchdog** (`src/lib/sync/health.ts`,
  `GET /api/cron/missed-tick`): alerts when no register completed inbound
  within 15 min — one deduped `sync.missed_tick` event per hour-long episode
  plus an optional `PLX_MC_ALERT_WEBHOOK_URL` POST. Fail-open by contract.
  GitHub Actions (`.github/workflows/sweep-redundancy.yml`) is the scheduler
  for this route and calls it before the recovery sweep, so an extended gap
  is still visible. That pre-sweep call adds a 5-minute grace
  (`beforeSweep=1`) because the Actions cadence equals the 15-minute
  threshold. `vercel.json` does not list the route, so a Vercel Cron outage
  still raises the alert. `GET /api/cron/reconcile` evaluates the strict
  15-minute check while that Vercel cron is alive; both callers share the
  dedupe. Watchdog-only dispatch (`mode=watchdog`) uses the strict threshold
  and does not sweep.
- **Cadence redundancy**: `.github/workflows/sweep-redundancy.yml` triggers
  `GET /api/cron/sweep` every 15 min from GitHub Actions (secret
  `PLX_MC_CRON_SECRET`; absent secret → the job no-ops) against production
  (`https://mc.plxcustomer.io`) and, when repo variable
  `PLX_MC_STAGING_SWEEP_URL` is set, staging. The same job then calls
  `GET /api/cron/missed-tick` on each armed target.

### Kill switch / fallback

- `PLX_MC_SYNC_ENABLED=1` enables the in-app 5-minute scheduler (default OFF).
- Vercel Cron `GET /api/cron/sweep` (Bearer `CRON_SECRET`) is the deployed
  cadence on production host **`https://mc.plxcustomer.io`** (Vercel project
  `plx-mission-control`; schedule in `vercel.json`); unset secret → 503.
- `PLX_MC_GRAPH_WEBHOOK_ENABLED` (P11) can disable notifications while
  retaining delta recovery — not wired in P4.
- Fallback: manual `POST /api/sync/sweep` (session `sync.mutate`) or wait for
  the next cron tick.

### Maturity (honesty-oracle)

- **`mc_self_check` cadence fields:** `syncMode` (`in-app` | `cron` | `off`) is
  authoritative. `inAppSchedulerEnabled` mirrors `PLX_MC_SYNC_ENABLED=1` (in-app
  scheduler only). `cronConfigured` reflects `CRON_SECRET` presence. Do not
  infer cadence from `inAppSchedulerEnabled` alone when `syncMode` is `cron`.
- **`lastSweepAgeMs`:** computed from `lastSweep` when it is canonical UTC ISO
  (`YYYY-MM-DDTHH:mm:ss[.SSS]Z`) or the UTC display stamp
  `YYYY.MM.DD · HH:mm` (`repo.stamp()`); null when absent or unparseable.
- **Sync engine (delta) — current:** inbound delta poll + outbound push is the
  live correctness backbone (five-minute sweep).
- **Graph change-notifications — deferred (P11):** subscription renewal /
  notification queue cron routes are gated scaffolding only; do not treat
  webhook cron presence as shipped push freshness.
- Production SoR cutover evidence:
  `artifacts/sync/2026-07-13-prod-site-cutover/` (Vercel Production redeploy
  aliases include `mc.plxcustomer.io`).

### Mirror-is-boring streak (N=7)

- After every successful `runSweep`, the engine evaluates whether self-check
  would report `dataSource: live` **and** `freshness.ok`, then increments or
  resets a singleton counter in `sync_boring_gate` (migration `021`).
- Exposed on `mc_self_check`: `boringTickStreak`, `boringGateN` (default 7),
  `boringGateMet`, `lastBoringEvalAt`, `lastBoringOutcome` (`green`|`reset`).
- Conflicts do **not** reset the streak (warning-only until volume exists).
- New planes (Knowledge Hub UI, OpenFlowKit, P11 live webhooks, …) wait until
  `boringGateMet` is true — see `AGENTS.md` → "Mirror Is Boring Entry Gate".

### Authorization

- Session conflict resolve / error retry / manual sweep: Entra `oid` from the
  authenticated session (caller-supplied actor ignored) + `sync.mutate`.
- MCP conflict list (`mc_list_conflicts`): durable MCP service principal +
  `task.read`. Returns open `sync_conflicts` rows (`cf-*` ids) from
  `repo.listOpenConflicts()`. No Entra session. Does not resolve.
- MCP conflict resolve (`mc_resolve_conflict` / `mc_resolve_conflicts`): durable
  MCP service principal + `sync.mutate`. Resolution enum is `keep_mc` \|
  `keep_sp` (mapped to engine `mc` \| `sp`). No Entra session. Ledger owns
  Keep MC for stage-lag leftovers; never silent `keep_sp`.
- Cron / inbound writes: durable service principal `sp_sync_inbound` +
  `sync.service.write`. Outer cron Bearer admission is unchanged.

### Audit boundary

Every adoption, invalid-row skip, conflict, human-over-service precedence
event, and sweep outcome appends to `sync_audit_log`. Conflict/error queues
retain history after resolution.

### Key files

- `src/lib/sync/freshness.ts` — canonical freshness API
- `src/lib/sync/engine.ts` — sweep, adoption, attribution, auth helpers
- `src/lib/sync/mapping.ts` — directions + reconcile + adoption validation
- `db/migrations/019_sync_authority.sql` — freshness + field attribution
- `config/sharepoint-schema.json` / `docs/product/SHAREPOINT_INTEGRATION.md`

## Dependencies

Python 3.12 + `requests`. Microsoft Graph. Postgres (`PLX_MC_DATABASE_URL`).
Permissions kernel (`sync.mutate`, `sync.service.write`). Depended on by:
routing (freshness gate), web store.

## Owner

Vince

## Criticality

Critical


### Container retirement

Migration 035 exposes `archived_at`, `archived_by`, `archive_reason` as stored
columns derived from existing JSON `archivedAt`, `archivedBy`, `archiveReason`
(the same single-authority pattern as project status). Archive/unarchive uses
`archiveContainer`, exported through the sync barrel. It serializes hierarchy
and task writes for the guard/cascade transaction, queues Projects/Roadmap and
appends per-container MC events in that transaction. There are no task writes.
AFTER INSERT guards close creation races and cover non-MCP creation paths;
ON CONFLICT updates of existing tasks continue syncing in archived buckets.
New inbound tasks/buckets beneath archived containers are audited and skipped
before insertion; archive guard race rejections are also audited and skipped so
cursors advance and outbound work continues. Existing records continue syncing.
Archive/unarchive (including migration backfill) preserves conflict holds; the
Archived flag waits for human conflict resolution before outbound mirroring.
Inbound Projects/Roadmap fields never overwrite the outbound-only `Archived`.
Owner: Vince. Reverting the app restores the former health filter; additive
columns stay. Operators can unarchive before rollback if they also need to
allow new records in containers (database insert guards remain after code revert).
