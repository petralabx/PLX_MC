# Runbook: GitHub credentials on coding boxes

Coding boxes authenticate to GitHub as a **GitHub App**, not with a personal
PAT. `git` and `gh` mint a short-lived installation token and refresh it
before it expires.

Fleet policy:

- Bot apps are **PR-write-only** (`contents: write`, `pull_requests: write`,
  `metadata: read`). They do not get administration or ruleset bypass.
- **CIP owns merges.** Opening a pull request is in scope. Merging is not.
- Default app slug: `plx-agents-writer`.
- A per-bot app uses the same secret path. Set `--github-app-slug <slug>` or
  `PLX_GITHUB_APP_SLUG`. There is no second pattern to invent.

## Secrets (AWS)

| What | Secret id | What lands on the box |
|------|-----------|------------------------|
| App id + installation id | `plx/github/apps/<slug>/config` | JSON `{"appId","installationId"}` copied into env as ids |
| Private key | `plx/github/apps/<slug>/private-key` | **Reference only.** The secret is a PEM, or JSON with a `private_key` field. The helper reads that field. The PEM stays in Secrets Manager |

Default `<slug>` is `plx-agents-writer`.

The helper `scripts/github-app-auth.py` reads that private-key secret when it
needs to mint. If the SecretString starts with `{`, it parses JSON and uses
`private_key`. Invalid JSON, or a JSON object with no PEM `private_key`,
stops the mint. It caches the installation token under
`~/.cache/plx-github-app/` (mode `0600`) and refreshes it 60 seconds before
expiry. It refuses any secret id that is not
`plx/github/apps/<slug>/private-key`, so a poisoned env file cannot point it
at `prod/ec2-secrets`.

These `prod/ec2-secrets` keys are **not** copied onto a box in the default
mode:

- `PETRALABX_GITHUB_TOKEN`
- `PETRALABX_GITHUB`
- `PLX_GITHUB_PAT`
- `GITHUB_TOKEN`

`resolveGithubToken()` still prefers `PETRALABX_GITHUB_TOKEN` over legacy
`GITHUB_TOKEN` when a server process falls back to a PAT. That path logs a
loud `console.error` (`LOUD FALLBACK`) and names the variable, never the
token.

## Workstation hydrate

```bash
python scripts/bootstrap-windows-secrets.py
source ~/.secrets-env.github          # Linux / DGX / Git bash
```

```powershell
python scripts/bootstrap-windows-secrets.py
. $HOME\.secrets-env.github.ps1
```

That writes (local only, never commit):

- `~/.secrets-env.staging.ps1` — full agent hydrate. App mode clears the
  personal PAT variables after a successful load.
- `~/.secrets-env.github` and `~/.secrets-env.github.ps1` — GitHub App fragment.
  Exports `PLX_GITHUB_APP_ID`, `PLX_GITHUB_APP_INSTALLATION_ID`,
  `PLX_GITHUB_APP_SLUG`, and `PLX_GITHUB_APP_PRIVATE_KEY_SECRET_ID`.
  Unsets the four personal PAT names and `GH_TOKEN`.
  Points `git` at `~/.local/bin/plx-github-app-auth` and puts a `gh` wrapper
  on `PATH`. When `AWS_PROFILE` is set in the bootstrap process, the fragment
  and the launcher export that same profile. `git` runs the launcher directly,
  so the profile has to be in the launcher, not only in a sourced file.
- `~/.local/bin/plx-github-app-auth`, `~/.local/bin/gh`, `~/.local/bin/gh.cmd`

App mode reads `PLX_MC_MCP_API_KEY` and optional `SWARM_API_KEY` only for the
default principal `sp_mcp_cursor`. That read is `prod/ec2-secrets`, or the
secret named by `--compat-secret-id` / `PLX_BOOTSTRAP_COMPAT_SECRET_ID`.
Any other `--mcp-principal-id` in app mode does not call GetSecretValue on
`prod/ec2-secrets` and does not read the agent-key bundle
`plx/prod/mc/mcp-agent-keys/v1`. That bundle must not be granted to boxes.
A dedicated principal reads `plx/prod/mc/lane-<suffix>-key/v1`
(`sp_mcp_claude_code` → `plx/prod/mc/lane-claude-code-key/v1`; underscores in
the suffix become hyphens). `--mcp-key-secret-id` overrides that id. The
PowerShell and Unix loaders fetch the secret when sourced, so
`MC_MCP_API_KEY` is not stored in the file. The full list is in
`docs/modules/mcp/README.md`.

Legacy mode still reads `prod/ec2-secrets`, unless `--compat-secret-id` names
a smaller secret. A host denied `prod/ec2-secrets` (coding-1) exits with the
AWS error code. The message names `--compat-secret-id` and does not print
secret text.

