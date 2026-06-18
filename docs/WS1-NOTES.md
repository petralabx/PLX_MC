# WS-1 — Directory, accountability & assignment policy (resolves EN-003)

> Placed under `docs/` (not repo root) because the repo-hygiene gate
> (`scripts/preflight.sh`) rejects unapproved root markdown files, and WS-1
> requires that gate to pass. Same content the task requested as `WS1-NOTES.md`.

Branch: `feat/enh-ws1-directory-accountability` (from `feat/enhancements` @ `ca42dd8`).
Worktree: `~/.cursor/worktrees/enh-ws1-ce3cddfc/PLX_MC-feat-enhancements-2a03bb03d623`.

## What changed (file list)

### Source
- `src/lib/mc-data/data.ts` — replaced the fabricated roster (`HUMANS` + `DIRECTORY_EXTRA`)
  with the **six real people** resolved from M365 Graph; removed `DIRECTORY_EXTRA`;
  `ACTORS = {...HUMANS, ...AGENTS}`; seeded every go-live task with
  `accountableOwner: "vince"`; added the **Accountable Owner** person column to the
  `ToDos` system-of-record (`SP_LISTS`).
- `src/lib/mc-data/types.ts` — `Task` gains `accountableOwner: string | null` and
  `humanOnly?: boolean`.
- `src/lib/mc-data/policy.ts` — **new** pure policy module (shared by client + server):
  `isAgentId`, `hasHumanAccountableOwner`, `assignmentViolation`, `stageAdvanceViolation`,
  `ACCOUNTABLE_GATE_STAGE`.
- `src/lib/mc-data/index.ts` — export the policy barrel.
- `src/lib/mc-data/store.ts` — `directory()` now sorts by role → online → name (no
  hardcoded id list); `NewTaskInput`/`addTask` carry `accountableOwner` + `humanOnly`
  (agent executor clamped on human-only); `TaskFieldPatch` adds the two fields;
  `patchTaskFields` enforces the stage gate; `reassignTask` enforces the human-only
  gate; new `setAccountableOwner` / `setHumanOnly` wrappers.
- `src/lib/sync/state.ts` — `CreateTaskInput`/`createTask` + `PatchTaskInput`/`patchTask`
  carry the two fields (DB-only tier); `patchTask` throws `ApiError`
  (`human_only_violation` / `stage_blocked`, 409) in lockstep with the client.
- `src/app/api/tasks/route.ts`, `src/app/api/tasks/[id]/route.ts` — zod schemas accept
  `accountableOwner` (nullable) + `humanOnly`.
- `src/components/mc/people-picker.tsx` — removed hardcoded `CORE_TEAM_IDS`; one
  role/online-ordered **Directory** group; agents still gated by `allowAgents`.
- `src/components/mc/new-task-modal.tsx` — **Accountable owner** picker (human-only) +
  **Executor** picker + **human-only toggle** that drives `allowAgents` on the executor.
- `src/components/mc/task-detail.tsx` — surfaces accountable owner (human-only picker) vs
  executor; human-only toggle; executor picker honors `task.humanOnly`. The lifecycle
  rail's stage gate is enforced via the store (blocked moves raise a non-silent notice).
- `src/components/mc/bucket-detail.tsx` — relabeled bucket **Owner → Accountable owner**
  (the existing `bucket.owner` is the accountable human per the aligned decision).
- `src/lib/sync/mapping.ts` — comment only: person columns (now incl. Accountable Owner)
  remain the deferred directory increment.
- `config/sharepoint-schema.json` — added the `AccountableOwner` person column to `todos`.

### Tests
- `tests/mc-accountability.test.ts` — **new**: directory truth (no fakes), `directory()`
  ordering, all policy predicates, human-only + accountable-owner + completion gates via
  the store, and the Accountable Owner SoR column.
- `tests/mc-patch.test.ts` — server round-trip of `accountableOwner`/`humanOnly` (DB-only)
  + server-side gate enforcement (`stage_blocked`, `human_only_violation`).
- `tests/sync-mapping.test.ts`, `tests/mc-data.test.ts`, `tests/mc-views.test.ts`,
  `tests/mc-insights.test.ts`, `tests/mc-store.test.ts`, `tests/api-route.test.ts` —
  updated fixtures that referenced removed fake people to the real directory ids and
  added the now-required `accountableOwner` field.

### Scripts
- `scripts/resolve-directory.mjs` — **new** documented Graph resolver (deliverable F).

## Directory identities used

Resolved via `scripts/resolve-directory.mjs` (Microsoft Graph client-credentials,
`/users` startswith search) on 2026-06-17. **All six are Graph-confirmed
`@petrasoap.com` identities — none are placeholders.**

