# Module: compliance

## What

The enforcement brain for EN-007 — PLX MC as the system of record. It decides
whether a pull request against a tracked repo is compliant: what **risk tier** a
change is, what **bundle** that tier requires (rollback plan, PRD, evidence), and
the final **pass/block verdict** for an agent vs operator PR. It is pure logic —
no I/O, no GitHub, no DB. The GitHub status check, checkout/dispatch ledger,
`mc_events` log, git→MC ingestion, and metadata-only routing propose wrap this
core.

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
- `verifyPr` (service) wraps the pure verdict for a PR: it reads **every**
  `MC-Checkout` stamp, verifies each checked-out task, and passes only if **all**
  pass — one incomplete task blocks the PR (a PR may complete N related tasks).
  Each task's verdict is recorded as its own check + `gate.passed/blocked` event;
  a single stamp is the back-compat subset. Bucket PRD is resolved from the
  persisted `buckets` table (`bucket-prd.ts`) — high-risk agent PRs block when
  the task's bucket has no PRD link.
- `verify` route auth is dual-path: GitHub Actions OIDC is the preferred
  first-class auth for `POST /api/compliance/verify`, with
  `COMPLIANCE_CI_TOKEN` bearer as fallback/break-glass during dogfood. The route
  stays fail-closed (503 when neither path is configured; 401 on bad/missing
  bearer) while remaining carved out from the UI session middleware.
- `POST /api/routing/propose` (P6) is the **authoritative** metadata-only proposal
  path for PR opened/reopened/synchronize/closed. Auth is GitHub Actions OIDC
  only. Verified claims bind to submitted full/numeric repository identity,
  `pull_request` event, PR ref/number, approved workflow ref, and merge/head SHA;
  fork/cross-repository/replay mismatches are rejected. The durable
  `sp_github_actions_routing` principal must pass `authorize(routing.propose)`.
  PR body is processed in memory for markers/hash only — never persisted raw.
  Operator PRs land in non-blocking `action_required` proposal state with an
  authenticated MC deep link. Agent hard-gate remains unchanged.
- `projectPullRequest` (projection) — after `mc_events` are appended, mutates sync
  tasks for **checked-out** work: open/sync → `progress`, merge → `merged` +
  `prs[]` + `task.promoted`. Every mutation requires
  `authorize(...)` for durable `sp_compliance_projection` (`task.progress` /
  `task.link`). **Sparse operator Task creation is retired** — unrouted operator
  PRs do not create Tasks. Kill switch: `COMPLIANCE_PROJECTION_ENABLED=0`.
  Proposal kill switch: `PLX_MC_ROUTING_PROPOSALS_ENABLED=0` (never restores
  silent sparse creation). Optional HMAC compatibility:
  `PLX_MC_ROUTING_HMAC_PROPOSE=1` may call the same propose service from the
  webhook (not a phase-one prerequisite).

Landed in P1b: the checkout/complete/verify handshake (`service.ts` + `repo.ts` +
`/api/compliance/*`), the dispatch ledger + compliance-check ledger, and the
first-class append-only `mc_events` log with keyset export (`GET /api/events`) —
schema in `db/migrations/005_compliance.sql`. The service resolves actor + task
from the checkout credential (never git metadata) and records every verdict as an
event. Server logic is proven hermetically (mocked DB seam,
`tests/compliance-server.test.ts`); applying the migration + live integration on
staging is the deploy step.

Landed after P1b: Cursor/Claude auto-checkout hooks (P2), GitHub App +
branch protection + git→MC ingestion + reconciliation queue (P3), and
OIDC-first verify auth with bearer fallback for the compliance gate dogfood path.
P6 adds OIDC propose + sparse-task retirement. Deferred: fleet rollout and the
embedding/index feed over the event log.

## Dependencies

`@/lib/mc-data` (the `Task`/`Evidence` types, `evidenceComplete`,
`hasHumanAccountableOwner` from EN-003 `policy.ts`). The pure core has no
external services and no DB. The server wrapper uses Postgres repositories,
GitHub webhook HMAC, GitHub Actions OIDC verification (`jose` JWKS), the
permissions kernel (`authorize`), and the routing control-plane repo for
proposals/revisions. Depended on by: the `/api/compliance/*` routes,
`/api/routing/propose`, and the GitHub status-check / routing metadata workflows.

### Runtime approval gates (TASK-629/630)

`src/lib/compliance/approvals.ts` — the A2A "input-required" primitive. An
agent raises a gate mid-run (`POST /api/cursor/request-approval`,
`approval.request`); the task's stage freezes (`mc-data/policy`) until a human
with `approval.decide` — never the requester (separation of duties, 403) —
decides it via `POST /api/approvals/decide`. Transitions append
`approval.requested` / `approval.decided` to `mc_events`; the Approvals inbox
(`/?screen=approvals`) lists pending gates from `GET /api/approvals`.
Gates live in the task jsonb (DB-only; never mirrored to SharePoint).

### Key Files

- `src/lib/compliance/risk.ts` — risk-tier classifier + per-tier bundle floor
- `src/lib/compliance/verify.ts` — `evidenceCompleteForTier` + `verifyCompliance`
- `src/lib/compliance/types.ts` — `RiskTier`, `ActorKind`, `VerifyInput/Result`
- `src/lib/compliance/index.ts` — pure-core barrel (import through here)
- `src/lib/compliance/service.ts` — server service: checkout / complete / verifyPr /
  ingest / `proposeRoutingFromPr` / listEvents
- `src/lib/compliance/repo.ts` — Postgres accessors (dispatch ledger, mc_events, check ledger)
- `src/lib/compliance/github-oidc.ts` — GitHub Actions OIDC verify + propose claim binding
- `src/lib/compliance/projection.ts` — PR lifecycle → sync task projection (authorize-gated)
- `src/lib/compliance/bucket-prd.ts` — bucket PRD resolution for verifyPr
- `src/lib/compliance/webhook.ts` — HMAC verify + PR-event parse (in-memory body)
- `src/lib/compliance/go-live-announcer.ts` — one-line Teams Workflow posts on `checkout` / `pr.opened` / `task.completed` (TASK-1454; kill switches default off)
- `src/app/api/compliance/{checkout,complete,verify,webhook}/route.ts`, `src/app/api/events/route.ts`
- `src/app/api/routing/propose/route.ts` — OIDC propose (middleware carve-out exact)
- `src/middleware.ts` — exact self-auth carve-outs including `api/routing/propose`
- `.github/workflows/compliance-gate.yml` — the required PR status check (default-off; soft→hard)
- `scripts/compliance-checkout.mjs` + `.cursor/compliance-hooks.json` — the capture hook
- `db/migrations/005_compliance.sql` — `mc_events`, `mc_dispatch`, `mc_compliance_check`
- `docs/product/SYSTEM_OF_RECORD.md` — the governing spec (EN-007)

## Owner

Vince

## Criticality

Critical
