# P3 — Cron cadence cleanup

MC: TASK-490 · MC-Checkout: dsp_mrnrxfuu6eu8lh · owner Vince
Branch: proj/honesty-oracle/phase-3-cron-cleanup
Base: 3da2b17 (proj/honesty-oracle/phase-1-arch-docs)

## Changes

1. `vercel.json`: demoted `/api/cron/sync-notifications` from `* * * * *` (every minute) to `0 * * * *` (hourly). Scaffolding stays registered; matches `sync-subscriptions` cadence until P11.
2. Routes unchanged — both `sync-notifications` and `sync-subscriptions` still return `enabled: false` when `graphWebhookEnabled()` / `graphWebhookConfigured()` are not both true (confirmed in-tree; no route code edits).
3. `TOOLS.md`: strengthened deferred-P11 section to document hourly schedules and the intentional demotion of the every-minute no-op.

## Forbidden paths

Not touched: `src/lib/sync/engine.ts`, `package.json`, `package-lock.json`, `.cursor/mcp.json`.

## Acceptance

- `python -c "...P3 cron ok"` → exit 0, printed `P3 cron ok`
- `git diff --check` → exit 0
