#!/usr/bin/env bash
# Scaffold PLX governance files into a consumer repository.
#
# Usage:
#   ./scripts/scaffold-tracked-repo.sh --repo owner/name --tier tooling --branch main --target /path/to/repo
#   ./scripts/scaffold-tracked-repo.sh --repo petralabx/skills --tier skills --branch main --target ../skills --workflows-only
#
# Requires: python (3.x), a PLX_MC clone (run from repo root).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# (cd + git rather than `git -C`: native Windows git cannot parse MSYS /c/... paths)
GEN_SHA="$(cd "$ROOT" && git rev-parse HEAD)"
WORKFLOWS_ONLY=0

usage() {
  sed -n '2,8p' "$0"
  exit 1
}

REPO=""
TIER=""
BRANCH="main"
TARGET=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --tier) TIER="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --target) TARGET="$2"; shift 2 ;;
    --workflows-only) WORKFLOWS_ONLY=1; shift ;;
    -h|--help) usage ;;
    *) echo "Unknown arg: $1" >&2; usage ;;
  esac
done

[[ -n "$REPO" && -n "$TIER" && -n "$TARGET" ]] || usage
[[ -d "$TARGET" ]] || { echo "target not a directory: $TARGET" >&2; exit 1; }

# Resolve a python interpreter (mirrors bootstrap-company-skills.sh — Windows
# hosts often have `py`/`python` but no `python3`).
PYTHON=()
if py -3 -c "import sys" >/dev/null 2>&1; then
  PYTHON=(py -3)
elif command -v python3 >/dev/null 2>&1 && python3 -c "import sys" >/dev/null 2>&1; then
  PYTHON=(python3)
elif command -v python >/dev/null 2>&1 && python -c "import sys" >/dev/null 2>&1; then
  PYTHON=(python)
else
  echo "error: python 3 required" >&2
  exit 2
fi

# Native Windows python can't open MSYS /c/... paths — convert when cygpath
# exists (git-bash); no-op elsewhere.
to_native() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi
}
ROOT_NATIVE="$(to_native "$ROOT")"

WF_DIR="$TARGET/.github/workflows"
mkdir -p "$WF_DIR"

echo "==> Emitting plx-mc-compliance.yml (GEN_SHA=$GEN_SHA)"
"${PYTHON[@]}" "$ROOT_NATIVE/scripts/generate-compliance-gate.py" --emit downstream \
  > "$WF_DIR/plx-mc-compliance.yml"

echo "==> Emitting mc-routing-metadata.yml"
"${PYTHON[@]}" "$ROOT_NATIVE/scripts/generate-routing-workflow.py" --emit \
  > "$WF_DIR/mc-routing-metadata.yml"

echo "==> Writing compliance-gate-drift.yml"
sed "s/{{GEN_SHA}}/$GEN_SHA/g" \
  "$ROOT_NATIVE/docs/templates/compliance-gate-drift.yml.tpl" \
  > "$WF_DIR/compliance-gate-drift.yml"

if [[ "$WORKFLOWS_ONLY" -eq 1 ]]; then
  echo "Done (workflows only)."
  exit 0
fi

GOV_DIR="$TARGET/docs"
mkdir -p "$GOV_DIR"
ROUTING_MANIFEST="$TARGET/.github/plx-mc-routing-manifest.json"
cp "$ROOT/docs/templates/mc-routing-manifest.json" "$ROUTING_MANIFEST"

cat > "$GOV_DIR/GOVERNANCE.md" <<EOF
# Governance pointer

