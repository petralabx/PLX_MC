# Design-system adopt/decline automation (ADR-005 P4)

**Owner:** Vince · **Task:** TASK-685 · **Policy:** human-gate all (`autoAdopt: never`)

## Flow

1. Portal cuts a new `design-system/` version on `staging` (release gate green).
2. `design-system-release.yml` dispatches `plx-ds-update` to each `consumers.yaml` adopting repo using `PLX_DS_DISPATCH_TOKEN`.
3. Consumer `design-system-adopt.yml` opens a labeled PR (`design-system-update`) with synced mirrors + bumped pin.
4. Human **merges** = ADOPT · **closes** = DECLINE (ledger PR via `design-system-decline.yml`).

## Secrets (operator)

| Secret | Where | Value |
|---|---|---|
| `PLX_DS_DISPATCH_TOKEN` | `petralabx/plx-customer-portal` Actions | Fine-grained PAT with access to adopting repos (`contents: write` so `repository_dispatch` works). Use the org `PETRALABX_GITHUB_TOKEN` class. |

Kill switch: delete the secret, set `config/design-system-adopt-policy.json` `enabled: false`, or disable the workflows.

## Manual test (consumer)

Actions → **design-system-adopt** → Run workflow with version/integrity from portal `design-system/manifest.json`.

## Local scripts

```bash
# Authority dry-run fan-out
python3 scripts/dispatch-design-system-update.py --dry-run   # in portal repo

# Prepare adopt tree locally
python3 scripts/plx-ds-prepare-adopt.py \
  --authority-root ../plx-customer-portal \
  --version 1.0.1 \
  --integrity sha256-…

# Record decline ledger
python3 scripts/plx-ds-record-decline.py --version 1.0.1 --reason "defer"
```
