# Code Review — Inbox/shell increment + parallel-lane substrate

Date: 2026-06-10 (ET) · Reviewer: founding-session agent · Scope: `main` at
`2c99d13` (commits `4cc894f` Inbox/shell, `2c99d13` substrate). The five screen
lanes were still in flight in isolated worktrees and are reviewed at their own
integration time.

## Verification evidence

- `npm run typecheck` → exit 0
- `npm run test` → exit 0 (3 files, 23 tests)
- `./scripts/preflight.sh --mode pre-push` → exit 0 at push time (hook-enforced)
- CI on `2c99d13` → success
- No `console.*` / `debugger` / `TODO` markers in `src/`

## Findings (by severity)

No high-severity bugs or security issues found. Mediums are deferred-behavior
gaps that become user-visible as lane screens land; each has a named owner
moment.

### M1 — Inbox unread state is fixture-static

`INBOX` lives only in `src/lib/mc-data/data.ts`; there is no store action to
mark notifications read, so the topbar/sidebar unread badge can never clear.
Prototype parity today, but once Task detail lands (notification rows navigate
there), users will expect the dot to clear.
**Action:** add a `markRead(notificationId)` store action when Task detail
integrates. Owner: integration of Lane B.

### M2 — `resolveConflict` only updates Task entities

`store.ts` clears the queue entry and register counts for any conflict, but
only Task entities get their `sync` ref flipped (risks are not held in store
state at all). Resolving `cf-risk1` updates counts/audit while RISK-1's
rendered sync tick (Bucket detail, Lane E) would still show its fixture state.
Mirrors the prototype's own modeling, but the inconsistency becomes visible
once risks render.
**Action:** when Lane D/E integrate, either move `RISKS` into store state or
scope risk conflict resolution accordingly. Owner: integration of Lanes D/E.

### M3 — Persistence covers only user-created tasks (stated, but easy to misread)

`localStorage` persists user-created tasks and invited people; sweeps,
conflict resolutions, and reassignment of fixture tasks reset on reload. This
is intentional prototype-fidelity (the seed is an immutable demo fixture), and
`store.ts` says so — but the behavior should be re-stated in the demo script /
README when the app is shown to stakeholders, or it reads as data loss.
**Action:** none in code; covered when the sync engine replaces the store.

### L1 — Clickable spans without keyboard semantics

`Assignee` / `.unassigned` in `atoms.tsx` accept `onClick` on `<span>` (ported
from the prototype). No keyboard activation or role. Fine while inert;
should become buttons when Lane C wires the picker.

### L2 — `SYNC_REGISTERS` shares `counts` object references with `SP_LISTS`

Derived with `counts: l.counts`. Safe today because the store deep-clones and
nothing mutates fixtures, but a future direct mutation of one would silently
mutate the other. A `structuredClone` (or `Object.freeze` on fixtures) would
make the invariant mechanical instead of conventional.

### L3 — Test gap: `hydrateFromStorage`

The corrupt-payload and duplicate-id guards in `hydrateFromStorage` are
untested (everything else on the store has exit-path coverage). Low risk —
guards are simple — but it is the one store entry point without a test.

### L4 — Hardcoded inbound simulation

`applyInbound` targets TASK-188 by id. Faithful to the prototype's demo sweep
and documented inline; listed here so nobody mistakes it for engine logic.

## Process notes (no action)

- The five lane branches all forked from `2c99d13`, after the substrate — no
  lane is building against stale contracts.
- `screens.tsx` is the single intentional merge-conflict surface; conflicts
  there are one-line and resolved at integration.

## Verdict

Substrate is sound to integrate against. Mediums are tracked to named
integration moments rather than fixed speculatively now (per Simplify
Relentlessly — the fixes belong with the code that makes them observable).
