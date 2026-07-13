# Runbook: Onboarding a repo into PLX governance

**Audience:** maintainers / org admins adding a repository to the PLX-tracked fleet.  
**Owner:** Vince · **Effective:** 2026-07-13

**Who uses which doc**

| Role | Start here |
|------|------------|
| Org maintainers onboarding or auditing a repo | **This runbook** (tier checklist, folder map, gap audit) |
| Humans using MC UI (request/approve repos, review evidence) | [`docs/HUMAN-MC-SOP.md`](../HUMAN-MC-SOP.md) |
| Day-to-day PR authors (human) | [`docs/COLLABORATOR-SOP.md`](../COLLABORATOR-SOP.md) |
| Agents opening PRs | [`docs/AGENT-PR-SOP.md`](../AGENT-PR-SOP.md) |

Canonical inputs (all in this repo — the SSOT):

| Artifact | Path |
|----------|------|
| Governance contract | `config/governance-contract.yaml` |
| PR / MC discipline | `docs/COLLABORATOR-SOP.md` |
| Fleet registry | `config/tracked-repos-registry.json` |
| Scaffold script | `scripts/scaffold-tracked-repo.sh` |
| CONTRIBUTING stub | `docs/templates/CONTRIBUTING.repo-stub.md` |
| Drift-check template | `docs/templates/compliance-gate-drift.yml.tpl` |

Consumer repos get thin layers only — **never copy the contract**:

- `docs/GOVERNANCE.md` — pointer to PLX_MC (no duplicated rules)
- `CONTRIBUTING.md` — branch / deploy / validation specifics only
- `.github/workflows/plx-mc-compliance.yml` — generated from
  `scripts/generate-compliance-gate.py --emit downstream`
- `.github/workflows/compliance-gate-drift.yml` — pins the generator SHA and
  fails CI if the committed gate drifts from the PLX_MC source

---

## Repository control-plane tier

This taxonomy is **descriptive onboarding metadata**: it answers what control-plane
shape a repository of a given kind should expose. It does **not** redefine
pillars, evidence policy, risk tiers, checkout discipline, or compliance modes.

Canonical governance remains `config/governance-contract.yaml`. Collaborator /
Mission Control checkout and PR evidence rules remain `docs/COLLABORATOR-SOP.md`.
Do not treat this section as superseding either document.

Descriptive seed (fleet parity write-up): 
[agentic-swarm `docs/runbooks/agent-control-plane-tiers.md`](https://github.com/petralabx/agentic-swarm/blob/main/docs/runbooks/agent-control-plane-tiers.md).
After adoption, **this runbook and the tracked-repo registry own onboarding
status and evidence**.

### Allowed control-plane tier values

| Tier | Meaning | Examples |
|------|---------|----------|
| `hub` | Fleet governance SSOT | `petralabx/PLX_MC` |
| `product_platform` | Internal platform / multi-runtime | `petralabx/agentic-swarm` |
| `product_app` | Customer-facing application | `plx-customer-portal` |
| `skills` | Skill content / registry | `petralabx/skills` |
| `tooling` | Scripts / research / utilities | `petralabx/local-inference` |

Registry-only (not a control-plane taxonomy value for gap audits): `sandbox`
(temporary / experimental entries such as `petralabx/test-perms-check`).

### Common baseline

Every tracked control-plane repository should provide:

- an `AGENTS.md` entry point for agents;
- a human `README.md` and a repo-specific contribution path;
- a `docs/GOVERNANCE.md` pointer to this repo's governance contract (consumers
  must not copy pillars into local prose);
- committed `.cursor/` rules or configuration appropriate to the repo;
- deterministic local checks with matching CI enforcement;
- an explicit skills source, or an explicit statement that no repo-local skills
  are required; and
- compliance evidence that identifies the integration branch, required checks,
  Mission Control checkout policy, and rollback expectations (see
  `docs/COLLABORATOR-SOP.md` — do not restate those rules here).

`CLAUDE.md` is the standard Claude adapter. A thin `.claude/` directory is
useful when a repository owns Claude-specific commands, hooks, or skills, but
its **absence is not itself a gap** when `AGENTS.md`, `CLAUDE.md`, and the
compliance path already cover the runtime. Do not make `.claude/` mandatory.

### Per-tier minimums

