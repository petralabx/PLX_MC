# REPORT — petralabx GitHub PAT promote + org-wide wiring

## Verdict
`PETRALABX_GITHUB` promoted staging → prod (aliased `PETRALABX_GITHUB_TOKEN`).
**Org coverage OK: 9/9** petralabx repos for both PAT (`push`+`pull`) and GitHub App install.
PLX_MC wiring: owner-aware PAT fallback + workstation bootstrap.

## Org repos verified (2026-07-13)

| Repo | PAT | App install |
|------|-----|-------------|
| petralabx/1hr-after | push+pull | yes |
| petralabx/agentic-swarm | push+pull | yes |
| petralabx/for-and-against | push+pull | yes |
| petralabx/furgenics | push+pull | yes |
| petralabx/local-inference | push+pull | yes |
| petralabx/plx-customer-portal | push+pull | yes |
| petralabx/PLX_MC | push+pull | yes |
| petralabx/skills | push+pull | yes |
| petralabx/test-perms-check | push+pull | yes |

Gaps: none (`SUMMARY_PAT_FAIL` / `SUMMARY_NO_PUSH` / `SUMMARY_MISSING_FROM_APP` = none).

## Secrets
- Staging key name used: `PETRALABX_GITHUB`
- Prod: `PETRALABX_GITHUB` + `PETRALABX_GITHUB_TOKEN`
- Staging alias `PETRALABX_GITHUB_TOKEN` ensured

## Code / docs (this PR)
- `resolveGithubToken` — petralabx prefers org PAT; other owners keep legacy `GITHUB_TOKEN`
- `scripts/bootstrap-windows-secrets.py` — exports `PETRALABX_GITHUB_TOKEN`
- Module + provisioning runbook updated
- `tests/github-app.test.ts` covers preference + non-petralabx isolation

## Operator follow-through
1. Re-run `python scripts/bootstrap-windows-secrets.py` on agent boxes.
2. ~~If `~/.aws/Secret_Github.txt` still holds the old limited PAT…~~ **Done (2026-07-13):** replaced local `Secret_Github.txt` with `PETRALABX_GITHUB_TOKEN`; re-bootstrapped; `GITHUB_TOKEN` == org PAT; portal probe `push=True`. Meta: `~/.aws/Secret_Github.txt.replaced-2026-07-13.meta` (no prior token retained).
3. Ensure MC/Vercel env eventually includes `PETRALABX_GITHUB_TOKEN` for PAT-fallback hosts (App-only Vercel already covers reads via install).
4. New org repos: App “all repositories” auto-includes; confirm PAT still org-wide.
5. Other agent machines (infra-ops break-glass, 2026-07-13):
   - **dell-vta** (`agentic-winrm`): `Secret_Github.txt` + `.secrets-env.github.ps1` — portal `push=True`
   - **dgx-spark** (`vinnysachet`, `AWS_PROFILE=plx-prod`): `Secret_Github.txt` + `.secrets-env.github` — portal `push=True`
   - VTA `C:\\Users\\vince` profile: not writable from WinRM agent account (Access Denied) — re-run as Vince interactively if that profile needs it
   - EC2 targets (`vmc-prod` / `swarm-prod` / `tradingbox`): not Secret_Github workstation boxes; use App / injected env there

## Rollback
Revert Secrets Manager `prod/ec2-secrets` to prior version stage; revert this PR.
