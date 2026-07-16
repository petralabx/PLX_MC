# P2 — Self-check honesty oracle (thin v1)

**Branch:** `proj/honesty-oracle/phase-2-self-check-thin`  
**Base:** `proj/honesty-oracle/phase-1-arch-docs` @ `3da2b17`  
**MC:** TASK-490 · `MC-Checkout: dsp_mrnrxfuu6eu8lh` · owner Vince  
**Date:** 2026-07-16

## What shipped

Extended `actionSelfCheck` (`src/lib/mcp/actions.ts`) via new
`src/lib/mcp/honesty.ts`. `GET /api/cursor/self-check` already delegates to
`actionSelfCheck`, so the REST envelope picks up the same fields with no route
change.

Local-only honesty fields (no Graph network probe):

| Field | Source |
|---|---|
| `syncMode` | `"in-app"` if `PLX_MC_SYNC_ENABLED===1`; else `"cron"` if `CRON_SECRET` set; else `"off"` |
| `cronConfigured` | `cronConfigured()` from `src/lib/secrets.ts` |
| `syncEnabled` | `syncEnabled()` from `src/lib/sync/scheduler.ts` |
| `databaseBound` | non-empty `PLX_MC_DATABASE_URL` |
| `lastSweepAgeMs` | age of `snapshot().lastSweep` in ms, or `null` if missing/invalid |
| `freshness` | full `SyncFreshnessResult` from `evaluateSyncFreshness` over `ROUTING_REQUIRED_REGISTERS` loaded via `getRegisterInboundCompletions()` |
| `webhooksEnabled` | `graphWebhookEnabled() && graphWebhookConfigured()` (default false) |
| `mcpEnabled` | `mcpEnabled()` from env `PLX_MC_MCP_ENABLED` — **not** hardcoded `true` |
| `dataSource` | `"seed"` \| `"live"` — see discriminator below |

Legacy fields retained: `ok`, `operator`, `taskCount`, `bucketCount`, `lastSweep`.

## `freshness` shape

Same as `SyncFreshnessResult` (`src/lib/sync/freshness.ts`):

```ts
{
  ok: boolean;
  code: "ok" | "sync_stale";
  maxAgeMs: number;
  checkedAt: string; // ISO
  registers: Array<{
    listKey: string;
    lastCompleteInboundAt: string | null;
    ageMs: number | null;
    ok: boolean;
    reason: "fresh" | "missing_register" | "stale_register";
  }>;
  reasons: string[]; // e.g. "missing_register:projects"
}
```

Required registers: `projects`, `roadmap`, `todos` (`ROUTING_REQUIRED_REGISTERS`).

## `dataSource` discriminator (hard gate)

- **`live`**: any required register has `lastCompleteInboundAt != null` in the
  freshness evaluation (i.e. `sync_register_freshness` recorded a completed
  inbound delta for that register).
- **`seed`**: otherwise — including a freshly `ensureSeeded()` DB with zero
  inbound-delta stamps.

P4 will tighten `live` to also require an acquirable Graph token (`graphTokenOk`).

## Example self-check JSON (`data` payload)

```json
{
  "ok": true,
  "operator": "vince@petrasoap.com",
  "taskCount": 3,
  "bucketCount": 1,
  "lastSweep": "2026-07-16T12:00:00.000Z",
  "syncMode": "off",
  "cronConfigured": false,
  "syncEnabled": false,
  "databaseBound": false,
  "lastSweepAgeMs": 21600000,
  "freshness": {
    "ok": false,
    "code": "sync_stale",
    "maxAgeMs": 360000,
    "checkedAt": "2026-07-16T18:00:00.000Z",
    "registers": [
      {
        "listKey": "projects",
        "lastCompleteInboundAt": null,
        "ageMs": null,
        "ok": false,
        "reason": "missing_register"
      },
      {
        "listKey": "roadmap",
        "lastCompleteInboundAt": null,
        "ageMs": null,
        "ok": false,
        "reason": "missing_register"
      },
      {
        "listKey": "todos",
        "lastCompleteInboundAt": null,
        "ageMs": null,
        "ok": false,
        "reason": "missing_register"
      }
    ],
    "reasons": [
      "missing_register:projects",
      "missing_register:roadmap",
      "missing_register:todos"
    ]
  },
  "webhooksEnabled": false,
  "mcpEnabled": false,
  "dataSource": "seed"
}
```

## Verification

```text
npx vitest run tests/mcp-self-check-honesty.test.ts  → exit 0 (8 tests)
npm run typecheck                                      → exit 0
git diff --check                                       → exit 0
```

Hard gate test: empty `sync_register_freshness` → `dataSource: "seed"` and all
honesty fields present; `mcpEnabled` false when env is `"0"`.

## Owns / forbidden

Touched only: `src/lib/mcp/**`, `tests/**`, `.orchestrator/honesty-oracle/P2/**`.  
Did not touch: `vercel.json`, `AGENTS.md`, `package.json`, `package-lock.json`,
`.cursor/mcp.json`, `src/lib/sync/engine.ts`.
