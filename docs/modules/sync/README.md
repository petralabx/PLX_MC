# Module: sync

## What

The system-of-record side of Mission Control: SharePoint provisioning today,
the two-way sync engine next. Owns the canonical tenant schema
(`config/sharepoint-schema.json`), the idempotent provisioner
(`scripts/provision-sharepoint.py`), and — as it lands — the Graph sync
service (outbound push, inbound delta, webhooks, conflict queue, audit log).
It is NOT the UI (web) and NOT the prototype store (which it will replace
behind the same action surface).

## Why

SharePoint is the canonical system of record (SOUL.md non-negotiable); the
tenant shape must be reproducible from the repo, never hand-built. The
provisioning script gives the same evidence discipline as the governance
gates: dry-run by default, `--apply` to mutate, `--verify` to diff the live
tenant against the committed schema with exit codes.

## How

- Schema source: `docs/product/SHAREPOINT_INTEGRATION.md` §2–4 (spec wins) →
  `config/sharepoint-schema.json` (keep aligned with `SP_LISTS` in
  `src/lib/mc-data/data.ts`).
- Auth: Graph client credentials from `MICROSOFT_GRAPH_*` env (AWS Secrets
  Manager via the loader). Site creation uses the Graph beta create-site API
  (`Sites.Create.All`); lists/columns/folders are Graph v1.0.
- Environments: `--env staging` (`/sites/plx-mission-control-dev`, sandbox) and
  `--env production` (default SoR, `/sites/plx-mission-control`, provisioned
  2026-07-13 — verify with `python scripts/provision-sharepoint.py --env
  production --verify`). Runtime site selection:
  `PLX_MC_SHAREPOINT_SITE_PATH` (default `/sites/plx-mission-control`; set the
  staging path only when intentionally pointing a host at the sandbox).
- Cutover from staging → production: (1) provision + verify the production
  site, (2) set `PLX_MC_SHAREPOINT_SITE_PATH` (or ship the production default),
  (3) `node scripts/cutover-sharepoint-site.mjs --apply` to clear staging
  `sp_item_id` + `delta_links` so the next sweep re-mirrors by TaskID/Risk key,
  (4) trigger `POST /api/sync/sweep` or wait for the cron. Evidence:
  `artifacts/sync/2026-07-13-prod-site-cutover/`.
- Known constraints (verified 2026-06-11): Graph cannot create
  hyperlinkOrPicture columns app-only → `PRD Link` is a text column; Risk
  `Likelihood` choices are `High/Med/Low` BY DESIGN (spec §5.2) — the engine's
  mapping layer normalizes MC's `Medium` → `Med`.
- Persistence (landed 2026-06-11): dedicated `plx_mc` database on the staging
  RDS instance (`plx-postgres-staging`, us-east-1), owned by the app-only
  `plx_mc_app` role — never the trading database or its credentials. Runtime
  URL: `PLX_MC_DATABASE_URL` (AWS Secrets Manager via the loader). Schema via
  numbered migrations in `db/migrations/` (`npm run migrate`,
  `scripts/migrate.mjs`); numbering serialization enforced by
  `scripts/check-migrations.py` in every preflight mode. Tables: `delta_links`,
  `sync_conflicts`, `sync_push_errors`, `sync_audit_log`, `entities`,
  (Item 2) `repos` / `repo_requests`, (Item 4) `bucket_comments`, and
  (EN-005) `buckets`.
- Engine v1 (landed 2026-06-11, `src/lib/sync/`): outbound push + inbound
  Graph delta poll for ToDos and Risk Register against the configured site
  (production SoR as of 2026-07-13; staging sandbox retained).
  Inbound runs BEFORE outbound in every sweep so dirty-field edits raise
  conflicts (§5.1) instead of last-write-wins. Mapping layer (`mapping.ts`)
  enforces §3 directions and the §5.2 `Medium` → `Med` Likelihood
  normalization.   Runs inside the Next.js process: `src/instrumentation.ts`
  starts the 5-min scheduler when `PLX_MC_SYNC_ENABLED=1` (default OFF, intended
  for a long-lived host — e.g. the dev box). On Vercel, where serverless timers
  are unreliable, the in-app scheduler stays OFF and the 5-min cadence runs via
  Vercel Cron (`vercel.json` → `GET /api/cron/sweep`, authed by `CRON_SECRET`);
  `POST /api/sync/sweep` runs one on demand. API surface per spec §6 under
  `src/app/api/` (shared wrapper + zod). Evidence:
  `artifacts/sync/2026-06-11-sync-engine/`.
