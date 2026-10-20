# Module: reporting-goals

## What

The **Goals & Production** report (sidebar: Reporting → Goals & production,
`/?screen=goals`; on phones it is in the More sheet) and its domain module. It tracks three
monthly goals for Petra Lab-X against the business's definitions:

- Line 1 bulk: 20,000 kg per working day, counting batches of 5,000 kg or more
  (it replaced the large-batch goal on 2026-10-16; see "Line 1 bulk" below)
- full truckloads: US$18,000 or more of product per shipment to five customers
- shipped revenue: $1,000,000 CAD a month

Figures come from FileMaker (`silver.batches`) and Sage 300
(`sage.oe_invoice_header`, `sage.ar_customer`) on the read-only PLX reporting
replica, refreshed at 06:00 Toronto each weekday and on demand. Staff can add
**manual entries** for batches and shipments the systems haven't caught up with.
An entry counts until its reference appears in the system data. The shipments
list opens each invoice to what shipped, its Sage lines
(`sage.oe_invoice_detail`), checked against the invoice to the cent (TASK-3144).

Not this module's job: writing to FileMaker, Sage or Business Central (never),
forecasting beyond "if every scheduled batch runs" and this month's revenue
forecast (step 12), or months other than the
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
3. **Queries** — `queries/*.ts`, one per dataset: `cutoffs`, `daily`,
   `truckloads`, `revenue-by-currency`, `shipments`, `shipment-lines`,
   `batches`, `batch-history`, `references` and `customers` (and the
   forecast's two, step 12).
   - They are adapted from the prototype's verified SQL.
   - Today is bound as `$1`. The truckload codes are bound too, because the
     config tables live in Mission Control's database and not on the replica.
   - Working days are computed in `rules.ts`, so the queries need no holiday
     table.
   - Line 1 kg are summed in `rules.ts` from `batches`, not in SQL. The
     `goal-summary` query and `daily`'s large-batch counts were retired with
     migration 042.
4. **Refresh** — `refresh.ts`, `source-db.ts`, `fx.ts` and `store.ts`.
   1. The claim takes `pg_advisory_xact_lock`.
      - At most one run is `running`, enforced by a unique index.
      - A run still running after 10 minutes is failed as abandoned.
      - Users may start one refresh per 5 minutes.
   2. The rate comes from the Bank of Canada Valet (`FXUSDCAD`), and every
      fetched rate is stored. If the fetch fails, the run uses the last stored
      rate and flags it.
   3. Every query runs in one `REPEATABLE READ READ ONLY` transaction on the
      replica (or through plx-reporting-mcp, see **Reporting MCP path**), with
      a 120-second budget per attempt. A transient error is
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
   | `GET /api/reporting/goals/runs/[id]/shipment-lines` | Viewer | One good run's Sage invoice lines and whether the login could read them (`{ access, missing, lines }`), which the shipments list fetches once (TASK-3144). 404 when the run has none stored. |
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
     batch list (search, filters, "Line 1 only" toggle, sortable columns) and
     the rules in plain words.
   - Charts: `StackedColumns` and `RunningLines` in
     `src/components/mc/charts/column-chart.tsx` (native SVG; HTML labels).
     Each has a one-sentence summary and its numbers in a table under it.
   - Amber (`--p-warn` / `--p-warn-text`) marks only what was entered by hand.
     The PLX palette has no red, so Behind uses the brand's alarm tone (hot).
   - Loading shows skeletons. A failed read, or a section that can't render,
     shows "Failed to load" + Retry in the same box. A section's figures name
     their query and run in tooltips and in a source line under the section.
   - After the batch list, "Shipments this month" lists the month's invoices
     and shipments by hand (see **Shipments list** below).
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
    sheets, the Shipment lines sheet (see **Shipments list**) and the Forecast
    sheet (step 12), from the page model plus the run's Sage invoices, their
    lines and truckload shipments (`loadGoalsExport()`). Sheet
    names and order, the file name and the "Manual entries" columns come from
    `excel/layout.ts`, the contract shared with the import.
    - House styles: Arial 10, 14-pt bold titles, header rows bold on light
      grey and frozen, amber (fill `FFF2CC`, font `7F6000`) for whatever was
      entered by hand, real dates, `#,##0` counts and the house dollar format.
    - It recalculates on open (`fullCalcOnLoad`). Totals and derived values
      are formulas: on Goals the targets, due so far, totals, statuses and
      needed per day over the assumptions block (rows 11–21; rows 20–21 hold
      the working days covered), with In system and By hand taken from the
      Daily and Truckloads totals; on Daily the running revenue and target to
      date; the truckload totals; Line 1 on Batches. Figures from FileMaker,
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
12. **Revenue forecast** (TASK-3151) — `forecast.ts` (pure), `forecast-read.ts`,
    `forecast-store.ts`, `queries/forecast-*.ts` and
    `src/components/mc/goals/forecast.tsx`. The last section of the page, before
    the rules: this month's revenue against the target, from the open Sage
    orders matched to FileMaker's plan.
    - **Datasets.** `forecast-orders`: every open item line of an Active or
      Future Sage order expected to ship by month end, overdue lines included
      (quantity still to ship, unit, unit price, currency). `forecast-assembly-orders`:
      the FileMaker assembly orders (AOs) that can link to those lines, and every
      AO scheduled this month, each with its bulk batch and that batch's status.
      Both run last in the refresh's read-only transaction.
    - **Read access.** Before them, the refresh checks from the catalogs that
      `mc_goals_ro` can read exactly the columns they read
      (`FORECAST_COLUMNS`, `queries/forecast-access.ts`). If any is missing it
      skips both, every other dataset refreshes as before, and the run records
      it: `report_snap_forecast_summary.access = 'missing'` with the columns, the
      `reporting.goals.refresh.succeeded` event's `forecast: "missing"`, a log
      line, and the section's "Waiting for read access to Sage orders and
      FileMaker assembly orders" naming them.
    - **The link** is the portal's Projected Revenue join: Sage `ORDNUMBER` +
      `ITEM` = the AO's order (its order list `oelist_c`, else its orders in
      FileMaker's order entry, through the portal's "OE Fix", first order only)
      + its finished product's ERP code (else code). The bulk batch is the AO's
      `idbatch`, else `idbatch_pre`.
    - **Buckets.** Each line is split across its AOs, which keep their own date
      and quantity (packed first, then by date; output beyond what the order's
      open lines of that item still need, later ones included, is taken as
      shipped already, oldest first); what no AO covers is Not planned. Each
      portion lands in one bucket, first match wins: the AO is packed → Ready;
      scheduled after month end → Late; its bulk batch is made → Ready;
      scheduled from today to month end → Planned in time; before today →
      Late; no AO (or an AO with no date) → Not planned.
    - **Values.** Quantity still to ship × unit price in the order's currency,
      to the cent; CAD as the Revenue card converts (USD at the run's Bank of
      Canada rate, half to even, per row; other currencies listed, never
      converted).
    - **The four numbers**, against `revenue_target_cad`. Theoretical =
      invoiced so far (the Revenue card's total, by hand included) + Ready +
      Planned in time. At risk = Late + Not planned. Pace = invoiced ÷ revenue
      working days covered × working days in the month. Realistic = invoiced +
      (Ready + Planned in time) × the average hit rate of up to the three latest
      complete months. A month's hit rate is the Sage revenue invoiced in it
      after its first good run, at that run's rate (the month's invoices as the
      last run of the next month sees them, less those at the first run), ÷
      that run's Ready + Planned in time. A month counts only when that first
      run had a forecast and an earlier month is still on record (runs are kept
      90 days, so the oldest month on record may have lost its first runs).
      Each run stores those (`report_snap_forecast_summary`, Sage and FileMaker
      only, no entries by hand), so history needs no other source; until a
      month is measured, Realistic shows "Measured from" the first month that
      counts.
    - Open AOs scheduled this month whose order and item match no open order
      line (of any date) are a note: production with no order behind it, never
      revenue.
    - **The list**: one row per line portion (expected date, order, customer,
      PO, item, description, still to ship, unit price, value, CAD, bucket, AO,
      bulk batch), bucket chips with counts, a search (order, customer, PO, item,
      description, AO) and CAD totals that follow both.
    - **Filters** (TASK-3177): customer class and item category, beside the
      search. They change the list, the chip counts and the CAD total, never
      the four numbers. **Customer class** comes from the sales workbook's
      "Customer categories" sheet (Vince's 5 Oct list, plus customers derived
      from the item categories they bought): Exclusive Manufacturing, Exclusive
      Distribution or Mixed; a customer not on it is Unclassified. It is
      committed as `customer-classes.json`; when a new workbook arrives, run
      `node scripts/goals-customer-classes.mjs <workbook.xlsx> "<source note>"`
      and commit the JSON. **Item category** is Sage's `CATEGORY` on the order
      line (`queries/forecast-orders.ts`, `CATEGORY_SQL`). Its channel is
      Manufacturing for BIOPH, BRANDS, CROWN, LIQUID, LSRVCA, PHAD, PLABEL,
      MFGLBR, MFGOHE, MFGPKG and MFGRM (`MANUFACTURING_CATEGORIES`), else
      Distribution. The filter offers both channels, each category on the
      list, and No category. Its column is checked on its own
      (`FORECAST_CATEGORY_COLUMNS`): without it the forecast still fills in,
      lines carry no category, and the filter says it waits for read access
      (`report_snap_forecast_summary.category_missing`; NULL on runs stored
      before migration 045).
    - **Storage**: `report_snap_forecast_line`, `report_snap_forecast_ao` and
      `report_snap_forecast_summary` (migration 043; the line's category and
      the summary's `category_missing`, migration 045), kept with their run (90
      days). **Workbook**: the Forecast sheet holds the rows as values and the
      totals, the four numbers and the hit rates as formulas. Each row ends
      with its customer class and item category (columns U and V, after the
      columns the formulas read), and a note under the rows says when
      categories wait for read access or for the next refresh.

