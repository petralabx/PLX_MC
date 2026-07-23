# Module: routing

## What

Deterministic Mission Control **control-plane** for associating commits and pull
requests with existing Tasks/Buckets (and creating a Task only after explicit
authorized confirmation). Owns typed evidence/trust/candidate/session/proposal/
revision/decision/link contracts, PR-body marker parsing, Postgres persistence,
the shadow scoring engine, confirmed mutations, and **rollout / retention /
maintenance** (P10).

This module does **not** call LLMs for control decisions or write SharePoint
business entities directly. Authorization stays in `permissions`. Fuzzy
auto-link remains disabled for every pilot.

## Why

Sparse operator-PR Task creation is retired. When an agent does not know the
Task, it must stop before editing. Suggestion cohorts may call
`mc_suggest_work`; shadow/unknown/unavailable suggestion paths require the
accountable human to search MC and create/assign work in the registry default
Bucket. A shared typed persistence and marker layer lets MCP, metadata
workflows, webhooks, and the Routing Inbox share one replay-safe proposal
identity (`{repoId, changeId}`) and `rtx_*` sessions without persisting raw PR
bodies. Human PRs remain normal and non-blocking.

## How

- **Markers** (`markers.ts`): parse `MC-Task: TASK-*`, `MC-Routing: rtx_*`, and
  migration-era `MC-Checkout: dsp_*` in memory. Deduplicate order-preserving.
  Reject oversized bodies. Classify authority: task = declaration, routing =
  correlation, checkout = credential *reference* (parser does not validate).
  Persist only `bodyContentHash` + extracted markers — never the raw body.
- **Types** (`types.ts`): `matchScore` is separate from `authorizationTrust`.
  Project is nullable and derived from Bucket. Explicit failure/degraded states.
- **Persistence** (`repo.ts` + migrations `017`/`018`): sessions, proposals,
  head-SHA revisions, candidates, decisions, append-only `related|delivery`
  work links, creation-intent idempotency `(proposal_id, creation_intent_hash)`,
  and global `mc_task_id_seq` reconciled above existing `TASK-*` IDs (never
  moved backwards). Write APIs accept `TxQuery` so P8 can atomically
  `FOR UPDATE` lock, allocate, insert Task/link/decision, and resolve.
- **Harness** (`scripts/test-routing-postgres.mjs`): disposable Docker Postgres
  only; refuses staging/production URLs; always removes the container.
- **Rollout** (`rollout.ts` + `config/mc-routing-rollout.json` +
  `config/routing-pilots/*`): shadow/suggestion/confirmation modes, research
  thresholds, Wilson CI lower bound, per-cohort + rolling-window evaluation,
  automatic demotion to suggestion-only, kill-switch snapshot, `rolloutHealth()`.
  Eight enabled cohorts are descriptor-valid/config healthy; three are suggestion
  (`PLX_MC`, portal, swarm) and five are shadow (skills, local-inference,
  `1hr-after`, Furgenics, For & Against). `minRepos` remains the independent
  research threshold of five. Confirmation and fuzzy auto-link are off.
- **Visibility contract**: Inbox must be enabled and verified before suggestion.
  Suggestion-mode GitHub output is a generic authenticated MC link only;
  candidate IDs/reasons remain in MC. Shadow output contains no link or visible
  candidates.
- **Authority split**: MC owns planning records and explicit decisions; GitHub
  owns PR identity/lifecycle metadata; repository governance owns team
  assignment through `AGENTS.md`, module contracts, and `CODEOWNERS` plus local
  declarations/CI; fleet governance owns cohort enrollment and priors. Routing
  never overrides repository team ownership.
- **Retention** (`retention.ts`): expire provisional sessions and proposal
  detail; never delete final typed links or append-only audit events.
- **Maintenance cron** (`/api/cron/routing-maintenance`): `CRON_SECRET` +
  durable `sp_routing_maintenance` + `routing.maintain` only.
