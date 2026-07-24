# Kickoff — Design System + Governance Cloud Enforcement

**Date:** 2026-07-24  
**Bucket:** `BKT-MISSION-CONTROL-OPS`  
**Accountable owner:** Vince  
**Agent runtime:** cursor-cloud (`bc-ac2127f2-cc87-4c48-9746-40925d4e4f06`)  
**Checkout:** `MC-Checkout: dsp_mryvrl8gj222kz` (TASK-681)

## Why

Cursor Cloud Agents were not enforcing PLX Design System or governance contracts because:

1. Multi-repo Cloud sessions always-apply only thin cross-repo team rules; PLX_MC `governance.mdc` / design rules stay repo-scoped.
2. Design-system authority + propagation ADR remains **PROPOSED** (no `design-system/` package, no `plx-brand.json` pin on MC, no adopt workflows).
3. PLX-MC MCP ships default-OFF and was not available in Cloud agent MCP catalogs without secret hydrate.

## Decision

Kick off as an **MC task program** under `BKT-MISSION-CONTROL-OPS` (MCP cannot create Projects/Buckets). Use `project-orchestrator` only for the heavy repo phases (portal P1, MC P2), not one cross-repo mega run.

Sequence: **Cloud wiring → Portal authority → MC pin → hold auto-adopt**.

## MC tasks created

| Task | Title | Stage |
|---|---|---|
| [TASK-681](https://mc.plxcustomer.io/tasks/TASK-681) | Draft SPEC + lock open ADR decisions | planned (checked out) |
| [TASK-682](https://mc.plxcustomer.io/tasks/TASK-682) | Cloud wiring: fleet always-apply + PLX-MC MCP | backlog |
| [TASK-683](https://mc.plxcustomer.io/tasks/TASK-683) | Portal P1: design-system authority package (ADR-005) | backlog |
| [TASK-684](https://mc.plxcustomer.io/tasks/TASK-684) | PLX_MC P2: plx-brand.json pin + sync + parity | backlog |
| [TASK-685](https://mc.plxcustomer.io/tasks/TASK-685) | P3 hold: adopt/decline automation | backlog |

## Artifacts

| Path | Role |
|---|---|
| `.orchestrator/ds-gov-cloud-enforcement/SPEC.md` | Draft program SPEC (needs Vince approval) |
| `artifacts/platform/2026-07-24-ds-gov-cloud-enforcement/` | Kickoff evidence bundle |

## Operator next steps

1. Review/approve SPEC (set `status: approved` + `approved_by` / `approved_at`).
2. Optionally create a UI-only MC **Project** umbrella linking TASK-681..685.
3. Lock or confirm open ADR defaults in the SPEC table (channel, auth, semver, auto-adopt).
4. After approval: execute P1 Cloud wiring, then portal orchestrator for TASK-683, then MC orchestrator for TASK-684. Leave TASK-685 blocked.

## Verification (this kickoff)

- MC self-check: `ok: true`, `mcpEnabled: true`, `boringGateMet: true` (2026-07-24T11:51Z)
- Tasks created via `POST /api/cursor/tasks`
- Checkout minted for TASK-681: `dsp_mryvrl8gj222kz`
- `spec-validate.sh` run against SPEC (see commit / CI notes)
