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