- Person columns (landed 2026-06-18, Item 1): ToDos `Assigned To` (↔),
  `Accountable Owner` (→) and `Reporter` (→) mirror via `<Column>LookupId`. The
  pure mapping layer emits a pre-resolved id (`outboundFields` `opts.persons`);
  `graph.ts` resolves an `@petrasoap.com` email → site User Information List id
  with a cached read (both directions). App-only client-credentials CANNOT
  `_api/web/ensureUser`, so a user not in the UIL (or an agent with no email)
  resolves to null → the column is skipped + audited (fail visible, never faked).
  `assignee` pulls inbound; owner/reporter are push-only.
- Repo Registry (landed 2026-06-18, Item 2): the allow-list + self-service
  request queue persist in the `repos` / `repo_requests` tables (migration
  `005`); `snapshot()` seeds the canonical repos idempotently and returns them so
  approvals survive a reload. A push-only "Repo Registry" list mirrors the
  registry (MC authoritative; resolved optionally so a missing list never blocks
  the sweep). Routes `POST /api/repos` (approver-gated) + `/api/repos/requests`.
- Sub-tasks (landed 2026-06-18, Item 3): a push-only `Subtasks` ToDos column —
  `serializeSubtasks` renders one human-readable line per sub-task; MC owns the
  structured array, so it is never read back.
- Bucket comments (landed 2026-06-18, Item 4): bucket discussion threads now
  persist in a dedicated `bucket_comments` table (migration `006`) via
  `PATCH /api/buckets/{id}/comments` (atomic replace-thread on `db.withTransaction`)
  and hydrate from the snapshot, so they survive a reload. The store mirrors each
  add/edit/delete optimistically (reconcile-on-success / rollback+notice-on-failure,
  the same spine as `patchTaskFields`). App-only — bucket comments are NEVER
  pushed to SharePoint (the EN-001 decision).
- Flexible buckets (landed 2026-06-18, EN-005): initiatives are no longer a
  static fixture — they persist in a dedicated `buckets` table (migration `007`,
  full Bucket shape in `data` jsonb, seeded idempotently from the BUCKETS fixture
  via `ensureBucketsSeeded`). `createBucket` / `patchBucket` (state) back
  `POST /api/buckets` + `PATCH /api/buckets/{id}` (shared wrapper + zod);
  attached repos are clamped to the persisted registry. The store exposes
  `allBuckets()` / `bucketById()` as the single source of truth (every consumer
  migrated off the fixture) plus optimistic create/edit
  (reconcile-on-success / rollback+notice-on-failure). Buckets ↔ Roadmap:
  outbound push is live (`pushBucketRoadmap`); inbound Gantt fields
  (name/health/started/target/progress) pull via `pullRoadmap`. ToDos Initiative
  lookup is two-way (`InitiativeLookupId` ↔ `task.bucket`) once the Roadmap item
  has an `sp_item_id`.
- Still deferred to a later increment: Graph change webhooks, notification
  DELIVERY (Teams/email — assignment/mention still in-app + audit only), Labels
  column on ToDos, and Project Documents (driveItem) sync — file entities are
  display fixtures until then.

## Dependencies

Python 3.12 + `requests` (`requirements.txt`). Microsoft Graph. Depended on
by: web (its store becomes a client of this module's API).

### Key Files

- `config/sharepoint-schema.json` — canonical tenant schema
- `scripts/provision-sharepoint.py` — idempotent provisioner + verifier
- `scripts/cutover-sharepoint-site.mjs` — clear staging SP item IDs + delta
  cursors when flipping `PLX_MC_SHAREPOINT_SITE_PATH` to production
- `docs/product/SHAREPOINT_INTEGRATION.md` — the governing spec

## Owner

Vince

## Criticality

Critical
