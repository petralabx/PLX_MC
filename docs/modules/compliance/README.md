# Module: compliance

## What

The enforcement brain for EN-007 — PLX MC as the system of record. It decides
whether a pull request against a tracked repo is compliant: what **risk tier** a
change is, what **bundle** that tier requires (rollback plan, PRD, evidence), and
the final **pass/block verdict** for an agent vs operator PR. It is pure logic —
no I/O, no GitHub, no DB. The GitHub status check, checkout/dispatch ledger,
`mc_events` log, and git→MC ingestion wrap this core in later phases.

## Why

Every change to a tracked repo must resolve to governed MC work; agents are gated
on a complete bundle, operators are recorded but ungated (EN-007 decisions 2, 5,
9, 12). Keeping the verdict logic pure makes the gate deterministic, fast on the
PR hot path, and unit-testable without a live Postgres or GitHub App — so the
truth table is proven before any plumbing exists.

## How

- `classifyRiskTier(changedPaths, labels)` — `low | standard | high`. Explicit
  labels (`risk:high`/`risk:low`) win, then high-risk paths (migrations, auth/
  permissions, infra, `.github/workflows`, deploy), then docs/test-only = low,
  else standard. Mirrors the governance contract's Database Safety / External
  Integrations risk surface.
- `bundleRequirementsFor(tier)` — the floor per tier: high = full evidence +
  rollback + bucket PRD; standard = complete checklist + rollback note; low =
  minimal summary.
- `evidenceCompleteForTier(evidence, tier)` — reuses EN-003 `evidenceComplete`;
  adds the rollback-note and (for high) change-appropriate-proof checks
  (screenshots **or** a test run).
- `verifyCompliance({ task, actor, tier, bucketHasPrd })` — the verdict. Operator
  PRs pass (recorded, ungated); an agent PR with no checked-out task is blocked;
  agent PRs must carry a human accountable owner (EN-003) + the tier bundle. The
  soft-vs-hard (warn vs block) decision belongs to the caller.

Landed in P1b: the checkout/complete/verify handshake (`service.ts` + `repo.ts` +
`/api/compliance/*`), the dispatch ledger + compliance-check ledger, and the
first-class append-only `mc_events` log with keyset export (`GET /api/events`) —
schema in `db/migrations/005_compliance.sql`. The service resolves actor + task
from the checkout credential (never git metadata) and records every verdict as an
event. Server logic is proven hermetically (mocked DB seam,
`tests/compliance-server.test.ts`); applying the migration + live integration on
staging is the deploy step.

Deferred to later phases (see `docs/product/SYSTEM_OF_RECORD.md`): the GitHub App +
branch protection + git→MC ingestion + reconciliation queue (P3), Cursor/Claude
auto-checkout hooks (P2), and the embedding/index feed over the event log (P5).

## Dependencies

`@/lib/mc-data` (the `Task`/`Evidence` types, `evidenceComplete`,
`hasHumanAccountableOwner` from EN-003 `policy.ts`). No external services, no DB
in the pure core. Depended on by: the (planned) `/api/compliance/*` routes and the
GitHub status-check workflow.

### Key Files

- `src/lib/compliance/risk.ts` — risk-tier classifier + per-tier bundle floor
- `src/lib/compliance/verify.ts` — `evidenceCompleteForTier` + `verifyCompliance`
- `src/lib/compliance/types.ts` — `RiskTier`, `ActorKind`, `VerifyInput/Result`
- `src/lib/compliance/index.ts` — pure-core barrel (import through here)
- `src/lib/compliance/service.ts` — server service: checkout / complete / verifyPr / listEvents (subpath import, like `mc-data/store`)
- `src/lib/compliance/repo.ts` — Postgres accessors (dispatch ledger, mc_events, check ledger)
- `src/lib/compliance/webhook.ts` — GitHub HMAC verify + PR-event parse (git→MC ingestion)
- `src/app/api/compliance/{checkout,complete,verify,webhook}/route.ts`, `src/app/api/events/route.ts` — the API surface
- `.github/workflows/compliance-gate.yml` — the required PR status check (default-off; soft→hard)
- `scripts/compliance-checkout.mjs` + `.cursor/compliance-hooks.json` — the capture hook (disabled by default)
- `scripts/compliance-ci-check.sh` — workflow/hook validator (P3 acceptance)
- `db/migrations/005_compliance.sql` — `mc_events`, `mc_dispatch`, `mc_compliance_check`
- `db/migrations/006_compliance_reconcile.sql` — `mc_reconcile_queue` (fail-closed replay)
- `db/migrations/007_compliance_event_dedup.sql` — event idempotency (`dedup_key`) + the `(kind, seq)` export index
- `src/app/api/compliance/reconcile/route.ts` — reconciliation sweep entrypoint
- `docs/runbooks/compliance-gate-rollout.md` — operator activation + External Integrations declaration
- `tests/compliance.test.ts` — risk truth table + verifier verdicts (pure)
- `tests/compliance-server.test.ts` — service orchestration (mocked DB seam)
- `tests/compliance-ingest.test.ts` — webhook signature/parse + ingestion (mocked seam)
- `docs/product/SYSTEM_OF_RECORD.md` — the governing spec (EN-007)

## Owner

Vince

## Criticality

Critical
