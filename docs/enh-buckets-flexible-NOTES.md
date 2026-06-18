# EN-005 — Flexible buckets (create/edit initiatives) · PR notes

Branch: `feat/enh-buckets-flexible` (off `main` after PR-A/PR-B merged) ·
slug: `enh-buckets-flexible` · 2026-06-18

## Why

Buckets (initiatives) were a single static `BUCKETS` fixture
(`src/lib/mc-data/data.ts`) consumed directly by ~12 files — there was **no way
to create one**. This was prototype heritage, not a product decision: the build
gave full CRUD + sync to tasks and risks, but buckets stayed display-only
fixtures. EN-005 makes buckets first-class and dynamic (create + edit, persisted,
reactive everywhere).

## What changed

### P1 — persistence + store layer (`30f3566`)
- **Migration `007_buckets.sql`** — a `buckets` table (full Bucket shape in a
  `data` jsonb; `sync_state` / `sp_item_id` carried for the future Roadmap
  mirror). Additive; idempotently seeded from the fixture.
- **`src/lib/sync/repo.ts`** — `getBuckets` / `seedBuckets` (ON CONFLICT DO
  NOTHING) / `upsertBucket` (parameterized).
- **`src/lib/sync/engine.ts`** — `ensureBucketsSeeded()` seeds the 8 fixture
  initiatives.
- **`src/lib/sync/state.ts`** — `snapshot()` returns `buckets`; `createBucket`
  (generates a `BKT-<slug>` id, defaults, **repos clamped to the persisted
  registry**) + `patchBucket`.
- **API** — `POST /api/buckets` + `PATCH /api/buckets/[id]` (shared
  `route()`/`parseBody` + zod + `{data}|{error}`).
- **`src/lib/mc-data/store.ts`** — bucket state seeded from the fixture +
  hydrated from the snapshot; `allBuckets()` / `bucketById()` getters; optimistic
  `addBucket` / `updateBucket`.

### P2 — dynamic consumers + New Initiative UI (`a734244`)
- Migrated **every** `BUCKETS` / `BUCKET_IDX` consumer to the reactive
  `allBuckets()` / `bucketById()` getters: `chrome` (sidebar), `command-palette`,
  `work-views` + `work-views.helpers`, `task-detail`, `bucket-detail`,
  `new-task-modal`, `files-view`, `traceability`, `meeting-intake` +
  `meeting-intake/store`, `insights` view. So a created initiative shows up
  everywhere and survives reload.
- **Pure/tested helpers** (`insights.ts` `buildInsights`, board helpers
  `columnsFor`/`resolveColumnDrop`/`bucketsForTimeline`/`timelineSegmentClass`)
  take an **injected `buckets` param (default = fixture)** so they stay
  deterministic (no store reads); the view components pass `allBuckets()`.
- **New Initiative modal** (`new-initiative-modal.tsx`) mounted in `shell.tsx`,
  triggered from a sidebar "+ New initiative" affordance and the (formerly dead)
  command-palette "New initiative" command.

### Audit fixes (`915bb18`) — independent auditor REJECT → ACCEPT
- `addBucket` now mirrors through a reconcile/rollback seam (like
  `updateBucket`): a failed `POST /api/buckets` **rolls back** the optimistic
  initiative + surfaces a notice — never a silent drop on reload.
- `bucket-detail` reads repo names from the live registry
  (`allRepos()[id]?.name ?? id`), not the `REPOS` fixture — an attached approved
  repo no longer crashes the view.
- command palette includes the store `version` in its groups memo (live commands).
- `patchBucket` seeds the repo registry before the allow-list check.

## SharePoint / DB approach

Buckets are **app-persistent** (the `plx_mc` DB), exactly as the repo registry
shipped DB-first before its SharePoint list. The buckets ↔ **Roadmap** list
two-way mirror is **deferred** — the sync engine does not mirror the Roadmap
list yet (a known deferred increment). `sync_state` / `sp_item_id` columns are
carried so that increment is additive.

## Stayed deferred (honest)

- **buckets ↔ Roadmap SharePoint mirror** + the **Initiative lookup** on ToDos.
- **Bucket DELETE / archive** (edit only for v1).
- **Known LOW (advisory, fail-safe):** the New Initiative modal navigates to the
  optimistic id; on the rare server-id divergence (only if the client/server
  bucket sets diverge — both use the same slug+suffix algorithm) the open detail
  view falls back to the first fixture bucket (no crash).

## Verification

- `npm run typecheck` → 0
- `npm run test` → **363 passed** (29 files; +15 over the 348 baseline:
  `mc-buckets`, `sync-buckets`, dynamic-column helper test)
- `npm run build` → 0
- `./scripts/preflight.sh --mode pre-push` → 0 (35 E2E passed incl. the
  `new-initiative` create-flow spec; 1 pre-existing "requires live Postgres" skip)
- Independent read-only auditor (`gpt-5.5-extra-high`): **ACCEPT** after fixes.
- Scope-locked per phase (`scripts/scope-check.sh`); evidence bundle in
  `.orchestrator/enh-buckets-flexible/`.
