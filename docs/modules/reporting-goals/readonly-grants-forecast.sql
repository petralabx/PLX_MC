-- Revenue forecast read access for an existing role (TASK-3151): the
-- mc_goals_ro login, or the reporting MCP server's own role (TASK-3558).
--
-- Run once by a DBA on the PLX reporting database — on the primary when the
-- reporting database is a streaming replica, since grants replicate. It adds
-- column-level SELECT on exactly the columns the forecast's two queries read
-- (src/lib/reporting/goals/queries/forecast-*.ts; the lists the refresh checks
-- are FORECAST_COLUMNS and FORECAST_CATEGORY_COLUMNS in
-- queries/forecast-access.ts) and USAGE on their schemas. Nothing else: no
-- table-level SELECT, no writes, no new role. Re-running it changes nothing,
-- except to grant a column added since: a login granted before TASK-3177 gets
-- Sage's item category on a re-run. Fresh installs get the same grants from
-- readonly-grants.sql.
--
--   psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -f readonly-grants-forecast.sql
--
-- That grants mc_goals_ro. Through plx-reporting-mcp the refresh checks the
-- MCP server's own role instead, so name that role with -v role (psql 10+):
--
--   psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -v role=<role> -f readonly-grants-forecast.sql
--
-- Until it runs, every refresh records that the forecast is waiting for read
-- access (naming the columns it lacks), the page says so, and everything else
-- refreshes as before. The next refresh after it runs fills the forecast in.
-- tests/reporting-goals-postgres.test.ts runs it against a disposable replica.

-- The grantee: -v role, else mc_goals_ro.
\if :{?role}
\else
  \set role mc_goals_ro
\endif

GRANT USAGE ON SCHEMA sage, silver, public TO :"role";

GRANT SELECT (orduniq, ordnumber, customer, bilname, ponumber, type, expdate, orsourcurr, reference, "desc")
    ON sage.oe_order_header TO :"role";

GRANT SELECT (orduniq, linenum, linetype, item, "desc", expdate, qtyordered, qtyshipped, ordunit, unitprice)
    ON sage.oe_order_detail TO :"role";

-- The line's item category, for the forecast's category filter (TASK-3177;
-- FORECAST_CATEGORY_COLUMNS). Without it the forecast still fills in, and only
-- that filter waits.
GRANT SELECT (category) ON sage.oe_order_detail TO :"role";

GRANT SELECT (id, nameamo_c, status, datescheduled, idfinprod, idbatch, idbatch_pre, oelist_c, qtytotal, unitsperbox)
    ON public.assembly_order TO :"role";

GRANT SELECT (idoeitem, idassembly) ON public.order_entry_item_assembly TO :"role";
GRANT SELECT (id, idoe) ON public.order_entry_item TO :"role";
GRANT SELECT (id, erpcode) ON public.order_entry TO :"role";

GRANT SELECT (id, code, erp_code) ON silver.finished_products TO :"role";