This repository is a **PLX-tracked repo**. Canonical governance lives in
**PLX Mission Control** (\`petralabx/PLX_MC\`):

| Document | Path |
|----------|------|
| Governance contract (SSOT) | [config/governance-contract.yaml](https://github.com/petralabx/PLX_MC/blob/main/config/governance-contract.yaml) |
| Collaborator / PR SOP | [docs/COLLABORATOR-SOP.md](https://github.com/petralabx/PLX_MC/blob/main/docs/COLLABORATOR-SOP.md) |
| Repo onboarding | [docs/runbooks/REPO-ONBOARDING.md](https://github.com/petralabx/PLX_MC/blob/main/docs/runbooks/REPO-ONBOARDING.md) |
| Fleet registry | [config/tracked-repos-registry.json](https://github.com/petralabx/PLX_MC/blob/main/config/tracked-repos-registry.json) |

**Do not duplicate** agent rules or MC-Checkout discipline in this repo.
Repo-specific workflow: see \`CONTRIBUTING.md\` at the repo root (or path in
tracked-repos-registry).

Integration branch: \`$BRANCH\`. Tier: \`$TIER\`.
EOF

# Validation commands by tier
VALIDATION="# (add repo-specific test/lint/build commands)"
LEDGER_ROW=""
RELEASE_ROW=""
REPO_NOTES=""

case "$TIER" in
  product_app)
    VALIDATION="cd portal && npm run test && npm run build && npm run audit:hygiene"
    LEDGER_ROW="Required when touching \`docs/portal/quality-ledger/\`: **MC Quality Ledger**."
    RELEASE_ROW="| **\`master\`** | Production release — \`staging → master\` PR only |"
    REPO_NOTES="See \`docs/runbooks/DATABASE-TARGETING.md\` and \`docs/runbooks/MISSION-CONTROL-LEDGER.md\`."
    ;;
  product_platform)
    VALIDATION="pip install -e '.[dev]' && pytest -q && python scripts/check-governance-alignment.py"
    LEDGER_ROW="Required when touching \`docs/vmc/quality-ledger/\`: validate ledger JSON."
    REPO_NOTES="Local \`config/governance-contract.yaml\` must stay aligned with PLX_MC SSOT."
    ;;
  skills)
    VALIDATION="# Validate manifest.json against schemas/manifest.schema.json"
    REPO_NOTES="Skill ids must match \`manifest.json\`. No secrets in \`skills/\`. Catalog: PLX_MC \`config/skills-catalog.json\`."
    ;;
  tooling|sandbox)
    VALIDATION="# pytest / npm test — add when project has a test suite"
    REPO_NOTES="Python tooling repo — follow governance contract for PR discipline."
    ;;
  hub)
    echo "hub tier: use docs/COLLABORATOR-SOP.md directly; skip CONTRIBUTING scaffold." >&2
    exit 0
    ;;
  *)
    echo "unknown tier: $TIER" >&2
    exit 1
    ;;
esac

CONTRIB_PATH="$TARGET/CONTRIBUTING.md"
STUB="$ROOT_NATIVE/docs/templates/CONTRIBUTING.repo-stub.md"

# Template substitution in python — bash ${var//pat/$rep} corrupts replacements
# containing '&' on bash >= 5.2 (patsub_replacement expands '&' to the pattern).
TPL_REPO_NAME="$REPO" \
TPL_INTEGRATION_BRANCH="$BRANCH" \
TPL_RELEASE_BRANCH_ROW="$RELEASE_ROW" \
TPL_VALIDATION_COMMANDS="$VALIDATION" \
TPL_LEDGER_CHECK_ROW="$LEDGER_ROW" \
TPL_REPO_SPECIFIC_NOTES="$REPO_NOTES" \
"${PYTHON[@]}" - "$STUB" "$(to_native "$CONTRIB_PATH")" <<'PY'
import os, sys
body = open(sys.argv[1], encoding="utf-8").read()
for key in ("REPO_NAME", "INTEGRATION_BRANCH", "RELEASE_BRANCH_ROW",
            "VALIDATION_COMMANDS", "LEDGER_CHECK_ROW", "REPO_SPECIFIC_NOTES"):
    body = body.replace("{{%s}}" % key, os.environ.get("TPL_" + key, ""))
with open(sys.argv[2], "w", encoding="utf-8", newline="\n") as f:
    f.write(body)
PY

echo "==> Wrote $CONTRIB_PATH"
echo "==> Wrote $GOV_DIR/GOVERNANCE.md"
echo "==> Wrote $WF_DIR/plx-mc-compliance.yml"
echo "==> Wrote $WF_DIR/mc-routing-metadata.yml"
echo "==> Wrote $WF_DIR/compliance-gate-drift.yml"
echo "==> Wrote $ROUTING_MANIFEST"
echo ""
echo "Next: set repo secrets PLX_MC_BASE_URL + COMPLIANCE_CI_TOKEN;"
echo "      enable branch protection on $BRANCH; open PR."
