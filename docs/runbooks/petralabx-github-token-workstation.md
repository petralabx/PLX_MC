# Runbook: petralabx GitHub credentials on agent workstations

Keeps explicit API consumers able to read the petralabx fine-grained PAT while
Git and `gh` use the authenticated `gh` keyring OAuth credential.

## Why

The legacy shared `GITHUB_TOKEN` could not see `plx-customer-portal` (404). MC
runtime prefers the GitHub App for reads. The explicit
`PETRALABX_GITHUB_TOKEN` fallback is for:

- `resolveGithubToken` PAT fallback when App mint is skipped/fails
- tools that explicitly read `PETRALABX_GITHUB_TOKEN`

Do not alias this PAT into `GITHUB_TOKEN` or `GH_TOKEN` in an interactive shell.
Those standard variables override `gh auth git-credential`. A token may
authenticate API reads while lacking effective Git write authorization. The
generated loaders therefore clear both standard overrides after setting the
explicit PetraLabX variable.

## Secrets (AWS)

| Key | Secret | Notes |
|-----|--------|-------|
| `PETRALABX_GITHUB` | `staging/ec2-secrets`, `prod/ec2-secrets` | Original staging key name |
| `PETRALABX_GITHUB_TOKEN` | same (alias) | Preferred name for consumers |

Do **not** put the raw PAT in git. Rotate in GitHub → update both secret stores →
re-bootstrap boxes.

## Workstation hydrate (automatic + manual)

### Preferred one-liners

```powershell
# Windows (Vince box / VTA)
. $HOME\load-secrets.ps1          # loads ALL prod/ec2-secrets keys into this session
. $HOME\.secrets-env.github.ps1   # GitHub-only fragment (after bootstrap)
```

```bash
# Linux / DGX
source ~/.secrets-env.github
# optional full AWS hydrate if you maintain ~/load-secrets.sh
```

### Regenerate fragments after rotation

```bash
python scripts/bootstrap-windows-secrets.py
```

Writes (local only):

- `~/.secrets-env.staging.ps1` — full agent hydrate; clears GitHub overrides
- `~/.secrets-env.github.ps1` — Windows fragment; sets only the explicit PAT
- `~/.secrets-env.github` — Unix fragment; sets only the explicit PAT

**Precedence (TASK-756):** AWS Secrets Manager only. Do **not** restore
`~/.aws/Secret_Github.txt` (or any `PLX_FORMS_*` / `forms-api-secret-*.txt`)
as a bootstrap fallback — that path caused the 2026-07-26 Graph 401 outage.
`PETRALABX_GITHUB_TOKEN` comes from `prod/ec2-secrets`. The three
`MICROSOFT_GRAPH_*` values are a matched set from
`plx/prod/m365/cursor-graph/v1` (PLX_Cursor_Graph), never from
`prod/ec2-secrets` Graph keys.

### Profile auto-source (so agents do not forget)

**PowerShell** (`$PROFILE` or `$HOME\Documents\PowerShell\Microsoft.PowerShell_profile.ps1`):

```powershell
$plxGh = Join-Path $HOME '.secrets-env.github.ps1'
if (Test-Path $plxGh) { . $plxGh }
```

**bash/zsh** (`~/.bashrc` / `~/.zshrc`):

```bash
[ -f "$HOME/.secrets-env.github" ] && . "$HOME/.secrets-env.github"
```

Cursor agents also get an always-on rule:
`.cursor/rules/petralabx-github-token.mdc`.

## Verify (no token print)

```powershell
. $HOME\.secrets-env.github.ps1
# Explicit API probe may use $env:PETRALABX_GITHUB_TOKEN.
# Git authorization proof must use a dry-run push through the gh keyring:
git push --dry-run origin HEAD
```

```bash
source ~/.secrets-env.github
# GITHUB_TOKEN and GH_TOKEN are unset; git/gh use the keyring OAuth credential.
git push --dry-run origin HEAD
```

## Boxes in scope

| Box | Env fragment | Notes |
|-----|--------------|-------|
| Vince Windows | `~/.secrets-env.github.ps1` | Also `load-secrets.ps1` |
| Dell VTA (`agentic-winrm`) | same under that profile | Cannot write `C:\Users\vince` via WinRM |
| DGX Spark | `~/.secrets-env.github` | Use `AWS_PROFILE=plx-prod` for bootstrap |
| Vercel / EC2 app hosts | App install + injected env | Not Secret_Github workstations |

## Related

- Module: `docs/modules/github-app/README.md`
- Provisioning: `docs/runbooks/github-app-provisioning.md`
- Evidence: `artifacts/platform/2026-07-13-petralabx-github-token/`
