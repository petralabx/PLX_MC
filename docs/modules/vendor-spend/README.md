# Module: vendor-spend

## What

The **AI Spend** screen (sidebar: System of record → AI Spend) and its domain
module — a company-wide observatory for subscription and API costs across
PLX's AI and platform vendors. v1 covers ten vendors from a committed registry,
with automated spend pulls for **AWS** (Cost Explorer), **Anthropic** (Admin
cost report), and **Cursor** (Enterprise Admin `/teams/spend`), manual cost
snapshot entry for everything else, monthly budgets per vendor with
warn/critical thresholds, period filtering (MTD default; weekly, quarterly,
YTD), and in-app alerts. Agent actions are recommend-only placeholders;
email/Teams alert delivery is deferred (see
`artifacts/platform/2026-06-30-vendor-spend-alerts-followup/`).

## Why

Budgets and invoices scattered across ten vendor consoles hide runaway AI
spend until the invoice lands. One lens with honest adapter health (a vendor
with a missing admin key shows as degraded, never as $0 spend), proactive
warn/critical badges, and a manual-entry path for API-less vendors gives
engineering ops and finance the true cost posture at a glance.

## How

1. **Registry** — `config/vendor-costs-registry.json`
   (`plx-vendor-costs-registry/v1`) lists the ten vendors with adapter kind
   (`aws` | `anthropic` | `cursor` | `manual`), category, billing model, and
   console URL. Parsed/validated by `parseVendorRegistry` (Zod, never throws).
2. **Persistence** — Postgres tables from `db/migrations/015_vendor_spend.sql`:
   `vendor_cost_budgets` (one monthly budget + thresholds per vendor),
   `vendor_cost_snapshots` (cost observations over `[period_start,
   period_end)`; api-sourced rows are unique per vendor+day so re-pulls upsert
   instead of double-counting), `vendor_cost_refresh_log` (adapter pull
   outcomes). Without `PLX_MC_DATABASE_URL` the store falls back to
   process-local memory (same contract as the skills submissions store), so
   tests and the e2e dev server need no database.
3. **Adapters** — `src/lib/vendor-spend/adapters/` implement one contract
   (`configured()` presence check + `pull(range)` that never throws). Missing
   keys, auth failures, and bad payloads return visible degraded results.
   Credentials come only from the shared secrets accessor (`src/lib/secrets.ts`):
   `awsCostExplorerConfigured/awsCostExplorerCredentials`,
   `anthropicAdminConfigured/anthropicAdminApiKey` (`ANTHROPIC_ADMIN_API_KEY`,
   alias `ANTHROPIC_ADMIN_KEY`), `cursorAdminConfigured/cursorAdminApiKey`
   (`CURSOR_ADMIN_API_KEY`, alias `CURSOR_ADMIN_KEY`).
4. **Loader** — `buildVendorSpendIndex(period)` merges registry + snapshots +
   budgets + refresh audit into overview rows (scariest-first: over → critical
   → warn → degraded), and `buildVendorSpendDetail(vendorId, period)` adds the
   snapshot + refresh history.
5. **Refresh** — `refreshAutomatedVendors()` pulls each automated adapter,
   upserts api snapshots, and logs the outcome; one vendor failing never kills
   the batch. Trigger paths: `POST /api/vendor-spend/refresh` (operator
   button), `GET /api/cron/vendor-spend-refresh` (CRON_SECRET-gated, mirrors
   the sync cron; MTD by default, `?period=` for any spend period), and
   `node scripts/seed-vendor-spend.mjs` (bootstrap/backfill: calls the cron
   route with `?period=ytd` and the `CRON_SECRET` bearer, since the session
   POST needs a signed-in admin — TASK-3011).
6. **API** — all routes go through the shared `route()` wrapper with the
   standard envelope; mutations validate with Zod via `parseBody`:
   `GET /api/vendor-spend?period=`, `GET /api/vendor-spend/[vendorId]?period=`,
   `GET|PATCH /api/vendor-spend/budgets`, `POST /api/vendor-spend/snapshots`
   (manual entry), `POST /api/vendor-spend/refresh`. The budget PATCH and the
   snapshot POST need the `vendor_spend.write` capability (admin and owner
   roles) on the signed-in Entra session through `requireSessionActor`, and
   record that session's email as `updated_by` / `entered_by`; the request
   body never names the author (TASK-2928). The refresh POST needs the same
   capability on the session (TASK-3011).
7. **UI** — `AiSpendView` (`src/components/mc/ai-spend.tsx` +
   `src/components/mc/vendor-spend/`), styles in
   `src/styles/mc-vendor-spend.css` (`--p-*` tokens only). Overview table with
   period filter and alert banner, vendor detail with snapshot/refresh history,
   budget editor, manual snapshot form, recommend-only agent panel stub.

```
registry.json ──┐
snapshots (pg) ─┼─ loader ─→ /api/vendor-spend[*] ─→ AiSpendView
budgets (pg) ───┘      ↑
adapters (aws|anthropic|cursor) ─ refresh ─ upsert api snapshots + audit log
```

### Budget proration formula

Budgets are **monthly caps**. For a period range the compared budget is: for
each calendar month the range touches, add the full monthly budget when the
range covers the month from its 1st (MTD, quarterly, YTD — a partially elapsed
current month still counts as one full month of cap), otherwise prorate by
days-in-range/days-in-month (weekly windows). Utilization = period spend ÷
that prorated budget; warn ≥ `warn_pct` (default 0.80), critical ≥
`critical_pct` (default 0.95), over > 1.0.

### Honesty contract

- A missing admin key is a **degraded** row with the reason and required
  secret named — never $0, never fabricated spend.
- AWS open days carry Cost Explorer's `Estimated` flag; Cursor cycle spend is
  labeled usage-reported, not invoice-final.
- Manual snapshots record who entered them (the signed-in session, never a
  request field) and when.

## Dependencies

Depends on: **web** (MC shell, shared `api()`/`route()` wrappers, middleware
auth), **permissions** (`vendor_spend.write` via `requireSessionActor`),
**design-system** (`--p-*` tokens behind `.brand-plx`), `src/lib/db`
(Postgres pool), `src/lib/secrets.ts` (the one secrets accessor).
`@aws-sdk/client-cost-explorer` is dynamically imported by the AWS adapter
only. Depended on by: nothing yet.

### Key Files

- `src/lib/vendor-spend/` — domain module (types, registry, period math, alerts, store, adapters, loader, refresh, barrel `index.ts`)
- `config/vendor-costs-registry.json` — ten-vendor registry (no secrets)
- `db/migrations/015_vendor_spend.sql` (+ `db/rollback/015_vendor_spend_rollback.sql`)
- `src/app/api/vendor-spend/` — read + mutating routes; `src/app/api/cron/vendor-spend-refresh/` — scheduled refresh
- `src/components/mc/ai-spend.tsx`, `src/components/mc/vendor-spend/` — screen
- `src/styles/mc-vendor-spend.css` — screen styles (`--p-*` tokens only)
- `scripts/seed-vendor-spend.mjs` — API bootstrap/backfill

## Owner

Vince

## Criticality

Medium
