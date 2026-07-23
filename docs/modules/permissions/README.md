# Module: permissions

## What

Typed, deny-by-default authorization kernel for Mission Control. Owns stable
capability unions, `owner|admin|member` grant bundles, durable service-principal
grants, contextual predicates, and identity record helpers for Entra users,
verified GitHub links, and service principals.

This is **not** a generic IAM framework, database-authored policy language, or
policy DSL. Domain lifecycle rules stay in `mc-data/policy`; authentication
admission (email allowlist / MCP API key) stays in `auth` / `mcp`.

## Why

Routing, task mutation, repo approval, and sync writers need one centralized
`authorize(...)` boundary so capability checks are not reimplemented in routes,
MCP actions, and UI affordances. Without it, service principals and humans blur,
and unknown capabilities fail open by accident.

## How

```ts
import { authorize } from "@/lib/permissions";

const decision = authorize({
  actor: { kind: "human", id: entraOid, role: "admin", status: "active" },
  capability: "repo.approve",
  resource: { type: "repo", id: "plx-mc" },
});
// { allowed, reasonCode, policyVersion: "permissions.v1" }
```

| Layer | Responsibility |
|-------|----------------|
| `auth` | Authenticate Entra sessions / credentials; admit via allowlist; propagate `oid` |
| `permissions` | Decide whether an authenticated actor may perform a capability |
| `mc-data/policy` | Domain invariants after authorization (accountable owner, lifecycle, evidence) |

**Default state / staged rollout (TASK-618):**
`PLX_MC_PERMISSIONS_ENFORCEMENT_MODE` = `off | log-only | review | enforce`
(default `off`; legacy `PLX_MC_PERMISSIONS_ENFORCEMENT_ENABLED=1` still maps to
`enforce`). `off` keeps builds/local dev DB-free and admission-only. `log-only`
hydrates identities best-effort and records every decision without changing
outcomes. `review` fail-closes service principals on the durable registry while
humans keep legacy outcomes with shadow verdicts recorded. `enforce` is full
enforcement. Rollout runbook: `docs/runbooks/permissions-enforcement-rollout.md`.
The kernel itself is pure and always callable for tests and gradual rollout.

**MCP (TASK-619):** per-agent API keys (`PLX_MC_MCP_AGENT_KEYS`, JSON map of
service principal id → key) authenticate durable per-agent principals
(`sp_mcp_cursor`, `sp_mcp_claude_code`, `sp_mcp_codex`, `sp_mcp_swarm`). The
legacy shared `PLX_MC_MCP_API_KEY` still resolves `sp_mcp_cursor` behind the
`PLX_MC_MCP_SHARED_KEY_ENABLED` kill switch (set `0` to retire it). Ids outside
the reviewed registry never authenticate. `X-MC-Operator-Email` is allowlisted
audit/context only and never grants human capabilities. From `review` mode
onward, MCP authentication loads the principal from `service_principals` and
rejects missing or revoked records. Service capabilities always come from the
reviewed versioned registry; callers cannot inject a capability list.

**Audit data (TASK-620):** every enforcement call site records `allowed`,
`reasonCode`, and `policyVersion` to `permissions_decision_log` (migration 022)
via `src/lib/permissions/enforcement.ts` + `decision-log.ts`, including the
enforcement mode and — during staged rollout — the shadow (real-identity)
verdict. Recording is fail-open and a no-op in mode `off`. UI affordance
checks (e.g. the `isApprover` display shim) are not enforcement and are not
recorded.

**Future extension:** add typed capabilities + grant-bundle / predicate updates
with contract tests. Do not introduce a policy expression language until a
concrete rule cannot be expressed that way.

### Key Files

- `src/lib/permissions/authorize.ts` — deny-by-default kernel
- `src/lib/permissions/grants.ts` — role + service-principal bundles
- `src/lib/permissions/predicates.ts` — contextual denials
- `src/lib/permissions/identities.ts` — record builders / active checks
- `src/lib/permissions/repository.ts` — lazy, parameterized identity lookups
- `src/lib/permissions/enforcement.ts` — staged-mode actor resolution + recorded decisions
- `src/lib/permissions/decision-log.ts` — fail-open decision audit sink
- `db/migrations/016_permissions_identities.sql` — durable identity tables
- `db/migrations/022_permissions_decision_log.sql` — decision audit table
- `db/migrations/023_mcp_agent_principals.sql` — per-agent MCP principals
- `src/lib/auth/identity.ts` — Entra `oid` session helpers + enforcement mode

## Dependencies

- Depends on: none at runtime for `authorize` (pure). Identity hydration uses
  the shared `db` query seam only when enforcement is enabled.
- Depended on by: `mc-data/repos` (`isApprover` shim), MCP auth (service
  principal actor), future routing / task / sync mutation paths.

## Owner

Vince

## Criticality

High
