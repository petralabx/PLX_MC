# Module: reporting-goals

## What

The **Goals & Production** report (sidebar: Reporting → Goals & production,
`/?screen=goals`; on phones it is in the More sheet) and its domain module. It tracks three
monthly goals for Petra Lab-X against the business's definitions:

- large batches: 2 per working day, 7,500 kg or more
- full truckloads: US$18,000 or more of product per shipment to five customers
- shipped revenue: $1,000,000 CAD a month

Figures come from FileMaker (`silver.batches`) and Sage 300
(`sage.oe_invoice_header`, `sage.ar_customer`) on the read-only PLX reporting
replica, refreshed at 06:00 Toronto each weekday and on demand. Staff can add
**manual entries** for batches and shipments the systems haven't caught up with.
An entry counts until its reference appears in the system data.

Not this module's job: writing to FileMaker, Sage or Business Central (never),
forecasting beyond "if every scheduled batch runs", or months other than the
current one (the snapshot tables are month-aware so history can follow).

## Why

The goals were tracked in a Claude prototype that read the database through a
local MCP server. It had no schedule, no shared state and no audit trail, and
it could not be used by the team. This module rebuilds it on Mission Control's
stack and keeps the prototype's verified rules and numbers. Every figure is
traceable to a refresh run and a named query.

## How

1. **Calendar** — `calendar.ts`. "Today" is always the America/Toronto date,
   never the database's UTC `current_date`. Working days are Monday to Friday
   less `report_holiday`. That table is seeded for 2026–2028 with Ontario's nine
   public holidays on their observed dates (`ontarioStatutoryHolidays()`; a
   test keeps the seed equal to it). The Civic Holiday is a working day.
2. **Rules** — `rules.ts` and `money.ts`. These are pure and hold the business
   contract: size bands (9,000–11,000 kg inclusive is ~10,000), load
   classification, manual-entry status (first match wins), goal maths,
   covered-through dates, the data-is-behind rule and the takeaway sentence.
   Money is integer cents parsed exactly from decimal strings. Each converted
   amount is rounded to the cent, half to even: 25,750 × 1.4219 = 36,613.925
   gives 36,613.92.
3. **Queries** — `queries/*.ts`, one per dataset: `cutoffs`, `goal-summary`,
   `daily`, `truckloads`, `revenue-by-currency`, `shipments`, `batches`,
   `batch-history`, `references` and `customers`.
   - They are adapted from the prototype's verified SQL.
   - Today is bound as `$1`. The large-batch minimum and truckload codes are
     bound too, because the config tables live in Mission Control's database
     and not on the replica.
   - Working days are computed in `rules.ts`, so the queries need no holiday
     table.
4. **Refresh** — `refresh.ts`, `source-db.ts`, `fx.ts` and `store.ts`.
   1. The claim takes `pg_advisory_xact_lock`.
      - At most one run is `running`, enforced by a unique index.
      - A run still running after 10 minutes is failed as abandoned.
      - Users may start one refresh per 5 minutes.
   2. The rate comes from the Bank of Canada Valet (`FXUSDCAD`), and every
      fetched rate is stored. If the fetch fails, the run uses the last stored
      rate and flags it.
   3. Every query runs in one `REPEATABLE READ READ ONLY` transaction on the
      replica, with a 120-second budget per attempt. A transient error is
      retried twice at most (backoff 5 s, then 15 s), and only while another
      full attempt fits in the 280-second budget.
   4. All snapshots and the run's success are written in one Mission Control
      transaction. A failed run never replaces the last good one.
   5. Runs are kept 90 days. The reference and customer lists are kept for the
      last three good runs only.
5. **View** — `view.ts` and `loader.ts`. The page model is the latest
   successful snapshot plus the live manual entries, evaluated at read time. It
   carries the run (cutoffs, rate, row counts) and the query behind each
   section. The newest run is reported beside it when it failed or is still
   running.
