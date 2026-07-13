# Runbook: Activate the PLX MC Compliance Gate (EN-007)

> **Fleet status (2026-07-08):** Active repos are on **hard** mode per
> [`fleet-compliance-hard-cutover.md`](fleet-compliance-hard-cutover.md). The
> soft→hard flip steps below are **historical activation procedure** for repos
> already live — except `petralabx/test-perms-check`, which stays `soft`.
>
> The EN-007 code is **built, tested, and deployed**. This runbook remains the
> operator/infra reference for initial activation, OIDC dogfood, and kill switches.

## Prerequisites

- The `feat/mirror-compliance-enforce` PR (EN-006/007) is merged.
- A deploy target for the PLX MC Next.js app that exposes a **public URL** (the
  verify + webhook endpoints) — MC has no public service today; this introduces it.
- GitHub admin on the target repos; access to the secrets manager.

## Step 1 — Apply the migrations (staging → prod)

`mc_events`, `mc_dispatch`, `mc_compliance_check` (005) and `mc_reconcile_queue`
(006). Additive + idempotent.

```bash
# STAGING first. Confirm the DB URL points at the staging plx_mc database.
echo "$PLX_MC_DATABASE_URL" | grep plx-postgres-staging   # must match (never prod without -staging)
npm run migrate                                            # scripts/migrate.mjs
# Verify:
#   \dt mc_events  mc_dispatch  mc_compliance_check  mc_reconcile_queue
```

Repeat against production only after staging is verified.

## Step 2 — Deploy MC with a public endpoint

Deploy the app and set, via the secrets manager (no hardcoded keys):

- `COMPLIANCE_WEBHOOK_SECRET` — HMAC secret for the GitHub webhook (shared with Step 3).
- `COMPLIANCE_OIDC_ENABLED=1` — enables GitHub Actions OIDC as the preferred auth path for `POST /api/compliance/verify`.
- `COMPLIANCE_OIDC_AUDIENCE=plx-mc-compliance-verify` — audience requested by the workflow and verified by MC.
- `COMPLIANCE_OIDC_REPO_ALLOWLIST=petralabx/PLX_MC` — dogfood allowlist for the first rollout. Add fleet repos only in the follow-up phase.
- `COMPLIANCE_CI_TOKEN` — bearer break-glass fallback the status-check workflow can send to `POST /api/compliance/verify` if OIDC token minting is unavailable (shared with the `COMPLIANCE_CI_TOKEN` repo secret in Step 4).
- `PLX_MC_DATABASE_URL` — already set for the app.

Confirm the endpoints answer: `POST {MC}/api/compliance/webhook` returns `503`
(default-off) until the secret is set, then `401` for an unsigned body;
`POST {MC}/api/compliance/verify` returns `503` until OIDC or bearer auth is
configured, then `401` without an `Authorization: Bearer` token. With
`COMPLIANCE_OIDC_ENABLED=1`, MC verifies GitHub Actions OIDC tokens first and
falls back to `COMPLIANCE_CI_TOKEN` only when bearer is still configured.

## Step 3 — Register + install the GitHub App

- New GitHub App. Permissions: **Pull requests: Read**, **Commit statuses: Write**,
  **Contents: Read**. Subscribe to **Pull request** events.
- Webhook URL: `{MC}/api/compliance/webhook`; Webhook secret = `COMPLIANCE_WEBHOOK_SECRET`.
- Generate a private key → store in the secrets manager (never commit).
- Install on **`PLX_MC` first** (dogfood), then `agentic-swarm`, then `plx-customer-portal`.

## Step 4 — Turn on the gate, soft → hard (historical dogfood)

> **Current fleet:** hard mode is live on active repos. Use this section only when
> onboarding a **new** repo (may start `soft`) or auditing the original PLX_MC dogfood.

The workflow `.github/workflows/compliance-gate.yml` is already in `PLX_MC` and is
**safe**: it skips while `PLX_MC_BASE_URL` is unset.

1. Set repo secret `PLX_MC_BASE_URL = {MC}` and variable
   `COMPLIANCE_MODE = soft`. Keep repo secret `COMPLIANCE_CI_TOKEN` during
   dogfood as the bearer fallback/break-glass path.
2. Open a test PR; confirm the check runs and records (soft = warn only).
3. When clean, set `COMPLIANCE_MODE = hard` and add the check to **branch
   protection** as a required status on the protected branches (`master` keeps its
   existing explicit-approval rule; the gate is additive).

