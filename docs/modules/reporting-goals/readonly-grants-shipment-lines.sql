-- Shipment lines read access for an existing role (TASK-3144): the
-- mc_goals_ro login, or the reporting MCP server's own role (TASK-3558).
--
-- Run once by a DBA on the PLX reporting database — on the primary when the
-- reporting database is a streaming replica, since grants replicate. It adds
-- column-level SELECT on exactly the columns the shipment-lines query reads that
-- the login doesn't have yet (src/lib/reporting/goals/queries/shipment-lines.ts;
-- the list the refresh checks is SHIPMENT_LINE_COLUMNS there): the invoice
-- header's join key and the invoice lines' columns. The header's invnumber and
-- shipdate came with readonly-grants.sql. Nothing else: no table-level SELECT,
-- no costs (unitcost, exticost), no writes, no new role. Re-running it changes
-- nothing. Fresh installs get the same grants from readonly-grants.sql.
--
--   psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -f readonly-grants-shipment-lines.sql
--
-- That grants mc_goals_ro. Through plx-reporting-mcp the refresh checks the
-- MCP server's own role instead, so name that role with -v role (psql 10+):
--
--   psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -v role=<role> -f readonly-grants-shipment-lines.sql
--
-- Until it runs, every refresh records that the invoice lines are waiting for
-- read access (naming the columns it lacks), an opened invoice on the page says
-- so, and everything else refreshes as before. The next refresh after it runs
-- brings the lines in. tests/reporting-goals-postgres.test.ts runs it (twice)
-- against a disposable replica.

-- The grantee: -v role, else mc_goals_ro.
\if :{?role}
\else
  \set role mc_goals_ro
\endif

GRANT USAGE ON SCHEMA sage TO :"role";

GRANT SELECT (invuniq) ON sage.oe_invoice_header TO :"role";

GRANT SELECT (invuniq, linenum, linetype, item, misccharge, "desc", qtyshipped, invunit, unitprice, extinvmisc, invdisc)
    ON sage.oe_invoice_detail TO :"role";
