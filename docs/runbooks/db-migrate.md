# MC non-production schema deployment

Owner: Vince (vince@petrasoap.com). This Action is a deployment gate for the
completedAt application release. It applies only already-merged numbered SQL,
including 031–035 as they land; gaps are valid. It adds no schema itself.

Vince must add these for the automatic path (a distinct, verified non-production
UAT database only): secret `MC_UAT_DATABASE_URL`, variable `MC_UAT_APPROVED_DB`
(`<database>@<exact-dns-host>`). UAT is required; missing config or a UAT
failure fails the run. The documented runtime identity is explicitly denied
even if approved.

Staging is optional. While `MC_STAGING_DATABASE_URL` and `MC_STAGING_APPROVED_DB`
stay unset, the automatic path is UAT-only and logs
`STAGING: skipped (MC_STAGING_DATABASE_URL and MC_STAGING_APPROVED_DB unset; UAT only; live plx_mc is not migrated here)`,
records staging as skipped (not failed) in the summary, and exits 0 if UAT
succeeded. Exactly one of the two set is a partial config and fails the job.
When both are set the target is still guarded and a failure still fails the job
(UAT evidence is still reported); a staging URL that is the live plx_mc identity
is refused and fails the job, never skipped. The non-production guard still
denies plx_mc on plx-postgres-staging, but that is NOT the live Mission Control
DB: the AWS SM prod/ec2-secrets PLX_MC_DATABASE_URL points there and stopped at
migration 030. The live DB is whatever Vercel project plx-mission-control's
Production PLX_MC_DATABASE_URL points to; its upstream source is to be confirmed
by Vince. Keep staging config unset until a human confirms the intended target.
Live migration is not this workflow; see "Live release" below.
Agents never provision these.

Deployment order:

1. Merge schema PRs into main. The `db/migrations/**` push filter starts
   **DB Migrate (UAT, staging when configured)**, serialized with cancellation disabled.
2. The Action validates URL host/database and live `current_database()` on
   each connection, applies UAT first, then staging when configured, with `npm run migrate`.
   It attempts staging even if UAT fails; any target failure fails the job.
3. Verify the successful Action summary, applied filenames and each database's
   schema before app deployment. `workflow_dispatch` on main with
   `status-only` lists pending/already-applied files without creating a ledger
   or applying SQL. `deploy` applies pending files, one transaction per file.
4. At deploy, before completedAt code goes live, the operator uses **MC's own
   sync identity**, not portal credentials, to run the SharePoint provisioner
   against `/sites/plx-mission-control-dev` (staging) first, then
   `/sites/plx-mission-control` (production):

   ```bash
   python3 scripts/provision-sharepoint.py --env staging --apply
   python3 scripts/provision-sharepoint.py --env staging --verify
   python3 scripts/provision-sharepoint.py --env production --apply
   python3 scripts/provision-sharepoint.py --env production --verify
   ```

   Confirm the CompletedAt schema is present in `config/sharepoint-schema.json`
   before provisioning and verify it at both sites. This is an operator step,
   outside the DB Action; the Action has no Graph identity and adds no secrets.
5. Deploy the app only after schema and SharePoint verification. Main currently
   has an automatic Vercel deployment connection: the operator must coordinate
   the release so application activation waits for these steps; this workflow
   does not disable or gate that separate deployment integration.

Safety: credentials are scoped to the migration step; only main may dispatch.
The runner rejects target overrides (URL query parameters and PG target env
variables), compares the effective target to the explicit approved identity,
and reads live database identity before any ledger write. TLS verification
stays enabled. No production database target or credential is wired here.
Production SQL is a separate, explicitly approved release step (below).

## Live release (separate, gated)

Owner: Vince. Workflow **DB Migrate (live release)** is manual only and separate
from the automatic non-production path. This change creates no secrets.

The default `mode=plan` job has no environment approval and may run on any ref.
It validates the URL with target overrides refused, then compares URL database
and exact hostname against human-set `MC_LIVE_EXPECTED_IDENTITY`. A URL mismatch
refuses before connection. Inside `BEGIN READ ONLY`, with a 5-second statement
timeout, it reads `current_database()` and attempts `pg_control_system()` under
a savepoint. Any fingerprint read error rolls back to that savepoint and reports
`sysid=unavailable`; it does not fail the plan. The connected database must match,
and a configured sysid must be readable and equal. Only MATCH permits ledger and
schema reads. All paths roll back and close the connection.

Identity UNSET or INVALID FORMAT still reads actual identity and prints a
`suggested MC_LIVE_EXPECTED_IDENTITY=...` line for human confirmation, but reads
neither ledger nor schema. Malformed expected input is never echoed (only its
length). Missing URL prints DB: NOT READ and identity NOT CHECKED. UNSET,
INVALID FORMAT and MISMATCH return plan exit 0 with apply_ready=no; configured
read failures return exit 1. Verify exits 1 unless MATCH. Preflight-apply refuses
with `preflight-apply refused: identity <VERDICT>` before any write, and
post-apply also requires MATCH.

