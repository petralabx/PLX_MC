# Runbook: Org CI pipeline (staged quality)

**Audience:** org admins, maintainers, and agents wiring or changing GitHub
Actions / branch protection on any `petralabx` repo.  
**Owner:** Vince · **Status:** active · **Effective:** 2026-08-21 · **Slug:**
`mc-sop-ci-pipeline`

> **TL;DR** — Quality is **staged**, not stuffed into one 30-minute job. Every
> `petralabx` repo runs a cheap **L0** floor (~20s, org-required): Mission
> Control **compliance** plus secrets. Product apps add a parallel **L1**
> lint ∥ typecheck ∥ unit ∥ `next build` job under **one always-reporting
> required name**. Playwright / persona QA is **L2** (HITL, not org-required).
> Migrate / deploy / smoke is **L3** (post-merge). Do **not** org-require a
> Next.js `next build` or Playwright. Speed without deleting tests.

Live catalog: [Governance SOPs — Org CI pipeline](https://mc.plxcustomer.io/?screen=governance-sops&sop=mc-sop-ci-pipeline)

Companion docs: [`COLLABORATOR-SOP.md`](../COLLABORATOR-SOP.md) (gate rules),
[`AGENT-PR-SOP.md`](../AGENT-PR-SOP.md) (agent close-out),
[`REPO-ONBOARDING.md`](REPO-ONBOARDING.md) (enroll a repo),
[`FLEET-SECRETS-SOP.md`](../FLEET-SECRETS-SOP.md) (tokens),
[`compliance-gate-rollout.md`](compliance-gate-rollout.md) (activation),
[`fleet-compliance-hard-cutover.md`](fleet-compliance-hard-cutover.md) (hard mode).

---

## 1. Why this exists

A single “run everything” workflow makes the merge queue wait on the slowest
path (Playwright, Next.js `next build`, persona QA). Contributors then skip,
path-filter, or add a **noop job with the same name** so the required check
always reports — which is indistinguishable from coverage
(TASK-710 class defect).

The SpaceX-shaped alternative: **cheap floor on every PR**, product evidence
in parallel, expensive HITL on the paths that need it, deploy after merge.

This runbook is the **mandated org process**. Per-repo workflows implement it.
Do not treat a green 30-minute monolith as equivalent.

---

## 2. Layers (mandate)

| Layer | Who | Target | Org-required? | What |
|-------|-----|--------|---------------|------|
| **L0** | All `petralabx` repos | ~20s | **Yes** | MC `compliance` + secrets. Downstream copies also run `drift` until the Team required-workflow pin is live. |
| **L1** | Product apps only (`product_app`, and hub/platform when they ship an app) | minutes, parallel | **No** (repo-required, not org-ruleset) | lint ∥ typecheck ∥ unit ∥ `next build`. **One** always-reporting required name. |
| **L2** | Product apps with HITL | as needed | **No** | Playwright / integration / persona QA — **the same tests**, on path filters **inside the job** or against staging. Never org-required. |
| **L3** | After merge | post-merge | **No** | migrate, deploy, smoke. Prefer a GitHub **merge queue** so L0+L1 stay green on the integration SHA. |

**Explicit prohibitions**

- Do **not** put Next.js `next build` or Playwright on the **org** required-workflow / org-ruleset floor.
- Do **not** delete L1/L2 tests to make CI faster. Move them to the right layer.
- Do **not** path-filter the workflow `on:` for a **required** check (skipped jobs never report; GitHub then looks pending forever, which tempts noop shadowing).
- Do **not** add a sibling job that always succeeds under the same required name.
- Do **not** `uses:` a public `petralabx/PLX_MC` reusable workflow from a **private** repo with `secrets: inherit` — that **startup-fails**. Keep generated self-contained copies + `drift`.

Humans are **recorded, not blocked** by L0 compliance. Agents are **hard-gated**
on hard-mode repos. Soft vs hard is `COMPLIANCE_MODE` + the registry — see
[`COLLABORATOR-SOP.md`](../COLLABORATOR-SOP.md). This runbook does **not**
authorize flipping live `COMPLIANCE_MODE`.

---

## 3. L0 — org floor (all repos)

Required check names that belong on branch protection / (eventually) the org
ruleset:

| Check | Job `name:` | Purpose |
|-------|-------------|---------|
| **compliance** | `compliance` | MC verify: actor, checkout, risk-tier bundle. Skip only when `PLX_MC_BASE_URL` is unset (pre-rollout). |
| **drift** | `drift` | Retired by decision D4: the org-required gate runs in every repo, so no repo keeps a copy or a drift check (TASK-3861, TASK-3902). Hub (`PLX_MC`) uses the generator `--check` in preflight. |
| **secrets** | repo-local cheap scan **or** GitHub secret scanning / push protection | Fail closed on committed credentials. Do not fold a heavy scanner into L1. |

### Copies + drift (retired)

Decision D4 retired the per-repo copies (`plx-mc-compliance.yml`) and their
drift checks (`compliance-gate-drift.yml`). The org required-workflow pin (below)
runs the gate from PLX_MC `main` in every repo. The portal and agentic-swarm
dropped theirs in TASK-3861; local-inference, plx_secondbrain and skills in
TASK-3902. The scaffold no longer writes them.

Hub workflow: `.github/workflows/compliance-gate.yml` (dogfood + `workflow_call`
for public callers). Private repos must **not** call that reusable with
`secrets: inherit`.

### Org ruleset (required-workflow pin live)

Script: `scripts/provision-org-ruleset-required-workflows.sh` (pins
`.github/workflows/compliance-gate.yml` @ `petralabx/PLX_MC@main`).

**Live (read 2026-10-24):** org ruleset **`PLX MC Compliance Gate`** id
**`18679471`** is active and requires `.github/workflows/compliance-gate.yml`
@ `petralabx/PLX_MC@main` on the default branch of each enrolled repo. Every PR
on a repo with a local copy therefore runs two `compliance` producers, the org
one and the copy, plus `drift` (seen on
https://github.com/petralabx/plx-customer-portal/pull/2979).
Decision D4 a (Vince, 2026-10-24) retires the local copies and `drift` in portal
and agentic-swarm: TASK-3861, a workflow-file change that Vince merges. Do not
delete them from a docs PR.

Per-repo branch protection: `scripts/provision-fleet-branch-protection.sh`
(requires `compliance` + `drift` on the protected branch). Portal extras are
**in addition** to this floor, not a replacement.

Secrets wiring: [`FLEET-SECRETS-SOP.md`](../FLEET-SECRETS-SOP.md)
(`PLX_MC_BASE_URL`, `COMPLIANCE_CI_TOKEN` break-glass, `COMPLIANCE_MODE`).

---

## 4. L1 — product apps (repo-required, parallel)

Applies to `tier: product_app` (today: `petralabx/plx-customer-portal`) and to
any hub/platform that ships a user-facing app. Tooling / skills / sandbox repos
are **not** required to run `next build` on every PR.

**Shape**

- Four **parallel** jobs: lint ∥ typecheck ∥ unit ∥ `next build`.
- One **aggregator** that **always reports** under a single required name
  (portal: exactly `lint-typecheck-build`). The aggregator depends on the four
  jobs and fails if any failed. It must run even when a child is skipped — but
  children of a required L1 check must **not** be skipped via workflow-level
  `on.paths`.
- No noop job that reports the required name without running the real work.

Portal **current extra** required checks (repo branch protection, **not** org
ruleset):

| Check | Layer | Notes |
|-------|-------|--------|
| `compliance` | L0 | Org floor. Agents need a live repo-scoped `MC-Checkout: dsp_*` — never `pending`. |
| `lint-typecheck-build` | L1 | Keep this exact name. Split the sequential monolith into parallel jobs; do not reintroduce noop shadowing. |
| `Validate ledgers (vmc-quality-ledger/v1)` | L1-adjacent | Ledger schema gate when the portal publishes `vmc-quality-ledger/v1`. |
| `silent-failure-audit` | L1-adjacent | **Real fail** on portal `product_app` repos. Do not raise `BASELINE`. Fix new catch-empty-returns with `QueryResult<T>`. |

Hub `PLX_MC` local equivalent is `./scripts/preflight.sh` (pre-commit / pre-push /
CI) — that is **this repo’s** product gate, not an org-wide Next/Playwright
requirement.

### AI review verdict (`ai-review/verdict`)

The portal posts `ai-review/verdict` from its own `ai-review-verdict.yml`. Every
other repo uses one shared rule (TASK-3902):

- `.github/workflows/ai-review-verdict-shared.yml` on PLX_MC `main` holds the
  rule. It is the portal's rule, with the base branch and the caller file as
  inputs.
- Each repo adds `.github/workflows/ai-review-verdict.yml`: a copy of PLX_MC's
  caller with its own `base_branch`. The caller pins the rule to PLX_MC `main`,
  so a PR cannot change the rule that grades it.
- A marker counts when the plx-agents app posts it, or when a petralabx member
  (author association `OWNER` or `MEMBER`) who did not open the PR posts it
  (Vince, 2026-10-25). CIP's own markers (`plx-cip[bot]`) do not count.
- Phase 2 of the org ruleset requires `ai-review/verdict` in every repo. Add the
  caller first, or the repo's PRs wait for a status that never comes.
- A change to the shared file changes the rule in every repo at once. It is a
  workflow change, so it needs an MC approval.
- Public repos can call the shared file only while PLX_MC is public. Before
  PLX_MC goes private (TASK-3867), move it with the org compliance gate.

---

## 5. L2 — HITL (not org-required)

Playwright, integration against staging, and persona / UAT QA stay in CI as
**the same tests**. They may:

- run on `workflow_dispatch` / nightly / merge-queue opt-in;
- use **job-level** `if:` / path filters so docs-only PRs skip the browser
  suite **without** skipping L0/L1 required names;
- target staging after a preview deploy.

They must **not** be org-required and should not sit on the portal’s single
L1 required name.

---

## 6. L3 — post-merge

After the integration branch moves:

1. Migrate (staging then prod, never prod-first).
2. Deploy (Vercel / existing host — see each repo’s CONTRIBUTING).
3. Smoke the **live** URL; do not treat GitHub CI green as deploy proof
   (deployment-verification rule).

**Recommend** GitHub **merge queue** on the integration branch so L0+L1 re-run
on the would-be merge SHA. Enabling the queue is an operator follow-up, not
part of documenting the process. Portal `staging` has run one since 2026-10-20
(TASK-3420): merge commits only, and agents arm auto-merge into it (decision D3,
2026-10-24). PLX_MC and agentic-swarm follow in Phase 2 (decision D13).

---

## 7. Current fleet snapshot (do not invent)

Authoritative enrollment: `config/tracked-repos-registry.json`. The org has
further repos that are **not** in that list.

| Repo | Registry | L0 today | Extra required (repo) | Notes |
|------|----------|----------|------------------------|--------|
| `petralabx/PLX_MC` | hub, hard, active | `compliance` | `Preflight + full suite` | Generator SSOT. No downstream `drift` copy. |
| `petralabx/plx-customer-portal` | product_app, hard, active | `compliance` (+ `drift`) | `lint-typecheck-build`, `Validate ledgers (vmc-quality-ledger/v1)`, `workbench-api`, `ai-review/verdict`, `compliance-group` (read 2026-10-24), `merge-hold` (added 2026-10-25) | Staging is the integration branch, with a merge queue. `silent-failure-audit` is not in the ruleset but is a real fail — do not raise `BASELINE`. |
| `petralabx/agentic-swarm` | product_platform, hard, active | `compliance` (+ `drift`, not required) | `Swarm (Python)`, `VMC Web (TypeScript)`, `Change Impact Analysis`, `smoke`, `Playwright PR Smoke`, `Agentic PR Evidence` (read 2026-10-24; none pinned to an app) | |
| `petralabx/skills` | skills, hard, active | `compliance` + `drift` | | |
| `petralabx/local-inference` | tooling, hard, active | `compliance` + `drift` | | |
| `petralabx/1hr-after` | tooling, **registry=hard** | `compliance` + `drift` | | **Gap:** live `COMPLIANCE_MODE` is **soft**. Do not silently flip. |
| `petralabx/furgenics` | tooling, **registry=hard** | `compliance` + `drift` | | **Gap:** live `COMPLIANCE_MODE` is **soft**. Do not silently flip. |
| `petralabx/for-and-against` | tooling, **registry=soft**, active | `compliance` + `drift` | | Soft by registry. |
| `petralabx/test-perms-check` | sandbox, soft, pending_adoption | optional | | Stays soft. |
| `petralabx/plx_secondbrain` | tooling, **registry=soft**, active | `compliance` + `drift` (live) | | Enrolled TASK-1165. L0 landed via https://github.com/petralabx/plx_secondbrain/pull/2. Stays soft; do not flip hard. |

Most enrolled non-hub repos require **`compliance` + `drift`**. Portal adds
`lint-typecheck-build`, `Validate ledgers`, `workbench-api`, `ai-review/verdict`,
`compliance-group` and `merge-hold`; `silent-failure-audit` stays a real fail outside the
ruleset. Do not org-require those extras.

---

## 7a. Runtime entry files (consumers must keep in sync)

`petralabx/PLX_MC` is the canonical SOP. Agents that start from this repo
(Claude, Cursor, Grok, Codex, swarm) read the Hub copies. Portal and other
consumers keep their own runtime entry files in sync with the pipeline
contract in [`AGENT-PR-SOP.md`](../AGENT-PR-SOP.md) / `AGENTS.md`. Do **not**
edit those consumer files from a PLX_MC PR.

| Consumer file | Why it must stay in sync |
|---------------|--------------------------|
| `AGENTS.md` | Cursor / swarm / generic agent entry |
| `CLAUDE.md` | Claude Code entry |
| `.cursorrules` | Legacy Cursor entry |
| `.cursor/rules/mc-compliance.mdc` | Always-apply checkout/compliance rule |
| `prompts/uat-agent/v2/*` | Portal UAT agent prompts |
| `.github/copilot-instructions.md` | GitHub Copilot / coding-agent entry |
| `GEMINI.md` | Gemini / other runtime entry |

Those copies must forbid `MC-Checkout: pending`, require a live repo-scoped
checkout before `PR_CREATE`, require non-empty `verificationCommands` AND
`rollback` on `mc_complete_task`, and never invent a `dsp_*`. On portal
`product_app` repos, `silent-failure-audit` is a real fail.

---

## 8. New-repo onboarding checklist (CI)

Full fleet enrollment remains [`REPO-ONBOARDING.md`](REPO-ONBOARDING.md) +
`scripts/scaffold-tracked-repo.sh`. CI-specific steps:

1. Org owner creates `petralabx/<name>`; MC **Request repo** → approve.
2. PLX_MC PR: add `config/tracked-repos-registry.json` (tier, integration
   branch, `compliance_mode`, status).
3. From hub `main`:

   ```bash
   ./scripts/scaffold-tracked-repo.sh \
     --repo petralabx/<name> \
     --tier <hub|product_platform|product_app|skills|tooling|sandbox> \
     --branch <integration-branch> \
     --target /path/to/clone
   ```

   That writes the thin governance layer, the compliance helper scripts and the
   routing artifacts. It writes no compliance gate copy: the gate is org-required
   in every repo (decision D4). Do **not** hand-copy YAML.
4. Wire L0 secrets/variables per [`FLEET-SECRETS-SOP.md`](../FLEET-SECRETS-SOP.md).
   New enrollments may start `COMPLIANCE_MODE=soft`; only flip to `hard` with an
   explicit operator task (never “while we are here”).
5. Branch protection on the integration branch:
   - **All repos:** require `compliance`. The org required-workflow pin does this;
     there is no `drift` check.
   - **Product apps:** also require the single L1 aggregator name (portal:
     `lint-typecheck-build`). Optionally the ledger validator. On portal,
     `silent-failure-audit` is a real fail — do not raise `BASELINE`.
     **Never** add Playwright or a second build job as an org-wide required check.
6. Confirm L1 `on:` has **no** path filters; the aggregator always reports.
7. Put Playwright / persona QA on L2 (path/`if:` inside optional jobs, or
   staging).
8. Document L3 migrate/deploy/smoke in the consumer `CONTRIBUTING.md`. Prefer
   merge queue once L0+L1 are stable.
9. Activate in the registry (`status: active`) only after a green L0 PR.

Hub full scaffold is not a no-op: it overwrites the routing workflow, two helper
scripts, both routing manifests and `docs/GOVERNANCE.md` (six files), skipping
only `CONTRIBUTING.md`. Do not run full scaffold against `PLX_MC`. For routing
refreshes use `--routing-only` (three routing files); `--workflows-only` writes
the routing workflow and two helpers (three files). Full non-hub scaffold writes
seven files. See the [exact file contract](REPO-ONBOARDING.md#scaffold-file-contract).

Agent PRs must not serialize on shared markdown indexes (review-links lists,
milestone registers). Put review URLs in the PR body; stamp registers after
merge — see [`AGENT-PR-SOP.md`](../AGENT-PR-SOP.md).

---

## 9. Operator follow-ups (do not silently “fix” in a docs PR)

These are **gaps**, not implied work for this process doc. File MC tasks; do
not flip live `COMPLIANCE_MODE` or edit downstream YAML from PLX_MC unless the
change is a generator/template pin in **this** repo.

| Gap | Fact | Disposition |
|-----|------|-------------|
| Org ruleset pin (was: hollow ruleset) | Resolved: `PLX MC Compliance Gate` id `18679471` requires `compliance-gate.yml@main` (read 2026-10-24). Every PR now runs two `compliance` producers plus `drift`. | Retire the copies and `drift` per decision D4 a: **TASK-3861** (workflow files; Vince merges). Was **TASK-1164**. |
| `plx_secondbrain` | Registry row active (tooling, soft). L0 `compliance`+`drift` live via https://github.com/petralabx/plx_secondbrain/pull/2. | Stay soft. Do not flip to hard. **TASK-1165**. |
| `COMPLIANCE_MODE` drift | `furgenics` and `1hr-after`: live variable **soft**, registry **hard**. | Operator reconcile. **Do not** silently set live to `hard`. **TASK-1166**. |
| Legacy generator fetch | Some consumer drift workflows still fetch `scripts/generate-compliance-gate.py` from **`taylorvalton/PLX_MC`**. Hub template already pins **`petralabx/PLX_MC`**. | Re-scaffold `--workflows-only` from hub `main` on those consumers. **TASK-1167**. |

---

## 10. Related

| Doc | Path |
|-----|------|
| Collaborator / gate rules | [`docs/COLLABORATOR-SOP.md`](../COLLABORATOR-SOP.md) |
| Agent PR close-out | [`docs/AGENT-PR-SOP.md`](../AGENT-PR-SOP.md) |
| Fleet onboarding | [`docs/runbooks/REPO-ONBOARDING.md`](REPO-ONBOARDING.md) |
| Fleet secrets | [`docs/FLEET-SECRETS-SOP.md`](../FLEET-SECRETS-SOP.md) |
| Compliance activation | [`docs/runbooks/compliance-gate-rollout.md`](compliance-gate-rollout.md) |
| Hard-mode cutover | [`docs/runbooks/fleet-compliance-hard-cutover.md`](fleet-compliance-hard-cutover.md) |
| Org ruleset evidence (historical) | `artifacts/compliance/2026-07-09-org-ruleset/` |
| Generator | `scripts/generate-compliance-gate.py` |
| Scaffold | `scripts/scaffold-tracked-repo.sh` |
| Branch protection | `scripts/provision-fleet-branch-protection.sh` |
| Org required-workflow pin | `scripts/provision-org-ruleset-required-workflows.sh` |
