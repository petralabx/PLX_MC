# Module: uat

## What

The User Acceptance Testing (UAT) contract between `plx-customer-portal` and
`PLX_MC`. It covers two kinds of work:

| Work | System of record | What MC does |
|---|---|---|
| **UAT feedback tickets**: a person files a bug in the portal and an agent fixes it | The portal's gold `Feedback` record (Prisma). SharePoint is a projection. | Mirrors each ticket attempt as one `BKT-UAT` task, shows the UAT tickets view, runs a daily drift check. |
| **UAT case runs**: SOP scenarios and go-live readiness | The portal `uat` quality ledger, `docs/portal/quality-ledger/uat.artifacts.json` | Reads it through Loop Ledgers. |

MC never authors a re-test result. A ticket's re-test result is **PASS**,
**FAIL** or **STALE**, never Verified (Vince, 2026-10-26). STALE means nobody
answered the re-test within 9 Toronto business days, so the ticket closed with
no result, never as FAIL (Vince, 2026-10-30, TASK-4200).

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
  `uat:hold` (an open question, or a STALE ticket whose fix never merged,
  mirrored by the portal), `uat:stale` (a STALE close, set only by the portal's
  `closeStale`) and `needs-vince`.
  `uat:<id>` is one segment, so `uat:cause:*` never reads as a ticket, and
  `uat:stale` is a state label, never a ticket id.
- **Completion** needs `prUrl` unless the outcome is `blocked` or `failed`
  (`src/lib/mcp/actions.ts`). The check applies only while the task sits in
  `BKT-UAT`; a ticket task moved to another bucket is not held to it.

### Stages

| Stage | Meaning |
|---|---|
| backlog → progress | Steward leased it; the PR is open or being written. |
| merged | The fix is on `staging` and waits for the person's re-test. It stays open in rollups (`src/lib/mc-data/policy.ts`, `awaitsRetest`). |
| merged + `uat:stale` | Closed as STALE: nobody answered the re-test (TASK-4200). Rollups count it **closed and unconfirmed**: in the closed share, never done and never open (`isStaleClosed`, `src/lib/tasks/uat-labels.ts`). Needs a human never lists it. |
| verified | The portal recorded the person's pass. Only the portal's `mc_update_task { verify }` sets it, under `task.uat_sync`. Every other door gets 403 (TASK-3963, TASK-4286). `mc_report_progress` refuses it first (`src/lib/mcp/actions.ts`). `patchTask` holds the rule for the web PATCH and `mc_update_task`, and `repo.updateEntity` for the SharePoint doors. A ToDos Status of Verified raises a Sync conflict, and keep-SP leaves the conflict open. No create starts a UAT ticket task at merged or verified (`src/lib/tasks/uat-labels.ts`). |
| cancelled | The portal cancels an obsolete, superseded or delivered-without-PR task. |

A PR merge never moves a verified task back (`src/lib/compliance/projection.ts`).
A task is promoted to merged only when its PR merges into the repo's integration
branch, `staging` for the portal.

### Portal → MC writes

The portal key holds `task.read`, `task.create`, `agent_report.read` and
`task.uat_sync` (`src/lib/permissions/grants.ts`). With `task.uat_sync` alone,
`mc_update_task` accepts only `verify`, `closeStale`, `cancel` and the
`uat:hold`, `uat-attempt:<n>`, `kind:*` and closure labels, and only on UAT
ticket tasks (`src/lib/mcp/task-update-actions.ts`). The portal mirrors hold,
re-attempt, cancel, the STALE close and the re-test result from its reconcile
sweep.

### STALE close (TASK-4200)

A re-test nobody answers within 9 Toronto business days closes as STALE in the
portal (gold `FeedbackStatus` `STALE`). The portal then sends
`mc_update_task { closeStale: { note?, staleClosedAt? } }` for the ticket's
merged task. `closeStale` widens what `task.uat_sync` covers; `grants.ts` keeps
the same four capabilities. The owner typed OK to that widening (decision 7,
Vince, 2026-10-30, recorded on TASK-4200): a verb that only adds `uat:stale`
to a merged UAT ticket task.

