-- Revenue forecast read access for the existing mc_goals_ro login (TASK-3151).
--
-- Run once by a DBA on the PLX reporting database — on the primary when the
-- reporting database is a streaming replica, since grants replicate. It adds
-- column-level SELECT on exactly the columns the forecast's two queries read
-- (src/lib/reporting/goals/queries/forecast-*.ts; the list the refresh checks
-- is FORECAST_COLUMNS in queries/forecast-access.ts) and USAGE on their
-- schemas. Nothing else: no table-level SELECT, no writes, no new role.
-- Re-running it changes nothing. Fresh installs get the same grants from
-- readonly-grants.sql.
--
--   psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -f readonly-grants-forecast.sql
--
-- Until it runs, every refresh records that the forecast is waiting for read
-- access (naming the columns it lacks), the page says so, and everything else
-- refreshes as before. The next refresh after it runs fills the forecast in.
-- tests/reporting-goals-postgres.test.ts runs it against a disposable replica.

GRANT USAGE ON SCHEMA sage, silver, public TO mc_goals_ro;

GRANT SELECT (orduniq, ordnumber, customer, bilname, ponumber, type, expdate, orsourcurr, reference, "desc")
    ON sage.oe_order_header TO mc_goals_ro;

GRANT SELECT (orduniq, linenum, linetype, item, "desc", expdate, qtyordered, qtyshipped, ordunit, unitprice)
    ON sage.oe_order_detail TO mc_goals_ro;

GRANT SELECT (id, nameamo_c, status, datescheduled, idfinprod, idbatch, idbatch_pre, oelist_c, qtytotal, unitsperbox)
    ON public.assembly_order TO mc_goals_ro;

GRANT SELECT (idoeitem, idassembly) ON public.order_entry_item_assembly TO mc_goals_ro;
GRANT SELECT (id, idoe) ON public.order_entry_item TO mc_goals_ro;
GRANT SELECT (id, erpcode) ON public.order_entry TO mc_goals_ro;

GRANT SELECT (id, code, erp_code) ON silver.finished_products TO mc_goals_ro;
