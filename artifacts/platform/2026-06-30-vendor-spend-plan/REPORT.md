# Vendor Spend (AI Spend) — Project Plan Bundle

## Summary

Placeholder **AI Spend** screen added to Mission Control (System of record sidebar).
Full vendor spend observatory deferred; execution contract captured in `SPEC.md`.

## Deliverables in this bundle

| Item | Location |
|---|---|
| Execution spec (5-phase DAG) | [SPEC.md](SPEC.md) |
| Bundle index | [index.md](index.md) |
| Placeholder UI | `src/components/mc/ai-spend.tsx` (committed separately) |

## Decisions locked (Stage 0)

- Audience: engineering ops + finance
- v1 automated vendors: AWS, Anthropic, Cursor
- Budgets: monthly per vendor; filters MTD / weekly / quarterly / YTD
- Alerts v1: in-app only; email/Teams follow-up deferred
- Scope v1: company-wide

## Next step

Execute via project-orchestrator against `SPEC.md` when prioritized.
