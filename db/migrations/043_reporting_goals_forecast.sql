-- Revenue forecast on Goals & Production (TASK-3151). Additive and idempotent.
-- Numbered 043: 042 belongs to PR #346 (TASK-3142, Line 1 kg goal), which is not
-- merged yet, so 043 must merge after 042. Nothing here depends on 042's objects.
--
-- Per good refresh run, keyed by the run and deleted with it (so the existing
-- 90-day run retention applies): the open Sage order lines due by month end, the
-- FileMaker assembly orders linked to them or scheduled this month, and one
-- summary row: whether the read-only login could read the forecast's tables
-- (and which columns it lacked), and the four bucket totals in CAD from Sage and
-- FileMaker only, which the hit rate is measured from. Amounts are stored as
-- read (numeric, no rounding). Nothing here writes to FileMaker, Sage or
-- Business Central. Rollback: db/rollback/043_reporting_goals_forecast_rollback.sql.

CREATE TABLE IF NOT EXISTS report_snap_forecast_line (
    run_id        bigint NOT NULL REFERENCES report_refresh_run (id) ON DELETE CASCADE,
    row_no        integer NOT NULL,
    order_no      text NOT NULL,
    line_no       integer,
    customer_code text,
    customer      text,
    po            text,
    item          text NOT NULL,
    description   text,
    -- The line's expected ship date, else the order's.
    expected      date NOT NULL,
    -- Still to ship, in the line's order unit; the unit price is per that unit, in the order's currency.
    qty           numeric NOT NULL,
    unit          text,
    unit_price    numeric NOT NULL,
    currency      text NOT NULL,
    -- Still to ship on the order's open lines of the same item due after month end or undated.
    later_qty     numeric NOT NULL DEFAULT 0,
    PRIMARY KEY (run_id, row_no)
);

CREATE TABLE IF NOT EXISTS report_snap_forecast_ao (
    run_id        bigint NOT NULL REFERENCES report_refresh_run (id) ON DELETE CASCADE,
    ao_id         text NOT NULL,
    ao            text,
    status        text,
    scheduled     date,
    item          text,
    -- The AO's free-text order list (oelist_c), else its orders in FileMaker's order entry.
    oe_list       text,
    -- Pieces.
    qty           numeric,
    units_per_box numeric,
    batch         text,
    batch_status  text,
    -- Its order and item match an open Sage order line of any date.
    open_order    boolean NOT NULL,
    PRIMARY KEY (run_id, ao_id)
);

CREATE TABLE IF NOT EXISTS report_snap_forecast_summary (
    run_id          bigint PRIMARY KEY REFERENCES report_refresh_run (id) ON DELETE CASCADE,
    -- read: both forecast datasets were read. missing: the login lacked SELECT on
    -- the columns listed in "missing" (schema.table.column), so neither was.
    access          text NOT NULL CHECK (access IN ('read', 'missing')),
    missing         jsonb NOT NULL DEFAULT '[]'::jsonb,
    lines           integer NOT NULL DEFAULT 0,
    ready_cad       numeric,
    planned_cad     numeric,
    late_cad        numeric,
    not_planned_cad numeric,
    CHECK (access = 'missing'
           OR (ready_cad IS NOT NULL AND planned_cad IS NOT NULL AND late_cad IS NOT NULL AND not_planned_cad IS NOT NULL))
);
