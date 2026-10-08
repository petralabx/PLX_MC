# MC non-production schema deployment

Owner: Vince (vince@petrasoap.com). This Action is a deployment gate for the
completedAt application release. It applies only already-merged numbered SQL,
including 031–035 as they land; gaps are valid. It adds no schema itself.

Vince must add these repository secrets (URLs for distinct, verified non-production
MC databases only): `MC_UAT_DATABASE_URL`, `MC_STAGING_DATABASE_URL`.
Required repository variables: `MC_UAT_APPROVED_DB`, `MC_STAGING_APPROVED_DB`.
Each variable is `<database>@<exact-dns-host>`; these are deliberately unset
placeholders, not guessed identities. Vince must confirm ownership and
non-production use of each identity before configuring it. Neither target is
optional. Missing configuration fails the run; agents never provision it.
The documented runtime identity is explicitly denied even if approved.

Deployment order:

1. Merge schema PRs into main. The `db/migrations/**` push filter starts
   **DB Migrate (UAT + staging)**, serialized with cancellation disabled.
2. The Action validates URL host/database and live `current_database()` on
   each connection, applies UAT first, then staging with `npm run migrate`.
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
Production SQL is a separate, explicitly approved release step.

Rollback: revert this PR to remove automation. If a run partially applied SQL,
follow each applied migration's rollback header; reverting the workflow does
not undo schema. A failed run's summary retains applied files; inspect runner
logs for the failed file and use status-only to inventory remaining files.
Never mark an unapplied migration applied to get past a failure.

The helper `scripts/lib/db-identity.mjs` shares the pending completedAt branch's
export contract; reconcile that overlapping file when merging both branches.
