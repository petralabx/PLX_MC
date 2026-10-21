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
| Private key | `plx/github/apps/<slug>/private-key` | **Reference only.** The PEM stays in Secrets Manager |

Default `<slug>` is `plx-agents-writer`.

The helper `scripts/github-app-auth.py` reads that private-key secret when it
needs to mint. It caches the installation token under
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
  on `PATH`.
- `~/.local/bin/plx-github-app-auth`, `~/.local/bin/gh`, `~/.local/bin/gh.cmd`

**Precedence (TASK-756):** AWS Secrets Manager only. Do not restore
`~/.aws/Secret_Github.txt`. Graph credentials stay a matched set from
`plx/prod/m365/cursor-graph/v1`.

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
| DGX Spark | `~/.secrets-env.github` | Use `AWS_PROFILE=plx-prod` for bootstrap |
| Vercel / EC2 app hosts | server App install + injected env | Not this workstation helper |

## Related

- Module: `docs/modules/github-app/README.md` (server read token; separate from this helper)
- Provisioning: `docs/runbooks/github-app-provisioning.md`
- Helper: `scripts/github-app-auth.py`
- Bootstrap: `scripts/bootstrap-windows-secrets.py`
