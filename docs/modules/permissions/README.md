# Module: permissions

## What

Typed, deny-by-default authorization kernel for Mission Control. Owns stable
capability unions, `owner|admin|member` grant bundles, durable service-principal
grants, contextual predicates, and identity record helpers for Entra users,
verified GitHub links, and service principals.

This is **not** a generic IAM framework, database-authored policy language, or
policy DSL. Domain lifecycle rules stay in `mc-data/policy`; authentication
admission (MC.* Entra app roles + transitional allowlist / MCP API key) stays
in `auth` / `mcp`.

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
| `auth` | Authenticate Entra sessions / credentials; admit via MC.* app role or allowlist; write `mc_users` at sign-in; propagate `oid` |
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
(`sp_mcp_cursor`, `sp_mcp_claude_code`, `sp_mcp_codex`, `sp_mcp_chatgpt`,
`sp_mcp_grok`, `sp_mcp_hermes`, `sp_mcp_swarm`, `sp_mcp_agent_runner`,
`sp_mcp_portal`). The legacy shared `PLX_MC_MCP_API_KEY` still resolves `sp_mcp_cursor` behind the
`PLX_MC_MCP_SHARED_KEY_ENABLED` kill switch (set `0` to retire it). Ids outside
the reviewed registry never authenticate. `X-MC-Operator-Email` is allowlisted
audit/context only and never grants human capabilities. From `review` mode
onward, MCP authentication loads the principal from `service_principals` and
rejects missing or revoked records. Service capabilities always come from the
reviewed versioned registry; callers cannot inject a capability list. The
shared agent bundle includes project and bucket creation, bucket updates
(`mc_update_bucket` / `bucket.update`), steward project edits
(`mc_update_project` / `project.update`, TASK-2530), plus `sync.mutate`
(conflict resolve via MCP) but not repository approval or permission
management. Console sweep/retry remain Entra-gated.

