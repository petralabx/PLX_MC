# Contributing to {{REPO_NAME}}

Version: 1.0  
Effective: 2026-07-06  
Owner: PLX Repo Maintainers

> **Governance is centralized in PLX Mission Control.** This file covers
> **repo-specific** workflow only. Cross-repo rules are mandatory:
>
> | Topic | Canonical source |
> |-------|------------------|
> | Agent pillars, PR discipline, evidence | [`petralabx/PLX_MC/config/governance-contract.yaml`](https://github.com/petralabx/PLX_MC/blob/main/config/governance-contract.yaml) |
> | Compliance gate, `MC-Checkout`, risk tiers | [`petralabx/PLX_MC/docs/COLLABORATOR-SOP.md`](https://github.com/petralabx/PLX_MC/blob/main/docs/COLLABORATOR-SOP.md) |
> | Onboarding checklist | [`petralabx/PLX_MC/docs/runbooks/REPO-ONBOARDING.md`](https://github.com/petralabx/PLX_MC/blob/main/docs/runbooks/REPO-ONBOARDING.md) |
>
> See also: `docs/GOVERNANCE.md` in this repo.

---

## 1. Integration branch

| Branch | Role |
|--------|------|
| **`{{INTEGRATION_BRANCH}}`** | All feature work merges here via PR |
{{RELEASE_BRANCH_ROW}}

**Rules**

1. **Never push directly to the integration branch.** Open a PR.
2. Every PR runs the **PLX MC Compliance Gate** (`.github/workflows/plx-mc-compliance.yml`).
3. Agent-driven PRs must include `MC-Checkout: dsp_…` in the body (see COLLABORATOR-SOP).
4. Non-docs PRs: add PR-body `## Rollback Plan` (human-readable; may be required by
   repo CI). Agent PRs must also complete **`task.evidence`** via `mc_complete_task`
   — the MC compliance gate reads `task.evidence`, not PR-body prose.

---

## 2. Branch naming

| Pattern | Use for |
|---------|---------|
| `feat/<area>-<slug>` | New capability |
| `fix/<area>-<slug>` | Bug fix |
| `chore/<area>-<slug>` | Tooling, deps |
| `docs/<area>-<slug>` | Documentation |
| `ci/<area>-<slug>` | GitHub Actions |

---

## 3. Commits

Use [Conventional Commits](https://www.conventionalcommits.org/) with scope. Include
Mission Control milestone IDs when applicable (`MRP-M-*`, `ERP-M-*`, etc.).

---

## 4. PR template

```markdown
## Summary
(what and why)

## Mission Control
- Milestone: … / n/a
- MC-Checkout: dsp_…   ← required for agent/task work
- task.evidence: complete via mc_complete_task before gate (summary, rollback, verification)

## Test plan
- [ ] (repo validation commands)

## Rollback Plan
(how to revert — PR-body section; MC gate also checks task.evidence.rollback for agents)
```

---

## 5. Validation before merge

```bash
{{VALIDATION_COMMANDS}}
```

Required GitHub checks: **CI**, **PLX MC Compliance Gate**.
{{LEDGER_CHECK_ROW}}

---

## 6. Repo-specific notes

{{REPO_SPECIFIC_NOTES}}

---

## 7. Operator setup

Repo secrets: `PLX_MC_BASE_URL`, `COMPLIANCE_CI_TOKEN`.  
Repo variable: `COMPLIANCE_MODE` (`soft` → `hard` when ready).  
Enable branch protection on `{{INTEGRATION_BRANCH}}` — require PR + checks.