Mandatory dual-auth cutover order:

1. Merge the dual-auth verify route + OIDC-capable workflow.
2. Deploy MC with `COMPLIANCE_OIDC_ENABLED=1`,
   `COMPLIANCE_OIDC_AUDIENCE=plx-mc-compliance-verify`, and
   `COMPLIANCE_OIDC_REPO_ALLOWLIST=petralabx/PLX_MC`.
3. Dogfood a PLX_MC PR that authenticates via OIDC.
4. Retire bearer in a follow-up only after dogfood evidence exists. Do not remove
   `COMPLIANCE_CI_TOKEN` in this PR.

## Step 5 — (Optional) enable zero-friction capture

For agent runs that should auto-link a task: merge `.cursor/compliance-hooks.json`
into `.cursor/hooks.json` and set in the run env: `COMPLIANCE_CAPTURE=1`,
`MC_BASE_URL`, `MC_TASK_ID`, `MC_ACCOUNTABLE`, `MC_REPO`. The hook checks out the
task and stamps the PR body with `MC-Checkout: <id>`. Default-off; opt-in per runtime.

## Step 6 — Roll out to the other repos (Phase 2 — completed)

> **Historical.** Fleet hard cutover completed 2026-07-08. Active repos listed in
> `fleet-compliance-hard-cutover.md`. Only `petralabx/test-perms-check` remains soft.

For `agentic-swarm`, then `plx-customer-portal`: add a 3-line caller workflow that
`uses:` the reusable `compliance-gate.yml` (or copy it), set `PLX_MC_BASE_URL` +
`COMPLIANCE_MODE=soft`, install the App, extend
`COMPLIANCE_OIDC_REPO_ALLOWLIST`, observe, then flip to `hard` + required. This
fleet rollout is **not** part of the OIDC dogfood PR; leave it for Phase 2 /
follow-up after PLX_MC proves OIDC end to end. Do **not** flip the live
`plx-customer-portal` to hard until its team's in-flight work is enrolled.

## Step 7 — Schedule reconciliation

**Implemented** as a Vercel Cron: `vercel.json` runs `GET /api/cron/reconcile`
every 5 min (authed by the Vercel-injected `CRON_SECRET` bearer, same as the
sweep cron). It replays `mc_reconcile_queue` so any work queued during an MC/DB
outage clears on recovery; held PR checks stay non-pass (fail-closed) until then.
A manual replay is still available via `POST {MC}/api/compliance/reconcile`
(operator-gated). Kill switch: remove the `crons` entry or unset `CRON_SECRET`.

## Security prerequisites (mandatory before `hard` mode)

These close the EN-007 security-review findings that are deployment/infra (the
code-level findings are already fixed on the branch):

