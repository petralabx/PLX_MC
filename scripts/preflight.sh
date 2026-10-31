#!/usr/bin/env bash
# Unified preflight gate for commit/push/CI.
# One stable command wraps every repository check, so local hooks, agent
# sessions, and CI all run the exact same pipeline.
#
# Usage: scripts/preflight.sh [--mode <pre-commit|pre-push|full|ci>]
#        scripts/preflight.sh --only <python-tests|node-tests|build|e2e> [-- <playwright args>]
#
# Modes:
#   pre-commit  Fast checks suitable for every commit (~seconds).
#   pre-push    Policy checks, then the changed files: ruff, the changed Python
#               tests, typecheck, ESLint and the unit tests they touch
#               (TASK-4389). CI runs the full suite in parallel jobs in about
#               7 min, faster than the 20+ min it takes here in sequence.
#   full        The whole local suite (lint + all tests + build + e2e), in order.
#   ci          Fast policy checks re-run in CI (same code path as pre-commit).
#
# --only runs one step of the full suite. CI runs each step in its own
# parallel job, so CI and full mode run the same commands.
set -euo pipefail

MODE="pre-commit"
ONLY=""
PASSTHROUGH=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="$2"; shift 2 ;;
    --only) ONLY="$2"; shift 2 ;;
    --) shift; PASSTHROUGH=("$@"); break ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done
