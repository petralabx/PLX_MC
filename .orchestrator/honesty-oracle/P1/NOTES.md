# P1 NOTES — Architecture table + deferred webhook labels

## Change
- AGENTS.md: replaced "Sync engine (planned)" with delta **current** + Graph change-notifications **deferred (P11)**.
- AGENTS.md runtime entry points: delta sweep current; subscription/notification queue deferred P11.
- TOOLS.md: new section documenting sync-subscriptions / sync-notifications as gated P11 scaffolding.

## Acceptance
`python -c "..."` → P1 docs ok
`git diff --check` → clean

## MC
TASK-490 · MC-Checkout: dsp_mrnrxfuu6eu8lh · owner Vince
