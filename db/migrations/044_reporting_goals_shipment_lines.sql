-- What shipped on Goals & Production (TASK-3144): the lines of each Sage invoice
-- in the shipments list. Additive and idempotent (expand only).
--
-- Per good refresh run, keyed by the run and deleted with it (so the existing
-- 90-day run retention applies): every line of the run's Sage invoices shipped
-- this month, items and miscellaneous charges alike, exactly as read (numeric,
-- no rounding, in each invoice's currency), and one summary row saying whether
-- the read-only login could read Sage's invoice lines and, if not, which columns
-- it lacked. The page reads only the summary; the lines load on demand. Nothing
-- here writes to FileMaker, Sage or Business Central.
-- Rollback: db/rollback/044_reporting_goals_shipment_lines_rollback.sql.

CREATE TABLE IF NOT EXISTS report_snap_shipment_line (
    run_id      bigint NOT NULL REFERENCES report_refresh_run (id) ON DELETE CASCADE,
    row_no      integer NOT NULL,
    -- The invoice's number: the shipments list keys the invoice's row by it.
    invoice     text NOT NULL,
    -- Sage's line number (32, 64, …), the lines' order.
    line_no     integer,
    -- item: Sage line type 1 (or blank); charge: line type 2, a miscellaneous charge such as freight.
    kind        text NOT NULL CHECK (kind IN ('item', 'charge')),
    -- The item's code, or the charge's.
    code        text,
    description text,
    -- Quantity shipped in the invoice unit; the unit price is per that unit.
    qty         numeric NOT NULL,
    unit        text,
    unit_price  numeric NOT NULL,
    -- Sage's extended amount (EXTINVMISC) and the line's discount (INVDISC).
    amount      numeric NOT NULL,
    discount    numeric NOT NULL,
    PRIMARY KEY (run_id, row_no)
);

CREATE TABLE IF NOT EXISTS report_snap_shipment_line_summary (
    run_id  bigint PRIMARY KEY REFERENCES report_refresh_run (id) ON DELETE CASCADE,
    -- read: the lines were read. missing: the login lacked SELECT on the columns
    -- listed in "missing" (schema.table.column), so they weren't.
    access  text NOT NULL CHECK (access IN ('read', 'missing')),
    missing jsonb NOT NULL DEFAULT '[]'::jsonb,
    lines   integer NOT NULL DEFAULT 0
);
