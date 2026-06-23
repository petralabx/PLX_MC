# Runbook: GitHub App provisioning (read-only repo Contents)

Activates the `github-app` module (`src/lib/github-app`) so loop-ledgers + repo
validation read GitHub via **short-lived, read-only installation tokens** instead
of the broad classic `GITHUB_TOKEN` PAT.

The code ships **default-off**: with no `GITHUB_APP_*` secrets, `resolveGithubToken()`
falls back to `GITHUB_TOKEN`. These steps flip it on; only Step 1–2 are manual
(GitHub has no PAT-issuable App-creation API), everything after is API-managed.

## Provisioned status (2026-06-23)

The App is **live**. Non-secret coordinates for operational traceability (the
private key lives only in the secret stores — never here):

- **App:** `PLX MC Compliance` (slug `plx-mc-compliance`), **App ID `4125227`**
- **Installation ID `142149327`** (account `taylorvalton`, selected repos:
  `agentic-swarm`, `PLX_MC`, `plx-customer-portal`)
- **Secrets set** (`GITHUB_APP_ID` / `GITHUB_APP_INSTALLATION_ID` /
  `GITHUB_APP_PRIVATE_KEY`): AWS Secrets Manager `prod/ec2-secrets` +
  `staging/ec2-secrets`, and Vercel project `plx-mission-control`
  (production + preview). Production was redeployed to pick them up.
- **Verified:** installation token mints with `contents:read, metadata:read` and
  resolves all three repos.
- **PAT note:** Vercel never had a `GITHUB_TOKEN` (the deployed app is App-only).
  The AWS `GITHUB_TOKEN` is a **shared** dev-box credential used by other tooling
  and was intentionally left in place — do not remove it as part of this module.

## Step 1 — Create the App (one-time, interactive)

GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App** (under
the `taylorvalton` account):

- **Name:** `plx-mission-control-ledgers` (any unique name)
- **Homepage URL:** the app URL (e.g. `https://mc.plxcustomer.io`)
- **Webhook:** uncheck **Active** (this App is pull-only; no webhook needed)
- **Repository permissions:** **Contents → Read-only**. (Metadata → Read-only is
  added automatically.) Leave everything else **No access**.
- **Account permissions / Org permissions:** none.
- **Where can this App be installed:** Only on this account.
- Create → on the App page, note the **App ID** and **Generate a private key**
  (downloads a `.pem`).

> Manifest shortcut (optional): the equivalent manifest is the permission set
> above (`contents: read`, no webhook). The UI form is faster for a one-off.

## Step 2 — Install the App (one-time, interactive)

On the App page → **Install App** → install on the `taylorvalton` account →
**Only select repositories** → choose `agentic-swarm`, `PLX_MC`,
`plx-customer-portal`. After installing, the URL is
`…/settings/installations/{INSTALLATION_ID}` — note the **Installation ID**
(or `GET /app/installations` with an App JWT returns it).

## Step 3 — Store the three secrets (API-managed from here on)

Put these in AWS Secrets Manager (`prod/ec2-secrets`, us-east-1) and the Vercel
project env (`petralabx/plx-mission-control`), exactly these keys:

| Key | Value |
|---|---|
| `GITHUB_APP_ID` | the numeric App ID from Step 1 |
| `GITHUB_APP_PRIVATE_KEY` | full PEM contents (literal newlines, or `\n`-escaped — the loader handles both) |
| `GITHUB_APP_INSTALLATION_ID` | the Installation ID from Step 2 |

No code change is needed — `githubAppConfigured()` flips true once all three are
present and the module starts minting installation tokens automatically.

## Step 4 — Verify

```bash
# With the three GITHUB_APP_* vars exported (and the agent's checker):
node -e "(async()=>{const {resolveGithubToken}=await import('./src/lib/github-app/token.ts');console.log((await resolveGithubToken())?.slice(0,4));})()"
```

Or simpler: hit the deployed `GET /api/loop-ledgers` and confirm the rows resolve
(agentic-swarm healthy; PLX_MC healthy now that its ledger is on `main`;
plx-customer-portal `no_ledgers` until it commits one) — and that none report
`token_missing` or `permission_denied`.

## Step 5 — Retire the broad PAT

Once Step 4 is green, **remove the classic `GITHUB_TOKEN`** from the secret store
and Vercel env. Both runtime consumers (`loop-ledgers` github-api source,
`sync` `validateRepoInOrg`) already route through `resolveGithubToken`, so the
App token is the sole GitHub credential. Confirm `GET /api/loop-ledgers` and a
repo-validate call still succeed after removal.

## Rollback

Unset the `GITHUB_APP_*` secrets → `resolveGithubToken()` reverts to
`GITHUB_TOKEN` (re-add it if removed) → then to honest degraded. No deploy or
code change required.
