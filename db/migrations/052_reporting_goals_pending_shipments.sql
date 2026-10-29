-- INTERIM (TASK-3992): shipped, not yet invoiced, on Goals & Production. Sage
-- posts a shipment before AR posts its invoice; until go-live the Revenue card
-- adds those shipments as an estimate. Additive and idempotent (expand only).
--
-- Per good refresh run, keyed by the run and deleted with it (so the existing
-- 90-day run retention applies): every posted shipment dated this month that
-- no posted invoice names yet, as read (numeric, in its currency; no cost),
-- and one summary row saying whether the read-only login could read Sage's
-- shipments and, if not, which columns it lacked. Nothing here writes to
-- FileMaker, Sage or Business Central.
-- Rollback: db/rollback/052_reporting_goals_pending_shipments_rollback.sql.

CREATE TABLE IF NOT EXISTS report_snap_pending_shipment (
    run_id        bigint NOT NULL REFERENCES report_refresh_run (id) ON DELETE CASCADE,
    row_no        integer NOT NULL,
    shipment      text NOT NULL,
    order_no      text,
    customer_code text,
    customer      text,
    -- The ship date: the month the estimate counts in.
    ship_date     date NOT NULL,
    currency      text NOT NULL,
    lines         integer NOT NULL,
    -- Order price x quantity shipped less discount, before tax, item lines only.
    product_value numeric NOT NULL,
    PRIMARY KEY (run_id, row_no)
);

CREATE TABLE IF NOT EXISTS report_snap_pending_shipment_summary (
    run_id    bigint PRIMARY KEY REFERENCES report_refresh_run (id) ON DELETE CASCADE,
    access    text NOT NULL CHECK (access IN ('read', 'missing')),
    missing   jsonb NOT NULL DEFAULT '[]'::jsonb,
    shipments integer NOT NULL DEFAULT 0
);
