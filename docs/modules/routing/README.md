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

Operator PRs without a checkout currently create sparse Tasks. Agents need
pre-checkout suggestions without inventing work. A shared typed persistence and
marker layer lets MCP, metadata workflows, webhooks, and the Routing Inbox share
one replay-safe proposal identity (`{repoId, changeId}`) and `rtx_*` sessions
without persisting raw PR bodies.

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
  Fuzzy auto-link forced off.
- **Retention** (`retention.ts`): expire provisional sessions and proposal
  detail; never delete final typed links or append-only audit events.
- **Maintenance cron** (`/api/cron/routing-maintenance`): `CRON_SECRET` +
  durable `sp_routing_maintenance` + `routing.maintain` only.

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
- `.plx/mc-routing.json` — PLX_MC path-routing manifest
- `docs/runbooks/mc-routing-rollout.md`
- `db/migrations/017_routing_proposals.sql`
- `db/migrations/018_routing_links_and_task_sequence.sql`
- `scripts/test-routing-postgres.mjs`

## Dependencies

- Depends on: `src/lib/db` (`query`, `TxQuery`, `withTransaction`); Postgres
  via numbered migrations; `src/lib/permissions` for maintenance authorization.
- Depended on by: MCP suggest/confirm, compliance propose/projection, Routing
  Inbox, metadata workflow, maintenance cron.

## Owner

Vince

## Criticality

Critical
