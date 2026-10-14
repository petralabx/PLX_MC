-- Goals & Production report (TASK-2895). Additive and idempotent.
-- Numbered 039: 038 is held by the unmerged branch claude/sp-mcp-workbench-readonly.
--
-- Source data stays in the read-only reporting replica (FileMaker silver.batches,
-- Sage sage.*); nothing here writes to FileMaker, Sage or Business Central.
-- Mission Control keeps: refresh runs, one snapshot table per dataset (keyed by
-- run, deleted with it), configuration (holidays, truckload customers, goal
-- settings), the USD/CAD rate history, and manual entries with their history and
-- imports. Rollback: db/rollback/039_reporting_goals_rollback.sql.

CREATE TABLE IF NOT EXISTS report_refresh_run (
    id                bigserial PRIMARY KEY,
    trigger           text NOT NULL CHECK (trigger IN ('cron', 'user')),
    requested_by      text NOT NULL,
    -- The Toronto calendar date the run computed "today" as (never UTC current_date).
    today             date NOT NULL,
    status            text NOT NULL DEFAULT 'running'
                      CHECK (status IN ('running', 'succeeded', 'failed')),
    step              text,
    started_at        timestamptz NOT NULL DEFAULT now(),
    finished_at       timestamptz,
    error             text,
    production_cutoff date,
    sage_cutoff       date,
    fx_rate           numeric(12,6),
    fx_rate_date      date,
    -- boc: fetched from the Bank of Canada this run; stored: the fetch failed and
    -- the last stored rate was used (the page flags it).
    fx_source         text CHECK (fx_source IN ('boc', 'stored')),
    row_counts        jsonb NOT NULL DEFAULT '{}'::jsonb,
    CHECK (status <> 'succeeded' OR (finished_at IS NOT NULL AND fx_rate IS NOT NULL))
);

-- At most one refresh is running at any time (the durable half of the claim;
-- the advisory lock serializes the check-and-insert).
CREATE UNIQUE INDEX IF NOT EXISTS report_refresh_run_one_running_idx
    ON report_refresh_run ((true)) WHERE status = 'running';

CREATE INDEX IF NOT EXISTS report_refresh_run_status_idx
    ON report_refresh_run (status, id DESC);

-- ─── Snapshots: one table per dataset query ────────────────────────────────
-- Amounts are stored exactly as the source sums them (numeric, no rounding).

CREATE TABLE IF NOT EXISTS report_snap_goal_summary (
    run_id                bigint PRIMARY KEY REFERENCES report_refresh_run (id) ON DELETE CASCADE,
    large_done            integer NOT NULL,
    large_scheduled_ahead integer NOT NULL,
    large_open_past_date  integer NOT NULL
);

CREATE TABLE IF NOT EXISTS report_snap_daily (
    run_id     bigint NOT NULL REFERENCES report_refresh_run (id) ON DELETE CASCADE,
    day        date NOT NULL,
    large_done integer NOT NULL,
    large_open integer NOT NULL,
    cad_this   numeric NOT NULL,
    usd_this   numeric NOT NULL,
    cad_last   numeric NOT NULL,
    usd_last   numeric NOT NULL,
    PRIMARY KEY (run_id, day)
);

CREATE TABLE IF NOT EXISTS report_snap_truckload (
    run_id      bigint NOT NULL REFERENCES report_refresh_run (id) ON DELETE CASCADE,
    code        text NOT NULL,
    shipment    text NOT NULL,
    ship_date   date NOT NULL,
    product_usd numeric NOT NULL,
    product_cad numeric NOT NULL,
    this_month  boolean NOT NULL,
    PRIMARY KEY (run_id, code, shipment)
);

CREATE TABLE IF NOT EXISTS report_snap_revenue (
    run_id         bigint NOT NULL REFERENCES report_refresh_run (id) ON DELETE CASCADE,
    currency       text NOT NULL,
    this_month     boolean NOT NULL,
    invoices       integer NOT NULL,
    net_before_tax numeric NOT NULL,
    PRIMARY KEY (run_id, currency, this_month)
);

CREATE TABLE IF NOT EXISTS report_snap_shipment (
    run_id         bigint NOT NULL REFERENCES report_refresh_run (id) ON DELETE CASCADE,
    row_no         integer NOT NULL,
    invoice        text NOT NULL,
    shipment       text,
    order_no       text,
    po             text,
    customer_code  text,
    customer       text,
    ship_date      date NOT NULL,
    currency       text NOT NULL,
    product_value  numeric NOT NULL,
    other_charges  numeric NOT NULL,
    net_before_tax numeric NOT NULL,
    PRIMARY KEY (run_id, row_no)
);

