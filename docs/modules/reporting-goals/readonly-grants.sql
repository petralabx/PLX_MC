-- Read-only login for Mission Control's Goals & Production report (TASK-2895).
--
-- Run once by a DBA on the PLX reporting database — on the primary when the
-- reporting database is a streaming replica, since roles replicate. It grants
-- SELECT on exactly the columns the report's dataset queries read
-- (src/lib/reporting/goals/queries/) and nothing else. The existing logins do not
-- fit: plx_ro_reporting is documented as sage + filemaker_replica only, and
-- workbench_ro is denied silver.batches.cal_title (the product name).
--
--   psql "$ADMIN_URL" -v password="$(openssl rand -hex 24)" -f readonly-grants.sql
--
-- Then store postgres://mc_goals_ro:<password>@<replica host>:5432/<database>
-- as REPORTING_DATABASE_URL (Vercel project plx-mission-control, Production).
-- tests/reporting-goals-postgres.test.ts runs this script against a disposable
-- copy of the schema and refreshes through the resulting login.

CREATE ROLE mc_goals_ro LOGIN PASSWORD :'password' NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 4;
ALTER ROLE mc_goals_ro SET default_transaction_read_only = on;
ALTER ROLE mc_goals_ro SET statement_timeout = '120s';

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO mc_goals_ro', current_database());
END
$$;

GRANT USAGE ON SCHEMA silver, sage TO mc_goals_ro;

GRANT SELECT (id, display_batch_number, status, status_qc, line, date_completed, date_scheduled,
              planned_qty, actual_qty, cal_title, updated_at)
    ON silver.batches TO mc_goals_ro;

GRANT SELECT (invnumber, shinumber, ordnumber, ponumber, customer, bilname, shipdate, insourcurr,
              invitmtot, invdiscamt, invmisc, invnetnotx, audtdate)
    ON sage.oe_invoice_header TO mc_goals_ro;

GRANT SELECT (idcust, namecust, codecurn)
    ON sage.ar_customer TO mc_goals_ro;

-- Revenue forecast (TASK-3151): Sage order entry, FileMaker assembly orders,
-- their order links and finished products (silver.batches' id,
-- display_batch_number and status are granted above). An existing login gets
-- exactly these from readonly-grants-forecast.sql instead.
GRANT USAGE ON SCHEMA public TO mc_goals_ro;

GRANT SELECT (orduniq, ordnumber, customer, bilname, ponumber, type, expdate, orsourcurr, reference, "desc")
    ON sage.oe_order_header TO mc_goals_ro;

GRANT SELECT (orduniq, linenum, linetype, item, "desc", expdate, qtyordered, qtyshipped, ordunit, unitprice)
    ON sage.oe_order_detail TO mc_goals_ro;

-- The line's item category, for the forecast's category filter (TASK-3177;
-- FORECAST_CATEGORY_COLUMNS). Without it the forecast still fills in, and only
-- that filter waits.
GRANT SELECT (category) ON sage.oe_order_detail TO mc_goals_ro;

GRANT SELECT (id, nameamo_c, status, datescheduled, idfinprod, idbatch, idbatch_pre, oelist_c, qtytotal, unitsperbox)
    ON public.assembly_order TO mc_goals_ro;

GRANT SELECT (idoeitem, idassembly) ON public.order_entry_item_assembly TO mc_goals_ro;
GRANT SELECT (id, idoe) ON public.order_entry_item TO mc_goals_ro;
GRANT SELECT (id, erpcode) ON public.order_entry TO mc_goals_ro;

GRANT SELECT (id, code, erp_code) ON silver.finished_products TO mc_goals_ro;

-- Shipment lines (TASK-3144): Sage's invoice lines, joined to their invoices on
-- invuniq (the header's invnumber and shipdate are granted above). Never the
-- lines' costs (unitcost, exticost) or anything else. An existing login gets
-- exactly these from readonly-grants-shipment-lines.sql instead.
GRANT SELECT (invuniq) ON sage.oe_invoice_header TO mc_goals_ro;

GRANT SELECT (invuniq, linenum, linetype, item, misccharge, "desc", qtyshipped, invunit, unitprice, extinvmisc, invdisc)
    ON sage.oe_invoice_detail TO mc_goals_ro;

-- Returns (TASK-3987): this month's credit notes (queries/credit-notes.ts,
-- CREDIT_NOTE_COLUMNS). An existing login gets exactly these from
-- readonly-grants-credit-notes.sql instead.
GRANT SELECT (crdnumber, invnumber, customer, bilname, crddate, crdsourcurr, crditmtot, crddiscamt, crdmisc, crdnetnotx, adjtype)
    ON sage.oe_credit_note_header TO mc_goals_ro;
