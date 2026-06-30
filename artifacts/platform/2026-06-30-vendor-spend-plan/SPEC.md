---
project: vendor-spend
created: 2026-06-30T00:00:00Z
status: draft
approved_by:
approved_at:
model_plan:
  planner:
  builder:
  mechanical:
  critic:
budget:
  max_parallel_phases: 3
  max_attempts_per_phase: 3
  time_budget_min: 0
---

# Vendor Spend Observatory (PLX MC)

## Mission

Build a **Vendor spend** module under Mission Control's **System of record** sidebar
that gives engineering ops and finance a single company-wide lens on subscription and
API costs across PLX's AI and platform vendors. v1 delivers automated spend pulls for
**AWS, Anthropic, and Cursor** (where credentials permit), manual entry for vendors
without reliable APIs, **monthly budgets per vendor**, period filtering (MTD default;
weekly, quarterly, YTD), and **in-app proactive warnings** when spend crosses
warn/critical thresholds. Agent recommendations stay read-only in v1; email/Teams
alerting is explicitly deferred to a follow-up project artifact.

## Success Criteria

- [ ] New **Vendor spend** screen appears in the MC sidebar under **System of record** and renders with `--p-*` tokens only.
- [ ] Registry lists all ten vendors (Resend, Vercel, DocuSign, AWS, GoDaddy, Google, Adobe, Claude/Anthropic, Cursor, Azure) with honest adapter status.
- [ ] **AWS** adapter pulls real spend via Cost Explorer; verified against a live API call in acceptance evidence.
- [ ] **Anthropic** adapter pulls org cost when `ANTHROPIC_ADMIN_API_KEY` is configured; degrades visibly when only a standard API key is present.
- [ ] **Cursor** adapter pulls team spend when `CURSOR_ADMIN_API_KEY` is configured (Enterprise Admin API); degrades visibly + supports manual entry fallback.
- [ ] Manual cost snapshot entry works for any vendor (required path for GoDaddy, Adobe, DocuSign in v1).
- [ ] Monthly budget per vendor is editable via API; warn (default 80%) and critical (default 95%) thresholds drive in-app badge + row state.
- [ ] Period filter supports **MTD (default), weekly, quarterly, YTD** and recomputes displayed spend + budget utilization.
- [ ] In-app notices surface when any vendor is in warn/critical/over-budget (no email/Teams in v1).
- [ ] Module contract README at `docs/modules/vendor-spend/README.md`; integration declared in `config/integrations.yaml`.
- [ ] Follow-up artifact bundle exists at `artifacts/platform/2026-06-30-vendor-spend-alerts-followup/index.md` scoping email/Teams alerting for v2.
- [ ] `./scripts/preflight.sh --mode pre-push` exits 0 on the integration branch.

## Scope

- In:
  - Domain module `src/lib/vendor-spend/` (registry, adapters, loader, budgets, alerts, period math)
  - Postgres persistence (`vendor_cost_budgets`, `vendor_cost_snapshots`, `vendor_cost_refresh_log`)
  - Read APIs: vendor index, vendor detail, budget list
  - Mutating APIs: set budget (Zod-validated), post manual snapshot (Zod-validated)
  - UI: overview table, vendor detail drawer/panel, budget editor, period filter, alert banner, recommend-only placeholder panel
  - Scheduled refresh hook (cron-compatible route or sweep extension) for automated vendors
  - Seed/bootstrap command that attempts API backfill for AWS / Anthropic / Cursor
  - Tests for period math, alert thresholds, adapter degrade behavior, API envelope
  - Module contract + integrations.yaml entry
- Non-goals (v1):
  - SharePoint as canonical cost SoR (Postgres cache only in v1)
  - Per-initiative / per-project cost allocation (v2)
  - Email, Teams, or Resend alert delivery (follow-up artifact only)
  - Autonomous agent actions (config changes, auto-throttle, auto task creation)
  - Invoice PDF ingestion or finance-grade reconciliation workflows
  - GoDaddy / Adobe / DocuSign automated adapters
  - Full automation for Resend, Vercel, Google, Azure (registry + manual entry only in v1)

## Stage 0 — Intent calibration (locked)

| Question | Decision |
|---|---|
| Primary audience | **Both** engineering ops and finance |
| v1 automated vendors | **Cursor, Anthropic, AWS** |
| Budget model | Monthly budget per vendor; UI filters **MTD (default), weekly, quarterly, YTD** |
| Manual entry | **Yes** — required for GoDaddy, Adobe, DocuSign; acceptable fallback for Cursor |
| Alerts v1 | **In-app only**; email/Teams → follow-up artifact |
| Agent actions v1 | **Recommend-only placeholder**; MC tasks + config changes → future |
| Scope v1 | **Company-wide**; project granularity → v2 |
| Seed data | **API bootstrap where creds exist** (see Risks); no spreadsheet assumed |

## Seed data feasibility (honest preflight)

| Vendor | Can we seed from current access today? | Blocker / note |
|---|---|---|
| **AWS** | **Yes** | Cost Explorer verified live (~$1,819 MTD Jun 2026 via instance IAM user). |
| **Anthropic** | **Partial** | Standard `ANTHROPIC_API_KEY` is set; **Admin API key** (`ANTHROPIC_ADMIN_API_KEY`, `sk-ant-admin01-…`) is **not** set. Cost API requires admin key. Module must degrade + allow manual seed until admin key is added to secrets. |
| **Cursor** | **No (yet)** | `CURSOR_ADMIN_API_KEY` is **not** set. Cursor Admin API (`/teams/spend`, `/teams/filtered-usage-events`) requires Enterprise team + admin-scoped key. Manual entry + degraded row until key is provisioned. |
| Other vendors | Manual only in v1 | Resend/Vercel/Google/Azure listed in registry; no automated adapter in v1. |

