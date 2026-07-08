#!/usr/bin/env bash
# Apply branch protection (required compliance + drift checks) on petralabx fleet repos.
# Works on the free org plan — no GitHub Team / org rulesets required.
#
# Prerequisites:
#   - gh CLI authenticated with a token that has **Administration: Read and write**
#     on the target repos (fine-grained PAT) OR a classic PAT with full `repo` scope.
#   - If the org uses SAML SSO, authorize the token for petralabx first.
#
# Usage:
#   unset GITHUB_TOKEN   # use gh keyring token, not a stale env override
#   ./scripts/provision-fleet-branch-protection.sh
#   ./scripts/provision-fleet-branch-protection.sh --dry-run
#   ./scripts/provision-fleet-branch-protection.sh --repo petralabx/skills

set -euo pipefail

DRY_RUN=0
ONLY_REPO=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --repo) ONLY_REPO="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

REPOS=(
  petralabx/skills
  petralabx/local-inference
  petralabx/1hr-after
  petralabx/furgenics
  petralabx/for-and-against
  petralabx/test-perms-check
)

if [[ -n "$ONLY_REPO" ]]; then
  REPOS=("$ONLY_REPO")
fi

payload() {
  cat <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "checks": [
      {"context": "compliance", "app_id": null},
      {"context": "drift", "app_id": null}
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0,
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false
  },
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
}

failures=0
for repo in "${REPOS[@]}"; do
  branch=$(gh api "repos/$repo" --jq .default_branch)
  echo ""
  echo "=== $repo (branch: $branch) ==="
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] would PUT branch protection + require compliance, drift"
    continue
  fi
  if gh api "repos/$repo/branches/$branch/protection" -X PUT --input - <<<"$(payload)"; then
    echo "OK: branch protection applied"
  else
    echo "FAIL: could not apply (need Administration scope or SAML SSO auth)" >&2
    failures=$((failures + 1))
  fi
done

echo ""
if [[ "$failures" -gt 0 ]]; then
  echo "$failures repo(s) failed — see token prerequisites in script header." >&2
  exit 1
fi
echo "All repos provisioned."
