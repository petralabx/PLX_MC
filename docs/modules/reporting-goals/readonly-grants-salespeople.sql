-- Salesperson filter read access for an existing role (TASK-4277): the
-- mc_goals_ro login, or the reporting MCP server's own role (TASK-3558).
--
-- Run once by a DBA on the PLX reporting database - on the primary when the
-- reporting database is a streaming replica, since grants replicate. It adds
-- column-level SELECT on exactly the columns the salesperson lookup reads
-- (src/lib/reporting/goals/queries/salespeople.ts; the list the page checks
-- is SALESPERSON_COLUMNS there): each customer's five salesperson slots and
-- the salespeople's names. Never the split percents (pctsasplt1-5), the
-- salespeople's commission rates, targets or sales figures, nothing at table
-- level, no writes, no new role. Re-running it changes nothing. Fresh installs
-- get the same grants from readonly-grants.sql.
--
--   psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -f readonly-grants-salespeople.sql
--
-- Through plx-reporting-mcp the page checks the MCP server's own role
-- instead, so name that role with -v role (psql 10+):
--
--   psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -v role=<role> -f readonly-grants-salespeople.sql
--
-- Until it runs, the page says the salesperson filter is waiting for read
-- access (naming the columns it lacks) and shows every customer. Nothing else
-- changes; the refresh doesn't read these columns.

-- The grantee: -v role, else mc_goals_ro.
\if :{?role}
\else
  \set role mc_goals_ro
\endif

GRANT USAGE ON SCHEMA sage TO :"role";

GRANT SELECT (idcust, codeslsp1, codeslsp2, codeslsp3, codeslsp4, codeslsp5)
    ON sage.ar_customer TO :"role";

GRANT SELECT (codeslsp, nameempl)
    ON sage.ar_salesperson TO :"role";