**Operator action before/during P2:** add `ANTHROPIC_ADMIN_API_KEY` and `CURSOR_ADMIN_API_KEY` to AWS Secrets Manager (`prod/ec2-secrets`) if automated seed for those vendors is required on day one.

## Phases

### P1 — Domain foundation + persistence
- deliverables: `config/vendor-costs-registry.json`; `db/migrations/011_vendor_spend.sql`; `src/lib/vendor-spend/` types, registry parser, period utilities, budget store, alert evaluator, barrel `index.ts`; `docs/modules/vendor-spend/README.md`; secrets presence helpers in `src/lib/secrets.ts` (configured checks only — no secret values logged)
- depends_on: []
- owns: ["config/vendor-costs-registry.json", "db/migrations/011_vendor_spend.sql", "src/lib/vendor-spend/**", "docs/modules/vendor-spend/**", "src/lib/secrets.ts", "docs/modules/README.md"]
- forbidden: ["src/components/**", "src/app/api/vendor-spend/**", "e2e/**"]
- acceptance: `./scripts/preflight.sh --mode pre-commit && npx vitest run tests/vendor-spend-period.test.ts tests/vendor-spend-alerts.test.ts`
- role: builder
- competitive: false

### P2 — Vendor adapters + loader + seed bootstrap
- deliverables: Adapter interface + implementations for `aws` (Cost Explorer), `anthropic` (Admin cost_report), `cursor` (Admin `/teams/spend` + filtered events sum), `manual` (DB snapshots); loader merging registry + DB + adapter reads; `scripts/seed-vendor-spend.mjs` bootstrap; refresh audit log writes; unit tests for degrade paths
- depends_on: [P1]
- owns: ["src/lib/vendor-spend/adapters/**", "src/lib/vendor-spend/loader.ts", "scripts/seed-vendor-spend.mjs", "tests/vendor-spend-adapters.test.ts", "tests/vendor-spend-loader.test.ts"]
- forbidden: ["src/components/**", "src/app/api/**"]
- acceptance: `npx vitest run tests/vendor-spend-adapters.test.ts tests/vendor-spend-loader.test.ts && node scripts/seed-vendor-spend.mjs --dry-run`
- role: builder
- competitive: false

### P3 — API routes + cron refresh
- deliverables: `GET /api/vendor-spend`, `GET /api/vendor-spend/[vendorId]`, `GET|PATCH /api/vendor-spend/budgets`, `POST /api/vendor-spend/snapshots`; optional `GET /api/cron/vendor-spend-refresh` (CRON_SECRET-gated, mirrors sync cron pattern); Zod schemas; route tests
- depends_on: [P2]
- owns: ["src/app/api/vendor-spend/**", "src/app/api/cron/vendor-spend-refresh/**", "tests/vendor-spend-routes.test.ts"]
- forbidden: ["src/components/mc/vendor-spend/**"]
- acceptance: `npx vitest run tests/vendor-spend-routes.test.ts`
- role: builder
- competitive: false

### P4 — UI + navigation wiring
- deliverables: `src/components/mc/vendor-spend/` screen (overview, detail, budget editor, period filter, in-app alert banner, recommend-only stub); `src/styles/mc-vendor-spend.css`; wire `route.ts`, `screens.tsx`, `chrome.tsx`, `globals.css`; sidebar badge when warn/critical vendors exist
- depends_on: [P3]
- owns: ["src/components/mc/vendor-spend/**", "src/styles/mc-vendor-spend.css", "src/components/mc/route.ts", "src/components/mc/screens.tsx", "src/components/mc/chrome.tsx", "src/app/globals.css", "tests/vendor-spend-ui.test.ts"]
- forbidden: ["src/lib/sync/**", "db/migrations/**"]
- acceptance: `npm run typecheck && npx vitest run tests/vendor-spend-ui.test.ts`
- role: builder
- competitive: false

### P5 — Integration, declarations, follow-up artifact
- deliverables: `config/integrations.yaml` vendor-spend entry; e2e smoke spec (optional, screen loads); follow-up bundle `artifacts/platform/2026-06-30-vendor-spend-alerts-followup/` with `index.md` + alert-channel spec; full pre-push gate
- depends_on: [P4]
- owns: ["config/integrations.yaml", "artifacts/platform/2026-06-30-vendor-spend-alerts-followup/**", "e2e/vendor-spend.spec.ts", "tests/**"]
- forbidden: []
- acceptance: `./scripts/preflight.sh --mode pre-push`
- role: mechanical
- competitive: false

## Risks & Rollback

- **Anthropic/Cursor admin keys missing at deploy** → adapters return `degraded` rows; manual snapshots + seed script document required secrets; no fabricated spend.
- **Cursor Enterprise contract fields invisible to API** → UI labels spend as "usage-reported" not "invoice-final"; finance disclaimer in module README.
- **AWS Cost Explorer lag/estimates** → surface `Estimated` flag from API; do not treat as closed books.
- **Period filter vs monthly budget mismatch** → budget comparison uses prorated monthly budget for weekly/quarterly/YTD views (document formula in module README).
- **Rollback** → revert integration PR; migration `011` is additive (DROP TABLE only in emergency runbook); disable cron route by unsetting `CRON_SECRET` or removing cron entry; remove sidebar item via route revert.

## Worktree Plan

- base branch: proj/vendor-spend
- phase branches: proj/vendor-spend/phase-1-foundation, proj/vendor-spend/phase-2-adapters, proj/vendor-spend/phase-3-api, proj/vendor-spend/phase-4-ui, proj/vendor-spend/phase-5-integration
- integration branch: proj/vendor-spend/integration
- delivery: one integration PR for the whole project
