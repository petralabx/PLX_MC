# P4-UNBLOCKED — Adopt/decline automation

**Date:** 2026-07-24  
**Unlocked by:** Vince (chat authorization — “I merged it and I want to adopt the automation”)  
**Task:** TASK-685 · Checkout `dsp_mryz9sz5jp0d8b`  
**Prerequisites proven:** TASK-682 Cloud wiring · TASK-683 portal #401 · TASK-684 MC pin #163

## Policy locks (SPEC defaults — locked)

| Decision | Lock |
|---|---|
| Release channel | `staging` |
| Cross-repo auth | Fine-grained org PAT `PLX_DS_DISPATCH_TOKEN` (= `PETRALABX_GITHUB_TOKEN` class) for authority→consumer `repository_dispatch`; consumer PRs use repo `GITHUB_TOKEN` |
| Semver | major = remove/rename token; minor = add; patch = value tweak |
| Agent auto-adopt | **Human-gate all** for v1 (`autoAdopt: never`) |

## Scope unlocked

1. Authority fan-out on `design-system/**` push to `staging` (`plx-ds-update` dispatch).
2. Consumer `design-system-adopt.yml` opens labeled ADOPT/DECLINE PRs (no auto-merge).
3. Decline close-path records ledger lines in `design-system/SYNC-LOG.md`.
4. Kill switch: remove `PLX_DS_DISPATCH_TOKEN` / disable workflows / set consumer policy `enabled: false`.

## Out of scope (later)

- Auto-merge patch/minor
- Dedicated GitHub App with contents:write (may replace PAT)
- Fan-out beyond `consumers.yaml` adopting list
