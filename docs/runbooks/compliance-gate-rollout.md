# Runbook: Activate the PLX MC Compliance Gate (EN-007)

> The EN-007 code is **built, tested, and merge-ready** (verifier, checkout/verify
> API, dispatch ledger, `mc_events` log + export, git→MC webhook + ingestion,
> fail-closed reconciliation queue, the status-check workflow, and the capture
> hook). The gate is **inert until the steps below run** — every piece ships
> **default-off**, so merging the code changes no repo's behavior. This runbook is
> the operator/infra activation that a coding session cannot perform (it needs
> GitHub admin, a public deployment, and shared-env credentials).
>
> Design + decisions: `docs/product/SYSTEM_OF_RECORD.md`. Module: `docs/modules/compliance/`.

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
- `COMPLIANCE_CI_TOKEN` — bearer token the status-check workflow sends to `POST /api/compliance/verify` (shared with the `COMPLIANCE_CI_TOKEN` repo secret in Step 4).
- `PLX_MC_DATABASE_URL` — already set for the app.

Confirm the endpoints answer: `POST {MC}/api/compliance/webhook` returns `503`
(default-off) until the secret is set, then `401` for an unsigned body;
`POST {MC}/api/compliance/verify` returns `503` until `COMPLIANCE_CI_TOKEN` is
set, then `401` without the `Authorization: Bearer` token.

## Step 3 — Register + install the GitHub App

- New GitHub App. Permissions: **Pull requests: Read**, **Commit statuses: Write**,
  **Contents: Read**. Subscribe to **Pull request** events.
- Webhook URL: `{MC}/api/compliance/webhook`; Webhook secret = `COMPLIANCE_WEBHOOK_SECRET`.
- Generate a private key → store in the secrets manager (never commit).
- Install on **`PLX_MC` first** (dogfood), then `agentic-swarm`, then `plx-customer-portal`.

## Step 4 — Turn on the gate, soft → hard (dogfood PLX_MC)

The workflow `.github/workflows/compliance-gate.yml` is already in `PLX_MC` and is
**safe**: it skips while `PLX_MC_BASE_URL` is unset.

1. Set repo secrets `PLX_MC_BASE_URL = {MC}` and `COMPLIANCE_CI_TOKEN` (matching
   the deployment's value so the workflow can authenticate to `verify`), and
   variable `COMPLIANCE_MODE = soft`.
2. Open a test PR; confirm the check runs and records (soft = warn only).
3. When clean, set `COMPLIANCE_MODE = hard` and add the check to **branch
   protection** as a required status on the protected branches (`master` keeps its
   existing explicit-approval rule; the gate is additive).

## Step 5 — (Optional) enable zero-friction capture

For agent runs that should auto-link a task: merge `.cursor/compliance-hooks.json`
into `.cursor/hooks.json` and set in the run env: `COMPLIANCE_CAPTURE=1`,
`MC_BASE_URL`, `MC_TASK_ID`, `MC_ACCOUNTABLE`, `MC_REPO`. The hook checks out the
task and stamps the PR body with `MC-Checkout: <id>`. Default-off; opt-in per runtime.

## Step 6 — Roll out to the other repos

For `agentic-swarm`, then `plx-customer-portal`: add a 3-line caller workflow that
`uses:` the reusable `compliance-gate.yml` (or copy it), set `PLX_MC_BASE_URL` +
`COMPLIANCE_MODE=soft`, install the App, observe, then flip to `hard` + required.
Do **not** flip the live `plx-customer-portal` to hard until its team's in-flight
work is enrolled.

## Step 7 — Schedule reconciliation

Drive `POST {MC}/api/compliance/reconcile` on a schedule (cron / the sync
scheduler) so any work queued during an MC/DB outage replays on recovery. Held
PR checks stay non-pass (fail-closed) until then.

## Security prerequisites (mandatory before `hard` mode)

These close the EN-007 security-review findings that are deployment/infra (the
code-level findings are already fixed on the branch):

- **Pin the required workflow (review #4).** On a `pull_request`, GitHub runs the
  workflow file from the **PR branch** — a PR could edit `compliance-gate.yml` to
  pass. Enforce via an **org ruleset "required workflow" pinned to the
  default-branch ref** (or a caller that only `uses:` the reusable workflow at an
  immutable ref). Never rely on the PR-head copy as the required check.
- **Authenticate the verify endpoint + carve out middleware (review #3).** Put
  `POST /api/compliance/verify` behind **GitHub OIDC** (or a shared CI token) and
  exempt `/api/compliance/webhook` (HMAC) + `/api/compliance/verify` from the UI
  auth middleware; keep `checkout` / `complete` / `reconcile` / `events` behind
  operator credentials. **Do not deploy with auth dormant** — that makes the
  control plane world-callable.
  - **Status:** both carve-outs are **implemented** in `src/middleware.ts`:
    `/api/compliance/webhook` (HMAC self-auth) and `/api/compliance/verify`
    (CI bearer token — `COMPLIANCE_CI_TOKEN`, enforced in the route: 503 when
    unset, 401 on a bad/missing token, runs on a match). `checkout` / `complete`
    / `reconcile` / `events` have no self-auth and remain behind the session gate
    (operator credentials). To activate `verify` set `COMPLIANCE_CI_TOKEN` on the
    deployment (Step 2) **and** as the matching `COMPLIANCE_CI_TOKEN` repo secret
    so the workflow can authenticate (Step 4).
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
