# AI Spend (vendor-spend) — Build Evidence

Execution evidence for the vendor-spend plan
(`artifacts/platform/2026-06-30-vendor-spend-plan/SPEC.md`), built 2026-07-07
on branch `cursor/ai-spend-observatory-0385`.

## What shipped

- `config/vendor-costs-registry.json` — ten vendors, honest adapter status
  (automated: aws, anthropic, cursor; manual: the rest)
- `db/migrations/014_vendor_spend.sql` — `vendor_cost_budgets`,
  `vendor_cost_snapshots` (unique api row per vendor/day), `vendor_cost_refresh_log`
  (+ `db/rollback/014_vendor_spend_rollback.sql`); prefix moved from the drafted
  `011` (taken by `011_projects.sql`) to `014`
- `src/lib/vendor-spend/` — registry parser, period math (monthly budget-cap
  proration), alert evaluator (warn 80% / critical 95% / over), store with
  memory fallback, three adapters (never throw; degrade visibly), loader, refresh
- `src/lib/secrets.ts` — `awsCostExplorerConfigured/Credentials`,
  `anthropicAdminConfigured/ApiKey`, `cursorAdminConfigured/ApiKey`
- `/api/vendor-spend` (index, `[vendorId]`, budgets GET|PATCH, snapshots POST,
  refresh POST) + `/api/cron/vendor-spend-refresh` (CRON_SECRET, vercel.json 6-hourly)
- `src/components/mc/vendor-spend/` + `src/styles/mc-vendor-spend.css` — full
  screen replacing the stub; sidebar warn/critical badge
- `scripts/seed-vendor-spend.mjs` — YTD backfill via the refresh endpoint
- `config/integrations.yaml` vendor-spend declaration;
  `docs/modules/vendor-spend/README.md` contract
- Follow-up: `artifacts/platform/2026-06-30-vendor-spend-alerts-followup/`

## Verification (exit-0 evidence)

| Gate | Result |
|---|---|
| `npx vitest run tests/vendor-spend-*.test.ts` | 6 files, 91 tests passed |
| `npm run test` (full) | 59 files, 786 tests passed |
| `npm run typecheck` / `npm run lint` | clean (one pre-existing warning in `tests/mcp-cursor-routes.test.ts`, untouched) |
| `npm run build` | success; all `/api/vendor-spend*` routes emitted |
| `npx playwright test` (full, via preflight) | 162 passed, 1 skipped |
| `./scripts/preflight.sh --mode pre-push` | **exit 0** |

## Honest limitations at ship time

- No AWS credentials, `ANTHROPIC_ADMIN_API_KEY`, or `CURSOR_ADMIN_API_KEY`
  were present in the build environment, so **no live vendor pull was
  executed**; adapters were verified against mocked upstream responses and
  their key-missing/unauthorized degrade paths. Once the keys exist in
  `prod/ec2-secrets` (and reach the app env), the same code paths go live —
  the UI shows API · DEGRADED with the exact missing secret named until then.
- Migration `014` was not applied to staging RDS from this environment
  (`PLX_MC_DATABASE_URL` absent); run `npm run migrate` on deploy.
- Session artifact queued in this bundle (`session-artifact.json`) because
  `VMC_API_KEY` was unavailable — replay per the session-brain skill.

## Contents

| File | What |
|---|---|
| `REPORT.md` | This evidence report |
| `session-artifact.json` | SessionArtifact v1 (offline queue — VMC unreachable from the build VM) |
