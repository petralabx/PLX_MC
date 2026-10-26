-- INTERIM (TASK-3992): read access for "shipped, not yet invoiced" on Goals &
-- Production, for an existing role: the mc_goals_ro login, or the reporting
-- MCP server's own role (TASK-3558). Until go-live, Sage posts a shipment
-- before AR posts its invoice; the Revenue card adds those shipments as an
-- estimate.
--
-- NOT RUN BY MISSION CONTROL. Run once by a DBA on the PLX reporting database -
-- on the primary when the reporting database is a streaming replica, since
-- grants replicate. Column-level SELECT on exactly the columns the query reads
-- (src/lib/reporting/goals/queries/pending-shipments.ts; the list the refresh
-- checks is PENDING_SHIPMENT_COLUMNS there). No cost or margin columns, no
-- table-level SELECT, no writes, no new role. Re-running it changes nothing.
-- Deliberately not added to readonly-grants.sql: this is temporary.
--
-- ASSUMPTION to confirm first: Sage 300's shipment header and detail (OESHIH,
-- OESHID) are replicated as sage.oe_shipment_header and
-- sage.oe_shipment_detail with Sage's column names lower-cased (shsourcurr:
-- the shipment's currency; shidisc: the line's discount amount). If the
-- replica names them otherwise, correct the query and this script together;
-- until then the refresh reports the columns as missing.
--
--   psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -f readonly-grants-shipments-pending.sql
--   psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -v role=<role> -f readonly-grants-shipments-pending.sql
--
-- Until it runs, the Revenue card says "Shipped, not invoiced: not included
-- (needs access)" and everything else refreshes as before.

-- The grantee: -v role, else mc_goals_ro.
\if :{?role}
\else
  \set role mc_goals_ro
\endif

GRANT USAGE ON SCHEMA sage TO :"role";

GRANT SELECT (shiuniq, shinumber, ordnumber, customer, bilname, shidate, shsourcurr)
    ON sage.oe_shipment_header TO :"role";

GRANT SELECT (shiuniq, linetype, item, qtyshipped, unitprice, shidisc)
    ON sage.oe_shipment_detail TO :"role";

-- Already granted for the invoices; repeated so this script stands alone.
GRANT SELECT (shinumber) ON sage.oe_invoice_header TO :"role";
