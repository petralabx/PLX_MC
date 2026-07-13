# Runbook: petralabx GitHub org PAT on agent workstations

Keeps every agent box able to act on **all** `petralabx/*` repos via a
fine-grained PAT (`PETRALABX_GITHUB_TOKEN`), without relying on interactive `gh`
keyring auth.

## Why

The legacy shared `GITHUB_TOKEN` could not see `plx-customer-portal` (404). The
org PAT covers **all** petralabx repos (verified 9/9). MC runtime prefers the
GitHub App for reads; this PAT is for:

- workstation / agent `gh` + git automation
- `resolveGithubToken` PAT fallback when App mint is skipped/fails
- any tool that only reads `GITHUB_TOKEN` / `PETRALABX_GITHUB_TOKEN`

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

- `~/.secrets-env.staging.ps1` — full agent hydrate
- `~/.secrets-env.github.ps1` — Windows GitHub fragment
- `~/.secrets-env.github` — Unix GitHub fragment
- prefers `~/.aws/Secret_Github.txt` when present (must be the org PAT)

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
# Then call GitHub API with $env:PETRALABX_GITHUB_TOKEN — expect portal push=True
```

```bash
source ~/.secrets-env.github
# python/curl against /repos/petralabx/plx-customer-portal — expect permissions.push true
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
