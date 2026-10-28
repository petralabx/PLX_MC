-- Credit notes read access for an existing role (TASK-3987): the mc_goals_ro
-- login, or the reporting MCP server's own role (TASK-3558).
--
-- Run once by a DBA on the PLX reporting database - on the primary when the
-- reporting database is a streaming replica, since grants replicate. It adds
-- column-level SELECT on exactly the columns the credit-notes query reads
-- (src/lib/reporting/goals/queries/credit-notes.ts; the list the refresh checks
-- is CREDIT_NOTE_COLUMNS there). Nothing else: no table-level SELECT, no
-- writes, no new role. Re-running it changes nothing. Fresh installs get the
-- same grants from readonly-grants.sql.
--
-- Confirmed 2026-10-27 on the staging replica: Sage 300's credit/debit note
-- header (OECRDH) is sage.oe_crdh. It is not in the sync's friendly-name map,
-- so there is no sage.oe_credit_note_header. Source currency is crsourcurr
-- (an invoice's insourcurr), not crdsourcurr.
--
-- The build already on Mission Control still selects sage.oe_credit_note_header
-- .crdsourcurr. Until this correction is deployed, a compatibility view of that
-- name (crsourcurr AS crdsourcurr) on the staging primary lets that build read
-- the real table. Drop the view once the deployed refresh reads sage.oe_crdh.
--
--   psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -f readonly-grants-credit-notes.sql
--
-- Through plx-reporting-mcp the refresh checks the MCP server's own role
-- instead, so name that role with -v role (psql 10+):
--
--   psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -v role=<role> -f readonly-grants-credit-notes.sql
--
-- Until it runs, every refresh records that the credit notes are waiting for
-- read access (naming the columns it lacks), the Revenue card says returns
-- aren't deducted yet, and everything else refreshes as before.

-- The grantee: -v role, else mc_goals_ro.
\if :{?role}
\else
  \set role mc_goals_ro
\endif

GRANT USAGE ON SCHEMA sage TO :"role";

GRANT SELECT (crdnumber, invnumber, customer, bilname, crddate, crsourcurr, crditmtot, crddiscamt, crdmisc, crdnetnotx, adjtype)
    ON sage.oe_crdh TO :"role";
