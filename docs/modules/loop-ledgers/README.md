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

### Bucket projection

Initiative buckets can bind to one or more quality-ledger modules so the bucket
detail screen shows ledger-derived **Milestone** and **Trace** rows without a
second system of record. The quality ledger stays authoritative; MC is a read
lens; projection is **ephemeral read-time derivation** — nothing is written to
the database, SharePoint, or the source ledger.

1. **Binding config** — `config/bucket-ledger-map.json` (`plx-bucket-ledger-map/v1`)
   lists `{ bucket, repo, module }` tuples. Parsed by `parseBucketLedgerMapJson`;
   `bindingsForBucket(config, bucketId)` returns all bindings for one initiative.
   Example (seeded):

   ```json
   {
     "schema_version": "plx-bucket-ledger-map/v1",
     "bindings": [
       {
         "bucket": "BKT-FIN",
         "repo": "petralabx/plx-customer-portal",
         "module": "finance-business-central"
       },
       {
         "bucket": "BKT-WMS",
         "repo": "petralabx/plx-customer-portal",
         "module": "mrp-wms"
       }
     ]
   }
   ```

2. **Loader + merge** — `GET /api/loop-ledgers/bucket/[bucketId]` reads the map,
   loads only bound repos via `listLedgerSummaries`, and merges per-binding output
   with `projectBucketFromRows`. Unbound buckets return `{ bound: false }`. Multi-binding
   buckets merge milestones and trace rows; each binding contributes a `sources` entry.

3. **Milestone projection** (`projectMilestones`) — one row per artifact with a
   non-empty `next_action` whose status is not terminal (`verified`, `covered`,
   `waived`). Sorted scariest-first (same ranking as the Loop Ledgers index).
   Ledger milestones are list-only (`col: 0`), provenance `sp: "Quality Ledger · <module>"`,
   id `LM-<module>-<artifact_id>`. State is `risk` when `safety_class === "red"` or
   status is `broken` / `partially_broken` / `blocked`; otherwise `now`.

4. **Trace projection** (`projectTrace`) — one `TraceRow` per artifact (`req =
   artifact_id`; `tasks`, `prs`, `merge` stay empty — the ledger carries no MC
   linkage). Evidence is `complete` when the artifact has evidence entries,
   else `incomplete`; `test` is the first `tests_existing` entry or `—`.

   | Artifact status | Trace `status` |
   |---|---|
   | `verified`, `covered`, `waived` | `satisfied` |
   | `fixed_pending_regression`, `works_observed` | `in-review` |
   | `missing_test`, `deferred` | `in-progress` |
   | `broken`, `partially_broken`, `blocked`, `unknown` | `gap` |

5. **Degraded behavior** — a binding whose repo is unreachable, whose ledger fails
   validation, or whose module is missing **never fabricates rows**. Instead
   `sources[]` carries `{ repo, module, degraded: "<reason>" }` at HTTP 200.
   Valid bindings still contribute rows; the initiative UI renders degraded notes
   as muted provenance alongside ledger milestones/trace (`Quality Ledger · read-only`).

6. **Initiative UI** — `bucket-detail.tsx` fetches the projection, merges ledger
   milestones with fixture milestones, and uses ledger trace when no fixture matrix
   exists for that bucket. Unbound buckets are unchanged.

7. **Rollback** — set `bindings` to `[]` in `config/bucket-ledger-map.json` to
   disable projection instantly (all buckets behave as unbound).

```
bucket-ledger-map.json → bindingsForBucket → listLedgerSummaries (bound repos only)
    → projectMilestones + projectTrace → projectBucketFromRows
    → GET /api/loop-ledgers/bucket/[bucketId] → bucket-detail (merge + degraded notes)
```

## Dependencies

Depends on: **web** (MC shell, shared `api()` + `route()` wrappers, middleware auth),
**design-system** (`--p-*` tokens behind `.brand-plx`), **github-app**
(`resolveGithubToken({ repoOwner })`), **mc-data** (Milestone / Trace shapes for
projection). Depended on by: initiative bucket detail (ledger projection merge).

### Key Files

- `src/lib/loop-ledgers/` — domain module (types, validator, registry, sources, loader, projection, barrel `index.ts`)
- `config/loop-ledgers-registry.json` — seeded three-repo registry (no secrets)
- `config/bucket-ledger-map.json` — bucket→ledger bindings (`plx-bucket-ledger-map/v1`)
- `src/app/api/loop-ledgers/` — read-only list, detail, and bucket projection routes
- `src/app/api/loop-ledgers/bucket/[bucketId]/` — bucket projection endpoint
- `src/components/mc/loop-ledgers/` — index, detail, and degraded gallery views
- `src/components/mc/bucket-detail.tsx` — merges ledger milestones/trace on initiative pages
- `src/styles/mc-loop-ledgers.css` — screen styles (`--p-*` tokens only)

## Owner

Vince

## Criticality

Medium
