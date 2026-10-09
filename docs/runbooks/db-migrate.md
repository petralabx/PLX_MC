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
is refused and fails the job, never skipped. The only plx_mc on
plx-postgres-staging is the live Mission Control DB, so those two stay unset.
Live plx_mc migration is not this workflow; see "Live release" below.
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
It reads `schema_migrations(filename)` in a READ ONLY transaction with a short
statement timeout, verifies live database identity, then rolls back. A missing
ledger table means every local migration is pending. It reads SharePoint sites,
lists and columns using Graph GET only; the client-credentials token POST to
login.microsoftonline.com is the only non-GET. No migration or provisioning
write runs in plan. Missing lists are identified and all configured columns
on those lists are pending. Dev is reported before production.

Stdout and the step summary start with `plan_commit_sha=<40 lowercase hex>`,
`pending_hash=sha256:<64 lowercase hex>`, and `apply_ready=yes|no (<reasons>)`,
then `target: host=<host> database=<db>` (never credentials, port or query).
Sections are `### Pending migrations (<n>)`, `### SharePoint columns missing`
with each site path, and `### Ledger anomalies`. Only pending files, missing
columns/lists and orphan ledger entries appear; empty sections say `none`.
Unreadable sections say `unknown`, never `none`. The canonical pending hash
sorts keys and pending sets and includes unavailable-source and missing-list
markers. It cannot confuse unreadable data with an empty pending set.
Missing credentials or rejected URL identity produce `apply_ready=no` and a
successful plan exit; a configured source that fails to read exits 1.

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

The DB path uses existing secret `MC_LIVE_DATABASE_URL` and variable
`MC_LIVE_APPROVED_DB` (`plx_mc@<exact runtime host>`). An admin must add these
repository secrets for both read and apply, using the same app as provisioning:

- `MICROSOFT_GRAPH_TENANT_ID`
- `MICROSOFT_GRAPH_CLIENT_ID`
- `MICROSOFT_GRAPH_CLIENT_SECRET`

No other secret or variable name is introduced. `PLAN_SHA` and `PENDING_HASH`
are step-local values from dispatch inputs, not credentials.

Rollback: revert the workflow/helper change to remove this automation. Reverting
code does not undo schema or SharePoint changes; use each applied migration's
rollback header and inspect provisioning results before an operator rollback.
Never mark unapplied migrations applied to bypass a failure.
