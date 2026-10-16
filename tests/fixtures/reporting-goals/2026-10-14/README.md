# Goals & Production fixtures — 2026-10-14

Test data for the Goals & Production report (`src/lib/reporting/goals/`),
pinned to Toronto date **2026-10-14** and a USD/CAD rate of **1.4219** (the
market spot the prototype used).

| File | What it holds | Used by |
|---|---|---|
| `source.json` | Rows for synthetic `silver.batches`, `sage.oe_invoice_header` and `sage.ar_customer` tables, in their source shapes (Sage columns as space-padded text, `shipdate` as `YYYYMMDD`) | `tests/reporting-goals-postgres.test.ts` loads them into a disposable PG16 |
| `datasets.json` | What every dataset query must return for today = 2026-10-14 | Postgres test (SQL output must equal it) and the pure rules tests |
| `expected.json` | The brief's published numbers, plus the prototype's per-day figures | Rules and view tests |
| `entries.json` | Manual-entry scenarios M1–M7 from the brief | Rules and view tests |
| `forecast-source.json` | Revenue forecast (TASK-3151) source rows: Sage `oe_order_header`/`oe_order_detail` (space-padded text, `YYYYMMDD` dates, with the traps the SQL must leave out), FileMaker `assembly_order`, its order-entry links, `silver.finished_products` and the AOs' bulk batches | `tests/reporting-goals-forecast-replica.ts` loads them for the Postgres test |
| `forecast.json` | What the two forecast queries must return for those rows, plus the hit-rate history the page fixture uses (an August run from before the forecast, and September's first run) | Postgres test (SQL output must equal it), the forecast, page, workbook and browser tests |

## Provenance

**From the prototype's export** (`PLX goals and production 2026-10-14.xlsx`):

- This month's 94 batch-list rows (30 completed, 44 scheduled from today,
  20 open past their date): batch, product, date, kg, line, status / QC status.
- This month's 70 Sage invoices: numbers, customer billing names (including
  A1 American's non-breaking space), ship dates, currency, product value,
  other charges and net before tax. PO fields that held a customer contact's
  name are replaced with `PO-REF-nnn`, so the fixtures carry no personal data.

**Synthetic**, built so every published figure still holds:

- Customer codes for customers other than the five truckload customers.
- September's invoices. Truckload shipments match the prototype's per-customer
  figures (7 full, 5 partial, US$215,065.66 of product). CAD invoices fill each
  day so September's running total matches the prototype's "last month to
  date" column within $0.50 and totals $1,007,365.11 at 1.4219.
- July–September completed batches (for the three-month size chart), older
  batches and invoices (for manual-entry references and the 120-day window).
- Rows every query must exclude: cancelled and generated batches, an open
  batch with `planned_qty` 0 or null, open batches scheduled last month or
  next month, and a May invoice outside the reference window.
- Traps from the brief: three invoices with a discount (`invitmtot −
  invdiscamt`), three completed batches without `actual_qty` (sized on
  `planned_qty`), a two-invoice shipment that is only a full load when its
  invoices are summed, a truckload freight-only invoice (revenue, never a
  load), and an invoice shipped 2026-09-30 but dated 2026-10-01 (counts in
  September by ship date).

Replace these with the prototype's saved query results when they are
available; the tests compare against `expected.json`, not against the files'
provenance.

The forecast fixture is **synthetic** (order numbers `OR1000158877` and
`OR10001600xx`, AOs `114xx`, bulk batches `9900xx`, none of which the other
files use). It covers every bucket rule, an order line split across three AOs
and one left partly unplanned, AO output beyond the order taken as shipped,
a November line riding on its order's October line of the same item
(`laterQty`), an AO listing two orders, a cancelled and an undated AO, a EUR
line, overdue lines and production with no order behind it. Derived
independently (Python `Decimal`, half to even) at USD/CAD 1.4219 with M1–M7:
Ready 53,762.80 · Planned in time 64,627.53 · Late 27,917.55 · Not planned
12,785.70; Theoretical 527,018.41 · At risk 40,703.25 · Pace 953,465.52 ·
Realistic 503,340.34 (September's 80% hit rate).
