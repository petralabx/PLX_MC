# REPORT — MC routing fleet control

**Date:** 2026-07-15  
**Owner:** Vince (`vince@petrasoap.com`)  
**MC:** TASK-452  
**Scope:** Central `petralabx/PLX_MC` control plane only

## Verdict

The central routing control plane is ready for PR review. It now defines eight
active cohorts, enforces three suggestion / five shadow modes at runtime, keeps
confirmation and fuzzy auto-link off, and generates a bounded metadata-only
workflow with signed OIDC identity and safe GitHub summaries.

No downstream activation PR was started in this delivery. The merged portal
canary remains the frozen behavior reference until this central PR produces the
generator SHA used by subsequent repos.

## Critical / High findings closed

- OIDC binds signed repository ID, canonical workflow identity, event, ref, and
  SHA; caller-submitted workflow identity is not authoritative.
- The workflow validates the exact MC origin before token mint, skips forks and
  Dependabot safely, bounds delivery to 20 seconds, and never executes PR code.
- Global kill switches clamp capabilities monotonically; shadow cohorts cannot
  leak candidates or deep links through workflow, MCP, or Routing Inbox.
- Pilot eligibility intersects the active fleet registry.
- Rejected cross-repo routing-session markers are discarded.
- Proposal revisions and candidate rows persist atomically and replay
  idempotently without reopening resolved work.
- New compliance callers send full repository identity while the dated legacy
  bare-name shim remains migration-only.

## Verification

- `bash ./scripts/preflight.sh --mode pre-commit` — exit 0
- `bash ./scripts/preflight.sh --mode pre-push` — exit 0
- Python: 50 passed
- Vitest: 99 files / 1199 tests passed
- Next.js production build — passed
- Playwright: 202 passed / 5 skipped
- Routing/compliance generator drift — aligned
- Repository hygiene — clean

Local browser tests emit expected degraded-state logs when
`PLX_MC_DATABASE_URL` is absent; the suite intentionally falls back to seeded
local state and still passed.

## Medium follow-ups

- TASK-456 — prove organization-variable consumption in public/private Actions
- TASK-457 — align descriptor/config versus live-health wording
- TASK-458 — correct hub scaffold side-effect documentation/contract
- TASK-459 — retire the bare-name compliance binding shim by 2026-10-15

## Deferred downstream activation

- TASK-448 — agentic-swarm
- TASK-449 — skills
- TASK-450 — local-inference
- TASK-453 — 1hr-after
- TASK-454 — furgenics
- TASK-455 — for-and-against

These remain blocked on the merged central generator SHA.

## Rollback

Disable suggestion and Routing Inbox first, then routing metadata/proposals if
required. Compliance remains active. Preserve proposal, decision, and audit
history; no destructive migration is part of this change.