CREATE TABLE IF NOT EXISTS report_snap_batch (
    run_id    bigint NOT NULL REFERENCES report_refresh_run (id) ON DELETE CASCADE,
    batch_id  text NOT NULL,
    batch     text NOT NULL,
    product   text,
    status    text NOT NULL,
    status_qc text,
    line      text,
    day       date NOT NULL,
    kg        numeric NOT NULL,
    PRIMARY KEY (run_id, batch_id)
);

CREATE TABLE IF NOT EXISTS report_snap_batch_history (
    run_id    bigint NOT NULL REFERENCES report_refresh_run (id) ON DELETE CASCADE,
    batch_id  text NOT NULL,
    batch     text NOT NULL,
    day       date NOT NULL,
    kg        numeric NOT NULL,
    status_qc text,
    PRIMARY KEY (run_id, batch_id)
);

-- Reference sets for manual-entry matching (normalized: lower case, no spaces).
-- Tens of thousands of rows a run, so only the last few good runs keep them.
CREATE TABLE IF NOT EXISTS report_snap_reference (
    run_id bigint NOT NULL REFERENCES report_refresh_run (id) ON DELETE CASCADE,
    kind   text NOT NULL CHECK (kind IN ('filemaker', 'sage')),
    ref    text NOT NULL,
    PRIMARY KEY (run_id, kind, ref)
);

CREATE TABLE IF NOT EXISTS report_snap_customer (
    run_id   bigint NOT NULL REFERENCES report_refresh_run (id) ON DELETE CASCADE,
    code     text NOT NULL,
    name     text NOT NULL,
    currency text,
    PRIMARY KEY (run_id, code)
);

-- ─── USD/CAD history (Bank of Canada FXUSDCAD; every fetched rate) ──────────

CREATE TABLE IF NOT EXISTS report_fx_rate (
    series     text NOT NULL,
    rate_date  date NOT NULL,
    rate       numeric(12,6) NOT NULL CHECK (rate > 0),
    source     text NOT NULL DEFAULT 'boc-valet',
    fetched_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (series, rate_date)
);

-- ─── Configuration ──────────────────────────────────────────────────────────

-- Ontario public holidays (Employment Standards Act) on their observed dates.
-- Plant shutdowns can be added as rows. The Civic Holiday is a working day.
CREATE TABLE IF NOT EXISTS report_holiday (
    day  date PRIMARY KEY,
    name text NOT NULL
);

INSERT INTO report_holiday (day, name) VALUES
    ('2026-01-01', 'New Year''s Day'),
    ('2026-02-16', 'Family Day'),
    ('2026-04-03', 'Good Friday'),
    ('2026-05-18', 'Victoria Day'),
    ('2026-07-01', 'Canada Day'),
    ('2026-09-07', 'Labour Day'),
    ('2026-10-12', 'Thanksgiving'),
    ('2026-12-25', 'Christmas Day'),
    ('2026-12-28', 'Boxing Day (observed)'),
    ('2027-01-01', 'New Year''s Day'),
    ('2027-02-15', 'Family Day'),
    ('2027-03-26', 'Good Friday'),
    ('2027-05-24', 'Victoria Day'),
    ('2027-07-01', 'Canada Day'),
    ('2027-09-06', 'Labour Day'),
    ('2027-10-11', 'Thanksgiving'),
    ('2027-12-27', 'Christmas Day (observed)'),
    ('2027-12-28', 'Boxing Day (observed)'),
    ('2028-01-03', 'New Year''s Day (observed)'),
    ('2028-02-21', 'Family Day'),
    ('2028-04-14', 'Good Friday'),
    ('2028-05-22', 'Victoria Day'),
    ('2028-07-03', 'Canada Day (observed)'),
    ('2028-09-04', 'Labour Day'),
    ('2028-10-09', 'Thanksgiving'),
    ('2028-12-25', 'Christmas Day'),
    ('2028-12-26', 'Boxing Day')
ON CONFLICT (day) DO NOTHING;

CREATE TABLE IF NOT EXISTS report_ftl_customer (
    code          text PRIMARY KEY,
    display_name  text NOT NULL,
    -- Lower-case fragments matched against a manual entry's customer name.
    name_patterns text[] NOT NULL DEFAULT '{}',
    sort_order    integer NOT NULL,
    active        boolean NOT NULL DEFAULT true
);

