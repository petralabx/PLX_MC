# Module: repos

## What

The repo registry (= the allow-list) and its governance: which codebases the
workspace tracks, self-service request → approve, and the **server-persisted**
source of truth. Owns the registry seed, the allow-list predicates, the Postgres
persistence (`mc_repos` / `mc_repo_requests`), server allow-list enforcement on
task create/edit, and the repo UI surfaces. It is explicitly NOT a SharePoint
"Repo Registry" list (deferred to the EN-006 sync increment — the site is
unprovisioned) and NOT GitHub repo contents.

## Why

EN-002 shipped the registry, allow-list, and request→approve flow but kept the
registry **client-side in memory only**. That left a real correctness bug
(EN-005 obs. #7): the server task mutation validated against the static `REPOS`
import while the client used the runtime registry, so a repo approved in the UI
failed server-side task creation. EN-005 persists the registry in Postgres so the
server and client enforce the **same runtime allow-list**, and makes a task's
repos editable post-creation.

## How

- **Allow-list = the persisted registry.** Seeded from the `REPOS` fixture in
  `data.ts` into `mc_repos` on first run (`registry.ensureRegistrySeeded`,
  `ON CONFLICT DO NOTHING`). `sync/state.ts createTask` **and** `patchTask`
  validate `repos` against `registry.getRegistry()` — never the static import —
  so a runtime-approved repo is honored server-side (the drift fix).
- **Pure predicates** in `src/lib/mc-data/repos.ts` (`isAllowedRepo`,
  `disallowedRepos`, `allowedReposOnly`, `repoIdFromName`, `repoFromRequest`,
  `isApprover`) are shared by client and server.
- **Request → approve** is server-authoritative and approver-gated: `POST
  /api/repos` files a request (deterministic id `RR-<repo-id>`, validated against
  the GitHub org); `POST /api/repos/{id}/approve|reject` is restricted to an
  Owner/Admin and **re-validates** at approve time, so an unverified repo never
  reaches the allow-list. The client store mirrors these optimistically and adopts
  server truth via `GET /api/state` (the snapshot now carries `repos` +
  `repoRequests`).
- **UI reads the runtime registry:** `atoms.RepoChip` and the inline
  `RepoEditor` (task detail) read `store.allRepos()` — a newly-approved repo renders
  by name and is selectable, and a task's `repos` are editable post-create
  (allow-list constrained; `store.setTaskRepos`).
- **Persistence tier:** task `repos` are DB-only on edit; re-push to the SharePoint
  ToDos `Repos` column is deferred to EN-006 (repos currently pushes on create only).

## Dependencies

`@/lib/db` (the Postgres pool), `@/lib/sync` (the engine seed hook, `github.ts`
org validation, the `state.ts` task mutations), `@/lib/mc-data` (the `Repo` /
`RepoRequest` types + `repos.ts` predicates + the `REPOS` seed), and the task
store. Depended on by: task creation/patch (allow-list), `repos-view.tsx`,
`task-detail.tsx`, and `atoms.RepoChip`.

### Key Files

- `src/lib/mc-data/data.ts` — `REPOS` seed registry + `REPO_ORG`
- `src/lib/mc-data/repos.ts` — allow-list predicates + request/approval builders
- `src/lib/mc-data/types.ts` — `Repo`, `RepoRequest`, `RepoVisibility`
- `src/lib/sync/registry.ts` — Postgres accessors (registry + request queue, seed)
- `src/lib/sync/state.ts` — `createTask` / `patchTask` allow-list validation + `createRepoRequest` / `approveRepoRequest` / `rejectRepoRequest`
- `src/lib/sync/github.ts` — GitHub-org validation seam
- `src/app/api/repos/route.ts`, `src/app/api/repos/[id]/approve|reject/route.ts`, `src/app/api/repos/validate/route.ts` — the API surface
- `src/lib/mc-data/store.ts` — client registry (`allRepos`, `requestRepo`, `approveRepo`, `rejectRepo`, `setTaskRepos`) + server mirror + hydration
- `src/components/mc/repos-view.tsx`, `repo-editor.tsx`, `atoms.tsx` (`RepoChip`) — UI surfaces
- `db/migrations/008_repo_registry.sql` — `mc_repos`, `mc_repo_requests`
- `tests/mc-repos.test.ts` (client) + `tests/mc-repo-registry-server.test.ts` (server allow-list + approve gate) + `tests/mc-patch.test.ts` (repos edit)

## Owner

Vince

## Criticality

High