**Cancel / reopen (TASK-2529):** `task.cancel` and `task.reopen` authorize
moving a task to and from the `cancelled` end stage (`mc_update_task`
`patch.cancel` / `patch.reopen`, `mc_report_progress` `stage:"cancelled"`, over
HTTP MCP, the cursor REST routes and the stdio client). They are evaluated on
the authenticated principal; `X-MC-Operator-Email` is recorded as audit context
only. Admin and owner roles hold both. `task.cancel` is granted to
`sp_mcp_cursor` (Ledger's live Task principal; Vince 2026-10-16),
`sp_mcp_cos`, and `sp_mcp_ledger`. `task.reopen` is granted to `sp_mcp_ledger`
(TASK-2580) and `sp_mcp_cursor` (Vince 2026-10-19, TASK-3374). No other service
principal holds `task.reopen`.
`MCP_AGENT_CAPABILITIES` never includes either capability (every agent would
then cancel any task); an operator grants one to a named principal in
`SERVICE_GRANTS`.
Humans cancel from the task detail (click **Cancelled** in the lifecycle rail,
pick a reason): `PATCH /api/tasks/{id}` with `{cancel: {reason, replacedBy?,
note?}}` alone, authorized as `task.cancel` on the Entra session (TASK-2598);
a refusal appends `task.cancel_denied`. Clicking any other stage on a cancelled
task reopens it through `task.reopen`.

**Portal principal (agent fleet P8, decision CG-07b):** `sp_mcp_portal`
(migration 028) does not get the shared agent bundle. Its grant is
`task.create` and `task.read` only. The MCP tool allowlist
(`src/lib/mcp/tool-allowlist.ts`) then limits it to `mc_create_task` and
`mc_search_tasks`: every other HTTP MCP tool and cursor REST route gives 403,
reads included. Fleet P8b adds one read: `agent_report.read`, with the
allowlist name `mc_list_agent_reports` for `GET /api/cursor/agent-reports`.
Only `sp_mcp_portal` holds `agent_report.read`; no other principal and no human
role does. It is the only MCP principal that may set an
`agent:` assignee; a signed-in person may too. The pure predicates
`isAgentAssignee` and `mayAssignAgent` live in `agent-assignee.ts`; the
server-only guard `assertAgentAssigneeAllowed` (`agent-assignee-guard.ts`)
throws 403 in `actionCreateTask` and `PATCH /api/tasks/[id]`.

**Vendor spend (TASK-2928):** `vendor_spend.write` authorizes saving a vendor
budget (`PATCH /api/vendor-spend/budgets`) and entering a manual cost snapshot
(`POST /api/vendor-spend/snapshots`), the AI Spend budget editor and manual
entry form. Both routes call `requireSessionActor("vendor_spend.write")` on the
Entra session and store the session email as the author. Admin and owner roles
hold it; members and every service principal do not, so until mode `enforce`
(humans synthesized as admin) no signed-in person is newly denied.
`POST /api/vendor-spend/refresh` needs it too (TASK-3011); the script backfill
uses `GET /api/cron/vendor-spend-refresh?period=` with `CRON_SECRET` instead.

**Session writes behind the middleware gate only (TASK-3011):** each now calls
`requireSessionActor(<capability>)` and takes its author from the session
(`sessionAuthorId` in `src/lib/api/session-actor.ts`: the directory id when the
email is listed, else the email — the id `GET /api/viewer` returns).
`bucket.comment` (member and up): `PATCH /api/buckets/[id]/comments`, plus the
bucket's project ACL (404 for an unknown bucket). One operation per request
(`add` / `edit` / `delete` one comment, `CommentOp`), applied in one
transaction under a per-bucket advisory lock: an add gets a server id, stamp
and the session author; only the author edits or deletes (403).
Task comments follow the same rule (TASK-3043): `PATCH /api/tasks/[id]/comments`
(`task.progress` plus the task's project ACL) takes one `CommentOp` under the
task row lock, and `PATCH /api/tasks/[id]` refuses a `comments` field (400).
`repo.request` (member and up): filing / updating one's own pending request
(`POST /api/repos/requests`) and `POST /api/repos/validate`. The server verifies
the request itself (allowed org + GitHub lookup) and re-verifies on a name or
owner change; `verified` and its details never come from the body.
`POST /api/repos/validate` with `requestId` re-validates the requester's own
pending request and records the result on it (TASK-3043). Request ids are
`RR-<uuid>`, unique across page loads. A decision
needs `repo.approve` and, until mode `enforce`, the directory approver role
(the same check as `POST /api/repos`); it is recorded under the session, is
final, refuses self-approval (`self_approval`), an unverified request and a
disallowed org, and an approval adds the repo to the registry in the same
transaction. Every request write is conditional on the row still being
pending (409 otherwise). `POST /api/repos` also refuses a repo matching the
caller's own pending request.
`skill.submit` (member and up): `POST /api/skills-directory/submit`, submitter =
session email. `skill.install` (member and up): `POST
/api/skills-directory/install` and `/sync-check`. `compliance.reconcile` (admin
and owner): `POST /api/compliance/reconcile`. No service principal holds any
of them. Under break-glass (Basic auth, no Entra session) a manual reconcile
is `GET /api/cron/reconcile` with the `CRON_SECRET` bearer.

**Audit data (TASK-620):** every enforcement call site records `allowed`,
`reasonCode`, and `policyVersion` to `permissions_decision_log` (migration 022)
via `src/lib/permissions/enforcement.ts` + `decision-log.ts`, including the
enforcement mode and — during staged rollout — the shadow (real-identity)
verdict. Recording is fail-open and a no-op in mode `off`. The same sink
covers MCP auth denials (missing or revoked principal), tool-allowlist
denials, checkout-release verdicts, agent-assignee decisions, restricted-project
ACL decisions, routing-session transfer verdicts, and the server-side
`repo.approve` gate (`repo.approve.session`). The client-side approver checks
in the store and the Repos and Skills screens (`authorize` on
`permissionActorFromDirectoryRole`) are UI hints only and are not recorded.

**Admission from Entra app roles (TASK-3010):** the `plx-mission-control` app
registration defines three app roles. At each Entra sign-in
(`src/lib/auth/index.ts` `signIn` callback, which runs only on the
`/api/auth` callback route, never in middleware) the ID token's `roles` claim
(the same claim Goals.Viewer / Goals.Editor use) is mapped by
`admissionDecision` / `accessRoleFromEntraRoles` in `src/lib/auth/gate.ts`:

| Entra app role (value) | Petra level | `mc_users.access_role` |
|------------------------|-------------|------------------------|
| `MC.Owner` | L5 | `owner` |
| `MC.Admin` | L4 | `admin` |
| `MC.Member` | L2–L3 | `member` |
| none | L1 | no admission by role |

Highest role wins. Values are case-sensitive.

- **Admission** = holds an MC.* role **OR** email is on `PLX_MC_ALLOWED_USERS`.
  Neither → refused (`AccessDenied` on `/signin`).
- **MC.* role** → `mc_users` row created or updated (`entra_oid`, email,
  display name, `access_role`, `status='active'`). Entra is the source of
  truth: the role re-activates a revoked row and overwrites a hand-set role.
- **Allowlist only** (no MC.* role) → admitted; the existing row is left as is
  (never downgraded or deleted from an absent claim); no row is created. Each
  such sign-in logs `[auth] admitted by PLX_MC_ALLOWED_USERS without an MC.*
  app role: <email>` — the list of people still to assign.
- **Refused** → an existing row is set `status='revoked'`.
- A failed `mc_users` write is logged (`[auth] mc_users sign-in sync FAILED`)
  and never changes the admission result: the database can neither grant nor
  block a sign-in.
- **Removing a role** ends access within 12h: sessions end 12h after sign-in
  (`sessionStillValid`, TASK-2977); the next sign-in without a role, off the
  allowlist, is refused and revokes the row. To cut access at once, also remove
  the email from the allowlist (live check on every request) or revoke the
  user's Entra sessions.
- **When a session ends** (TASK-3161) the middleware redirects a page to
  `/signin` but answers `/api/*` with 401 `signin_required` JSON. On a read,
  `api()` / `apiDownload()` (`src/lib/api`) send the browser to
  `/signin?callbackUrl=<screen>`, and sign-in returns it to that screen
  (`signInReturnPath`: a path on this site, never `/api` or `/signin`). A write
  fails with the sign-in message and stays on the page, so unsaved input is
  kept. A route's own 401 `not_authenticated` does not redirect: a live session
  can hit it, and `/signin` would bounce straight back.

**`PLX_MC_ALLOWED_USERS` is transitional / break-glass.** It stays an
admission path so deploying this before the roles exist locks nobody out. It
is also the MCP `X-MC-Operator-Email` allowlist (`src/lib/mcp/auth.ts`), so
emptying it breaks every MCP call that names an operator: reduce it to the
MCP operator emails plus a named break-glass owner, not to empty, until the
MCP allowlist is split from sign-in.

**`repo.approve` (TASK-3010):** `POST /api/repos`, the decision path of
`POST /api/repos/requests` and `PATCH /api/skills-directory/submissions/[id]`
call `requireRepoApprover` (`src/lib/api/session-actor.ts`): in OIDC mode the
session's `mc_users` row (role + status) decides in every enforcement mode —
staged modes would otherwise treat every person as admin. A revoked row is
`403 not_approver`. **Transitional:** a session with no row falls back to its
HUMANS directory role (the pre-TASK-3010 rule) and logs
`repo.approve by directory role, no mc_users row`, so approvers are not locked
out before the app roles exist. Remove the fallback after step 4 below shows
every approver with a row. Dormant local/test mode keeps the body actor's
directory role.

**Operator steps (in this order):**

1. Deploy this change. Nothing changes for anyone on the allowlist.
2. Entra admin center → App registrations → `plx-mission-control` → App roles →
   create three roles, allowed member types *Users/Groups*, values exactly
   `MC.Owner`, `MC.Admin`, `MC.Member` (display names "MC Owner", "MC Admin",
   "MC Member").
3. Enterprise applications → `plx-mission-control` → Users and groups → assign
   the L5 group to MC.Owner, L4 to MC.Admin, L2 and L3 to MC.Member. Assign no
   L1 group.
4. Ask each person to Sign out and sign in again (or wait out the 12h session).
   Verify: `SELECT email, access_role, status, updated_at FROM mc_users ORDER BY
   updated_at DESC;` shows every expected person with the right role, and
   Vercel logs show no `admitted by PLX_MC_ALLOWED_USERS` lines for people who
   should hold a role. Check that the repo approvers (today: Vince) have an
   `owner` or `admin` row — without one, repo and skill approval returns 403.
5. Enterprise applications → `plx-mission-control` → Properties → set
   **Assignment required? = Yes**, so Entra refuses anyone without a role
   before MC sees them. Do this only after step 4, or allowlisted people with
   no assignment are refused by Entra itself.
6. Reduce `PLX_MC_ALLOWED_USERS` to the MCP operator emails plus a named
   break-glass owner (see above), and redeploy.
7. Then TASK-618 can move `PLX_MC_PERMISSIONS_ENFORCEMENT_MODE` log-only →
   review → enforce on `permissions_decision_log`.

Roll back: re-add emails to `PLX_MC_ALLOWED_USERS` (admits them with no role)
and set **Assignment required?** back to No. Reverting the code restores
allowlist-only admission and the HUMANS job-title `repo.approve` gate;
`mc_users` rows already written stay.

**Project ACL (TASK-1527 / TASK-1548):** restricted projects are a resource
allowlist, not a new capability. `src/lib/permissions/project-acl.ts` is the
pure membership check (`emails` / Entra oids / directory ids / reviewed
`sp_mcp_*` ids). `project-acl-guard.ts` loads project/bucket/task rows and
fail-closes API + MCP list/read/mutate. Shared/default projects are unchanged.
A non-empty project id with no row is deny/404 (dangling parent); null/empty
project stays fail-open (unparented = shared-like). `authorize()` also denies
when `context.projectVisibility === "restricted"` and the caller’s
`principalTokens` miss `projectMembers`. `GET /api/state` also strips
audit / conflict / error rows that name a hidden project, bucket, or task id.

**Known residual (restrict-after-push):** flipping a previously shared project
to `restricted` stops later outbound pushes (sync marked omitted) but does not
delete existing SharePoint Projects / Roadmap / ToDos items. Rails must create
projects as restricted so they never enter the mirror. A Graph item-delete
tombstone is a follow-up, not this change.

**Future extension:** add typed capabilities + grant-bundle / predicate updates
with contract tests. Do not introduce a policy expression language until a
concrete rule cannot be expressed that way.

### Key Files

- `src/lib/permissions/project-acl.ts` — restricted-project membership (pure)
- `src/lib/permissions/project-acl-guard.ts` — server loaders / snapshot scoping
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
- `db/migrations/025_grok_hermes_mcp_principals.sql` — Grok/Hermes MCP principals
- `db/migrations/030_chatgpt_mcp_principal.sql` — ChatGPT MCP principal
- `db/migrations/034_ledger_mcp_principal.sql` — Ledger steward MCP principal (`task.link_merged_pr`)
- `src/lib/auth/identity.ts` — Entra `oid` session helpers, enforcement mode, sign-in `mc_users` sync
- `src/lib/auth/gate.ts` — MC.* role → access_role mapping, admission decision, session validity

## Dependencies

- Depends on: none at runtime for `authorize` (pure). Identity hydration uses
  the shared `db` query seam only when enforcement is enabled.
- Depended on by: the `repo.approve` approver gate (`requireRepoApprover` on
  `mc_users` for the routes, with a logged directory-role fallback while a
  session has no row; directory-role UI hints in the store and the Repos and
  Skills screens), MCP auth (service principal actor), the vendor-spend write
  routes (`vendor_spend.write`), the TASK-3011 session writes (bucket comments,
  repo requests, skills submit/install, compliance reconcile), future routing /
  task / sync mutation paths.

## Owner

Vince

## Criticality

High