INSERT INTO report_ftl_customer (code, display_name, name_patterns, sort_order) VALUES
    ('A1TEXT11', 'A1 American', ARRAY['a1 american', 'tiger hospitality'], 1),
    ('PETSUP10', 'Pet Supplies Plus', ARRAY['pet supplies plus'], 2),
    ('DIVE11', 'Diversified Hospitality', ARRAY['diversified'], 3),
    ('1SHOP11', '1-Shoppe', ARRAY['1-shoppe', '1 shoppe'], 4),
    ('SOAP11', 'Soapbox', ARRAY['soapbox', 'soap box'], 5)
ON CONFLICT (code) DO NOTHING;

-- Goal definitions. A NULL value means "not set" (no truckload target yet).
CREATE TABLE IF NOT EXISTS report_goal_setting (
    key        text PRIMARY KEY,
    value      numeric,
    note       text,
    updated_by text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO report_goal_setting (key, value, note, updated_by) VALUES
    ('large_batches_per_working_day', 2, 'Large batches per working day', 'migration:039'),
    ('large_batch_min_kg', 7500, 'A large batch is this many kg or more', 'migration:039'),
    ('full_truckload_min_usd', 18000, 'US$20,000 truckload less the 10% allowance, before tax and freight', 'migration:039'),
    ('revenue_target_cad', 1000000, 'Shipped revenue, net before tax, CAD per month', 'migration:039'),
    ('full_truckloads_per_month', NULL, 'No full-truckload target set yet', 'migration:039')
ON CONFLICT (key) DO NOTHING;

-- ─── Manual entries ─────────────────────────────────────────────────────────
-- Live, never snapshotted: their effect is computed at read time against the
-- latest good refresh. Incomplete entries are allowed and shown with a status.

CREATE SEQUENCE IF NOT EXISTS report_manual_entry_seq;

CREATE TABLE IF NOT EXISTS report_manual_entry (
    id            bigserial PRIMARY KEY,
    entry_id      text NOT NULL UNIQUE,
    type          text NOT NULL CHECK (type IN ('Batch', 'Shipment')),
    day           date,
    reference     text,
    customer      text,
    -- Sage customer code when the customer was picked from the list.
    customer_code text,
    product       text,
    kg            numeric(14,3),
    product_value numeric(14,2),
    freight       numeric(14,2),
    currency      text CHECK (currency IS NULL OR currency IN ('CAD', 'USD')),
    note          text,
    entered_by    text NOT NULL,
    entered_at    timestamptz NOT NULL DEFAULT now(),
    updated_by    text NOT NULL,
    updated_at    timestamptz NOT NULL DEFAULT now(),
    deleted_at    timestamptz,
    deleted_by    text,
    -- 'ui' or 'import:<file name>'
    source        text NOT NULL
);

CREATE TABLE IF NOT EXISTS report_manual_import (
    id           bigserial PRIMARY KEY,
    file_name    text NOT NULL,
    file_sha256  text NOT NULL,
    file_bytes   bytea NOT NULL CHECK (octet_length(file_bytes) <= 2097152),
    uploaded_by  text NOT NULL,
    uploaded_at  timestamptz NOT NULL DEFAULT now(),
    status       text NOT NULL DEFAULT 'previewed'
                 CHECK (status IN ('previewed', 'applied', 'rejected', 'superseded')),
    -- Fingerprint of the entry list the preview was computed against; confirm is
    -- refused if the list changed since.
    base_version text NOT NULL,
    preview      jsonb NOT NULL,
    applied_at   timestamptz,
    applied_by   text
);

-- Append-only before/after record of every entry change (readable by the report's
-- Viewers only; mc_events gets ids and counts, never values).
CREATE TABLE IF NOT EXISTS report_manual_entry_version (
    id        bigserial PRIMARY KEY,
    entry_id  text NOT NULL,
    action    text NOT NULL CHECK (action IN ('created', 'updated', 'deleted')),
    actor     text NOT NULL,
    at        timestamptz NOT NULL DEFAULT now(),
    import_id bigint REFERENCES report_manual_import (id),
    before    jsonb,
    after     jsonb
);

CREATE INDEX IF NOT EXISTS report_manual_entry_version_entry_idx
    ON report_manual_entry_version (entry_id, at);
