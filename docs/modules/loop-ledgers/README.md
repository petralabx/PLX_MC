# Module: loop-ledgers

## What

Read-only cross-repo hardening-ledger observatory for Mission Control. The module
reads committed `vmc-quality-ledger/v1` artifact ledgers from a seeded registry,
validates them, and exposes a scariest-first index, per-module detail view, and
degraded-state gallery. It is **not** a writer or mutator — no sync, repair,
rerun, or source-ledger edit affordances exist anywhere in the stack.

The registry seeds three repos: `petralabx/agentic-swarm` (main,
`docs/vmc/quality-ledger/*.artifacts.json`), `petralabx/PLX_MC` (main,
`docs/plx-mc/quality-ledger/*.artifacts.json`), and `petralabx/plx-customer-portal`
(staging, `docs/portal/quality-ledger/*.artifacts.json`). Missing, stale, invalid,
or unreachable sources render as loud degraded rows — they are never hidden or
filtered out.

New repos and modules adopt the **one canonical, versioned template** at
`docs/templates/quality-ledger/` (`TEMPLATE.md` + `example.artifacts.json`) so every
consumer publishes the same `vmc-quality-ledger/v1` shape with no schema drift. That
template is the cross-repo contract this module reads.

## Why

Operators need the true quality posture across repos before running more
hardening loops. Without a single read-only lens, stale ledgers, schema drift,
and unreachable private repos stay invisible until someone manually checks each
repo. Loop Ledgers makes every failure mode visible and scariest-first so the
worst problems surface first.

## How

1. **Registry** — `config/loop-ledgers-registry.json` (`plx-loop-ledger-registry/v1`)
   lists repo entries (glob, branch, evidence dir). Parsed by `parseRegistryConfig`.
2. **LedgerSource** — `createSource()` returns `GithubApiSource` in all environments
   (GitHub Trees + Contents API via `resolveGithubToken({ repoOwner })` from
   **github-app**). `LocalFsSource` is dev/test-only (allowlisted roots, traversal
   rejection, disabled in production).
3. **Validator** — `validateLedgerRaw` enforces `vmc-quality-ledger/v1` invariants:
   schema version match, count reconciliation, unique `artifact_id`, enum/range
   checks, `verified` requires evidence, freshness ≤7d/≤30d/stale. Never throws.
4. **Loader** — `listLedgerSummaries` and `getLedgerDetail` batch over the source;
   one repo failing never kills the batch; degraded rows stay in the output list,
   sorted scariest-first via `sortByScariest`.
5. **API** — `GET /api/loop-ledgers` (list) and `GET /api/loop-ledgers/[ref]` (detail)
   go through the shared `route()` wrapper, return the standard `{ data }` /
   `{ error }` envelope, and are auth-gated by middleware (no handler-level auth).
   Degraded detail returns `{ data: { ok: false, ... } }` at 200 — visible, not hidden.
6. **UI** — `LoopLedgersView` in the MC shell (`Screen = "loop-ledgers"`, sidebar
   "System of record" group) fetches via the shared `api()` wrapper, renders index +
   detail + degraded gallery with `--p-*` tokens only (`mc-loop-ledgers.css`).

```
registry.json → LedgerSource (github-api | local-fs) → validator → loader
    → GET /api/loop-ledgers[*] → LoopLedgersView (index | detail | degraded)
```

## Dependencies

Depends on: **web** (MC shell, shared `api()` + `route()` wrappers, middleware auth),
**design-system** (`--p-*` tokens behind `.brand-plx`), **github-app**
(`resolveGithubToken({ repoOwner })`). Depended on by: nothing yet — read-only
observability only.

### Key Files

- `src/lib/loop-ledgers/` — domain module (types, validator, registry, sources, loader, barrel `index.ts`)
- `config/loop-ledgers-registry.json` — seeded three-repo registry (no secrets)
- `src/app/api/loop-ledgers/` — read-only list + detail API routes
- `src/components/mc/loop-ledgers/` — index, detail, and degraded gallery views
- `src/styles/mc-loop-ledgers.css` — screen styles (`--p-*` tokens only)

## Owner

Vince

## Criticality

Medium