- **Health semantics**: `rolloutHealth()` proves descriptor/config health only
  (`scope: "descriptor_config"`; registry intersection, 3/5/0 modes,
  tier/default-Bucket parity, fuzzy off). Its `reasons[]` reports configuration
  mismatches. Live activation additionally requires selected variables,
  full-slug OIDC binding, the copied workflow, and recorded run/proposal/audit
  evidence.

```ts
import { parseRoutingMarkers, upsertRoutingProposal, rolloutHealth } from "@/lib/routing";
import { withTransaction } from "@/lib/db";

const parsed = parseRoutingMarkers(prBody); // in-memory only
await withTransaction(async (q) => {
  await upsertRoutingProposal(input, q);
  // P8: lockProposalForUpdate → allocateNextTaskId → insertCreationIntent …
});
rolloutHealth(); // pilots + fuzzy-off invariant
```

### Key Files

- `src/lib/routing/types.ts` — contracts
- `src/lib/routing/markers.ts` — marker parser + body hash
- `src/lib/routing/repo.ts` — transaction-aware repository
- `src/lib/routing/rollout.ts` — modes, metrics, demotion
- `src/lib/routing/retention.ts` — expiry planning
- `src/lib/routing/persistence/` — SQL helpers / constants
- `src/app/api/cron/routing-maintenance/route.ts`
- `config/mc-routing-rollout.json`, `config/routing-pilots/`
- `.github/plx-mc-routing-manifest.json` — copied generated declaration
- `.plx/mc-routing.json` — optional path-rule declaration; **not consumed by the
  current runtime**
- `docs/runbooks/mc-routing-rollout.md`
- `db/migrations/017_routing_proposals.sql`
- `db/migrations/018_routing_links_and_task_sequence.sql`
- `scripts/test-routing-postgres.mjs`

## Evaluation loop (Phase 5 — TASK-632..635)

- **Outcome metrics** (`src/lib/routing/outcomes.ts`): per-runtime success
  rate, rework (re-checkout after completion), median checkout→completion
  cycle time, and session token/cost telemetry — computed from the
  append-only `mc_events` substrate (kinds `checkout`, `task.completed`,
  `agent.session_telemetry`). Surfaced at `GET /api/agent-metrics`.
- **Session telemetry** (TASK-633): agents report tokens/cost at session
  close via `mc_report_session_telemetry`
  (`POST /api/cursor/session-telemetry`, `telemetry.report` capability),
  deduped per sessionId.
- **Metrics → suggestions** (TASK-634): every `mc_suggest_work` response
  carries an `evaluation` envelope — the effective autonomy level and the
  requesting runtime's outcome metrics (fail-open). Scoring weights are
  unchanged; evaluation context informs the operator/agent, demotion still
  goes through rollout thresholds.
- **Autonomy dial** (TASK-635, `src/lib/routing/autonomy.ts` +
  `config/autonomy-dial.json`): per-repo/per-bucket operator dial that can
  only LOWER effective autonomy below the pilot cohort mode
  (shadow < suggestion < confirmation). Enforced at suggest availability and
  again at confirm/create time for service actors (`autonomy_restricted`
  403); humans always decide.

## Dependencies

- Depends on: `src/lib/db` (`query`, `TxQuery`, `withTransaction`); Postgres
  via numbered migrations; `src/lib/permissions` for maintenance authorization.
- Depended on by: MCP suggest/confirm, compliance propose/projection, Routing
  Inbox, metadata workflow, maintenance cron.
- Metadata workflow boundary: exact `https://mc.plxcustomer.io` validation
  precedes OIDC audience `plx-mc-compliance-verify`; same-repo metadata only,
  20-second warn-only delivery, no checkout/code/dependency/cache execution.
  Fork/Dependabot paths are skips, not activation proof. Distribution remains
  copied/generated; reusable workflows, Checks writes, and ruleset expansion
  are deferred.

## Owner

Vince

## Criticality

Critical
