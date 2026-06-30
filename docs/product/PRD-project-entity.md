# PRD — Project entity above Bucket (P2)

- **Owner (accountable human):** Vince
- **Risk tier:** High (schema migration touching the buckets table)
- **Scope:** scoping bundle Axis A / Q6 (operator approved Option 1)

## Problem

Operators expect **Project → Bucket → Task → Sub-task**, but the model stops at
Bucket: buckets are the top initiative unit with no parent, so multiple buckets that
belong to one initiative (all "Portal go-live" work today) float independently.

## Decision (Option 1 — additive, reversible)

Add a nullable `Project` parent above Bucket rather than renaming Bucket (Option 2,
rejected as churny + breaks SharePoint mapping). Chosen because:

- Additive `projects` table + a **nullable** `buckets.project_id` FK — every existing
  bucket/task stays valid; no destructive change.
- Compliance `MC_BUCKET` auto-create stays valid (Project is purely organizing).
- Preserves the SharePoint Bucket↔Roadmap mapping (Project becomes a new list/column
  later — deferred, exactly like buckets today).

## What ships

- `db/migrations/011_projects.sql`: `projects` table (jsonb `data`, sync cols, like
  `007_buckets.sql`); nullable `buckets.project_id` FK `ON DELETE SET NULL`; index;
  idempotent seed of `PRJ-PORTAL-GOLIVE`; backfill `UPDATE buckets SET project_id =
  'PRJ-PORTAL-GOLIVE' WHERE project_id IS NULL`.
- `src/lib/mc-data`: `Project` type; `PROJECTS` fixture (single source of truth);
  optional `project` on `Bucket`; 8 seeded buckets attach `PRJ-PORTAL-GOLIVE`.
- `src/lib/sync`: `seedProjects`/`getProjects` accessors; `ensureProjectsSeeded`
  wired into the snapshot/load paths before buckets.
- Tests: no dangling project FK; every seeded bucket rolls up to a project.

## Verification

- `npm run typecheck` ✅; `mc-data` + `mc-buckets` suites ✅ (28); full suite ✅;
  migration gate ✅ (5); static SQL safety: additive, idempotent, **no
  DELETE FROM/DROP/TRUNCATE**, backfill UPDATE is WHERE-guarded.

## Rollback Plan

- **Pre-deploy:** revert the PR (removes the migration file + code; nothing applied).
- **Post-apply (staging):** run `db/rollback/011_projects_rollback.sql` —
  `ALTER TABLE buckets DROP COLUMN IF EXISTS project_id;` then
  `DROP TABLE IF EXISTS projects;` (safe: column/table added by this migration only;
  no other table references them). Buckets/tasks are untouched by the rollback.

## G-DB note (apply is gated)

The migration is **built and verified statically + in code**, but **not applied to
staging Postgres** in this run (no local DB reachable here; staging apply is the
operator/Hermes step). Apply with:
`source ~/.secrets-env.staging && bash scripts/assert-staging-context.sh && npm run migrate`.