- **Pin the required workflow (review #4).** On a `pull_request`, GitHub runs the
  workflow file from the **PR branch** — a PR could edit `compliance-gate.yml` to
  pass. Enforce via an **org ruleset "required workflow" pinned to the
  default-branch ref** (or a caller that only `uses:` the reusable workflow at an
  immutable ref). Never rely on the PR-head copy as the required check.
- **Authenticate the verify endpoint + carve out middleware (review #3).** Put
  `POST /api/compliance/verify` behind **GitHub Actions OIDC** as the preferred
  path and keep the shared CI bearer token only as fallback/break-glass through
  dogfood. Exempt `/api/compliance/webhook` (HMAC) + `/api/compliance/verify`
  from the UI auth middleware; keep `checkout` / `complete` / `reconcile` /
  `events` behind operator credentials. **Do not deploy with auth dormant** —
  that makes the control plane world-callable.
  - **Status:** both carve-outs are **implemented** in `src/middleware.ts`:
    `/api/compliance/webhook` (HMAC self-auth) and `/api/compliance/verify`
    (dual-auth — GitHub Actions OIDC first when
    `COMPLIANCE_OIDC_ENABLED=1` plus audience/allowlist are configured, then
    `COMPLIANCE_CI_TOKEN` bearer fallback when present; 503 when neither path is
    configured, 401 on a bad/missing token, runs on a match). `checkout` /
    `complete` / `reconcile` / `events` have no self-auth and remain behind the
    session gate (operator credentials). To activate OIDC set the three OIDC env
    vars on the MC deployment (Step 2). Keep `COMPLIANCE_CI_TOKEN` on both MC and
    the repo secret until the dogfood PR proves OIDC and a separate bearer
    retirement follow-up removes it.
- **Enrolled-repo strict policy (review #2).** A PR with no valid agent dispatch is
  treated as operator work and passes (recorded, ungated) by design (decision 5).
  Telling a real human operator apart from an agent that skipped checkout needs the
  authenticated identity above. Until then the safeguards are: a present
  `checkoutId` is always treated as agent and validated strictly (unrevoked,
  unexpired, repo-bound) so a bad credential **blocks**, and autonomous agents have
  no way to act except via the token + capture hook.

## Rollback / kill switch

- **Per repo:** set `COMPLIANCE_MODE=soft` (warn only) or remove the required-check
  from branch protection.
- **Verify auth:** set `COMPLIANCE_OIDC_ENABLED=0` on MC to disable OIDC and run
  bearer-only while `COMPLIANCE_CI_TOKEN` remains configured.
- **Global:** unset `PLX_MC_BASE_URL` in a repo → the gate skips (exit 0).
- Uninstall the GitHub App to stop ingestion. Nothing about the gate changes repo
  behavior while it is off; the event log is append-only and retains history.

## External Integrations declaration (governance-required)

| Field | Value |
|---|---|
| **Provider** | PLX MC Compliance GitHub App + the MC verify/webhook endpoints |
| **Owner** | Vince |
| **Scope** | Runtime, per-repo (PR status check + `pull_request` webhook ingestion) |
| **Auth source** | GitHub App private key + `COMPLIANCE_WEBHOOK_SECRET` (webhook HMAC) + GitHub OIDC / CI token (verify endpoint), all via the secrets manager (shared accessor `src/lib/secrets.ts`); no hardcoded keys |
| **Default state** | **Off** — workflow skips without `PLX_MC_BASE_URL`; webhook 503 without the secret; capture hook `enabled:false`; per-repo `soft` before `hard` |
| **Kill switch** | Per-repo `COMPLIANCE_MODE=soft` / remove required check; global unset `PLX_MC_BASE_URL`; uninstall the App |
| **Health check** | `GET {MC}/api/events` (DB reachable); webhook returns 401 on bad signature, 503 when unconfigured |
| **Fallback** | Fail-closed: checks hold (non-pass) + `mc_reconcile_queue` replays on recovery; never silent-pass |
| **Data/audit boundary** | Only PR metadata is ingested (no repo source); every action appends to the `mc_events` audit log |

## Step 8 — Dogfood: prove PR→task projection (EN-007 P5)

After projection code ships, **redeploy Production** before merging dogfood PRs. Webhook
ingestion appends `pr.merged` + `task.promotion.requested` on every deploy; **`task.promoted`
and DB stage flips require the projection module on the live deployment**. A stale
Production build records events but leaves tasks at `planned`.

1. Confirm Vercel Production tracks `main` at or past the projection merge (see
   `artifacts/compliance/2026-07-08-pr-lifecycle-dogfood/REPORT.md` for a deploy-window incident).
2. Open agent dogfood PRs with `MC-Checkout` on `PLX_MC` + `plx-customer-portal`; pass
   hard-mode compliance; merge.
3. Verify in DB: `entities.data->>'stage' = 'merged'`, `prs[]` populated,
   `mc_events.kind = 'task.promoted'`, `sync_audit_log` shows outbound push after sweep.

If merges land before deploy, operator replay: call `projectPullRequest` for the stored
PR events against the production DB, then `runSweep` (or wait for the 5-min cron).

## Step 9 — Org required-workflow ruleset (anti-tamper)

After the hub lives at `petralabx/PLX_MC` (EN-008), pin the compliance gate so PRs
cannot skip it by editing the PR-head workflow copy:

```bash
unset GITHUB_TOKEN
./scripts/provision-org-ruleset-required-workflows.sh --dry-run
./scripts/provision-org-ruleset-required-workflows.sh
```

Requires **GitHub Team** (or higher) on `petralabx`. On Free the API returns 403 —
keep per-repo branch protection (`scripts/provision-fleet-branch-protection.sh`) as
the substitute until Team is active. Evidence: `artifacts/compliance/<date>-org-ruleset/`.