6. **Access** — `access.ts`. Two Entra app roles on Mission Control's sign-in
   app, `Goals.Viewer` (see and export) and `Goals.Editor` (also refresh and
   manual entries), are assigned to the two Entra groups.
   - The roles ride in the session from sign-in (`src/lib/auth`) and are
     checked on the server for every request.
   - A role change applies at the user's next sign-in.
   - Refused writes are logged as `reporting.goals.denied`.
   - Basic break-glass sessions are read-only.
7. **API** — every route goes through `route()`, and mutating routes validate
   their bodies with Zod.

   | Route | Who | Does |
   |---|---|---|
   | `GET /api/reporting/goals` | Viewer | The page model, plus `viewer.editor` (whether this viewer may refresh) |
   | `POST /api/reporting/goals/refresh` | Editor | Claims a run and answers 202 with it; the run finishes in `after()`. 409 while one is running, 429 within 5 minutes of the last, 503 if the reporting database is not connected. |
   | `GET /api/reporting/goals/runs/[id]` | Viewer | One run's status, for polling |
   | `GET /api/reporting/goals/export` | Viewer | The workbook (step 10) as `PLX goals and production YYYY-MM-DD.xlsx`, dated by the run's Toronto day. 404 `no_data` before the first good refresh. |
   | `GET /api/reporting/goals/entries` | Viewer | The live manual entries, oldest first |
   | `POST /api/reporting/goals/entries` | Editor | Adds an entry: 201 with it (next `M001`-style ID; entered by the signed-in Editor). 400 `invalid_entry` with the problems. |
   | `PATCH`, `DELETE /api/reporting/goals/entries/[id]` | Editor | Changes the fields sent (nothing is written when nothing changes), or soft-deletes the entry. 404 when there is no such live entry. |
   | `GET /api/reporting/goals/customers` | Viewer | The latest good refresh's Sage customers (code, name, currency), for the form's picker |
   | `POST /api/reporting/goals/import` | Editor | Previews an import: `{ fileName, fileBase64 }`, up to 2 MB (413). Answers the entries to add, change and remove, each with the status it would get, and a token. 422 `header_mismatch`, `too_many_rows`, `unreadable_file`, `missing_sheet`, or `invalid_rows` (one line per row problem). |
   | `POST /api/reporting/goals/import/confirm` | Editor | Applies the uploader's preview `{ importId, token }` in one transaction. 409 `entries_changed` when entries changed since the preview, `preview_out_of_date` when a newer preview replaced it. |
   | `GET /api/cron/reporting-goals` | Vercel Cron | Runs at 10:00 and 11:00 UTC on weekdays and acts only at 06:00 Toronto. Needs the `CRON_SECRET` bearer, compared timing-safe. |

8. **Page** — `src/components/mc/goals/` (styles `src/styles/mc-goals.css`,
   `mc.screens` layer). One read of the page model, so every section comes
   from the same snapshot.
   - Header: the month's title, "Data as of" with both cutoffs, the amber
     legend, the takeaway, Export to Excel and, for Editors, Refresh, Import
     manual entries and Add entry. Refresh follows the run through
     `GET …/runs/[id]` every 2 s and reloads when it ends; it shows when the
     5-minute limit lifts. Export downloads through `apiDownload()` (next to
     `api()` in `src/lib/api`); its progress and errors use the same status
     line.
   - Sections: the three goal cards, the day-by-day charts, truckloads by
     customer, entries by hand, completed and scheduled batches by size, the
     batch list (search, filters, 7,500 kg toggle, sortable columns) and the
     rules in plain words.
   - Charts: `StackedColumns` and `RunningLines` in
     `src/components/mc/charts/column-chart.tsx` (native SVG; HTML labels).
     Each has a one-sentence summary and its numbers in a table under it.
   - Amber (`--p-warn` / `--p-warn-text`) marks only what was entered by hand.
     The PLX palette has no red, so Behind uses the brand's alarm tone (hot).
   - Loading shows skeletons. A failed read, or a section that can't render,
     shows "Failed to load" + Retry in the same box. A section's figures name
     their query and run in tooltips and in a source line under the section.
