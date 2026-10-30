# Module: uat-scorecard

## What

The UAT scorecard (TASK-4196, for TASK-3712): each week of the UAT fix loop,
from the numbers and from users' feedback, graded against the team's targets
in five areas (Outcomes, Speed, Flow, Users, Reliability), with the trend
across weeks. This module owns the rubric (metrics, directions, targets, near
bands, score), the stored weekly reads, the daily pull, `GET /api/uat-scorecard`
and the UAT scorecard screen. It does not measure anything itself: the portal
owns the tickets and serves the numbers, and this module grades them. It never
writes to the portal.

## Why

TASK-3712 asks for a weekly readout of the UAT fix loop with "user scores
beside the numbers", posted by hand. Vince asked on 2026-10-30 for it in
Mission Control instead: how the loop performs week by week, graded against
default targets that the team will adjust. Success is scores that go up and a
time to PASS that goes down.

## How

1. **Payload** — `schema.ts`: the zod schema of the portal's
   `plx-uat-scorecard/v1` (window, outcomes, speed, flow, users, reliability,
   read errors). Loose objects keep every field the portal adds, so a later
   rubric can grade stored weeks again. Counts and medians may be null: a
   section the portal could not read names itself in `readErrors`, and the
   point-in-time numbers (open, over the clock, waiting on PLX, stuck, dead
   outbox rows) are null in a closed week. `outcomes.closedPollable`
   (tickets that moved to RESOLVED or REJECTED in the week and whose
   submitter can answer the closing poll: signed in, not rejected at identity
   review) and `outcomes.passWithoutRun` (PASS verdicts on a ticket with no
   agent run, legacy) may be absent until the portal sends them.
   `users.closingPoll.lowWithFollowUp` counts only the follow-ups made before
   `window.end`. `users.pulse` lists the newest two scored pulse rounds opened
   before `window.end`, oldest first. A round's question averages and
   `responses` cover all of its answers created before `window.end`, not only
   the week's. Kept apart from `index.ts` so the screen's bundle carries no
   zod.
2. **Pull** — `readPortalScorecard(week)` in
   `src/lib/compliance/uat-portal-read.ts`, beside `readPortalTickets`, with
   the same flag, base URL, token and 8 s timeout:
   `GET <PLX_MC_PORTAL_BASE_URL>/api/internal/uat-feedback/scorecard?week=YYYY-MM-DD`,
   where `week` is the Monday (America/Toronto) that starts the week. It
   answers `off`, `ok` or `error` with a plain message (HTTP status, timeout,
   shape, missing token, or a week other than the one asked for), never an
   empty read. The daily `GET /api/cron/uat-drift` runs `pullScorecardWeeks`
   after the drift check: last week, which has closed, then this week so far,
   one after the other. Each week reads and stores on its own, so one failure
   never stops the other or the drift check; a failed drift check still fails
   the run, after the pull. A week that fails appends one
   `uat.scorecard.pull_failed` row (the week, the message and the time, never
   ticket text; one per week and UTC hour). The cron answers
   `scorecard: { status, weeks }`.
3. **Store** — `store.ts` (server-only): one append-only `mc_events` row per
   read, kind `uat.scorecard.snapshot`, through `appendEvent`. The dedup key
   has two forms that never meet, both with `window.start` in UTC, so the
   offset the portal writes cannot store a week twice. A clean final read
   (closed, no read errors) keys as `uat-scorecard:<window.start>|final`, so
   its replay is a no-op. Any other read, open or partial, keys as
   `uat-scorecard:<window.start>|read:<UTC hour of generatedAt>`, so each
   daily read appends, except a partial re-read of a week whose clean final
   read is stored: that one is dropped, because it could never be shown. A
   clean final read can follow a partial one, even one read in the hour the
   week closed. A week's first clean final read is kept: a later portal
   recompute of the week does not change it, because its replay is a no-op.
   The store reads back at most 800 reads: the 52 weeks and the week before
   at the daily pull's worst case (14 a week, 742), with 58 rows for re-runs
   in other hours (up to 2 each). No migration: `mc_events` already has the
   unique `dedup_key` index. Without `PLX_MC_DATABASE_URL` it falls back to
   process-local memory (the ci-scorecard contract). Postgres and the fallback
   both stamp a read and a failed pull with the time they are stored, so the
   two order on one clock. Failed pulls are read back from the last 15 days
   only, which covers the two weeks the daily pull reads.
