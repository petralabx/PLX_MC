# Runbook: Marketing Brand Repo Setup

> Operator + marketing-team checklist for onboarding a **consumer brand repo**
> (For & Against, Furgenics, 1HR-After, …) into PLX Mission Control and PLX
> repo governance. These repos **opt out** of the PLX portal `--p-*` design tokens
> but must ship a **complete PLX-structure design-system bundle** with their own
> token namespace.
>
> **GitHub org:** create brand repos under **`petralabx/<slug>`**, not `taylorvalton/`.
> Platform repos (`PLX_MC`, `plx-customer-portal`, `agentic-swarm`) are on **`petralabx`**
> post EN-008 — see [`github-org-phased-migration.md`](github-org-phased-migration.md).
>
> Canonical references: `docs/design-system/HOMEPAGE-SCOPE.md` (sibling-track
> decision), `artifacts/design-system/2026-06-17-authority-and-propagation/REPORT.md`
> (opt-in / opt-out model), `docs/REPO_HYGIENE_SPEC.md`, `config/plx-brand.schema.json`.

## Scope

This runbook covers **everything** a marketing brand repo must satisfy — not only
design-system structure:

| Layer | What | Enforced by |
|---|---|---|
| MC registry | Allow-list membership + metadata | MC `REPOS` / request → approve |
| Brand declaration | Recorded opt-out + boundary | `plx-brand.json` + `check-brand-repo-structure.py` |
| Design-system bundle | Tokens, ADRs, inventory, contributing guide | Structure gate |
| Repo hygiene | File placement, evidence bundles, naming | `check-repo-hygiene.py` |
| Module contracts | `docs/modules/<domain>/README.md` | Hygiene + review |
| Agent / PR workflow | MC task checkout, evidence, compliance | Compliance gate + capture hook |
| CI / preflight | One definition of passing | `scripts/preflight.sh` |
| External integrations | Owner, scope, kill switch per integration | Governance contract |

---

## Phase 0 — Decide before creating the repo

- [ ] **Brand slug** chosen (kebab-case, matches GitHub repo name): e.g. `for-and-against`, `furgenics`, `1hr-after`.
- [ ] **Display name** locked: e.g. `For & Against`, `Furgenics`, `1HR-After`.
- [ ] **Human accountable owner** named (marketing lead or operator).
- [ ] **Rationale recorded**: consumer brand with own visual identity; does **not** adopt PLX portal tokens.
- [ ] **Shared brand spine** decided per `HOMEPAGE-SCOPE.md` (wordmark / periodic mark / favicons — which assets this brand shares with PLX operational surfaces).

---

## Phase 1 — GitHub + MC registry

### 1.1 Create the GitHub repo

Create under **`petralabx/<slug>`** (private until launch). Default branch: `main`.
Do **not** create under `taylorvalton/` — see [`github-org-phased-migration.md`](github-org-phased-migration.md).

### 1.2 Register in Mission Control

The repo must appear in the MC allow-list before tasks or agents attach it.

**Option A — seeded (operator):** add to `src/lib/mc-data/data.ts` `REPOS` with honest metadata:

| Field | Example |
|---|---|
| `id` | `for-and-against` |
| `name` | `for-and-against` (GitHub repo name) |
| `owner` | `petralabx` |
| `def` | `main` |
| `visibility` | `private` (update when GitHub validates) |
| `lang` | `—` until GitHub resolves |
| `scope` | `{DisplayName} consumer brand — marketing site, design system, and brand assets (PLX-structure, own tokens).` |

**Option B — self-service:** collaborator submits **Request repo** in MC → Owner/Admin approves after GitHub org validation passes.

- [ ] Repo visible on MC **Repos** screen.
- [ ] Repo selectable in **New Task** / task detail repo picker.
- [ ] Agents clamped to the same allow-list (no off-registry attaches).

Current marketing-brand registry ids (seeded 2026-06-30):

