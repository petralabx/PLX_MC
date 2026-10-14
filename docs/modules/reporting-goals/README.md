# Module: reporting-goals

## What

The **Goals & Production** report (sidebar: Reporting → Goals & production;
the page arrives in a follow-up PR) and its domain module. It tracks three
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
   | `GET /api/reporting/goals` | Viewer | The page model |
   | `POST /api/reporting/goals/refresh` | Editor | Claims a run and answers 202 with it; the run finishes in `after()`. 409 while one is running, 429 within 5 minutes of the last, 503 if the reporting database is not connected. |
   | `GET /api/reporting/goals/runs/[id]` | Viewer | One run's status, for polling |
   | `GET /api/cron/reporting-goals` | Vercel Cron | Runs at 10:00 and 11:00 UTC on weekdays and acts only at 06:00 Toronto. Needs the `CRON_SECRET` bearer, compared timing-safe. |

8. **Audit**
   - `mc_events` records `reporting.goals.refresh.succeeded|failed` (run id,
     counts and error code, never values) and `reporting.goals.denied`.
   - Entry history goes to `report_manual_entry_version`, which only the
     report's Viewers can read.

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

External:
- the PLX reporting replica (read-only)
- the Bank of Canada Valet API (no key)

Depended on by: nothing yet.

### Key Files

- `src/lib/reporting/goals/` — the module (barrel `index.ts`; calendar, money, rules, view, queries/, source-db, fx, store, refresh, loader, access)
- `db/migrations/039_reporting_goals.sql` (+ `db/rollback/039_reporting_goals_rollback.sql`)
- `src/app/api/reporting/goals/` — read, refresh and run routes; `src/app/api/cron/reporting-goals/` — the daily refresh
- `docs/modules/reporting-goals/readonly-grants.sql` — the replica login's grants
- `tests/reporting-goals-*.test.ts`, `tests/fixtures/reporting-goals/2026-10-14/` — rules, SQL (disposable PG16) and route tests against the 2026-10-14 figures

## Owner

Vince

## Criticality

Medium
