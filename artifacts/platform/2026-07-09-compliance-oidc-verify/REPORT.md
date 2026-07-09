# Compliance OIDC Verify Evidence

## Mission

Make `POST /api/compliance/verify` safe for PLX_MC dogfood by documenting
GitHub Actions OIDC as the preferred CI authentication path while retaining the
existing bearer token as a temporary fallback/break-glass control.

## Work Context

- Task: `TASK-297`
- Checkout: `MC-Checkout: dsp_mrdittqo7fml8s`
- Phase branch: `proj/compliance-verify-oidc-phase-4-docs-evidence`
- Scope: P4 docs and evidence only. No source, test, workflow, or package files
  are changed in this phase.

## What Changed Before P4

- P1 established the compliance gate service and persisted verification/audit
  records.
- P2 added agent checkout/capture surfaces so PRs can carry `MC-Checkout`
  attribution.
- P3 updated the compliance workflow and verify path for OIDC-first auth with
  bearer fallback, including `id-token: write` in
  `.github/workflows/compliance-gate.yml`.

## What Changed In P4

- Updated `docs/runbooks/compliance-gate-rollout.md` to make OIDC the
  first-class `POST /api/compliance/verify` auth path.
- Documented required OIDC env vars:
  `COMPLIANCE_OIDC_ENABLED=1`,
  `COMPLIANCE_OIDC_AUDIENCE=plx-mc-compliance-verify`, and
  `COMPLIANCE_OIDC_REPO_ALLOWLIST=petralabx/PLX_MC`.
- Documented the dual-auth cutover order: merge dual-auth, deploy MC with OIDC
  env, dogfood under OIDC, and retire bearer only in a follow-up.
- Updated `docs/modules/compliance/README.md` to mention
  `src/lib/compliance/github-oidc.ts` and the dual-auth verify route.

## Verification Commands

```bash
test -f artifacts/platform/2026-07-09-compliance-oidc-verify/REPORT.md && test -f artifacts/platform/2026-07-09-compliance-oidc-verify/index.md && rg -q 'OIDC' docs/runbooks/compliance-gate-rollout.md
```

Result: exit 0 locally.

```bash
git diff --check
```

Result: exit 0 locally.

## Deploy And Dogfood Evidence

- SC 7 deploy evidence: TODO — deploy MC with OIDC env and attach deployment
  URL/build evidence here. Do not claim deployment before it exists.
- SC 8 dogfood evidence: TODO — open a PLX_MC PR under OIDC, capture
  `auth=oidc` workflow output and verify response evidence here. Do not retire
  bearer before this passes.

## Rollback Plan

- Set `COMPLIANCE_OIDC_ENABLED=0` on MC to disable OIDC and use bearer-only while
  `COMPLIANCE_CI_TOKEN` remains configured.
- Unset `PLX_MC_BASE_URL` in the repo to make the workflow skip the gate.
- Set `COMPLIANCE_MODE=soft` or remove the required check from branch
  protection to stop blocking PRs while preserving audit visibility.

## Follow-Up

- Bearer is **not retired** in this phase. Keep `COMPLIANCE_CI_TOKEN` through
  dogfood and remove it only in a follow-up with evidence.
- Fleet rollout for `agentic-swarm` and `plx-customer-portal` is Phase 2 /
  follow-up after PLX_MC OIDC dogfood succeeds.