9. **Audit**
   - `mc_events` records `reporting.goals.refresh.succeeded|failed` (run id,
     counts and error code, never values), `reporting.goals.export` (who and
     the run id) and `reporting.goals.denied`.
   - It also records `reporting.goals.entry.created|updated|deleted` (the
     entry id and, for an edit, the names of the fields changed) and
     `reporting.goals.import.confirmed` (import id and counts). Never values.
   - Entry history goes to `report_manual_entry_version`, which only the
     report's Viewers can read.
10. **Workbook** — `excel/export.ts` (pure, exceljs) builds the brief's seven
    sheets from the page model plus the run's Sage invoices and truckload
    shipments (`loadGoalsExport()`). Sheet names and order, the file name and
    the "Manual entries" columns come from `excel/layout.ts`, the contract
    shared with the import.
    - House styles: Arial 10, 14-pt bold titles, header rows bold on light
      grey and frozen, amber (fill `FFF2CC`, font `7F6000`) for whatever was
      entered by hand, real dates, `#,##0` counts and the house dollar format.
    - It recalculates on open (`fullCalcOnLoad`). Totals and derived values
      are formulas: on Goals the targets, due so far, totals, statuses and
      needed per day over the assumptions block (rows 11–21; rows 20–21 hold
      the working days covered), with In system and By hand taken from the
      Daily and Truckloads totals; on Daily the running revenue and target to
      date; the truckload totals; Large on Batches. Figures from FileMaker,
      Sage and the entries are values, to the cent, as the page computed them.
    - In-system revenue converts USD with Excel's `ROUND` (half away from
      zero), while the page rounds half to even, so the two differ only when a
      conversion lands on exactly half a cent.
    - "Manual entries" is the import template: the entries in amber, then
      formatted blank rows with the Type and Currency lists to row 200.
11. **Manual entries and import** — `entry-input.ts` (validation, pure),
    `entries.ts` (writes), `excel/import.ts` (reading the workbook and planning)
    and `src/components/mc/goals/entries.tsx` (the dialogs).
    - One validation serves the form (in the browser and again on the server)
      and the import. Type and date are required, kg for a batch, and product
      value and currency for a shipment. A date in another month is allowed:
      it gets the "Not this month" status. A field of the other type is refused,
      not ignored. kg is kept exact to 3 places and money to 2, and nothing is
      rounded.
    - Every write is one transaction under one advisory lock. It writes the
      entry, an append-only `report_manual_entry_version` row (before and
      after) and the audit event. The Entry ID comes from
      `report_manual_entry_seq` and skips IDs already taken. Who entered or
      changed an entry is the signed-in Editor; the body can't set it. Deletes
      are soft: the entry leaves the list and its history stays.
    - A customer picked from the latest refresh's Sage list keeps its code
      (`customer_code`), so truckload customers match by code. Free text keeps
      none and matches by name.
    - **Import.** Only the "Manual entries" sheet is read, and only when its
      header row is exactly the export's (`excel/layout.ts`). Blank formatted
      rows are skipped; more than 1,000 entry rows rejects the file. Every row
      is checked, and any problem imports nothing.
    - The sheet replaces the list. A row without an Entry ID is added. A row
      whose Entry ID names a current entry changes it when a value differs
      (compared exactly, as numbers). A current entry missing from the sheet is
      removed. An Entry ID that isn't a current entry, or that appears twice,
      is a row error. "Entered by" and "Dashboard status" are ignored; the
      uploader is recorded.
    - The preview keeps the file and the plan in `report_manual_import`, with a
      fingerprint of the entry list it was worked out against (the token).
      Confirm applies the uploader's newest preview in one transaction. It is
      refused (409) if the fingerprint changed, so a stale file never
      overwrites someone's edit.

