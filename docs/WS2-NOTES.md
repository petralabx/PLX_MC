# WS-2 — Repo registry, seeding, self-service & governance (EN-002)

Branch: `feat/enh-ws2-repos-governance` (off `feat/enh-ws1-directory-accountability`)
Worktree: `~/.cursor/worktrees/ws2-repos-1282c599/PLX_MC-feat-enhancements-2a03bb03d623`

## What changed

### Registry (the allow-list)
`src/lib/mc-data/data.ts` `REPOS` is now exactly the three canonical repos under
the `taylorvalton` GitHub org, with **honest metadata resolved from the org**
(no fabricated PR/task counts — those were removed from the model and are derived
live from task membership/PRs on the Repos screen):

| id | name | default branch | visibility | language |
|---|---|---|---|---|
| `portal-web` | `plx-customer-portal` | `master` | private | TypeScript · Next.js |
| `agentic-swarm` | `agentic-swarm` | `main` | private | TypeScript |
| `plx-mc` | `PLX_MC` | `main` | public | TypeScript |

The four demo placeholders (`portal-api`, `mrp-core`, `design-sys`, `infra`)
were deleted, and all references to them removed. `portal-web` keeps its id so
the seeds that reference it keep resolving.

### Backfill
Every one of the 8 buckets and all 15 seeded tasks now attach `["portal-web"]`
(the prior `portal-api`/`infra` attachments on `BKT-DAPI`/`TASK-222` and
`BKT-INFRA`/`TASK-235` were changed to `portal-web`). `agentic-swarm` and
`plx-mc` stay in the registry but attach to nothing yet.

### Model (additive)
`src/lib/mc-data/types.ts`:
- `Repo` gains `owner`, `visibility` (`RepoVisibility`), `scope`; `def` stays the
  default branch; fabricated `openPRs`/`openTasks` removed.
- New `RepoRequest` + `RepoRequestStatus` types for the self-service queue.

### Governance helpers
`src/lib/mc-data/repos.ts` (new, exported via the barrel):
- `isApprover(actor)` — true only for human `Owner`/`Admin` (vince is Owner).
- `isAllowedRepo` / `disallowedRepos` / `allowedReposOnly` — the allow-list
  predicates, used by both client and server.
- `repoIdFromName` / `repoFromRequest` — build a registry repo from an approval.

### Self-service request → approve (store, additive)
`src/lib/mc-data/store.ts`:
- `McState` gains `repos` (seeded from `REPOS`) + `repoRequests`.
- Getters `allRepos()`, `repoRequests()`.
- Actions `requestRepo` (any collaborator), `approveRepo` / `rejectRepo`
  (gated by `isApprover`; approve adds the repo to the registry/allow-list).
- **Hardened approval gate (orchestrator decision, 2026-06-17):** `approveRepo`
  also requires `verified === true`. An unverified request (one that failed
  GitHub-org validation) can never be approved — `approveRepo` returns `false`
  with a clear `repo_unverified`-style notice and nothing joins the allow-list.
  The Repos-screen Approve button is `disabled` for unverified requests while the
  unverified flag stays visible; Reject remains available. (No server approve
  route exists — approval is store-enforced only — so the guard lives in the
  store action + UI.)
- Injectable GitHub-validation seam `__setRepoValidatorForTests` +
  `__repoValidationSettled` (mirrors the existing `patchMirror` test seam).
- `addTask` now clamps `repos` to the allow-list and surfaces a notice for any
  dropped repo.

### Allow-list enforcement (humans and agents)
- Client: `addTask` filters off-list repos.
- Server: `src/lib/sync/state.ts` `createTask` rejects off-list repos with
  `ApiError("repo_not_allowed", …, 422)` — agents create tasks through this same
  gate, so they are bound to the same allow-list.

### GitHub-org validation
`src/lib/sync/github.ts` `validateRepoInOrg(owner, name)` calls the GitHub REST
API with `GITHUB_TOKEN`. Route `POST /api/repos/validate`
(`src/app/api/repos/validate/route.ts`, shared `route()`/`parseBody` + zod).
When the token is missing or the call fails it returns `ok:false` + an honest
note; the store marks the request unverified rather than fabricating membership.

### UI
`src/components/mc/repos-view.tsx`: "+ Request repo" form, a repo-request review
queue with verified/status pills, and Approve/Reject controls shown only to an
approver. `src/components/mc/new-task-modal.tsx` Repos section now sources the
registry from `allRepos()` (the allow-list). New styles in
`src/styles/mc-record.css` use `--p-*` tokens only (no raw hex).

## GitHub-validation result (REAL, run at build time)
All three repos were validated live against the org with the available
`GITHUB_TOKEN`:
- `taylorvalton/plx-customer-portal` → 200, private, default `master`, TypeScript
- `taylorvalton/agentic-swarm` → 200, private, default `main`, TypeScript
- `taylorvalton/PLX_MC` → 200, public, default `main`, TypeScript

The registry metadata above is taken directly from those responses. In the unit
tests the validator is **mocked** through the injectable seam (hermetic; no
network).

## Deferred (with reason)
- **SharePoint list for the repo registry (SHOULD):** deferred — **approved by the
  orchestrator (2026-06-17)** to land with the person-column/sync increment.
  Standing up a new SharePoint list is an External Integrations change
  (owner/scope/auth/kill-switch declaration) and the WS-2 brief says don't disturb
  the existing `Repos` column mapping. The runtime registry + request queue are
  in-store only for now. **TODO:** add a `Repo Registry` list to
  `config/sharepoint-schema.json` + `SP_LISTS` + `mapping.ts` when that increment
  runs.
- **Persisting requests/approved repos across reloads:** in-memory for now (reset
  by `resetStore`), matching the prototype's not-yet-server-persisted surfaces.

## Verification (all green)
- `npm run typecheck` → exit 0
- `npm run test` → 19 files, **272 passed** (was 257; +15 WS-2 tests in
  `tests/mc-repos.test.ts` incl. the unverified-approval guard,
  `tests/mc-record.test.ts` updated for the new registry)
- `npm run build` → success; `/api/repos/validate` registered
- `./scripts/preflight.sh --mode pre-commit` → all checks passed
- Heavy Playwright E2E intentionally skipped (per brief).

## Files changed
- `src/lib/mc-data/types.ts` (Repo + RepoRequest)
- `src/lib/mc-data/data.ts` (registry + backfill)
- `src/lib/mc-data/repos.ts` (new)
- `src/lib/mc-data/index.ts` (barrel export)
- `src/lib/mc-data/store.ts` (registry state + request/approve/reject + allow-list)
- `src/lib/sync/github.ts` (new)
- `src/lib/sync/index.ts` (export validator)
- `src/lib/sync/state.ts` (server allow-list enforcement)
- `src/app/api/repos/validate/route.ts` (new)
- `src/components/mc/repos-view.tsx` (request + review UI)
- `src/components/mc/new-task-modal.tsx` (Repos section sources the registry)
- `src/styles/mc-record.css` (request/review styles, --p-* tokens)
- `tests/mc-repos.test.ts` (new), `tests/mc-record.test.ts` (updated)

## For integration with WS-3
Shared-file edits (`types.ts`, `store.ts`, `mc-data/index.ts`, `sync/index.ts`,
`sync/state.ts`) are additive and localized. No comment/sub-task/timeline/
task-detail/bucket-detail collaboration code was touched.
