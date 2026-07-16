# P7 — Arch parity + mirror-boring gate

MC: TASK-490 · MC-Checkout: dsp_mrnrxfuu6eu8lh · owner Vince
Branch: proj/honesty-oracle/phase-7-arch-parity
Base: merge of P1 (3da2b17) + P2 (d0ffdc8) + P3 (04f6d19)

## Changes

1. `scripts/check-arch-parity.py` — fails if AGENTS.md sync-maturity cells drift
   from TOOLS.md (delta current / Graph change-notifications deferred P11);
   forbids recurrence of `Sync engine (planned)`.
2. `scripts/preflight.sh` — wires arch parity into `run_policy` (every
   pre-commit / pre-push / ci mode).
3. `AGENTS.md` — Mirror Is Boring Entry Gate (schema-green + parity-in-CI +
   N consecutive green cron ticks, default **N=7**); conflict SLO warning-only
   until volume exists.
4. `SOUL.md` — non-negotiable summary pointing at the AGENTS.md gate.
5. `tests/test_check_arch_parity.py` — exit-code behavior + committed-docs pass.

## Forbidden paths

Not touched: `src/lib/sync/engine.ts`, `package.json`, `package-lock.json`,
`.cursor/mcp.json`, `vercel.json`, `TOOLS.md`.

## Acceptance

- `python scripts/check-arch-parity.py` → exit 0, `arch parity clean`
- gate-text assert → `P7 gate text ok`
- `git diff --check` → clean
- `pytest tests/test_check_arch_parity.py` → 6 passed