| id | name | email | role | dept | source |
|---|---|---|---|---|---|
| greg | Greg Mitchell | greg.m@petrasoap.com | Contributor (no Graph jobTitle) | Marketing | Graph-confirmed |
| rishi | Rishi | rishi@petrasoap.com | Contributor (no Graph jobTitle) | — (Graph dept empty) | Graph-confirmed |
| ricardo | Ricardo Savelli Fuzito | ricardo@petrasoap.com | Contributor (no Graph jobTitle) | Production | Graph-confirmed |
| stephen | Stephen Alton | stephen@petrasoap.com | Operations Director (from Graph jobTitle "CM Operations Director and Private Brands GM") | IT | Graph-confirmed |
| ross | Ross Pennino | ross@petrasoap.com | Contributor (no Graph jobTitle) | Customer Service | Graph-confirmed |
| vince | Vince Alton | vince@petrasoap.com | Owner (operator) | IT | Graph-confirmed |

Notes / honest caveats:
- **Roles**: only Stephen has a Graph `jobTitle`; Vince is the operator (Owner per spec).
  The other four have no Graph `jobTitle`, so they use the honest default **"Contributor"**
  (no invented titles).
- **`online`**: presence is not wired. Only the signed-in operator (`vince`) is shown
  present; everyone else is `online: false` (no fabricated presence).
- **`accountableOwner` on seed tasks**: set to `vince` uniformly — he owns the PLX Portal
  go-live plan (every bucket is `owner: vince`). The Shopify→BC tasks reference Greg/Stephen
  in their descriptions but stay `assignee: null` pending owner confirmation; accountability
  is vince until reassigned.

## Key design decisions

- **`accountableOwner: string | null`** (not bare `string`): null models the "no owner yet"
  state the gate enforces, mirroring the existing `assignee: string | null`. The gate
  (`lib/mc-data/policy.ts`) blocks advancing past `planned` without a human owner.
- **Completion gate**: reuses `evidenceComplete` — a task with an evidence bundle cannot
  reach `merged`/`verified` until the bundle is complete; a task with no bundle is
  unaffected (matches the existing `deriveEvidenceProgress` "no checklist ⇒ ready").
- **Enforcement is shared & symmetric**: one pure `policy.ts`, called by the client store
  and the server `patchTask`, so client and server never diverge.

## Deferred (with rationale)

- **F (Graph resolver script): DELIVERED** — `scripts/resolve-directory.mjs`, documented,
  run to produce the table above.
- **G (SharePoint person-column mapping): PARTIALLY DELIVERED, push deferred.**
  - Done: the **Accountable Owner** person column is now defined in the system-of-record
    (`config/sharepoint-schema.json` + `SP_LISTS`), the same way `Assigned To` / `Reporter`
    are already defined.
  - **Deferred (TODO)**: wiring the *actual* two-way person-column push/pull in
    `src/lib/sync/mapping.ts`. The whole codebase intentionally treats person columns as a
    single **deferred directory increment** — `mapping.ts` never emits them, and the honest
    "Assigned To mirror deferred to the directory increment" audit/activity narrative is
    pinned by multiple existing tests (`tests/mc-store.test.ts`, `tests/sync-mapping.test.ts`).
    Flipping that for one column would be a cross-cutting change beyond "if clean", so per
    the WS-1 instructions it is left as a clear TODO rather than half-wired or faked. WS-1's
    mandate — a *truthful* directory + the accountability model — is complete; the person
    push is the next sync increment, and it should land for Assigned To + Accountable Owner
    + Reporter together.

## Pre-existing issue (NOT introduced by WS-1)

- `npm run lint` reports one error in `src/components/mc/shell.tsx:134`
  (`react-hooks/set-state-in-effect`). That file is **untouched** by WS-1 and the error
  exists on the base branch. The canonical gate (`scripts/preflight.sh`) does not run
  ESLint and passes clean. Left as-is (surgical scope).

## Verification

```text
$ npm run typecheck
> tsc --noEmit
(clean, exit 0)

$ npm run test
 Test Files  18 passed (18)
      Tests  257 passed (257)       # baseline 235 + 22 new/extended, all green

$ npm run build
✓ Compiled successfully in 1334ms
  Finished TypeScript in 2.1s
✓ Generating static pages (7/7)
(exit 0)

$ ./scripts/preflight.sh --mode pre-commit
=== [preflight] Governance alignment (contract -> surfaces) === aligned
=== [preflight] Repo hygiene === clean
=== [preflight] Migration numbering === clean (4 files)
=== [preflight] Python lint (ruff check) === All checks passed!
=== [preflight] Python format === 6 files already formatted
=== [preflight] Canary tests === 4 passed
=== [preflight] TypeScript typecheck === clean
=== [preflight] All pre-commit checks passed ===
```

Heavy Playwright E2E (`--mode pre-push`) was **skipped** per the WS-1 instructions.
