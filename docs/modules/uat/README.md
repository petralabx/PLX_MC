# Module: uat

## What

The User Acceptance Testing (UAT) contract between `plx-customer-portal` and
`PLX_MC`. It covers two kinds of work:

| Work | System of record | What MC does |
|---|---|---|
| **UAT feedback tickets**: a person files a bug in the portal and an agent fixes it | The portal's gold `Feedback` record (Prisma). SharePoint is a projection. | Mirrors each ticket attempt as one `BKT-UAT` task, shows the UAT tickets view, runs a daily drift check. |
| **UAT case runs**: SOP scenarios and go-live readiness | The portal `uat` quality ledger, `docs/portal/quality-ledger/uat.artifacts.json` | Reads it through Loop Ledgers. |

MC never authors a re-test result. UAT results are **PASS**, **FAIL** or
**unverified**, never Verified (Vince, 2026-10-26).

## Why

The fix loop has to be visible from both sides. The portal knows the ticket and
its re-test. MC knows the coding task, its lease and its PR. One contract keeps
the two from drifting: every open ticket has a holder and a next step, and MC
rollups count a fix as done only when the person who filed it confirmed it.

## How

### Ticket task contract

- **One task per ticket attempt** in `BKT-UAT`. Labels are `kind:code` +
  `uat:<feedbackId>` + `repo:petralabx/plx-customer-portal`, and `uat-attempt:<n>`
  from attempt 2 (`src/lib/tasks/uat-labels.ts`, `src/lib/tasks/uat-tickets.ts`).
- **The portal creates it** in backlog with no `lane:*`, with the idempotency key
  `uat-<feedbackId>` (or `uat-<feedbackId>-a<n>`). PLX Steward leases it. Agents
  find it by label and never create one.
- **State labels:** `uat:blocked` and `uat:cause:<cause>` (set by Steward),
  `uat:hold` (an open question, mirrored by the portal) and `needs-vince`.
  `uat:<id>` is one segment, so `uat:cause:*` never reads as a ticket.
- **Completion** needs `prUrl` unless the outcome is `blocked` or `failed`
  (`src/lib/mcp/actions.ts`). The check applies only while the task sits in
  `BKT-UAT`; a ticket task moved to another bucket is not held to it.

### Stages

| Stage | Meaning |
|---|---|
| backlog → progress | Steward leased it; the PR is open or being written. |
| merged | The fix is on `staging` and waits for the person's re-test. It stays open in rollups (`src/lib/mc-data/policy.ts`, `awaitsRetest`). |
| verified | The portal recorded the person's pass. Only the portal's `mc_update_task { verify }` sets it, under `task.uat_sync`; MCP refuses `stage: verified` from anyone else (`src/lib/mcp/actions.ts`). |
| cancelled | The portal cancels an obsolete, superseded or delivered-without-PR task. |

A PR merge never moves a verified task back (`src/lib/compliance/projection.ts`).
A task is promoted to merged only when its PR merges into the repo's integration
branch, `staging` for the portal.

### Portal → MC writes

The portal key holds `task.read`, `task.create`, `agent_report.read` and
`task.uat_sync` (`src/lib/permissions/grants.ts`). With `task.uat_sync` alone,
`mc_update_task` accepts only `verify`, `cancel` and the `uat:hold`,
`uat-attempt:<n>`, `kind:*` and closure labels, and only on UAT ticket tasks
(`src/lib/mcp/task-update-actions.ts`). The portal mirrors hold, re-attempt,
cancel and the re-test result from its reconcile sweep.

### Needs a human

A UAT ticket task counts as Needs a human when it carries `uat:blocked` or
`needs-vince`, as well as on the general rules (a pending approval gate, a
blocked flag, no human owner) (`src/components/mc/project-overview.helpers.ts`).

### UAT tickets view and drift check

- **View:** a block on the `BKT-UAT` bucket page (`src/components/mc/uat-tickets.tsx`,
  `GET /api/uat-tickets`). One row per ticket task filed in `BKT-UAT`, with lease, PR,
  holder and age. The table lists that bucket only, while the check below counts any
  bucket, so a moved task can appear in a finding with no row.
