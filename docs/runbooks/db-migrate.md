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

Workflow **DB Migrate (live release)**, `.github/workflows/db-migrate-live.yml`,
`workflow_dispatch` only, main only. It does not share secrets with the automatic
path: Vince adds secret `MC_LIVE_DATABASE_URL` and variable `MC_LIVE_APPROVED_DB`
(`plx_mc@<exact host>`) later, plus the existing `MICROSOFT_GRAPH_*` secrets for
apply. This change does not create the environment, secrets or variables.

- **plan** (default `mode=plan`; no environment) changes nothing: it lists the
  pending migration files an apply would run (local `db/migrations`, including
  031–035 when present), the target as redacted host and database name only
  (never user, password, URL or query; "secret unset" if the secret is absent,
  which does not fail the run), and the SharePoint columns from
  `config/sharepoint-schema.json` for `/sites/plx-mission-control-dev` first, then
  `/sites/plx-mission-control`. No database or Graph call is made.
- **apply** needs `mode=apply`, `confirm=MIGRATE_LIVE`, and approval on GitHub
  environment `mc-live-release`. Vince or an org admin must create that
  environment and its required reviewers before apply can run. It first verifies
  the URL, `MC_LIVE_APPROVED_DB` and live `current_database()` are the documented
  live plx_mc (refusing any other database), then runs `npm run migrate`, then
  `provision-sharepoint.py --env staging --apply` (dev site) and
  `--env production --apply`. Anything other than a confirmed apply runs plan.

Rollback: revert this PR to remove automation. If a run partially applied SQL,
follow each applied migration's rollback header; reverting the workflow does
not undo schema. A failed run's summary retains applied files; inspect runner
logs for the failed file and use status-only to inventory remaining files.
Never mark an unapplied migration applied to get past a failure.

The helper `scripts/lib/db-identity.mjs` shares the pending completedAt branch's
export contract; reconcile that overlapping file when merging both branches.