**Precedence (TASK-756):** AWS Secrets Manager only. Do not restore
`~/.aws/Secret_Github.txt`. Graph credentials stay a matched set from
`plx/prod/m365/cursor-graph/v1`. The Unix staging file
(`~/.secrets-env.staging`, or `~/.secrets-env.staging.<principal>`) fetches
that same set when sourced and copies it to `AZURE_TENANT_ID`,
`AZURE_CLIENT_ID`, and `AZURE_CLIENT_SECRET`. A missing or partial secret
exits non-zero and names the missing variables. It does not print their values.

Profile auto-source, so agents do not forget:

```bash
[ -f "$HOME/.secrets-env.github" ] && . "$HOME/.secrets-env.github"
```

```powershell
$plxGh = Join-Path $HOME '.secrets-env.github.ps1'
if (Test-Path $plxGh) { . $plxGh }
```

Cursor agents also get `.cursor/rules/petralabx-github-token.mdc`.

## Verify (no token print)

```bash
source ~/.secrets-env.github
gh auth status
git push --dry-run origin HEAD
```

`gh auth status` must show the **GitHub App** (the app's bot account), not a
personal user. Do not print `GH_TOKEN` or the private key.

If the App token cannot be minted, `gh` and `git` stop. They exit non-zero
and do not use a stored personal login or `GH_TOKEN` / `GITHUB_TOKEN` /
`GH_ENTERPRISE_TOKEN`. The only exception is an explicit
`--legacy-personal-pat` (or `PLX_BOOTSTRAP_LEGACY_GITHUB_PAT=1`).

## Legacy personal PAT (rollout only)

Boxes that do not yet have the App secret can keep the old export:

```bash
python scripts/bootstrap-windows-secrets.py --legacy-personal-pat
# or: PLX_BOOTSTRAP_LEGACY_GITHUB_PAT=1
```

That writes `PETRALABX_GITHUB_TOKEN` from `prod/ec2-secrets` using this
precedence: `PETRALABX_GITHUB_TOKEN`, `PETRALABX_GITHUB`, `PLX_GITHUB_PAT`,
`GITHUB_TOKEN`. It still does not export `GITHUB_TOKEN` or `GH_TOKEN` (those
override `gh` and `git`). It removes a previously generated `~/.local/bin/gh`
wrapper when that file carries the bootstrap marker, and leaves an unrelated
`gh` binary alone.

Turn the flag off once `gh auth status` shows the app.

On a host that cannot read `prod/ec2-secrets` (coding-1), pass
`--compat-secret-id` with a secret that contains the personal PAT. Do not
grant that host `prod/ec2-secrets` or `plx/prod/mc/mcp-agent-keys/v1`.

```bash
python scripts/bootstrap-windows-secrets.py --legacy-personal-pat \
  --compat-secret-id <smaller-secret>
```

## Rollback

Revert the bootstrap change and re-run it from commit `07016274` on each
box so the loader matches that tree. Secret values do not change.

```bash
git checkout 07016274 -- scripts/bootstrap-windows-secrets.py
python scripts/bootstrap-windows-secrets.py
```

A host denied `prod/ec2-secrets` still cannot use `--legacy-personal-pat`
against that secret. Use `--compat-secret-id`, or re-run without the legacy
flag after the GitHub App secret is present.

## Rollout

CIP owns merges. After this change is on `main`, an operator does three steps.
Do not remove the PAT keys before every box shows the app.

1. Run `python scripts/bootstrap-windows-secrets.py` on each coding box via
   SSM (or that box's existing remote shell). Do not pass
   `--legacy-personal-pat` unless that box's App secret is missing and the
   box must keep working that day. DGX still uses `AWS_PROFILE=plx-prod`.
   Known boxes: Vince Windows, Dell VTA (`agentic-winrm`), DGX Spark.
2. On the box, source the GitHub fragment and run `gh auth status`. The
   logged-in account must be the GitHub App, not a personal user.
3. After every box shows the app, rotate or remove `PETRALABX_GITHUB_TOKEN`,
   `PETRALABX_GITHUB`, `PLX_GITHUB_PAT`, and `GITHUB_TOKEN` from
   `prod/ec2-secrets` and the staging alias.

## Boxes in scope

| Box | Env fragment | Notes |
|-----|--------------|-------|
| Vince Windows | `~/.secrets-env.github.ps1` | Also `load-secrets.ps1` for non-GitHub secrets |
| Dell VTA (`agentic-winrm`) | same under that profile | Cannot write `C:\Users\vince` via WinRM |
| DGX Spark | `~/.secrets-env.github` | Export `AWS_PROFILE=plx-prod` before bootstrap. The launcher keeps it |
| Vercel / EC2 app hosts | server App install + injected env | Not this workstation helper |

## Related

- Module: `docs/modules/github-app/README.md` (server read token; separate from this helper)
- Provisioning: `docs/runbooks/github-app-provisioning.md`
- Helper: `scripts/github-app-auth.py`
- Bootstrap: `scripts/bootstrap-windows-secrets.py`