- **The close:** it adds `uat:stale` and changes nothing else. The stage stays
  merged, and stage, PRs, evidence, checkouts and the other labels never
  change, so MC never verifies or cancels a task on a STALE close (decision 6).
  It audits `task.uat_stale_closed` (`previousStage`, `closedBy`, `note`,
  `staleClosedAt`, `decision`).
- **Refusals:** a merged task that already has `uat:stale` returns an empty
  diff and writes nothing. Verified gives 409 `already_verified` and cancelled
  409 `already_cancelled`, even when the task has the label. Any other stage
  gives 409 `not_merged`, the only 409 the portal retries. An agent (a
  principal with `task.progress`) gets 403 and a `task.close_stale_denied`
  event.
- **One door:** only `closeStale` adds `uat:stale`, and no door adds a
  near-copy such as ` UAT:Stale`. No label patch removes it, whoever sends it.
  While it is on, a label patch keeps `kind:code` and the `uat:<feedbackId>`
  label. A web PATCH that also ends the close (below) is free of both rules,
  because the label goes with the move. No task is created with it.
  `mc_create_task` refuses it before its idempotency claim; `POST /api/tasks`
  and the routing create refuse it before any write. Each gets 403
  (`src/lib/tasks/uat-labels.ts`).
- **The close ends:** a move to an open stage, or from verified back to merged,
  ends it. `repo.updateEntity` (`src/lib/sync/repo.ts`) drops the label in the
  same write, which covers every door: a reopen, a person's move back, the
  SharePoint ToDos pull and a keep-SP resolution. A reworked fix that merges
  again then awaits re-test and never counts as stale-closed.
- **A late result:** the portal accepts one until the end of the 30th Toronto
  calendar day after the close day. A late PASS verifies the task through
  `verify`, which keeps `uat:stale` as history and records
  `previousClosure: "stale"`. A late FAIL starts a new attempt task, and the
  portal cancels the old one as `superseded` (decision 10); the cancel keeps
  the label too.
- **Readers:** the portal snapshot may carry status `STALE`, a closed status.
  The UAT tickets view shows a STALE close (`uat:stale`, or a merged task whose
  ticket is STALE) in its own STALE group and filter, held by nobody: its work
  is done, and a late result only verifies it or supersedes it. Before
  closeStale lands, a merged task the bucket table counts as Needs a human
  stays in Needs a human. A held task that never merged stays in Waiting on
  submitter, unless it needs a human: during the 30-day late window, only the
  submitter can move a STALE ticket.
  The drift check calls the ticket "closed as STALE (no re-test result)", never
  rejected or resolved. It asks the portal for a missing `uat:stale` with no fix in MC,
  and offers a person a cancel for an open task that never merged. When a late
  PASS resolves the ticket while its newest task is still closed as STALE, the
  check asks the portal to re-send its verify, with no fix in MC.
- **Deploy order:** MC deploys before the portal sends `STALE`. An older MC
  fails the whole snapshot read on one `STALE` row and refuses `closeStale`.

### Needs a human

A UAT ticket task counts as Needs a human when it carries `uat:blocked` or
`needs-vince`, as well as on the general rules (a pending approval gate, a
blocked flag, no human owner) (`src/components/mc/project-overview.helpers.ts`).
A task closed as STALE (`uat:stale`) is closed, so it never does; before
closeStale lands, a merged task on a STALE ticket still can.

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
- `src/lib/mcp/task-update-actions.ts`: `task.uat_sync` limits, `verifyUatTicketTx` and `staleCloseUatTicketTx`.
- `src/lib/mc-data/policy.ts`: the verified stage, STALE closes and rollups.
- `config/integrations.yaml` (`uat-portal-read`), `config/loop-ledgers-registry.json`.
- `.cursor/skills/uat-runner/SKILL.md`: the UAT runner skill (canonical copy in `petralabx/skills`).

## Owner

Vince

## Criticality

Medium. MC has runtime UAT paths: the verify door, the view, the drift cron and
the UAT ticket rules on MCP writes. A break hides stuck tickets or counts
unconfirmed fixes as done. Ticket intake and the re-test itself run in the portal
and do not depend on MC.
