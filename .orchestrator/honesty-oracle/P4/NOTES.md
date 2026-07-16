# P4 — Self-check full Graph probe

**Branch:** `proj/honesty-oracle/phase-4-self-check-full`
**Base:** `proj/honesty-oracle/phase-2-self-check-thin` @ `d0ffdc805cd12b66d866100930cb6338922d663e`
**MC:** TASK-490 · `MC-Checkout: dsp_mrnrxfuu6eu8lh` · owner Vince
**Date:** 2026-07-16

## What shipped

Extended the honesty oracle with a fail-soft Graph health probe and tightened
`dataSource` so `live` cannot be claimed without an acquirable token.

| Field / change | Behavior |
|---|---|
| `graphTokenOk` | `probeGraphTokenOk()` — same sweep-start health shape: token acquisition + `siteContext()` site/list resolution; 8s timeout; catch-all → `false`; never throws into self-check |
| `dataSource` | `"live"` only when **any** required register has `lastCompleteInboundAt` **and** `graphTokenOk`; otherwise `"seed"` (prefer seed when either leg missing) |
| `buildHonestyFields` | Accepts injectable `probeGraphToken` for tests; wraps default probe in try/catch |

`GET /api/cursor/self-check` / `actionSelfCheck` pick up `graphTokenOk` via the
existing honesty field spread — no route change.

## Probe implementation

`src/lib/sync/graph.ts`:

- `probeGraphTokenOk({ timeoutMs?, resolveSite? })` — races `siteContext()`
  (or injectable resolver) against a timeout; returns `boolean`.
- `GRAPH_TOKEN_PROBE_TIMEOUT_MS = 8000`
- `clearSiteContextCache()` test/ops seam for the site+list cache

Exported from `src/lib/sync/index.ts`.

## `dataSource` discriminator (hard gate, P4)

- **`live`**: inbound delta stamp on a required register **and** `graphTokenOk === true`
- **`seed`**: otherwise (no inbound, probe failed/timeout/missing secrets, or both)

No intermediate status value — prefer `"seed"` when either evidence leg is missing.

## Verification

```text
npx vitest run tests/mcp-self-check-honesty.test.ts  → exit 0 (14 tests)
git diff --check                                       → exit 0
```

## Owns / forbidden

Touched only: `src/lib/mcp/**`, `src/lib/sync/**`, `tests/**`,
`.orchestrator/honesty-oracle/P4/**`.
Did not touch: `vercel.json`, `package.json`, `package-lock.json`,
`.cursor/mcp.json`, `AGENTS.md`.
