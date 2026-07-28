# Runbook — PLX_Forms Graph Client Secret Rotation

| | |
|---|---|
| **Date raised** | 2026-07-27 |
| **Owner** | Vince Taylor-Valton |
| **App** | `PLX_Forms` — client `c4b5438d-66d4-4445-9e85-c45b4c8040ed` |
| **Tenant** | `dc28356c-e440-4a9e-b8e6-e40967bfee06` (Petra Hygienic Systems Int Ltd) |
| **Status** | **Superseded — never exercised.** See [REPORT.md](REPORT.md) for what actually happened |
| **MC task** | TASK-742 (`BKT-HARDENING`, high) |
| **Revised** | 2026-07-27 — store inventory corrected against the Vercel API; Business Central finding reversed |

> **Read REPORT.md first.** The incident was resolved by revoking the secret outright, not by
> rotating it, because measurement showed **no deployed store held this credential** — every
> readable store holds app `3013790b`. The store table below was built from variable *names*
> and is not a reliable map of which app each store uses. This document is retained only as a
> reference procedure for a future rotation that genuinely spans stores.

## Why

The `PLX_Forms` app-only client secret is exposed and must be replaced:

1. It was stored **in plaintext** on line 14 of `~/.secrets-env.staging.ps1` on the
   Windows workstation, not sourced from a secret store.
2. It was read into an AI agent session transcript on 2026-07-27.

The credential is high value. Per `plx-customer-portal/.cursor/rules/credentials-and-access.mdc`
it carries tenant-wide `Sites.FullControl.All`, `Sites.ReadWrite.All`, `Files.ReadWrite.All`,
`Mail.ReadWrite`, and `Mail.Send`.

**Mail is already partially restricted — correcting an earlier claim in this document.**
`credentials-and-access.mdc` instructs scoping the Mail permissions "before relying on
them" and no evidence of it was found in the repo, from which this runbook originally
concluded the app could read every mailbox and send as anyone. Probing disproved that.
Measured 2026-07-27, stable across 18 minutes:

| Mailbox | Result |
|---|---|
| `cos@petrasoap.com` | 200 |
| `vince@petrasoap.com` | 200 |
| `ricardo@petrasoap.com` | **403** |

A third-party mailbox being refused means a `RestrictAccess` policy **is** in force; the
stability rules out propagation. The app is therefore scoped to a group containing at least
cos@ and vince@, not tenant-wide. The documentation gap was real; the exposure inferred
from it was not.

**Confirm the actual scope before relying on this** — the group membership defines the true
blast radius and has not been read:

```powershell
Get-ApplicationAccessPolicy | Where-Object AppId -eq 'c4b5438d-66d4-4445-9e85-c45b4c8040ed' |
  Format-List AppId, AccessRight, ScopeName, ScopeIdentity, Description
Get-DistributionGroupMember <ScopeName from above> |
  Format-Table DisplayName, PrimarySmtpAddress, RecipientTypeDetails
```

Every member of that group is a mailbox this credential can read and send as. Note that
`scope-mail-to-mailbox.ps1` skips creation when a policy already exists, so running it
against this app does **not** narrow an existing scope — the group must be edited directly.

Scoping does not reduce the SharePoint surface either; `Sites.FullControl.All` remains.