- **Drift check:** `src/lib/tasks/uat-tickets.ts` `findUatDrift` finds five
  cases. It counts a ticket's task in any bucket, not only `BKT-UAT` (TASK-3973). A daily cron (`/api/cron/uat-drift`, 10:00 UTC) records one
  `uat.drift.checked` event and fixes nothing.
- **Portal read:** the view and three of the five drift cases need the portal's
  ticket snapshot, `GET /api/internal/uat-feedback/mc-snapshot`, which the portal
  serves since 28 Oct (TASK-3798, portal PR #3052). While the read is off, only
  `duplicate_open_tasks` and `expired_lease_no_pr` can fire.
- **UAT scorecard:** after the drift check, the same cron pulls last week and this
  week from the portal's `GET /api/internal/uat-feedback/scorecard` for the UAT
  scorecard (`/?screen=uat-scorecard`, TASK-4196), which grades the fix loop week
  by week against the team's targets. Contract and targets:
  `docs/modules/uat-scorecard/README.md`.
- **Flags, both off by default** (`src/lib/secrets.ts`):
  `PLX_MC_UAT_PORTAL_READ_ENABLED` (needs `PLX_MC_PORTAL_READ_TOKEN`) and
  `PLX_MC_UAT_DRIFT_CRON_ENABLED`.

### UAT case runs

The `uat-runner` skill runs SOP scenarios and writes results to the portal `uat`
quality ledger (schema `vmc-quality-ledger/v1`, template in
`docs/templates/quality-ledger/`). MC's Loop Ledgers module pulls it through
`config/loop-ledgers-registry.json`.

### Portal side

The ticket lifecycle, custody model and per-ticket sweep live in the portal:
`docs/projects/cos-companion/UAT-TICKET-CONTRACT.md`,
`docs/modules/uat-feedback/README.md` and `docs/runbooks/uat-agent-v2.md`.
The per-ticket cut-over is in force only when the portal's ticket-task sweep runs
in apply mode (`UAT_MC_TICKET_TASKS_ENABLED=1`, `UAT_MC_TICKET_TASKS_SINCE`,
`UAT_AGENT_EXECUTOR_DISPATCH_ENABLED=0`). Until then the portal runner still
creates one "UAT agent run …" task per run.

## Dependencies

- `compliance` (MC): PR projection, merge promotion, the UAT tickets loader and drift check.
- `mcp` (MC): `task.uat_sync`, the UAT ticket rules on `mc_update_task`, `mc_report_progress` and `mc_complete_task`.
- `loop-ledgers` (MC): reads the portal `uat` quality ledger.
- `uat-scorecard` (MC): grades the portal's weekly fix-loop numbers, pulled by the drift cron.
- `plx-customer-portal`: owns the tickets, the re-test, the ticket-task sweep and the ledger.
- PLX Steward: leases ticket tasks and sets `uat:blocked` / `uat:cause:*`.

### Key Files

- `docs/modules/uat/README.md`: this contract.
- `src/lib/tasks/uat-labels.ts`, `src/lib/tasks/uat-tickets.ts`: labels, identity, groups, drift-fix drafts.
- `src/lib/compliance/uat-tickets.ts`, `src/lib/compliance/uat-portal-read.ts`: loader, drift check, portal read.
- `src/app/api/uat-tickets/route.ts`, `src/app/api/cron/uat-drift/route.ts`: the view's read and the daily cron.
- `src/components/mc/uat-tickets.tsx`: the UAT tickets view.
- `src/lib/mcp/task-update-actions.ts`: `task.uat_sync` limits and `verifyUatTicketTx`.
- `src/lib/mc-data/policy.ts`: the verified stage and rollups.
- `config/integrations.yaml` (`uat-portal-read`), `config/loop-ledgers-registry.json`.
- `.cursor/skills/uat-runner/SKILL.md`: the UAT runner skill (canonical copy in `petralabx/skills`).

## Owner

Vince

## Criticality

Medium. MC has runtime UAT paths: the verify door, the view, the drift cron and
the UAT ticket rules on MCP writes. A break hides stuck tickets or counts
unconfirmed fixes as done. Ticket intake and the re-test itself run in the portal
and do not depend on MC.
