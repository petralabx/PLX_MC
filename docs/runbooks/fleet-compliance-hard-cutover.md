# Runbook: Fleet compliance hard-mode cutover (EN-007 P4)

> After PR→task projection (P1), bucket PRD enforcement (P2), and SharePoint push
> verification (P3) land in MC, flip every **active** tracked repo from soft
> (warn-only) to **hard** (merge-blocking). Branch protection requiring the
> `compliance` check is already live fleet-wide (2026-07-08); this step closes the
> gap where `COMPLIANCE_MODE=soft` let the workflow exit 0 on block.

## Prerequisites

- MC deployed with projection enabled (`COMPLIANCE_PROJECTION_ENABLED` unset or `1`).
- `POST {MC}/api/compliance/verify` and webhook return `401` without auth (not `503`).
- Repo secrets present on every target: `PLX_MC_BASE_URL`, `COMPLIANCE_CI_TOKEN`.
- Branch protection requires `compliance` (+ `drift` where applicable) — see
  `scripts/provision-fleet-branch-protection.sh`.
- Acceptance tests green: `npm run test -- --run tests/compliance-projection.test.ts
  tests/compliance-multitask.test.ts tests/sync-projection.test.ts`.

## Active fleet (hard)

Authoritative list: `config/tracked-repos-registry.json` (`compliance_mode: hard`).

| Repo | Protected branch |
|------|------------------|
| `taylorvalton/PLX_MC` | `main` |
| `taylorvalton/plx-customer-portal` | `staging` |
| `taylorvalton/agentic-swarm` | `main` |
| `petralabx/skills` | `main` |
| `petralabx/local-inference` | `main` |
| `petralabx/1hr-after` | `main` |
| `petralabx/furgenics` | `main` |
| `petralabx/for-and-against` | `main` |

**Excluded:** `petralabx/test-perms-check` stays `soft` (`pending_adoption`).

## Cutover (one command per repo or fleet script)

```bash
unset GITHUB_TOKEN   # use gh keyring / GHUB_DGX_SPARK, not a stale env override
./scripts/provision-fleet-compliance-hard.sh
# dry-run first:
./scripts/provision-fleet-compliance-hard.sh --dry-run
```

The script sets the GitHub **Actions variable** `COMPLIANCE_MODE=hard` on each repo.
The workflow reads it via `vars.COMPLIANCE_MODE` (see `.github/workflows/compliance-gate.yml`).

Verify:

```bash
for r in taylorvalton/PLX_MC taylorvalton/plx-customer-portal taylorvalton/agentic-swarm \
  petralabx/skills petralabx/local-inference petralabx/1hr-after petralabx/furgenics \
  petralabx/for-and-against; do
  echo -n "$r: "
  gh variable list --repo "$r" | awk '/COMPLIANCE_MODE/{print $2}'
done
```

## Rollback

Per repo (owner only):

```bash
gh variable set COMPLIANCE_MODE --body soft --repo OWNER/REPO
```

Update `config/tracked-repos-registry.json` to match if the rollback is intentional.
Removing the required `compliance` check from branch protection is a separate step
and should be rare.

## Kill switches

| Switch | Effect |
|--------|--------|
| `COMPLIANCE_MODE=soft` | Check runs but does not fail the workflow on block |
| Unset `PLX_MC_BASE_URL` | Workflow skips (no MC call) |
| `COMPLIANCE_PROJECTION_ENABLED=0` on MC | PR events recorded; tasks not auto-projected |

## Post-cutover verification

1. Open a test PR on `petralabx/test-perms-check` (still soft) — confirm warn-only.
2. Agent dogfood PR on `PLX_MC` with `MC-Checkout` — confirm task moves to
   `progress` on open and `merged` on merge (P5 evidence bundle).
3. High-risk migration path on an agent PR without bucket PRD — confirm `compliance` blocks.
