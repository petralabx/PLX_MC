## Scope

BKT-MC-SERVER covers the server changes in PR #385, from `601640a4c5db33733d9e6ecd78aff5387a561c7a` to `0e23bb30d0a5fcbe11727b2b8f8cd1ece333a583`.
Vince owns the outcome.
This document describes that diff only.

- TASK-3483 accepts a task's human accountable owner for service-alias checkouts and returns accountable people in checkout receipts and reads. See `src/lib/compliance/service.ts`, `src/lib/mc-data/policy.ts`, and `src/lib/mcp/read-actions.ts`.
- TASK-3409 renews stamped open-PR leases on push or reopen, supports explicit reuse, reports concurrent holders, and exposes checkout liveness. See `src/lib/compliance/repo.ts`, `src/lib/compliance/service.ts`, `src/lib/compliance/webhook.ts`, and `src/lib/mcp/actions.ts`.
- TASK-3407 adds lane identity to MCP audit events and checkouts, plus audited reassignment. See `src/lib/mcp/auth.ts` and `src/lib/mcp/task-update-actions.ts`.
- TASK-3408 signs human approvals for launch, merge, or flags. TASK-3444's MC half exposes approval verification. See `src/lib/compliance/approval-signature.ts`, `src/lib/compliance/approvals.ts`, and `src/lib/mcp/approval-actions.ts`.
- TASK-3410 records checkout launcher identity, launch records, and an ordered SHA chain. See `src/lib/compliance/lease-chain.ts`, `src/lib/compliance/repo.ts`, and `src/lib/mcp/checkout-head-actions.ts`.
- TASK-3442 adds project and bucket redirects and MCP links. See `src/app/projects/[id]/page.tsx`, `src/app/buckets/[id]/page.tsx`, and `src/lib/mcp/envelope.ts`.
- TASK-3426 adds the draft AI review spec and research record. See `docs/specs/ai-review-v2.2-implementation-spec.md` and `artifacts/review/2026-10-20-ai-review-v2-2-design-review/REPORT.md`.

The routes and stdio proxy expose the server behavior in `src/app/api/cursor/` and `tools/plx-mc-mcp/index.ts`.

## Principals and capabilities that change

`task.assign` is added to human admin and owner roles, `sp_mcp_ledger`, and `sp_mcp_cos`.
Reassignment requires a reason of at least 10 characters and emits `task.assignment.changed`.
The accountable owner must resolve to a person; existing restrictions on agent assignees remain.
See `src/lib/permissions/types.ts`, `src/lib/permissions/grants.ts`, and `src/lib/mcp/task-update-actions.ts`.

`X-MC-Agent` optionally identifies `<runtime>/<lane>` and must match `X-MC-Runtime`.
Missing agents warn unless `PLX_MC_CHECKOUT_AGENT_REQUIRED=1`.
Concurrent leases warn unless `PLX_MC_CHECKOUT_TAKEOVER_ENFORCE=1`; `forceReason` permits takeover.
See `src/lib/mcp/auth.ts`, `src/lib/mcp/actions.ts`, and `src/lib/compliance/service.ts`.

Any principal with `task.read` and task project access can call `mc_verify_approval`; its response omits the proposal.
Human approvals use HMAC-SHA256 with `PLX_MC_APPROVAL_SIGNING_KEY`.
Without the key, approvals remain unsigned and signed checks fail closed.
The optional `PLX_MC_APPROVAL_DECIDERS` list limits deciders.
Launch approvals expire after four hours, flags after 24 hours, and merge or unscoped approvals after 72 hours.
Tasks labelled `approval:merge-required` need a valid signed approval for the exact repository, PR, and head SHA.
See `src/lib/compliance/approval-signature.ts`, `src/lib/compliance/service.ts`, and `src/lib/mcp/approval-actions.ts`.

Only `PLX_MC_LAUNCHER_PRINCIPALS` members may attach a launch record.
`mc_record_checkout_head` requires `task.checkout`, project access, and the principal that took the checkout.
It refuses inactive checkouts and another PR after chain binding.
Only the owning configured launcher receives its full checkout ID on reads.
`PLX_MC_LAUNCH_LANES` selects lanes requiring launch records; chain violations warn until `PLX_MC_LEASE_CHAIN_ENFORCE=1`.
See `src/lib/compliance/lease-chain.ts`, `src/lib/compliance/service.ts`, `src/lib/mcp/checkout-head-actions.ts`, and `src/lib/mcp/read-actions.ts`.

## Rollback

Revert the replacement PR's application and documentation changes through the normal review process.
Leave migration 047's additive columns and table in place; this scope contains no down migration.
Keep enforcement flags disabled while operators review activation.
Removing the signing key makes signed checks fail closed; rotating it invalidates existing signatures and requires live gates to be approved again.
See `db/migrations/047_checkout_lease_chain.sql`, `src/lib/compliance/lease-chain.ts`, and `docs/FLEET-SECRETS-SOP.md`.

## How migration 047 is applied

This change is operator-merged, with Vince's yes before production.
An operator applies migration 047 through `scripts/migrate.mjs`; this replay does not apply it.
The migration declares transactional application by that runner and uses idempotent, additive DDL.
It adds `launcher_id`, `base_sha`, and `launch_id` to `mc_dispatch`.
It creates `mc_dispatch_heads` with ordered heads, source, recorder, timestamp, dispatch reference, and uniqueness on dispatch plus head SHA.
See `db/migrations/047_checkout_lease_chain.sql` and its entry in `src/lib/db/migration-manifest.json`.