| Brand | MC registry id | GitHub |
|---|---|---|
| For & Against | `for-and-against` | `petralabx/for-and-against` |
| Furgenics | `furgenics` | `petralabx/furgenics` |
| 1HR-After | `1hr-after` | `petralabx/1hr-after` |

---

## Phase 2 — Root declaration (`plx-brand.json`)

Copy `config/plx-brand.json.template` from PLX_MC to the brand repo root and customize.

Required fields (see `config/plx-brand.schema.json`):

```json
{
  "schemaVersion": "plx-brand/v1",
  "repoKind": "marketing-brand",
  "brand": { "slug": "furgenics", "displayName": "Furgenics" },
  "designSystem": {
    "adoptsPlxTokens": false,
    "tokenPrefix": "--fg-",
    "boundaryClass": "brand-furgenics",
    "decidedBy": "vince",
    "decidedAt": "2026-06-30",
    "rationale": "Consumer-facing brand; own token layer; PLX-structure bundle."
  },
  "mc": {
    "github": "petralabx/furgenics",
    "registryId": "furgenics"
  }
}
```

Rules:

- `registryId` **must match** the MC allow-list id.
- `tokenPrefix` must be brand-specific (`--fa-`, `--fg-`, `--1hr-`, …) — **never** `--p-*`.
- `boundaryClass` wraps all branded UI; tokens must not leak globally.
- `adoptsPlxTokens: false` is the explicit, auditable opt-out.

- [ ] `plx-brand.json` committed at repo root.
- [ ] `registryId` matches MC `REPOS` entry.

---

## Phase 3 — PLX-structure design-system bundle

Marketing brands ship the **same structural rigor** as PLX operational repos, with **their own** tokens and components.

### Required tree

```
<repo>/
├── plx-brand.json
├── README.md
├── AGENTS.md
├── docs/
│   ├── design-system/
│   │   ├── README.md              ← what / why / read order
│   │   ├── tokens.css             ← canonical token spec (--fa-* etc.)
│   │   ├── tokens.ts              ← TS mirror for build consumers
│   │   ├── REFERENCE.md           ← artifact / screen index
│   │   ├── COMPONENT-INVENTORY.md ← shadcn inherit/extend/build catalog
│   │   ├── CONTRIBUTING.md        ← how to add screens without breaking the system
│   │   └── decisions/
│   │       └── ADR-001-….md       ← at least one ADR documenting brand vocabulary
│   └── modules/
│       └── design-system/
│           └── README.md          ← module contract (What, Why, How, Dependencies, Owner)
```

### Design rules (marketing brand)

- **Token-driven colors only** inside components — no raw hex in TSX/CSS (enforce with a brand-local scan or ESLint rule).
- **Opt-in boundary** — wrap routes in `<div className="brand-<slug>">` (or equivalent); never activate tokens on `:root` globally.
- **shadcn + remap** pattern is recommended: remap `--primary`, `--background`, etc. **inside** the boundary to brand tokens.
- **Do not** `@import` PLX portal `tokens.css` or define `--p-paper`, `--p-ink`, `--p-accent`, etc. as your primary layer.
- **Shared spine only where declared** in `sharedBrandSpine` (wordmark SVG, favicon set — not the full PLX operational skin).

- [ ] All required files present.
- [ ] At least one ADR in `docs/design-system/decisions/`.
- [ ] `docs/modules/design-system/README.md` module contract filled in.

Validate locally:

```bash
python3 scripts/check-brand-repo-structure.py --repo-root .
```

---

## Phase 4 — Repo hygiene + module governance

Adopt the same hygiene rules as PLX operational repos (`docs/REPO_HYGIENE_SPEC.md`):

- [ ] No forbidden root files (`FINAL_*`, `*_SUMMARY.md`, date-stamped status docs, …).
- [ ] Evidence bundles under `artifacts/<domain>/<yyyy-mm-dd>-<slug>/` with `REPORT.md` + `index.md`.
- [ ] Superseded material in `archive/<yyyy-mm-dd>-<reason>/` with `README.md`.
- [ ] Every new domain module has `docs/modules/<module>/README.md` (What, Why, How, Dependencies, Owner).
- [ ] Import through module barrels, not deep internal paths.

