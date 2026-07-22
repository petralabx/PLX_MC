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
| Projects | name, health, started, target, desc | Owner, PRD Link |
| Roadmap | name, health, started, target, progress, project | Owner, PRD Link |
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
- **`lastSweepAgeMs`:** computed from `lastSweep` when it is canonical ISO or
  the UTC display stamp `YYYY.MM.DD · HH:mm` (`repo.stamp()`); null when absent
  or unparseable.
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