4. **Rubric** — `index.ts` (client-safe, no runtime imports): `METRICS`, each
   with an area, a unit, a direction and, when graded, a target. Lower is
   better: **met** at or under the target, **near** within 1.5× a target
   above zero (that band rounded to the two decimals it shows), and no near
   band for a target of 0. Higher is better: **met**
   at or over the target, **near** at or over the metric's own floor. A metric
   with no data is not graded. The score counts met as 1 and near as a half
   over the graded metrics (0 to 100), with A from 90, B 80, C 70, D 60:
   ci-scorecard's points and bands, pinned by a parity test. `buildScorecard`
   keeps one read per Toronto week: the newest clean final read, else the
   newest final read, else the newest open read. A week is `final`, `open`,
   or `no-final-read`. A week that has ended stays `open` for 24 hours with
   `finalReadPending`, because the daily pull takes its final read at 10:00
   UTC, 5 to 6 hours after Toronto midnight. After that, with open reads
   only, it is `no-final-read`, graded from the newest. A closed week takes
   each point-in-time number from its newest open read that has it, and says
   so in the row's note; when none has it, the week's read errors name that
   read's errors, with its day. Each value is graded, compared and noted at
   the precision the screen shows it (`DECIMALS`: one decimal for a percent,
   two for days and scores, none for a count), so the shown value and its
   grade agree. Each row is compared with the calendar week before, when it
   is stored. A pulse average 0.5 or more below the round before it in the
   same read is flagged, with that round and its mean. The headline is the
   newest final week, else the newest ended week without a final read (lost,
   or still pending), else this week so far; the open weeks are the last
   points of the history, each with its own read errors.
5. **API** — `GET /api/uat-scorecard` (session `task.read`): `{ latest,
   history, rubric, source }`; `?weeks=1..52` (default 12) bounds the history.
   `source` says whether the portal read and the daily check are on, names
   the portal origin, and carries `lastPullFailure`: the newest failed pull
   that no later read of its own week answers, while the daily pull still
   reads that week (this week or last week, in Toronto weeks). A read of
   another week answers nothing. A week with its clean final read stored has
   nothing left to pull, so a failed re-read of it is answered. Once a week
   leaves the pull, its failure is not named: its `no-final-read` state says
   what happened. A week whose every pull failed has no stored read, so once
   it leaves the pull nothing names it: the trend just has a gap. While the
   portal read or the daily check is off, no pull can answer a failure, so
   `lastPullFailure` is null. The screen then shows one note. With the portal
   read off, even with the daily check off too, it says "Portal read is off.
   Mission Control pulls no new week until `PLX_MC_UAT_PORTAL_READ_ENABLED` is
   on." With only the daily check off, it says "The daily UAT check is off, so
   no new week is pulled. It needs `PLX_MC_UAT_DRIFT_CRON_ENABLED` and
   `CRON_SECRET`."