if [[ ${#PASSTHROUGH[@]} -gt 0 && "$ONLY" != "e2e" ]]; then
  echo "Arguments after -- go to Playwright and need --only e2e" >&2
  exit 1
fi

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

# Pin from requirements.txt (e.g. ruff==0.15.16 → 0.15.16). Empty if absent.
pin_from_requirements() {
  local pkg="$1"
  sed -nE "s/^${pkg}==([^[:space:]#]+).*/\\1/p" requirements.txt 2>/dev/null | head -n1
}

# Locate uvx even under WSL bash, where Windows tools appear as *.exe on PATH
# via interop but the bare `uvx` name is often missing.
resolve_uvx() {
  command -v uvx 2>/dev/null || command -v uvx.exe 2>/dev/null || true
}

# Prefer `$PY -m <pkg>` when that interpreter has the module (CI / .venv path).
# Else fall back to `uvx <pkg>@<pin>` so a clean checkout on WSL bash — where
# system python3 lacks ruff/pytest but Windows uvx is reachable — still runs
# the remaining gate instead of dying mid-list under `set -e`.
# If neither works, fail loudly with bootstrap instructions (never skip).
run_py_tool() {
  local pkg="$1"
  shift
  local pin uvx_bin
  pin="$(pin_from_requirements "$pkg")"

  if "$PY" -c "import ${pkg}" >/dev/null 2>&1; then
    "$PY" -m "$pkg" "$@"
    return
  fi

  uvx_bin="$(resolve_uvx)"
  if [[ -n "$uvx_bin" && -n "$pin" ]]; then
    echo "[preflight] ${pkg} missing in \$PY (${PY}); using ${uvx_bin} ${pkg}@${pin}"
    if [[ "$pkg" == "pytest" ]]; then
      # Canary/full suite imports project deps (pyyaml, …) — pull the pin file.
      "$uvx_bin" --with-requirements requirements.txt --from "pytest==${pin}" pytest "$@"
    else
      "$uvx_bin" "${pkg}@${pin}" "$@"
    fi
    return
  fi

  echo "[preflight] FATAL: ${pkg} is required for this preflight mode but is unavailable." >&2
  echo "[preflight]   interpreter: ${PY}" >&2
  echo "[preflight]   import ${pkg}: failed" >&2
  if [[ -z "$uvx_bin" ]]; then
    echo "[preflight]   uvx / uvx.exe: not on PATH" >&2
  elif [[ -z "$pin" ]]; then
    echo "[preflight]   pin: ${pkg} not found in requirements.txt" >&2
  fi
  echo "[preflight] Bootstrap (preferred):" >&2
  echo "[preflight]   python -m venv .venv && .venv/Scripts/pip install -r requirements.txt   # Windows" >&2
  echo "[preflight]   python3 -m venv .venv && .venv/bin/pip install -r requirements.txt     # POSIX" >&2
  echo "[preflight] Or install uv and retry (falls back to uvx ${pkg}@<pin from requirements.txt>)." >&2
  exit 1
}

run_ruff() { run_py_tool ruff "$@"; }
run_pytest() { run_py_tool pytest "$@"; }

# ---------------------------------------------------------------------------
# Policy gates — always run, in every mode. These are cheap and absolute.
# ---------------------------------------------------------------------------
run_policy() {
  step "Governance alignment (contract -> surfaces)"
  "$PY" scripts/generate-governance-surfaces.py --check

  step "Compliance gate alignment (source -> workflow)"
  "$PY" scripts/generate-compliance-gate.py --check

  step "Routing workflow alignment (source -> workflow)"
  "$PY" scripts/generate-routing-workflow.py --check

  step "Repo hygiene"
  "$PY" scripts/check-repo-hygiene.py

  step "Shebang line endings (eol=lf)"
  # Self-resolve cwd rather than passing bash's $REPO_ROOT: under WSL bash +
  # a native Windows .venv python, /mnt/c/... becomes C:\mnt\c\... and git dies.
  "$PY" scripts/check-shebang-eol.py

  if [[ -f plx-brand.json ]]; then
    step "Brand repo structure (plx-brand.json present)"
    "$PY" scripts/check-brand-repo-structure.py
    step "Design-system pin (ADR-005)"
    "$PY" scripts/check-ds-pin.py
  fi

  if [[ -f config/brand-portal-parity.json ]]; then
    step "Brand portal parity (ADR-003 upstream manifest)"
    # Self-resolve repo root from __file__ rather than passing bash's $REPO_ROOT:
    # under WSL bash + a native Windows python, a POSIX /mnt/c/... string is not
    # translated for plain CLI args and pathlib mis-anchors it as C:\mnt\c\...
    "$PY" scripts/check-brand-portal-parity.py
    step "MC brand application (boundary + component colors)"
    "$PY" scripts/check-mc-brand-application.py
  fi

  step "Architecture maturity parity (AGENTS.md <-> TOOLS.md)"
  "$PY" scripts/check-arch-parity.py

  step "Architecture diagram pack (docs/architecture honesty)"
  # Self-resolve repo root from __file__ (same WSL/Windows path caveat as brand parity).
  "$PY" scripts/check-architecture-diagrams.py

  step "Unified knowledge program (TASK-477)"
  "$PY" scripts/check-unified-knowledge-program.py

  step "Migration numbering (serialized prefixes)"
  "$PY" scripts/check-migrations.py

  step "Workstation secrets-loader drift (host-local; skips where absent)"
  # Exit codes: 0 clean, 1 drift, 2 no loader on this host.
  # CI runners and servers have no ~/.secrets-env.staging.ps1, so 2 is the
  # normal result there and must not fail the gate. Only a real drift (1)
  # blocks. Anything above 2 is an unexpected error and still blocks.
  loader_drift_rc=0
  "$PY" scripts/check-workstation-loader-drift.py || loader_drift_rc=$?
  if [[ "$loader_drift_rc" -eq 1 || "$loader_drift_rc" -gt 2 ]]; then
    exit "$loader_drift_rc"
  fi
}

# ---------------------------------------------------------------------------
# Quick checks — lint/format and a fast canary. Adjust per stack.
# ---------------------------------------------------------------------------
run_quick() {
  if [[ -f pyproject.toml || -f requirements.txt ]]; then
    step "Python lint (ruff check)"
    run_ruff check .
    step "Python format (ruff format --check)"
    run_ruff format --check .
    if [[ -f tests/test_canary.py ]]; then
      step "Canary tests (imports + smoke)"
      run_pytest tests/test_canary.py -x -q --no-header
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
run_python_tests() {
  if [[ -f pyproject.toml || -f requirements.txt ]]; then
    step "Python tests (full suite)"
    run_pytest -q
  fi
}

run_node_tests() {
  if [[ -f package.json ]]; then
    step "Node tests"
    npm run test
  fi
}

run_build() {
  if [[ -f package.json ]]; then
    step "Production build"
    npm run build
  fi
}

# Extra arguments go to Playwright (CI passes --shard=N/M).
run_e2e() {
  if [[ -f package.json ]]; then
    step "Playwright browser runtime"
    npx playwright install chromium
    step "Playwright E2E (Cycle-1 Planner)"
    npm run test:e2e -- "$@"
  fi
}

run_full() {
  run_python_tests
  run_node_tests
  run_build
  run_e2e
}

# ---------------------------------------------------------------------------
# Changed-file checks (pre-push, TASK-4389): what CI would catch first, in
# seconds to a couple of minutes. The unit tests get PREFLIGHT_TEST_BUDGET
# seconds (default 120); past that it warns and goes on, because CI runs them.
# ---------------------------------------------------------------------------
changed_files() {
  local base="${PREFLIGHT_BASE:-origin/main}" mb
  mb="$(git merge-base "$base" HEAD 2>/dev/null)" || return 0
  { git diff --name-only "$mb"; git ls-files --others --exclude-standard; } | sort -u
}

run_changed() {
  local f py=() py_tests=() js=() rc=0
  while IFS= read -r f; do
    [[ -f "$f" ]] || continue
    case "$f" in
      *.py) py+=("$f"); [[ "$f" == tests/test_*.py ]] && py_tests+=("$f") ;;
      *.ts|*.tsx|*.js|*.jsx|*.mjs) js+=("$f") ;;
    esac
  done < <(changed_files)
  if [[ ${#py[@]} -eq 0 && ${#js[@]} -eq 0 ]]; then
    echo "[preflight] no changed Python or TypeScript files"
    return 0
  fi
  if [[ ${#py[@]} -gt 0 ]]; then
    step "Python lint, changed files (ruff check + format --check)"
    run_ruff check "${py[@]}"
    run_ruff format --check "${py[@]}"
  fi
  if [[ ${#py_tests[@]} -gt 0 ]]; then
    step "Python tests, changed test files"
    run_pytest -q "${py_tests[@]}"
  fi
  if [[ ${#js[@]} -gt 0 && -f package.json ]]; then
    step "TypeScript typecheck"
    npm run typecheck
    step "ESLint, changed files"
    npx eslint --no-warn-ignored "${js[@]}"
    step "Unit tests the changed files touch (vitest related)"
    timeout "${PREFLIGHT_TEST_BUDGET:-120}" npx vitest related --run --passWithNoTests "${js[@]}" || rc=$?
    if [[ $rc -eq 124 ]]; then
      echo "[preflight] the related unit tests ran past ${PREFLIGHT_TEST_BUDGET:-120}s; CI runs them"
    elif [[ $rc -ne 0 ]]; then
      return "$rc"
    fi
  fi
}

# --only runs one full-suite step. CI runs each in its own parallel job; the
# steps are the same functions full mode runs in order.
if [[ -n "$ONLY" ]]; then
  case "$ONLY" in
    python-tests) run_python_tests ;;
    node-tests) run_node_tests ;;
    build) run_build ;;
    # The ${x+...} form keeps an empty array safe under set -u in bash 3.2.
    e2e) run_e2e ${PASSTHROUGH[@]+"${PASSTHROUGH[@]}"} ;;
    *)
      echo "Unsupported --only step: $ONLY (python-tests, node-tests, build, e2e)" >&2
      exit 1
      ;;
  esac
  echo ""
  echo "=== [preflight] $ONLY passed ==="
  exit 0
fi

case "$MODE" in
  pre-commit|commit|quick)
    run_policy
    run_quick
    ;;
  pre-push|push)
    run_policy
    run_changed
    ;;
  full)
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
