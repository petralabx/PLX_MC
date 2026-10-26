-- Returns on Goals & Production (TASK-3987): this month's Sage credit notes,
-- subtracted from the Revenue card and shown beside it. Additive and idempotent
-- (expand only).
--
-- Per good refresh run, keyed by the run and deleted with it (so the existing
-- 90-day run retention applies): every credit note dated this month, exactly as
-- read (numeric, no rounding, in each note's currency), and one summary row
-- saying whether the read-only login could read Sage's credit notes and, if
-- not, which columns it lacked. Nothing here writes to FileMaker, Sage or
-- Business Central.
-- Rollback: db/rollback/051_reporting_goals_credit_notes_rollback.sql.

CREATE TABLE IF NOT EXISTS report_snap_credit_note (
    run_id         bigint NOT NULL REFERENCES report_refresh_run (id) ON DELETE CASCADE,
    row_no         integer NOT NULL,
    credit_note    text NOT NULL,
    -- The invoice it credits, when Sage has one.
    invoice        text,
    customer_code  text,
    customer       text,
    -- The credit note's date: the month the return counts in.
    credit_date    date NOT NULL,
    currency       text NOT NULL,
    -- Items less discount before tax (what comes off the goal), credited
    -- charges, and the two together, as Sage keeps them (positive).
    product_value  numeric NOT NULL,
    other_charges  numeric NOT NULL,
    net_before_tax numeric NOT NULL,
    PRIMARY KEY (run_id, row_no)
);

CREATE TABLE IF NOT EXISTS report_snap_credit_note_summary (
    run_id  bigint PRIMARY KEY REFERENCES report_refresh_run (id) ON DELETE CASCADE,
    -- read: the credit notes were read. missing: the login lacked SELECT on the
    -- columns listed in "missing" (schema.table.column), so they weren't.
    access  text NOT NULL CHECK (access IN ('read', 'missing')),
    missing jsonb NOT NULL DEFAULT '[]'::jsonb,
    notes   integer NOT NULL DEFAULT 0
);