6. **Screen** — `src/components/mc/uat-scorecard/` (`/?screen=uat-scorecard`;
   Reporting in the zoned sidebar, Admin & health in the classic one, beside
   the CI scorecard, whose stylesheet it shares): the overall letter and score
   of the latest closed week, this week so far and, while its final read is
   pending, the week that just ended, each on its own line with its own read
   errors (wherever the screen names a week, a pending one reads "final read
   pending", the headline included), the weekly score trend, one card per area
   (value, grade, target and near band, previous week), the portal's read
   errors, links to the portal's Loop board and to TASK-3712, and how grading
   works. It says when the portal read or the daily check is
   off, when the last daily pull failed ("The last daily pull failed: …",
   with its time in Toronto), and when no week is stored yet. Speed's holder
   medians follow the portal's custody model: the staff board's holder clocks
   (`lib/uat-feedback/custody.ts` in the portal).

### Default targets

The defaults come from the TASK-4196 design (2026-10-30). The team adjusts
them in `METRICS` in `src/lib/uat-scorecard/index.ts`; a change regrades every
stored week. Business days (bd) are Toronto business days.

| Area | Metric | Direction | Target | Near band |
|---|---|---|---|---|
| Outcomes | PASS share of verdicts | higher | 70% | ≥ 60% |
| Outcomes | FAIL share of verdicts | lower | 20% | ≤ 30% |
| Outcomes | STALE share of verdicts (legacy stall expiries included) | lower | 10% | ≤ 15% |
| Outcomes | PASS within 5 business days of filing (share of PASS) | higher | 60% | ≥ 50% |
| Outcomes | PASS on the first attempt (share of PASS with an agent run) | higher | 70% | ≥ 60% |
| Speed | Filed to PASS, median | lower | 5 bd | ≤ 7.5 bd |
| Speed | PLX hold, median | lower | 1 bd | ≤ 1.5 bd |
| Speed | Agent hold, median | lower | 1 bd | ≤ 1.5 bd |
| Speed | Pipeline hold, median | lower | 0.5 bd | ≤ 0.75 bd |
| Speed | Submitter hold, median | lower | 3 bd | ≤ 4.5 bd |
| Flow | Open tickets over their clock | lower | 0 | none |
| Flow | Stuck tickets (UFL-0b categories) | lower | 5 | ≤ 7.5 |
| Flow | Waiting on PLX | lower | 5 | ≤ 7.5 |
| Users | Closing poll average (1 to 5) | higher | 4.0 | ≥ 3.5 |
| Users | Closing poll response rate (answers / closed tickets whose submitter can answer) | higher | 30% | ≥ 20% |
| Users | Low scores with no follow-up by the end of the week | lower | 0 | none |
| Users | Pulse average, latest round (1 to 5) | higher | 3.5 | ≥ 3.0, and a fall of 0.5 or more from the round before is flagged |
| Reliability | Every outbox row that reached FAILED_TERMINAL this week, of any kind | lower | 0 | none |
| Reliability | Watchdog pages this week | lower | 10 | ≤ 15 |

Shown for context, not graded: tickets reopened, filed to PASS p90, tickets
filed, open tickets and dead outbox rows open.

The closing poll is offered when a ticket closes or escalates to a developer,
so answers can outnumber the tickets closed; the rate then shows 100% with a
note. Without `outcomes.closedPollable`, or with no such ticket, it is not
graded. The first-attempt share counts only the PASS verdicts on a ticket with
an agent run; with none, it is not graded.

## Dependencies

- `compliance` (`appendEvent`, `eventsByKinds`, `eventByDedupKey` on `mc_events`; the portal read
  in `uat-portal-read.ts`; the daily `uat-drift` cron), `secrets`
  (`databaseConfigured`, the portal read flag, token and base URL, the cron
  flags), `ci-scorecard` (the `Grade`, `Letter` and `Trend` types, and the
  screen's grade labels, score line and stylesheet), `api/route`, `routing`
  (`requireSessionActor`).
- The web module's chart kit (`src/components/mc/charts`).
- Fed by `plx-customer-portal`'s
  `GET /api/internal/uat-feedback/scorecard`, which the portal does not serve
  yet. Until it does, each pull is an HTTP error and no week is stored.

### Key Files

- `src/lib/uat-scorecard/index.ts` — the rubric, grading, Toronto weeks and `buildScorecard` (client-safe).
- `src/lib/uat-scorecard/schema.ts` — the payload's zod schema.
- `src/lib/uat-scorecard/store.ts` — `recordSnapshot`, `listSnapshots`, `pullScorecardWeeks`, memory fallback.
- `src/lib/compliance/uat-portal-read.ts` — `readPortalScorecard`.
- `src/app/api/uat-scorecard/route.ts`, `src/app/api/cron/uat-drift/route.ts` — the read API and the daily pull.
- `src/components/mc/uat-scorecard/` — the screen and its helpers.
- `tests/uat-scorecard.test.ts`, `tests/uat-scorecard-server.test.ts`,
  `tests/uat-scorecard-ui.test.ts` — rubric, server side and screen.

## Owner

Vince

## Criticality

Medium — the scorecard is the team's weekly read of the UAT fix loop, and a
wrong grade can steer that work. Nothing gates on it: a missing week leaves a
gap in the trend, and a failed pull never fails the drift check. A rubric
change regrades every stored week.
