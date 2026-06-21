#!/usr/bin/env bash
# Unified preflight gate for commit/push/CI.
# One stable command wraps every repository check, so local hooks, agent
# sessions, and CI all run the exact same pipeline. GitHub Actions is NOT
# your test runner — everything must pass here first.
#
# Usage: scripts/preflight.sh [--mode <pre-commit|pre-push|ci>]
#
# Modes:
#   pre-commit  Fast checks suitable for every commit (~seconds).
#   pre-push    Full local CI before any push (lint + all tests + build).
#   ci          Fast policy checks re-run in CI (same code path as pre-commit).
set -euo pipefail

MODE="pre-commit"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="$2"; shift 2 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Resolve the Python interpreter: prefer the repo venv (Windows or POSIX
# layout), else fall back to whatever the system provides. Windows installs
# have no `python3` alias, so never hardcode it.
if [[ -f .venv/Scripts/python.exe ]]; then
  PY=".venv/Scripts/python.exe"
elif [[ -f .venv/bin/python ]]; then
  PY=".venv/bin/python"
else
  PY="$(command -v python3 || command -v python)"
fi

step() { echo ""; echo "=== [preflight] $1 ==="; }

# ---------------------------------------------------------------------------
# Policy gates — always run, in every mode. These are cheap and absolute.
# ---------------------------------------------------------------------------
run_policy() {
  step "Governance alignment (contract -> surfaces)"
  "$PY" scripts/generate-governance-surfaces.py --check

  step "Repo hygiene"
  "$PY" scripts/check-repo-hygiene.py

  step "Migration numbering (serialized prefixes)"
  "$PY" scripts/check-migrations.py
}

# ---------------------------------------------------------------------------
# Quick checks — lint/format and a fast canary. Adjust per stack.
# ---------------------------------------------------------------------------
run_quick() {
  if [[ -f pyproject.toml || -f requirements.txt ]]; then
    step "Python lint (ruff check)"
    "$PY" -m ruff check .
    step "Python format (ruff format --check)"
    "$PY" -m ruff format --check .
    if [[ -f tests/test_canary.py ]]; then
      step "Canary tests (imports + smoke)"
      "$PY" -m pytest tests/test_canary.py -x -q --no-header
    fi
  else
    echo "[preflight] SKIP python quick checks (no pyproject.toml/requirements.txt)"
  fi

  if [[ -f package.json ]]; then
    step "TypeScript typecheck"
    npm run typecheck
    step "ESLint"
    npm run lint
  else
    echo "[preflight] SKIP node quick checks (no package.json)"
  fi
}

# ---------------------------------------------------------------------------
# Full checks — the complete test suite and build. Mirror CI exactly.
# ---------------------------------------------------------------------------
run_full() {
  if [[ -f pyproject.toml || -f requirements.txt ]]; then
    step "Python tests (full suite)"
    "$PY" -m pytest -q
  fi

  if [[ -f package.json ]]; then
    step "Node tests"
    npm run test
    step "Production build"
    npm run build
    step "Playwright browser runtime"
    npx playwright install chromium
    step "Playwright E2E (Cycle-1 Planner)"
    npx playwright test
  fi
}

case "$MODE" in
  pre-commit|commit|quick)
    run_policy
    run_quick
    ;;
  pre-push|push|full)
    run_policy
    run_quick
    run_full
    ;;
  ci)
    run_policy
    run_quick
    ;;
  *)
    echo "Unsupported mode: $MODE" >&2
    exit 1
    ;;
esac

echo ""
echo "=== [preflight] All $MODE checks passed ==="