```
reporting replica (read-only login) ──┐ one RR read-only tx
Bank of Canada Valet (FXUSDCAD) ──────┼─ refresh ─→ report_refresh_run + report_snap_* (Postgres)
                                      │                     │
manual entries (live) ────────────────┴──────── loader → rules → GET /api/reporting/goals
```

### Setup

1. Run `readonly-grants.sql` on the reporting database. It creates the
   `mc_goals_ro` login with column-level SELECT only.
2. Set `REPORTING_DATABASE_URL` on the Vercel project `plx-mission-control`
   (Production). `CRON_SECRET` is already set.
3. Create the app roles `Goals.Viewer` and `Goals.Editor` on the Entra app
   registration `plx-mission-control`, and assign the Viewer and Editor groups
   to them on its enterprise application. Assigning groups needs Entra ID P1.
4. Apply migration 039 through the approved live migration workflow before
   the code deploys (`docs/runbooks/db-migrate.md`).

### Interpretations to confirm

- Covered-through dates never run past today. A manual entry dated later this
  month does not raise "due so far" early.
- Two counted entries with the same batch reference both count. Only the first
  moves the matching open batch out of the schedule. The brief defines no
  duplicate status.
- An invoice without a shipment number counts as its own shipment
  (`invoice:<invnumber>`), so blank numbers never merge into one load or
  across months. The brief defines a shipment by its number only.

## Dependencies

Depends on:
- **web**: the shared `route()` and `api()` wrappers and the middleware sign-in
  gate.
- **auth** (`src/lib/auth`): Entra app roles in the session.
- **compliance**: `appendEvent` / `appendEventTx` into `mc_events`.
- `src/lib/db`: Mission Control's pool and `withTransaction`.
- `src/lib/db/tls`: the RDS CA bundle, reused for the replica.
- `src/lib/secrets.ts`: `reportingDatabaseConfigured/Url`, `cronConfigured/Secret`
  and `basicAuthConfigured`.
- `zod`.
- `exceljs`: the workbook (`excel/export.ts`) and reading the import (`excel/import.ts`).

External:
- the PLX reporting replica (read-only)
- the Bank of Canada Valet API (no key)

Depended on by: nothing yet.

### Key Files

- `src/lib/reporting/goals/` — the module (barrel `index.ts`; calendar, money, rules, view, queries/, source-db, fx, store, refresh, loader, access, entry-input, entries, excel/)
- `db/migrations/039_reporting_goals.sql` (+ `db/rollback/039_reporting_goals_rollback.sql`)
- `src/app/api/reporting/goals/` — read, refresh, run, export, entry, customer and import routes; `src/app/api/cron/reporting-goals/` — the daily refresh
- `src/components/mc/goals/` — the page; `src/components/mc/charts/column-chart.tsx` — its charts; `src/styles/mc-goals.css`
- `docs/modules/reporting-goals/readonly-grants.sql` — the replica login's grants
- `tests/reporting-goals-*.test.ts`, `tests/fixtures/reporting-goals/2026-10-14/` — rules, SQL (disposable PG16), route, page and workbook tests against the 2026-10-14 figures (the workbook's LibreOffice recalculation skips where `soffice` isn't installed, as in CI, and logs why); `tests/reporting-goals-entries*.test.ts` — validation, the import plan, and the entry and import routes against PG16 (`tests/reporting-goals-workbook.ts` builds the workbooks); `tests/reporting-goals-roundtrip.test.ts` — the real export read back by the import (the round-trip guarantee)
- `e2e/goals.spec.ts`, `e2e/goals-export.spec.ts`, `e2e/ui-goals-{responsive,a11y}.spec.ts` — the page in a browser (`e2e/helpers/goals.ts` serves the same fixture); `e2e/goals-entries.spec.ts`, `e2e/ui-goals-entries-{responsive,a11y}.spec.ts` — adding, editing, deleting and importing entries (`e2e/helpers/goals-entries.ts` serves the entries API in memory)

## Owner

Vince

## Criticality

Medium