Copy or adapt from PLX_MC:

- `scripts/check-repo-hygiene.py`
- `scripts/preflight.sh` (trim stack-specific steps as needed)

---

## Phase 5 — Agent + PR workflow (Mission Control)

Marketing repos are **not exempt** from MC task discipline:

- [ ] Every agent-driven PR stamps `MC-Checkout: <task-id>` in the body.
- [ ] One logical theme per PR.
- [ ] Autonomous agents check out an MC task before coding.
- [ ] High-risk changes carry a `## Rollback Plan` and evidence (screenshots, test output).
- [ ] Human accountable owner recorded on the MC task.

When the compliance gate rolls out to marketing repos, add the reusable workflow per
`docs/runbooks/compliance-gate-rollout.md` (soft → hard, branch protection).

Optional MCP enablement (when ready): set `MC_REPO=petralabx/<slug>` in the
PLX-MC MCP block — see `docs/runbooks/plx-mc-mcp-team-registration.md`.

---

## Phase 6 — CI / preflight

- [ ] `scripts/preflight.sh` wired into `.pre-commit-config.yaml` and/or CI.
- [ ] Preflight runs at minimum:
  - `python3 scripts/check-brand-repo-structure.py`
  - `python3 scripts/check-repo-hygiene.py`
  - Typecheck / lint for your stack (e.g. `npm run typecheck`, `npm run lint`)
- [ ] No push without local `./scripts/preflight.sh --mode pre-push` passing.

PLX_MC ships the canonical checker; brand repos should vendor or submodule the script
from PLX_MC until a shared tooling package exists.

---

## Phase 7 — External integrations (per feature)

Every integration that touches an external system must be declared before merge
(governance contract → External Integrations):

| Attribute | Required |
|---|---|
| Owner | Human accountable |
| Scope | Runtime vs local-only |
| Auth source | Secrets manager / env |
| Default state | Disabled in committed config |
| Kill switch | Feature flag or env gate |
| Health check | Callable probe |
| Fallback path | What happens when down |
| Data / audit boundary | What is logged, where |

Marketing sites commonly add: analytics, email capture, CMS, deploy (Vercel), form
providers. Each gets a row in `docs/modules/<integration>/README.md` and committed
config that ships **disabled by default**.

- [ ] No hardcoded API keys.
- [ ] Secrets via shared accessor / secrets manager only.

---

## Phase 8 — Launch verification

Before calling a brand repo "production-ready":

```bash
# From the brand repo root
python3 scripts/check-brand-repo-structure.py --repo-root .
python3 scripts/check-repo-hygiene.py
./scripts/preflight.sh --mode pre-push
```

- [ ] Structure gate exit 0.
- [ ] Hygiene gate exit 0.
- [ ] Preflight exit 0.
- [ ] MC task exists for the launch milestone with correct `repos: ["<registry-id>"]`.
- [ ] Brand boundary verified in browser (tokens do not leak outside `brand-<slug>`).
- [ ] Shared spine assets (if any) match approved brand marks.

---

## Quick reference — For & Against / Furgenics / 1HR-After

Use these starting values when copying the template:

| Brand | slug | tokenPrefix | boundaryClass | GitHub |
|---|---|---|---|---|
| For & Against | `for-and-against` | `--fa-` | `brand-for-and-against` | `petralabx/for-and-against` |
| Furgenics | `furgenics` | `--fg-` | `brand-furgenics` | `petralabx/furgenics` |
| 1HR-After | `1hr-after` | `--1hr-` | `brand-1hr-after` | `petralabx/1hr-after` |

---

## Rollback

- Remove the repo from MC `REPOS` (or reject the pending request) to detach allow-list membership.
- Archive the GitHub repo; do not delete MC audit history.
- Record the rollback reason in an MC task activity log.

## Owner

Vince (operator) · Marketing team accountable per brand repo.