```
reporting replica (read-only login) ──┐ one RR read-only tx
Bank of Canada Valet (FXUSDCAD) ──────┼─ refresh ─→ report_refresh_run + report_snap_* (Postgres)
                                      │                     │
manual entries (live) ────────────────┴──────── loader → rules → GET /api/reporting/goals
```

### Shipments list

"Shipments this month" (`shipment-list.ts`, `src/components/mc/goals/shipments.tsx`)
lists one row per Sage invoice shipped this month (query `shipments`, the
invoices the Revenue card adds up) and one per counted shipment entered by hand
(amber, source "By hand"), by ship date, then invoice. The page model carries
the rows (`shipments`), built from the same snapshot and entries as the cards.

- **CAD.** A CAD invoice's net as it is; a USD invoice's net at the run's rate,
  rounded to the cent half to even; other currencies are not converted. A hand
  entry shows the CAD it adds to revenue (product value plus freight) and its
  reference under Invoice.
- **Truckload.** Full or Partial belongs to the invoice's whole shipment
  (customer code plus shipment number, or `invoice:<number>` without one, as
  the `truckloads` query groups invoices), classified with the Truckloads
  card's helpers. Every invoice of a full load shows Full, and the list's loads
  match the card. A hand entry shows its own load.
- **Filters and totals.** A search (customer, invoice or reference, shipment,
  order, PO) and one filter (All, Truckload customers, Full, Partial, CAD, USD,
  By hand). The totals, in a small table under the list, follow them: the CAD
  subtotal, the USD subtotal converted once at the rate, the CAD entered by
  hand, and their sum, which is the Revenue card's formula; with no filter it
  is the card's total to the cent.
  Converting the USD subtotal once can differ from adding up the CAD column by
  a few cents (on the 2026-10-14 fixture, 245,176.45 against 245,176.46).
  Other currencies are listed but left out of the total.
