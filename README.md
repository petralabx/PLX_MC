# PLX Mission Control

Agent-operated work hub for Petra Lab-X: humans direct, review, approve, and
assign; background agents do the work. A **two-way SharePoint mirror**
(`petrasoap.sharepoint.com/sites/plx-mission-control`) is the canonical system
of record — the app is a fast, opinionated lens over it, with manual conflict
resolution and a full audit trail. Colleagues across `@petralabx.com` /
`@petrasoap.com` can be tasked via the Microsoft 365 directory.

**Public app:** https://mc.plxcustomer.io

**Why:** everything resolves to a Task, every change mirrors to the record,
and work is traceable end-to-end (PRD requirement → task → PR → evidence →
test status → merge commit). The full product spec lives in
[`docs/product/`](docs/product/README.md).

## Stack

- **Web:** Next.js (App Router) + TypeScript + React — `src/app/`
- **Brand:** PLX design system, fourth brand surface per
  [ADR-003](docs/design-system/decisions/ADR-003-mission-control-surface.md) —
  `--p-*` tokens, opt-in `.brand-plx` boundary
- **Governance tooling:** Python 3.12 (`scripts/`, gated by `requirements.txt`)
- **System of record:** SharePoint Online via Microsoft Graph (sync engine
  spec: [`docs/product/SHAREPOINT_INTEGRATION.md`](docs/product/SHAREPOINT_INTEGRATION.md))

## Quickstart

```bash
# 1. Node side
npm install
npm run dev                # http://localhost:3000

# 2. Governance tooling (Python 3.12)
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt   # POSIX: .venv/bin/python

# 3. Arm the local gates (once per clone)
.venv/Scripts/pre-commit install --hook-type pre-commit --hook-type pre-push
```

## The two gate commands

Every contributor — human or agent — runs the same gate. CI re-runs the exact
same script; there is exactly one definition of "passing."

```bash
./scripts/preflight.sh --mode pre-commit   # before every commit (~seconds)
./scripts/preflight.sh --mode pre-push     # before every push (full suite + build)
```

## Reading order for agents

1. [`SOUL.md`](SOUL.md) — mission and non-negotiables
2. [`AGENTS.md`](AGENTS.md) — architecture, module ownership, governance block
3. [`docs/modules/README.md`](docs/modules/README.md) — module contracts index
4. [`docs/product/README.md`](docs/product/README.md) — the product handoff spec
5. [`LESSONS.md`](LESSONS.md) — do not repeat documented mistakes

Governance rules are generated from
[`config/governance-contract.yaml`](config/governance-contract.yaml) — edit
the contract, run `python scripts/generate-governance-surfaces.py`, never
hand-edit a generated block.
