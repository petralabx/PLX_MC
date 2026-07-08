#!/usr/bin/env bash
# Set COMPLIANCE_MODE=hard on every active PLX-tracked repo (EN-007 P4).
# Pair with docs/runbooks/fleet-compliance-hard-cutover.md.
#
# Prerequisites: gh CLI + token with repo Actions variables write on target repos.
#
# Usage:
#   unset GITHUB_TOKEN
#   ./scripts/provision-fleet-compliance-hard.sh
#   ./scripts/provision-fleet-compliance-hard.sh --dry-run
#   ./scripts/provision-fleet-compliance-hard.sh --repo taylorvalton/PLX_MC

set -euo pipefail

DRY_RUN=0
ONLY_REPO=""
MODE="hard"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --repo) ONLY_REPO="$2"; shift 2 ;;
    --mode) MODE="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

# Active fleet — must match config/tracked-repos-registry.json (compliance_mode: hard).
REPOS=(
  taylorvalton/PLX_MC
  taylorvalton/plx-customer-portal
  taylorvalton/agentic-swarm
  petralabx/skills
  petralabx/local-inference
  petralabx/1hr-after
  petralabx/furgenics
  petralabx/for-and-against
)

if [[ -n "$ONLY_REPO" ]]; then
  REPOS=("$ONLY_REPO")
fi

failures=0
for repo in "${REPOS[@]}"; do
  echo ""
  echo "=== $repo → COMPLIANCE_MODE=$MODE ==="
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] would: gh variable set COMPLIANCE_MODE --body $MODE --repo $repo"
    continue
  fi
  if gh variable set COMPLIANCE_MODE --body "$MODE" --repo "$repo"; then
    echo "OK"
  else
    echo "FAIL" >&2
    failures=$((failures + 1))
  fi
done

echo ""
if [[ "$failures" -gt 0 ]]; then
  echo "$failures repo(s) failed." >&2
  exit 1
fi
echo "All repos set to COMPLIANCE_MODE=$MODE."