A missing ledger means every local migration is pending. SharePoint sites,
lists and columns use Graph GET only; the token POST to login.microsoftonline.com
is the only non-GET. No writes run in plan. Missing lists include all configured
columns. Dev is reported before production.

Stdout and step summary start with `plan_commit_sha=<40 lowercase hex>`,
`pending_hash=sha256:<64 lowercase hex>`, and `apply_ready=yes|no (<reasons>)`.
Immediately after apply_ready, the prominent identity block is:

```text
======== IDENTITY: MATCH ========
expected: <database>@<host>[#sysid=<digits>]   actual: <database>@<host> sysid=<digits|unavailable>
```

The verdict may also be MISMATCH, UNSET, INVALID FORMAT or NOT CHECKED; missing
identities say unavailable. Reasons name the identity problem. Target output is
host/database only, never credentials, port or URL query. Pending migrations,
SharePoint columns missing, and ledger anomalies retain their sections. Unknown
sources never say none. The canonical pending hash sorts keys and pending sets
and includes unavailable-source and missing-list markers. **Any identity other
than MATCH makes DB unavailable for hashing**, so a refused plan cannot share
a hash with a MATCH preflight.

### Schema sanity (advisory)

Inside the same READ ONLY transaction, after the ledger read, select the newest
ledgered migration with a local SQL file by filename sort. Mention newer ledger
entries without local files. Strip SQL comments and extract up to 50 key tables,
ADD COLUMN clauses (including multiple clauses), indexes, views and functions,
including schema-qualified and quoted names. Parameterized existence queries
check relations and columns; functions are skipped with a note because overloads
need manual inspection. Example:

```text
### Schema sanity (newest ledgered: 0xx_name.sql)
- OK table foo
- MISSING column bar.baz
WARNING: ledger says 0xx_name.sql is applied but 1 key object(s) are missing; ledger and schema disagree
```

Empty extraction says `no checkable objects found in 0xx_name.sql`. Unread DB
says `unknown (DB not read)`; refused identity says `skipped (identity not MATCH)`.
**This warning does not change apply_ready or pending_hash.** Existence alone
cannot establish complete schema equivalence; Vince reviews warnings before apply.

Vince plans the intended ref, copies both first-line values, then dispatches
on the same ref with `mode=apply`, `confirm=MIGRATE_LIVE`,
`plan_sha=<plan_commit_sha>` and `pending_hash=<pending_hash>`, and approves the
`mc-live-release` environment. The existing environment has a required reviewer.
Branch refs are allowed only through the SHA pin; an admin may additionally
add a deployment-branch policy to the environment.

Apply checks out the exact dispatch SHA. Before any write, preflight refuses a
malformed SHA/hash, a plan SHA different from HEAD or GITHUB_SHA, a URL or
connected database identity mismatch, either source unreadable, or a freshly
computed pending hash different from the supplied hash. If HEAD changed or
pending work changed, run another plan and use its values. Inputs are passed
via environment variables, never interpolated into shell commands.
Order: preflight-apply → `npm run migrate` → provisioning dev (`--env staging
--apply`) → production (`--env production --apply`) → post-apply live recompute.
Each failure stops later steps. Post-apply requires readable sources, no pending
migrations/columns/lists. Ledger anomalies remain reported separately.

### BREAKING CHANGE and human configuration

`MC_LIVE_APPROVED_DB` is no longer read by live release; it is replaced by repo
variable **`MC_LIVE_EXPECTED_IDENTITY`**. If the old variable is present in the
script environment, plan prints one retirement note; an admin may delete it.
The non-production path retains its existing variables and guards.

A human must derive the expected identity from the exact host (lowercase) and
database in Vercel project `plx-mission-control`'s **Production** sensitive
`PLX_MC_DATABASE_URL`, after confirming that production actually reads that
value. Its upstream source is to be confirmed by Vince. Format:
`<database>@<host>` or `<database>@<host>#sysid=<digits>` (1–20 digits, PostgreSQL
system_identifier). Example: `plx_mc@production-host.example.invalid#sysid=12345`.
With the expected variable unset, a first read-only plan prints actual identity
and a suggested value. After confirming the URL is the production database,
a human can copy the suggestion, including sysid where available, into the repo
variable. Never infer the live target from the database name or staging host.

An admin deleted repo secret **`MC_LIVE_DATABASE_URL`** after the near-miss on
2026-10-09. An admin must re-add that same secret name with the Vercel Production
value before release. AWS SM `prod/ec2-secrets` `PLX_MC_DATABASE_URL` is not the
live DB; it points to the staging database stopped at migration 030.
Agents never set or delete these repo secrets, variables or environments. This
change creates none. Existing Graph secrets remain required for both sources:

- `MICROSOFT_GRAPH_TENANT_ID`
- `MICROSOFT_GRAPH_CLIENT_ID`
- `MICROSOFT_GRAPH_CLIENT_SECRET`

`PLAN_SHA` and `PENDING_HASH` are step-local dispatch values, not credentials.

Rollback: revert the workflow/helper change to remove this automation. Reverting
code does not undo schema or SharePoint changes; use each applied migration's
rollback header and inspect provisioning results before an operator rollback.
Never mark unapplied migrations applied to bypass a failure.