- **What shipped** (TASK-3144; `shipment-lines.ts`, `queries/shipment-lines.ts`).
  Each Sage row has a toggle (a button with `aria-expanded`) in its first
  column that opens the invoice's lines under it: items (code, description,
  quantity shipped, unit, unit price, amount, discount) and charges such as
  freight (code, description, amount), in the invoice's currency. Rows entered
  by hand have none. The search also matches the lines' codes and descriptions.
- **Checked to the cent.** Item lines' amounts less their discounts must come
  to the invoice's product value, and charges to its other charges, each side
  added up exactly and rounded once. An invoice whose lines don't is marked
  "Lines don't add up" on its row and, opened, shows both figures; the line
  above the list counts them, or says every invoice adds up. An invoice with no
  lines on the replica is marked unless both its amounts are 0.
- **Dataset.** `shipment-lines`: the lines of exactly the invoices `shipments`
  reads (the header's ship date in the month), joined on INVUNIQ, by invoice and
  line number, read last but one in the refresh's read-only transaction.
- **Read access.** First the refresh checks from the catalogs that
  `mc_goals_ro` can read exactly the columns the query reads
  (`SHIPMENT_LINE_COLUMNS`; the check is shared with the forecast,
  `queries/read-access.ts`). If any is missing it skips the lines, everything
  else refreshes as before, and the run records it:
  `report_snap_shipment_line_summary.access = 'missing'` with the columns, the
  `reporting.goals.refresh.succeeded` event's `shipmentLines: "missing"`, a log
  line, and an opened invoice's "Item details are waiting for read access to
  Sage invoice lines" naming them.
- **Loaded on demand.** The page model carries only whether the run has its
  lines (`shipmentLines`); the list fetches them once, from
  `GET …/runs/[id]/shipment-lines`, when it opens. Measured on the 2026-10-14
  fixture and a synthetic month of 700 invoices × 3 lines: the fixture's page
  model is 78 KB (its 133 lines, 25 KB); a 700-invoice month's is 306 KB
  without lines, and its 2,100 lines would add 338 KB uncompressed to it (the
  route sends them as 389 KB, about 15 KB gzipped), past the ~300 KB the page
  allows itself.
- **Storage**: `report_snap_shipment_line` (one row per line, as read) and
  `report_snap_shipment_line_summary` (migration 044), kept with their run
  (90 days). **Workbook**: the "Shipment lines" sheet, after Shipments, holds
  one row per line (invoice, ship date, customer, line type, item or charge,
  description, quantity, unit, unit price, amount, discount, currency) as values,
  then the invoices whose lines don't add up, worded as on the page.

### Reporting MCP path

Since TASK-2719 the replica's port 5432 is open only to scoped sources, and
Vercel is not one of them. When `REPORTING_MCP_URL` and `REPORTING_MCP_TOKEN`
are both set, the refresh reads through **plx-reporting-mcp** instead
(`source-mcp.ts`, TASK-3489). That is the bearer-authenticated MCP server in
front of postgres-mcp (restricted mode) on App Runner; see agentic-swarm
`apps/plx-reporting-mcp/README.md`. With only one of the two set, or neither,
the refresh uses `REPORTING_DATABASE_URL` exactly as before. With no path at all
the report is not connected.

- **Same queries.** The refresh sends the same fixed dataset queries to the
  `execute_sql` tool, one at a time, in one MCP session per attempt. Nothing
  else is called.
- **Literals, not parameters.** `execute_sql` takes SQL text only.
  `sql-literal.ts` is the one place a parameter becomes SQL. It accepts only
  strings, finite numbers, booleans, null, valid dates, and arrays of strings
  or of numbers, and it refuses anything else.
- **No shared snapshot.** Restricted mode runs each statement in its own
  read-only transaction, and it refuses `BEGIN` and `SET`. So the datasets of
  one run are not read at one single moment, as `REPEATABLE READ` gives the pg
  path. A batch or invoice that changes during the few seconds of a refresh can
  show in one dataset and not yet in another. The next refresh corrects it.
- **No session time zone.** Restricted mode also refuses `AT TIME ZONE`. The
  one timestamp the queries read (the latest `silver.batches.updated_at`)
  comes back as epoch seconds. `cutoffs.ts` turns it into a Toronto date.
- **Limits.** The server caps a result at 5,000 rows and 2 MB, and a statement
  at 15 s. References (about 12,800) and customers (about 7,400) therefore come
  back as one row of arrays (about 0.2 and 0.4 MB on 2026-10-20). A truncated
  result fails the attempt; no partial snapshot is stored.
- **Failures.** These fail the attempt: a truncated result, a tool error, an
  `Error:` text, an unreadable result, HTTP 401/429/5xx, and the 120-second
  attempt budget running out. Retries follow the existing transient rules:
  429, 5xx, an unreachable server, a statement timeout and a reset server pool
  are retried, and 401, a refused query and a permission error are not.
- **Grants.** The catalog checks for the forecast and the invoice lines run
  through the same path, so they check the MCP server's role. Without those
  grants the forecast waits and everything else refreshes, as before. On
  2026-10-20 that role could read the invoice lines, but not 6 of the
  forecast's columns.
- **Logs.** Neither the adapter nor the refresh logs the token, SQL text or row
  values. Errors carry a stable code and a fixed message.

Setup (the operator does this; agents never set these):

1. Issue a token for client `mc-goals-report` as the plx-reporting-mcp README
   says. Add only its SHA-256 to `plx/ro/reporting-mcp/tokens`. The gateway
   picks it up within about 60 s.
2. Set `REPORTING_MCP_URL` (the App Runner service URL plus `/mcp`) and
   `REPORTING_MCP_TOKEN` on the Vercel project `plx-mission-control`.
3. Confirm that the server's role reads the same replica and the goals columns.
   A refresh shows this: the cutoffs, the row counts, and any section that
   waits for read access.

Rollback: unset `REPORTING_MCP_URL` or `REPORTING_MCP_TOKEN`. The refresh falls
back to `REPORTING_DATABASE_URL` when it is set. To cut the path at the source,
disable `mc-goals-report` in the token map.

### Setup

1. Run `readonly-grants.sql` on the reporting database. It creates the
   `mc_goals_ro` login with column-level SELECT only.
2. Set `REPORTING_DATABASE_URL` on the Vercel project `plx-mission-control`
   (Production). `CRON_SECRET` is already set.
3. Create the app roles `Goals.Viewer` and `Goals.Editor` on the Entra app
   registration `plx-mission-control`, and assign the Viewer and Editor groups
   to them on its enterprise application. Assigning groups needs Entra ID P1.
4. Apply migrations 039 and 042 through the approved live migration workflow
   before the code deploys (`docs/runbooks/db-migrate.md`).
5. Revenue forecast (TASK-3151): apply migration 043 (after 042) the same way
   before its code deploys. Then a DBA runs `readonly-grants-forecast.sql` on
   the reporting database for the existing `mc_goals_ro` login (fresh installs
   get the same grants from `readonly-grants.sql`). Until then the section
   waits for read access and everything else works.
   Forecast filters (TASK-3177): apply migration 045 the same way before its
   code deploys, then re-run `readonly-grants-forecast.sql` so the login can
   read Sage's item category. Until then only the item category filter waits.
6. Before relying on the forecast, reconcile three to five open orders against
   Sage's O/E Order Entry screen and FileMaker, one rule at a time. Each rule is
   one named fragment or function, so a correction is one edit:
   1. An order with a partial shipment: Sage's Qty. Ordered, Shipped, B/O,
      Shipped To Date and Orig. Order against "Still to ship"
      (`QTY_TO_SHIP_SQL`, `queries/forecast-orders.ts`).
   2. A line whose price unit differs from its order unit, and one with a
      discount: Ext. Price against still to ship × Unit Price (`toRow` in
      `forecast.ts`; discounts aren't deducted).
   3. One order of each type in use (Active, Future, Standing, Quote) and one on
      hold (`COUNTED_ORDER_TYPES_SQL`).
   4. A line without its own Exp. Ship Date (`EXPECTED_DATE_SQL`), a
      miscellaneous charge and a comment line (`ITEM_LINES_SQL`).
   5. Two AOs: their order list and finished product against the order number
      and item (`AO_ORDER_LIST_SQL`, `AO_ITEM_SQL`,
      `queries/forecast-assembly-orders.ts`; `fixOeNumber`, `linkedOrderNumber`),
      one AO listing several orders, and one created in the portal.
   6. An AO's quantity against what it makes for the order, in pieces and in
      cases (`aoQtyInLineUnit`), and its status and bulk batch's status against
      FileMaker (`aoStage`, `isBulkMade`, `bucketFor`). One order with lines of
      an item in two months and an AO for each (`LATER_QTY_SQL`, `forecastRows`).
   7. An order shipped but not yet invoiced: when it leaves the open orders and
      when its invoice counts.
7. What shipped (TASK-3144): apply migration 044 (after 043) the same way
   before its code deploys. Then a DBA runs `readonly-grants-shipment-lines.sql`
   on the reporting database for the existing `mc_goals_ro` login (fresh
   installs get the same grants from `readonly-grants.sql`). Until then an
   opened invoice waits for read access and everything else works.
8. Before relying on the "Lines don't add up" marks, reconcile three invoices
   against Sage's O/E Invoice Inquiry (or the printed invoice), one rule each.
   Each rule is one named fragment or function, so a correction is one edit:
   1. An invoice with freight or another miscellaneous charge: each charge
      line's code and amount (`CHARGE_LINE_SQL`, `LINE_CODE_SQL`,
      `queries/shipment-lines.ts`), and their sum against the invoice's Misc.
      Charges (`invoiceLines`, `shipment-lines.ts`).
   2. An invoice with a line discount, and a line priced in a unit other than
      its invoice unit: Qty. Shipped, Unit Price, Extended Price and Discount
      against the opened invoice, and the item lines less their discounts
      against the invoice's product value.
   3. An invoice with an invoice (header) discount: if Sage keeps it on the
      lines' discount, the lines add up; if it spreads it in HDRDISC instead,
      the invoice shows "Lines don't add up" by exactly that discount. Then
      deduct HDRDISC in `invoiceLines`, add it to `SHIPMENT_LINE_COLUMNS` and
      both grant scripts, and reconcile again.
   Then check each "Lines don't add up" mark the first refreshes show: it
   should be a real difference (a line missing on the replica, a manual
   adjustment), not a rule.

### Line 1 bulk

Approved by Vince Alton on 2026-10-16 (TASK-3142), in place of the large-batch
goal (2 batches of 7,500 kg or more per working day).

- **Goal.** 20,000 kg of Line 1 bulk per working day
  (`report_goal_setting.line1_kg_per_working_day`): 420,000 kg in October
  2026's 21 working days. Due so far counts the working days to production's
  covered-through date, as the large-batch goal did.
- **Size decides.** A batch of 5,000 kg or more (`line1_min_kg`; exactly
  5,000 counts) is assumed to run on Line 1. FileMaker's `line` field is not
  used: in the 2026-10-14 data every batch of 5,000 kg or more is recorded on
  line 10 (27 batches) or 5 (5), none on 1. The batch list still shows it.
- **kg.** A batch's kg is the batch list's: actual kg once Realized (planned
  if missing), planned while open. Done is FileMaker's Realized Line 1 kg; by
  hand is the kg of counted entries of 5,000 kg or more, including one that
  completes an open batch, whose planned kg then leaves the schedule.
- **One source.** Every Line 1 figure is a sum over the batch list, in whole
  grams, so the card, the chart, the list, the takeaway and the workbook
  agree, and runs stored before the change show the new figures at once.
- **Migration 042** adds the two settings and defaults
  `report_snap_daily.large_done` / `large_open` to 0. It drops nothing: 039's
  `large_batch*` settings rows, `report_snap_goal_summary` and those two
  columns are retired but kept, because production applies 042 before the code
  deploys, and the release still live until then (or restored by a code
  rollback) reads and writes them. A later migration can drop them. Rollback:
  revert the code; run `db/rollback/042_reporting_goals_line1_rollback.sql`
  only if the Line 1 settings must go too.

### Interpretations to confirm

- Covered-through dates never run past today. A manual entry dated later this
  month does not raise "due so far" early.
- Production's covered-through date moves with a counted Line 1 batch entered
  by hand (5,000 kg or more), as it did with large batches; a smaller batch
  entered by hand does not move it.
- Two counted entries with the same batch reference both count. Only the first
  moves the matching open batch out of the schedule. The brief defines no
  duplicate status.
- An invoice without a shipment number counts as its own shipment
  (`invoice:<invnumber>`), so blank numbers never merge into one load or
  across months. The brief defines a shipment by its number only.
- Revenue forecast (TASK-3151), each reconciled by Setup step 6:
  - Still to ship is `QTYORDERED − QTYSHIPPED`, as the portal reads open
    quantity: Sage lowers QTYORDERED as shipments post. Sage's COMPLETE flags
    are never read (the header's is an enumeration, 1–5). A posted shipment not
    yet invoiced is in neither invoiced nor open orders.
  - Value is still to ship × UNITPRICE, which is per order unit (ORDUNIT; the
    pricing unit, PRIUNTPRC, isn't used). Line and order discounts are not
    deducted, so the value can be above what Sage will invoice. Quantities are
    valued to two decimals (Sage keeps four).
  - Active (1) and Future (2) orders count; Standing (3, a template) and Quote
    (4) don't. Orders on hold count. As in the portal: miscellaneous charges
    (line type 2), the C and MISC items and orders whose reference or
    description says TEST are left out.
  - The expected date is the line's EXPDATE, else the order's. A line with
    neither is left out.
  - An AO links to the first order in its list only, as the portal joins, so
    a second order on the list shows Not planned unless it has its own AO.
    Order numbers and item codes match exactly, trimmed. The item code comes
    from `idfinprod`; the portal's `portal_product_id` override (TASK-2650,
    through a gold table) isn't read.
  - An AO's quantity is its `qtytotal`, in pieces, ÷ `unitsperbox` for a case
    line when it is over 1. The portal values `qtymfgleftoe_c`, but FileMaker
    calculates it: it is 0 once an AO is packed and empty on AOs created in
    the portal, so it can't place a packed AO's goods in Ready. An AO without a
    readable quantity covers nothing.
  - Several AOs on one order and item form one stream: packed first, then by
    scheduled date. Output beyond what the order's open lines of that item
    still need (those due after month end or undated included,
    `LATER_QTY_SQL`) is taken as shipped already, from the oldest, which is
    conservative when AOs were made bigger than the order. The lines of one
    order and item share the first line's unit.
  - AO statuses Realized and Completed are packed; Cancelled AOs never link.
    An AO with no scheduled date is Not planned unless it is packed or its
    bulk is made. A bulk batch is made when FileMaker marks it Realized.
  - The hit rate averages the monthly rates (each rounded to the cent of
    Ready + Planned in time before the mean), uncapped; a month counts once a
    run in the month after it has closed it. A month is measured from its
    first good run only, so the month the forecast or its read access arrives
    isn't measured. With runs kept 90 days, the third complete month's first
    runs are almost always gone, so in practice Realistic averages at most two
    months; three would need about 125 days of run history.

- What shipped (TASK-3144), each reconciled by Setup step 8:
  - A line belongs to its invoice by INVUNIQ (OEINVD.INVUNIQ → OEINVH.INVUNIQ,
    as the portal's Sage sync keys them) and to the month by its invoice's ship
    date, as in the shipments list; the line's own shipment fields aren't read.
  - Line type 2 is a miscellaneous charge, its code MISCCHARGE (else ITEM when
    Sage left that blank); 1 and blank are items, as the portal reads order
    lines. Every line is listed, the forecast's left-out C and MISC items too,
    since Sage counts them in the invoice's totals.
  - An item shows QTYSHIPPED in INVUNIT and UNITPRICE per INVUNIT (the pricing
    unit's price, PRIUNTPRC, isn't read), and Sage's Extended Price as stored
    (EXTINVMISC), never quantity × price recomputed.
  - An invoice adds up when its item lines' EXTINVMISC less INVDISC come to
    INVITMTOT − INVDISCAMT and its charges' EXTINVMISC to INVMISC, to the cent.
    The invoice discount is assumed to sit on the lines' INVDISC; the
    alternative, HDRDISC, is Setup step 8.3. A charge's INVDISC is shown, never
    deducted.
  - Lines are kept with their run for the full 90 days, like its invoices
    (about 2,100 rows a run in a 700-invoice month).

## Dependencies

Depends on:
- **web**: the shared `route()` and `api()` wrappers and the middleware sign-in
  gate.
- **auth** (`src/lib/auth`): Entra app roles in the session.
- **compliance**: `appendEvent` / `appendEventTx` into `mc_events`.
- `src/lib/db`: Mission Control's pool and `withTransaction`.
- `src/lib/db/tls`: the RDS CA bundle, reused for the replica.
- `src/lib/secrets.ts`: `reportingDatabaseConfigured/Url`,
  `reportingMcpConfigured/Url/Token`, `cronConfigured/Secret` and
  `basicAuthConfigured`.
- `@modelcontextprotocol/sdk`: the MCP client for the reporting MCP path.
- `zod`.
- `exceljs`: the workbook (`excel/export.ts`) and reading the import (`excel/import.ts`).

External:
- the PLX reporting replica (read-only), directly or through plx-reporting-mcp
- the Bank of Canada Valet API (no key)

Depended on by: nothing yet.

### Key Files

- `src/lib/reporting/goals/` — the module (barrel `index.ts`; calendar, money, rules, view, queries/, source-db, source-mcp, sql-literal, fx, store, refresh, loader, access, entry-input, entries, excel/)
- Reporting MCP path (TASK-3489): `source-mcp.ts`, `sql-literal.ts`; `tests/reporting-goals-source-mcp.test.ts` (a fake plx-reporting-mcp), `tests/reporting-goals-sql-literal.test.ts`, `tests/reporting-goals-source-select.test.ts`
- `db/migrations/039_reporting_goals.sql` (+ `db/rollback/039_reporting_goals_rollback.sql`)
- `db/migrations/042_reporting_goals_line1.sql` (+ `db/rollback/042_reporting_goals_line1_rollback.sql`) — the Line 1 settings
- `src/app/api/reporting/goals/` — read, refresh, run, export, entry, customer and import routes; `src/app/api/cron/reporting-goals/` — the daily refresh
- `src/components/mc/goals/` — the page; `src/components/mc/charts/column-chart.tsx` — its charts; `src/styles/mc-goals.css`
- `docs/modules/reporting-goals/readonly-grants.sql` — the replica login's grants; `readonly-grants-forecast.sql` — the forecast's grants for the existing login; `readonly-grants-shipment-lines.sql` — the invoice lines' grants for the existing login
- What shipped (TASK-3144): `src/lib/reporting/goals/shipment-lines.ts` (pure), `queries/shipment-lines.ts`, `queries/read-access.ts` (the catalog check it shares with the forecast); `src/app/api/reporting/goals/runs/[id]/shipment-lines/route.ts`; `db/migrations/044_reporting_goals_shipment_lines.sql` (+ rollback); `tests/reporting-goals-shipment-lines{,-export}.test.ts` and the shipment lines block of `tests/reporting-goals-postgres.test.ts` (`tests/reporting-goals-shipment-lines-replica.ts` loads `shipment-lines-source.json`); `e2e/goals-shipment-lines.spec.ts`
- Revenue forecast (TASK-3151): `src/lib/reporting/goals/forecast.ts` (pure), `forecast-read.ts`, `forecast-store.ts`, `queries/forecast-{orders,assembly-orders,access}.ts`, `customer-classes.json` (written by `scripts/goals-customer-classes.mjs`, TASK-3177); `src/components/mc/goals/forecast.tsx`; `db/migrations/043_reporting_goals_forecast.sql` and `045_reporting_goals_forecast_category.sql` (+ rollbacks); `tests/reporting-goals-forecast*.test.ts` and the forecast block of `tests/reporting-goals-postgres.test.ts` (`tests/reporting-goals-forecast-replica.ts` builds the source tables from `forecast-source.json`); `e2e/goals-forecast.spec.ts`
- `tests/reporting-goals-*.test.ts`, `tests/fixtures/reporting-goals/2026-10-14/` — rules, SQL (disposable PG16), route, page and workbook tests against the 2026-10-14 figures (the workbook's LibreOffice recalculation skips where `soffice` isn't installed, as in CI, and logs why); `tests/reporting-goals-entries*.test.ts` — validation, the import plan, and the entry and import routes against PG16 (`tests/reporting-goals-workbook.ts` builds the workbooks); `tests/reporting-goals-roundtrip.test.ts` — the real export read back by the import (the round-trip guarantee)
- `e2e/goals.spec.ts`, `e2e/goals-export.spec.ts`, `e2e/ui-goals-{responsive,a11y}.spec.ts` — the page in a browser (`e2e/helpers/goals.ts` serves the same fixture); `e2e/goals-entries.spec.ts`, `e2e/ui-goals-entries-{responsive,a11y}.spec.ts` — adding, editing, deleting and importing entries (`e2e/helpers/goals-entries.ts` serves the entries API in memory)

## Owner

Vince

## Criticality

Medium