| Tier | Files | Hooks and checks | Skills | Compliance |
|------|-------|------------------|--------|------------|
| `hub` | Common baseline plus the fleet registry, governance/onboarding docs, and control-plane configuration | Checkout/evidence enforcement, governance alignment, registry validation, and CI parity checks | Fleet-wide skill registry or installation contract with precedence and collision rules | Owns or directly links the governance SSOT; defines tracked-repo onboarding and compliance mode |
| `product_platform` | Common baseline plus architecture and operations runbooks for each runtime surface | Language checks for every engineering root, preflight gate, API/security checks where applicable, and CI equivalents | Repo/domain skills and a documented path to the fleet skill source; adapters stay thin | Consumes PLX_MC governance, records Mission Control evidence, and requires rollback/deployment evidence for product changes |
| `product_app` | Common baseline plus product, deployment, and operator documentation for the application root | App lint, typecheck, tests, build/smoke checks, and compliance gate | Product workflow skills only where they add domain knowledge; do not duplicate fleet governance as a skill | Consumes PLX_MC governance and requires product acceptance, rollback, and deploy evidence |
| `skills` | Common baseline plus skill registry/lock data, provenance, and authoring guidance | Schema, metadata, hash, collision, and install verification | Canonical skill bodies and deterministic export/install behavior | Records ownership, license/provenance, allowed consumers, versioning, and deprecation policy |
| `tooling` | Common baseline plus operator runbooks, configuration examples, and safety boundaries | Unit/integration checks, config validation, smoke/health checks, and compliance gate | An operating skill when agents invoke the tool; otherwise document that no skill is needed | Documents owner, auth source, default state, kill switch, health check, fallback, and audit/data boundary |

These are minimums, not a requirement to copy every hub file into every repo.

### Standard top-level folder map

Maps describe recognizable control-plane locations while **preserving each
repository's established engineering roots** (`src/`, `apps/`, `portal/`,
`scripts/`, domain roots such as `litellm/`, etc.).

| Tier | Standard map |
|------|--------------|
| `hub` | `src/` engineering root; `config/` fleet and governance data; `docs/` onboarding/runbooks; `scripts/` checks and automation; `.cursor/` agent rules/hooks; optional thin `.claude/` adapters |
| `product_platform` | `src/` shared/runtime code plus `apps/` product surfaces; `config/`, `docs/`, `scripts/`, `.cursor/`; optional thin `.claude/` adapters |
| `product_app` | Established application root such as `portal/`; root-level agent/governance pointers; `docs/`, `scripts/`, and `.cursor/` where present |
| `skills` | `skills/` canonical skill bodies; registry/lock configuration; `docs/` authoring guidance; `scripts/` validators/installers; `.cursor/` agent controls |
| `tooling` | `scripts/` automation plus the established domain root, for example `litellm/`; `docs/` runbooks; configuration; `.cursor/` agent controls |

#### Engineering-root stability

Do **not** rename an engineering directory merely to match this map. A proposed
rename must include a **costed migration note** covering affected imports,
build and deploy paths, CI, secrets/config references, documentation, external
consumers, rollback, owner, and estimated effort. Without that note, preserve
the existing root and align only the control-plane surfaces around it.

### Onboarding checklist (tier gap audit)

1. Select the repository's primary control-plane tier.
2. Record its existing engineering root or roots (registry `notes` or PR body —
   no schema migration required for this metadata).
3. Check files, hooks/checks, skills, and compliance against the tier minimum.
4. Record each unmet minimum as an onboarding gap with an owner and evidence
   requirement.
5. If an engineering-root rename is proposed, require a costed migration note
   before approval.
6. Keep `config/tracked-repos-registry.json` aligned with the chosen `tier`
   and onboarding status (`pending_adoption` → `active`).

### Initial fleet application

| Repository | Tier | Notes |
|------------|------|-------|
| `agentic-swarm` | `product_platform` | Structurally aligned; local governance must remain a pointer to PLX_MC |
| `PLX_MC` | `hub` | Governance SSOT; optional `.claude/` absence is not a gap |
| `plx-customer-portal` | `product_app` | **Verified** on `staging` (2026-07-13): app root `portal/` (+ `src/` present); `AGENTS.md`, `CLAUDE.md`, `docs/GOVERNANCE.md`, `docs/runbooks/CONTRIBUTING.md`, `.cursor/`, compliance workflows present |
| `local-inference` | `tooling` | Roots `scripts/` + `litellm/`; compliance workflows + `docs/GOVERNANCE.md` present. Residual closed via https://github.com/petralabx/local-inference/pull/7 (`CLAUDE.md` + `petralabx/PLX_MC` governance links) |