Rotation replaces the secret. It does not reduce the permission surface. See
[Follow-on work](#follow-on-work).

## Scope

**In scope:** replacing the client secret on `PLX_Forms` and updating every consumer.

**Not in scope:** the new `PLX_Cursor_Graph` app (`34cd4ff8-3797-4c98-a365-f2c0e2db8565`),
which was stood up separately on 2026-07-27 for Cursor IDE and Cloud Agent use. It
consumes `plx/prod/m365/cursor-graph/v1` in AWS Secrets Manager and is unaffected by
this rotation.

## Business Central — resolved, and the hazard is inverted

`portal/src/lib/business-central/config.ts` resolves its credential as:

```ts
clientSecret:
  process.env.BC_CLIENT_SECRET ||
  process.env.AZURE_CLIENT_SECRET ||
  process.env.MICROSOFT_GRAPH_CLIENT_SECRET
```

Checked against the Vercel API on 2026-07-27: `BC_CLIENT_SECRET` is **not** set, but
`AZURE_CLIENT_SECRET` **is** set on production, preview and development. It therefore wins
the fallback and Business Central never reaches the `MICROSOFT_GRAPH_` variable.

**Rotating `MICROSOFT_GRAPH_CLIENT_SECRET` does not affect Business Central.**

The real hazard is the reverse: rotating **`AZURE_CLIENT_SECRET`** would break BC sync.
`/api/cron/bc-sync` runs every 5 minutes and `/api/cron/bc-inbound-sync` every 15, so it
would surface within minutes. That variable is out of scope here — do not rotate it as part
of this task without treating BC as a first-class consumer.

`AZURE_CLIENT_SECRET` also holds three **different** values across the three environments
(ciphertext lengths 1100 / 1088 / 1088) and differs from `MICROSOFT_GRAPH_CLIENT_SECRET`
(1104). These are not aliases of a single credential.

## Store inventory

Every location holding the `PLX_Forms` secret. Confirm each before starting — the
list is derived from static analysis, not from reading the stores.

| # | Store | Variable(s) | How to confirm |
|---|---|---|---|
| 1 | **Vercel — plx-customer-portal** (Production, Preview, Development) | `MICROSOFT_GRAPH_CLIENT_SECRET` — **duplicated**, see note below | `vercel env ls` in `portal/`, or Vercel dashboard → Settings → Environment Variables |
| 1b | **Vercel — plx-mission-control** (Production) | `MICROSOFT_GRAPH_CLIENT_ID` / `_SECRET` / `_TENANT_ID` | Confirmed via Vercel API 2026-07-27. **Missing from the original inventory** |
| 2 | **Vercel — plx-vmc-preview** (Production, Preview) | `AZURE_CLIENT_ID` / `_SECRET` / `_TENANT_ID` — **not** `MICROSOFT_GRAPH_*` | The `agentic-swarm-8` project holds no Graph vars at all, so the original "vmc-web" row was misdescribed |
| 3 | **GitHub Actions secrets** — `petralabx/plx-customer-portal` | `MICROSOFT_GRAPH_CLIENT_SECRET` | `gh secret list -R petralabx/plx-customer-portal`. Used by `uat-feedback-mark-ready-from-pr.yml` and `uat-feedback-post-deploy.yml` |
| 4 | **Workstation `~/.aws/`** | `forms-api-secret-value.txt` (and check `forms-api-secret-secret.txt`) | `Get-ChildItem $HOME\.aws\forms*.txt` |
| 5 | **AWS Secrets Manager** — `prod/ec2-secrets`, `staging/ec2-secrets` | unknown key names | Not readable by IAM user `taylorvalton`; requires assuming `cursor-cloud-agent-prod-ec2-secrets-read`. **Must be checked** — these are what Cursor Cloud Agents read |
| 6 | **EC2 / agent hosts** | environment variables | Only if any host holds a baked copy rather than reading store 5 |

**Duplicate entries in `plx-customer-portal`.** `MICROSOFT_GRAPH_CLIENT_ID`, `_SECRET` and
`_TENANT_ID` each exist **twice**: one set targeting development + preview + production, and
a second preview-only set. Preview may therefore resolve to a different credential than
production. Update both copies, or delete the duplicate — otherwise preview silently keeps
the old value through the rotation and the failure appears later, on a preview deploy.

Note: `~/.secrets-env.staging.ps1` is **no longer** a consumer. It was repointed on
2026-07-27 to fetch `PLX_Cursor_Graph` from AWS Secrets Manager. The pre-change file is
preserved at `~/.secrets-env.staging.ps1.bak-20260727-graph` — **that backup contains the
old plaintext secret and must be deleted as part of this rotation.**

## Procedure

Order matters. Entra permits two active secrets per app, so create before destroying.
At no point should the old secret be deleted while a store still holds it.

### Step 1 — Confirm the inventory

Work down the table above and record which stores actually hold the value. Do not
proceed on assumption; a store discovered mid-rotation means an outage.

### Step 2 — Create the replacement secret

Entra → App registrations → `PLX_Forms` → Certificates & secrets → **New client secret**.
Description `rotation-2026-07-27`, expiry 180 days. Copy the **Value** column immediately —
not Secret ID. **Leave the existing secret in place.**

Both secrets are now valid. Every consumer keeps working during the cutover.

### Step 3 — Update each store

Update stores in this order, verifying each before moving on.

**3a. AWS Secrets Manager (store 5)** — do this first if it holds the value, since Cloud
Agents read it and there is no way to verify without assuming the role.

**3b. Vercel (stores 1 and 2)** — update all three environments per project. A Vercel env
var change does not take effect until redeploy; either redeploy or accept that running
instances continue on the old secret until they cycle. This is why the old secret stays
alive until Step 5.

**3c. GitHub Actions (store 3)**

```bash
gh secret set MICROSOFT_GRAPH_CLIENT_SECRET -R petralabx/plx-customer-portal
```

**3d. Workstation (store 4)** — overwrite `~/.aws/forms-api-secret-value.txt`. Do not
paste the secret into a shell command; PSReadLine writes command history to
`%APPDATA%\Microsoft\Windows\PowerShell\PSReadLine\ConsoleHost_history.txt` in plaintext.
Use `Read-Host` or edit the file directly.

### Step 4 — Verify per store

Each check must pass before the old secret is deleted.

| Store | Verification | Pass condition |
|---|---|---|
| 1 — Vercel portal | Redeploy, then `curl -H "Authorization: Bearer $CRON_SECRET" https://staging.plxcustomer.io/api/cron/bc-sync` | Returns `{ ok, summary }`; an `app_bc_sync_run` row is recorded. **This is the BC canary** |
| 1 — Vercel portal | Exercise a SharePoint read path in the portal UI | No 401/403 |
| 2 — Vercel vmc-web | Trigger a `sync-trdv2-*` script or the email-ingest cron | Completes without auth error |
| 3 — GitHub Actions | Re-run the most recent `uat-feedback-post-deploy` workflow | Green |
| 4 — Workstation | Mint a token and read the PLXCUSTOMERS site (below) | HTTP 200 |
| 5 — AWS SM | Start a **new** Cloud Agent and mint a token from the injected env | Token issued, Graph call returns 200 |

Workstation check for store 4:

```powershell
$t = Invoke-RestMethod -Method Post `
  -Uri "https://login.microsoftonline.com/dc28356c-e440-4a9e-b8e6-e40967bfee06/oauth2/v2.0/token" `
  -ContentType 'application/x-www-form-urlencoded' `
  -Body @{ client_id='c4b5438d-66d4-4445-9e85-c45b4c8040ed'
           client_secret=(Get-Content $HOME\.aws\forms-api-secret-value.txt -Raw).Trim()
           scope='https://graph.microsoft.com/.default'
           grant_type='client_credentials' }
Invoke-RestMethod -Headers @{ Authorization = "Bearer $($t.access_token)" } `
  -Uri 'https://graph.microsoft.com/v1.0/sites/petrasoap.sharepoint.com:/sites/PLXCUSTOMERS' |
  Select-Object displayName, id
```

A `401` means the store still holds the old value or the new one was pasted wrong.
A `403` means the token is valid but permissions changed — not a rotation failure.

### Step 5 — Delete the old secret

Only once every row in Step 4 passes. Entra → `PLX_Forms` → Certificates & secrets →
delete the pre-rotation entry.

### Step 6 — Clean up

```powershell
Remove-Item $HOME\.secrets-env.staging.ps1.bak-20260727-graph
```

Tick `tasks/todo.md` → "Part A — rotate compromised secrets" if this closes it, and
record the new expiry date with a calendar reminder. There is no automatic rotation.

## Rollback

Until Step 5, rollback is to revert the store to the old secret — both are valid, so
any consumer works with either. After Step 5 there is no rollback; you must issue a
third secret and repeat Step 3. This asymmetry is the reason Step 5 is last.

## BLOCKER — the same variable name means two different apps

**Do not rotate until this is resolved.**

App `3013790b-ab91-4c10-866c-bec0d2a3b788` is not an unknown credential.
`docs/workshops/PLX-Business-Central-Integration-Plan.md` calls it "the app the portal
already uses for Graph/SharePoint", it is the Teams SSO resource (`api://3013790b-…`),
`agentic-swarm/src/tools/m365_auth.py` defaults to it, and
`docs/PROJECT-PLAN-Admin-Portal.md:803` assigns it to `MICROSOFT_GRAPH_CLIENT_ID`.

But the workstation loader assigned `c4b5438d-…` (`PLX_Forms`) to that **same variable
name**. So `MICROSOFT_GRAPH_CLIENT_ID` refers to *different app registrations depending on
the store*. Vercel values are encrypted at rest and could not be read via the API, so which
app each store holds is still unconfirmed.

This is very likely the mechanism behind the 2026-07-26 app-only Graph 401 outage recorded
in Internal-SOP v8.40. Rotating "the" secret without knowing which app each store means is
how that outage recurs.

**Decisive method:** for each store, mint a client-credentials token and decode the `appid`
claim. That identifies the app per store without needing the plaintext secret.

## Remaining open question

**Do `prod/ec2-secrets` / `staging/ec2-secrets` contain the Graph secret?** Cannot be
determined from the workstation IAM user; requires assuming
`cursor-cloud-agent-prod-ec2-secrets-read`.

## Wider finding — the Graph secret is not the only plaintext credential

Surfaced while preparing this runbook. The same loader file holds, in plaintext:

| Variable | What it is |
|---|---|
| `PETRALABX_GITHUB_TOKEN`, `GITHUB_TOKEN` | GitHub fine-grained PAT, `github_pat_…` (same value under both names) |
| `MC_MCP_API_KEY` | Mission Control API key, `plxmc_…` |
| `SWARM_API_KEY` | agentic-swarm API key |

Only the Graph block was migrated to AWS Secrets Manager on 2026-07-27. These three are
**still plaintext in the live `~/.secrets-env.staging.ps1`** and in the backup, and share
the identical exposure path — same file, same transcript. Rotating only the Graph secret
leaves the rest outstanding.

Now tracked separately as **TASK-751**, which is their home rather than this runbook. Each
has its own consumers and needs its own store inventory; they are not covered by the table
above. The GitHub PAT is likely the most severe of the four credentials in that file, since
an org-write PAT permits pushing to production repositories.

## Follow-on work

Rotation restores control of the credential; it does not reduce blast radius. Separately
worth doing:

- **Narrow the existing `PLX_Forms` mail scope to cos@.** A `RestrictAccess` policy already
  exists (see the probe table above) but its group includes vince@. Narrowing means editing
  that group's membership, not running `scope-mail-to-mailbox.ps1`, which no-ops when a
  policy is already present.
  Note the mechanism: Exchange **RBAC for Applications role assignments are additive grants
  and do NOT restrict** — only the legacy `RestrictAccess` policy does. Established by probe
  on the sibling app, where scoped RBAC assignments plus
  `Test-ServicePrincipalAuthorization` reporting `InScope=True` still left it able to read
  every mailbox and send as anyone. Verify with a Graph probe, never with
  `Test-ApplicationAccessPolicy`, which reported `Granted` while real requests were denied.
  Removing vince@ looks safe because portal transactional email uses **Resend**, not Graph
  (`portal/src/lib/notifications/email.ts`, `EMAIL_FROM` → `support@plxcustomer.io`), and the
  only mailbox other than cos@ that PLX_Forms reads is `vince@petrasoap.com`, hardcoded in
  three unscheduled one-off scripts (`inbox-triage.py`, `graph_api_tasks.py`,
  `backfill_email_bodies.py`). `RestrictAccess` is per-mailbox, not per-operation: adding
  vince@ back to the group would also grant send-as-vince@.
- **Drop `Sites.FullControl.All`.** `credentials-and-access.mdc` calls it "the highest blast
  radius" and "usually redundant with `Sites.ReadWrite.All` + `Sites.Manage.All`".
- **Stop storing secrets in plaintext `~/.aws/*.txt`.** The `PLX_Cursor_Graph` pattern —
  AWS Secrets Manager fetched at source time — is the model to copy.

## Related

- New app setup: `skills/plx-graph-mail/scripts/verify-graph-app.ps1`
- Mail scoping: `skills/plx-graph-mail/scripts/apply-mail-rbac.ps1`
- Credential map: `plx-customer-portal/.cursor/rules/credentials-and-access.mdc`
- Env var table: `plx-customer-portal/docs/Internal-SOP.md`
