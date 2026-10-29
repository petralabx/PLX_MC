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
-- Confirmed on the UAT Sage copy (Ricardo Savelli, 2026-10-28): the tables
-- are sage.oe_shipment_header and sage.oe_shipment_detail, the columns are
-- text, shidate is YYYYMMDD, shsourcurr is CAD or USD, shidisc is the
-- line's discount amount, and hdrdisc is the header discount spread onto
-- the line. A shipment is pending when trim(numinvoice) = '0'
-- (1 means AR has posted the invoice; lastinvnum holds that invoice number).
-- The invoice header has no shinumber, so this script does not grant it.
-- Sage has no void flag. A deleted shipment is removed. Verified on live
-- Sage: uninvoiced means numinvoice 0, and that check leaves no orphan rows.
-- Header complete = 1 on the uninvoiced rows.
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

GRANT SELECT (shiuniq, shinumber, ordnumber, customer, bilname, shidate, shsourcurr, numinvoice)
    ON sage.oe_shipment_header TO :"role";

GRANT SELECT (shiuniq, linetype, qtyshipped, unitprice, shidisc, hdrdisc)
    ON sage.oe_shipment_detail TO :"role";