---

## 1. Register the repo

**Prerequisite — GitHub (org owner/admin only):** create the repository under
**`petralabx/<name>`** first. Standard org members **cannot** create repos.

**Prerequisite — MC allow-list:** collaborator submits **Request repo** in MC UI;
Owner/Admin **approves** after org validation. This is separate from fleet registry
enrollment — see [`docs/HUMAN-MC-SOP.md`](../HUMAN-MC-SOP.md) §5.

Then:

1. Add an entry to `config/tracked-repos-registry.json` with
   `status: "pending_adoption"`. Pick a tier (see
   [Repository control-plane tier](#repository-control-plane-tier) for
   minimums and folder map):

   | Tier | Meaning | Examples |
   |------|---------|----------|
   | `hub` | PLX_MC itself | `petralabx/PLX_MC` |
   | `product_app` | Customer-facing app | `plx-customer-portal` |
   | `product_platform` | Internal platform / swarm | `agentic-swarm` |
   | `skills` | Skill content repos | `petralabx/skills` |
   | `tooling` | Scripts / research / utilities | `petralabx/local-inference` |
   | `sandbox` | Temporary / experimental | `petralabx/test-perms-check` |

2. Open a PR to PLX_MC `main` with the registry change (hard compliance mode —
   agent PRs must carry an `MC-Checkout` stamp; see COLLABORATOR-SOP).

## 2. Scaffold the consumer repo

From a PLX_MC clone root, with the target repo cloned locally:

```bash
./scripts/scaffold-tracked-repo.sh \
  --repo <owner>/<name> --tier <tier> --branch <integration-branch> \
  --target /path/to/local/clone
```

- `--workflows-only` regenerates just the two workflow files (use when the
  gate generator changes and you need to re-sync a fleet repo).
- The script embeds the current PLX_MC HEAD SHA as `GEN_SHA` in the drift
  check. Commit from a PLX_MC checkout that is on `main` (or the merged hub
  commit) so the pinned SHA is fetchable from GitHub raw.
- `hub` tier is a no-op by design — PLX_MC uses COLLABORATOR-SOP directly.

## 3. Open the adoption PR on the consumer repo

Commit the four files on a branch (`chore/adopt-plx-governance`), open a PR to
the integration branch. Review that CONTRIBUTING's validation commands match
the repo's real test/build entry points — edit them; that section is
repo-owned.

## 4. Operator wiring (per repo)

1. **Secrets:** `PLX_MC_BASE_URL` (`https://mc.plxcustomer.io`),
   `COMPLIANCE_CI_TOKEN`.
2. **Variable:** `COMPLIANCE_MODE` — active fleet repos are **`hard`** (merge-blocking)
   per [`fleet-compliance-hard-cutover.md`](fleet-compliance-hard-cutover.md).
   New enrollments may start `soft` during adoption; only `petralabx/test-perms-check`
   stays soft by policy.
3. **Branch protection** on the integration branch: require PR + status checks
   `compliance` (and the repo's CI contexts).

## 5. Activate

After the adoption PR merges and the gate runs green: PR to PLX_MC flipping
the repo's `status` to `"active"` in `config/tracked-repos-registry.json`.

---

## Deactivating / archiving

Set `status` to `"archived"` (or remove the entry) via PLX_MC PR; remove the
two workflows in the consumer repo if the repo lives on outside the fleet.

## Troubleshooting

- **`drift` check fails on the consumer repo** — the committed
  `plx-mc-compliance.yml` no longer matches the pinned generator. Re-run the
  scaffold with `--workflows-only` from current PLX_MC `main`, or bump
  `GEN_SHA` if the generator changed intentionally.
- **Gate startup-fails calling a reusable workflow** — expected; that's why
  the gate is a generated self-contained copy, not a `workflow_call` (private
  repo → public reusable with `secrets: inherit` startup-fails).
- **`compliance` skips** — `PLX_MC_BASE_URL` secret unset; the downstream gate
  no-ops without it (soft adoption path).
