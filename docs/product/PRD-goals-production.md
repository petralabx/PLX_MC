# PRD — Goals & Production report

- **Owner (accountable human):** Vince
- **Requested by:** the coding-agent brief "Mission Control Goals & Production
  reporting module" (Oct 14, 2026, Vinny Sachet). Plan approved by Vince the same day.
- **Risk tier:** High. It adds migration 039 and an Entra app-role claim in the sign-in session.
- **Tasks:** TASK-2895 (data layer, rules, refresh), TASK-2896 (page),
  TASK-2897 (manual entries + import), TASK-2898 (export)
- **Module contract:** `docs/modules/reporting-goals/README.md`

## Problem

Three monthly goals are tracked in a prototype dashboard built in Claude, which
read the reporting database through a local MCP server:

- large batches: 2 per working day, ≥ 7,500 kg. Replaced on 2026-10-16
  (Vince, TASK-3142) by Line 1 bulk: 20,000 kg per working day of batches
  ≥ 5,000 kg, which are assumed to run on Line 1
- full truckloads: ≥ US$18,000 of product per shipment to five customers
- shipped revenue: $1,000,000 CAD a month

The prototype has no schedule, no shared state, no audit trail and no way for
the team to use it.

FileMaker and Sage also catch up in bursts (both looked a week stale on the
morning of Oct 14), and staff enter data up to a week late. So the report has
to show how fresh each source is and let staff record what really happened.

## Decision

Rebuild the report as a Mission Control module and reproduce the prototype's
numbers exactly. On 2026-10-14 with USD/CAD 1.4219 the published figures are:

- large batches: 6 done of 18 due so far, against a target of 42
- full loads: 2
- revenue: $367,014.16 of $428,571 due so far

With the brief's seven manual-entry scenarios the figures become 8 large
batches, 3 full loads and $408,628.08.

Approved defaults (the questions the brief raised):

1. **Storage.** Snapshots, runs, rates, config, manual entries and uploaded
   workbooks live in Mission Control's Postgres only. Nothing goes to
   SharePoint lists or files.
2. **Revenue source.** Sage now, behind a source interface. A Business Central
   version follows once the cutover date is set; BC data is test-only today
   and its CAD columns are empty.
3. **USD/CAD.** The Bank of Canada daily rate (Valet FXUSDCAD), the same rate
   the ERP integration pushes to BC. Finance to confirm.
4. **Roles.** Entra app roles `Goals.Viewer` and `Goals.Editor` on the existing
   sign-in app, assigned to the two groups and checked on the server for every
   request. A role change applies at the next sign-in.
5. **Truckload target.** A setting, empty until the business sets one.
6. **Credit notes.** Deducted (TASK-3987, Ricardo, 26 Oct 2026): this month's Sage credit notes, bucketed by the credit note's date, come off the Revenue headline, status and pace at their product value before tax (credited freight and other charges left out, as charges are), within the selected customer scope; the card shows them as a side line ("− $R returns (N credit notes)") and the export lists them. Debit notes are not returns. The replica table is `sage.oe_crdh` (source currency `crsourcurr`).
7. **Civic Holiday.** A working day: it is not statutory.
8. **Refresh.** 06:00 Toronto, Monday to Friday, holidays included; Editors can
   refresh at any time.
9. **Rounding.** Each converted amount is rounded to the cent, half to even.
   This reproduces the brief's $36,613.92 and $408,628.08.
10. **Data-is-behind banner.** Shown when a working day is missing between the
    cutoff and today, so it doesn't fire every Monday.
11. **Navigation.** A new "Reporting" sidebar group. On phones it sits in the
    More sheet.
12. **PR flow.** The four PRs land one at a time.

## What ships

| PR | Scope | Done when |
|---|---|---|
| 1 | Migration 039; read-only replica pool; dataset queries; pure rules; Bank of Canada rate; refresh (cron and Editor button, one at a time, five-minute limit, retries within a 300 s budget); read and run APIs; role guard | Rules and SQL reproduce every 2026-10-14 figure and M1–M7 on a disposable PG16. A failed refresh keeps the last good snapshot. Viewers get 403 on writes. |
| 2 | The page: goal cards, day-by-day charts, truckload table, size bands, batch list | Renders at 400 px and in dark mode; axe clean |
| 3 | Manual entries: add, edit and delete form; Excel import with preview and one-transaction confirm | Viewers get 403; a header change is rejected; 1,000-row cap |
| 4 | Seven-sheet Excel export | LibreOffice recalculation shows 0 errors and Goals!G8 = 367,014.16; the round trip is an empty diff |

## Out of scope

- writing to FileMaker, Sage or Business Central
- forecasting beyond "if every scheduled batch runs"
- months other than the current one
- changing a goal definition without the business's sign-off

## Rollback

Revert the PRs. Then run `db/rollback/039_reporting_goals_rollback.sql` only if
the tables must go; export the manual entries first. With
`REPORTING_DATABASE_URL` unset, the report is dormant.
