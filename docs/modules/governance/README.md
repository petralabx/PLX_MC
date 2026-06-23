# Module: governance

## What

The repository's constitution-as-code: the governance contract
(`config/governance-contract.yaml`), the generator that renders it into every
agent-facing surface, the repo hygiene linter, and the unified preflight gate.
It owns policy enforcement only — it is explicitly NOT a build tool, test
runner, or deployment system (it wraps those commands; it does not implement
them).

## Why

Rules that live in prose drift and fork. One YAML contract rendered into
`AGENTS.md` / `CLAUDE.md` / `.cursor/rules/governance.mdc` by automation, with
a CI drift gate, means a rule can never quietly diverge across surfaces — and
a gate that runs identically at commit, push, and CI means exactly one
definition of "passing."

## How

- Edit `config/governance-contract.yaml` → run
  `python scripts/generate-governance-surfaces.py` → surfaces update between
  `governance:auto` markers. Never hand-edit a generated block.
- `--check` is the drift gate: exit 1 if any surface differs from the contract.
- The contract carries an `agent_workflow` section (task/PR discipline for
  agent-driven work — resolve to an MC task, `MC-Checkout` stamps incl. multi-task,
  the tier bundle, never bypass the gate) rendered into every runtime surface, so
  the same rules reach Cursor, Claude Code, and ChatGPT/Codex from one source.
- `scripts/check-repo-hygiene.py` enforces `docs/REPO_HYGIENE_SPEC.md`
  (approved root files, forbidden patterns, dated artifact bundles, documented
  archives) with exit codes.
- `scripts/preflight.sh --mode pre-commit|pre-push|ci` runs policy gates +
  stack checks; local hooks (`.pre-commit-config.yaml`) and CI
  (`.github/workflows/ci.yml`) both invoke it.
- Exit-code behavior is protected by `tests/test_canary.py`.

## Dependencies

Python 3.12 + `requirements.txt` (pyyaml, ruff, pytest, pre-commit). Nothing
in `src/` depends on this module; everything in the repo is gated by it.

### Key Files

- `config/governance-contract.yaml` — single source of truth
- `scripts/generate-governance-surfaces.py` — generator + drift gate (`--check`)
- `scripts/check-repo-hygiene.py` — hygiene linter
- `scripts/preflight.sh` — the one gate command
- `tests/test_canary.py` — exit-code contract tests

## Owner

Vince

## Criticality

High
