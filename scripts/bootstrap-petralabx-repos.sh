#!/usr/bin/env bash
# One-shot bootstrap for petralabx org repos (brands + local-inference).
# Requires GH_TOKEN with repo scope on the org (OAuth), not the narrow PAT.
set -euo pipefail

ORG="petralabx"
MC_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${TMPDIR:-/tmp}/plx-petralabx-bootstrap-$$"
mkdir -p "$WORK"

if [[ -z "${GH_TOKEN:-}" ]]; then
  echo "GH_TOKEN is required (OAuth token with repo + read:org)" >&2
  exit 1
fi

clone_push() {
  local repo="$1"
  local dir="$WORK/$repo"
  rm -rf "$dir"
  git clone "https://x-access-token:${GH_TOKEN}@github.com/${ORG}/${repo}.git" "$dir"
  cp -a "$2/." "$dir/"
  cd "$dir"
  git add -A
  if git diff --cached --quiet; then
    echo "[skip] $repo — no changes"
    return 0
  fi
  git -c user.name="PLX MC Bootstrap" -c user.email="vince@petrasoap.com" commit -m "chore: initial PLX brand repo scaffold"
  git push origin main
  echo "[ok] pushed $ORG/$repo"
}

write_brand() {
  local slug="$1" display="$2" prefix="$3" boundary="$4" rationale="$5"
  local root="$WORK/scaffold-$slug"
  mkdir -p "$root/docs/design-system/decisions" "$root/docs/modules/design-system" "$root/scripts"

  cat >"$root/plx-brand.json" <<EOF
{
  "schemaVersion": "plx-brand/v1",
  "repoKind": "marketing-brand",
  "brand": {
    "slug": "$slug",
    "displayName": "$display"
  },
  "designSystem": {
    "adoptsPlxTokens": false,
    "tokenPrefix": "$prefix",
    "boundaryClass": "$boundary",
    "decidedBy": "vince",
    "decidedAt": "2026-06-30",
    "rationale": "$rationale"
  },
  "mc": {
    "github": "${ORG}/${slug}",
    "registryId": "$slug"
  },
  "sharedBrandSpine": {
    "wordmark": true,
    "periodicMark": false,
    "favicons": true
  }
}
EOF

  cat >"$root/README.md" <<EOF
# $display

Consumer brand repository for **$display**, governed by PLX Mission Control.

- GitHub: \`${ORG}/${slug}\`
- MC registry id: \`$slug\`
- Design system: brand-local tokens ($prefix) — not PLX portal \`--p-*\`

See \`docs/design-system/README.md\` and \`plx-brand.json\`.
EOF

  cat >"$root/AGENTS.md" <<'EOF'
# AGENTS.md — Brand repo

- Import MC task discipline: every agent PR stamps `MC-Checkout: <task-id>`.
- Colors come from brand tokens in `docs/design-system/tokens.css` only — no raw hex in components.
- Tokens activate inside the opt-in brand boundary declared in `plx-brand.json`.
EOF

  cat >"$root/docs/design-system/README.md" <<EOF
# $display Design System

Brand-local design system (PLX-structure, own tokens). Read order:

1. \`decisions/ADR-001-brand-vocabulary.md\`
2. \`tokens.css\` / \`tokens.ts\`
3. \`COMPONENT-INVENTORY.md\`
4. \`CONTRIBUTING.md\`
5. \`REFERENCE.md\`
EOF

  cat >"$root/docs/design-system/tokens.css" <<EOF
/* Canonical brand tokens — activate only inside .$boundary */
.$boundary {
  ${prefix}ink: #1a1a1a;
  ${prefix}paper: #f5f2eb;
  ${prefix}accent: #3d2e24;
  ${prefix}muted: #6b6560;
  ${prefix}grid: rgba(26, 26, 26, 0.12);
}
EOF

  cat >"$root/docs/design-system/tokens.ts" <<EOF
/** TS mirror of docs/design-system/tokens.css */
export const brandTokens = {
  prefix: "$prefix",
  boundary: "$boundary",
} as const;
EOF

  cat >"$root/docs/design-system/REFERENCE.md" <<EOF
# Reference — $display

Design artifacts and screen index for the $display marketing surface.
EOF

  cat >"$root/docs/design-system/COMPONENT-INVENTORY.md" <<EOF
# Component inventory — $display

| Pattern | Strategy | Notes |
|---|---|---|
| Layout shell | Build | \`.$boundary\` wrapper |
| Typography | Token-driven | Uses $prefix tokens |
| Forms | Inherit shadcn + remap | Inside brand boundary |
EOF

  cat >"$root/docs/design-system/CONTRIBUTING.md" <<EOF
# Contributing — $display

1. Wrap new routes in \`.$boundary\`.
2. Use $prefix tokens only — no raw hex in TSX/CSS.
3. Run \`python3 scripts/check-brand-repo-structure.py\` before opening a PR.
EOF

  cat >"$root/docs/design-system/decisions/ADR-001-brand-vocabulary.md" <<EOF
# ADR-001 — $display brand vocabulary

**Status:** Accepted  
**Date:** 2026-06-30

$display opts out of PLX portal \`--p-*\` tokens and ships a sibling-track
marketing design system per \`HOMEPAGE-SCOPE\` / EN-008.
EOF

  cat >"$root/docs/modules/design-system/README.md" <<EOF
# Module: design-system

## What
Brand-local tokens and governance docs for $display.

## Why
Marketing brand with its own visual identity; PLX-structure bundle without PLX portal skin.

## How
Opt-in \`.$boundary\`; tokens in \`docs/design-system/tokens.css\`.

## Dependencies
None at bootstrap.

## Owner
Marketing team (human accountable: vince)
EOF

  cp "$MC_ROOT/scripts/check-brand-repo-structure.py" "$root/scripts/"
  chmod +x "$root/scripts/check-brand-repo-structure.py"

  clone_push "$slug" "$root"
}

write_inference() {
  local root="$WORK/scaffold-local-inference"
  mkdir -p "$root/scripts"
  cat >"$root/plx-brand.json" <<EOF
{
  "schemaVersion": "plx-brand/v1",
  "repoKind": "platform",
  "brand": {
    "slug": "local-inference",
    "displayName": "Local Inference"
  },
  "designSystem": {
    "adoptsPlxTokens": false,
    "tokenPrefix": "--li-",
    "boundaryClass": "brand-local-inference",
    "decidedBy": "vince",
    "decidedAt": "2026-06-30",
    "rationale": "Platform tooling for local LLM inference; not on PLX portal tokens."
  },
  "mc": {
    "github": "${ORG}/local-inference",
    "registryId": "local-inference"
  }
}
EOF
  cat >"$root/README.md" <<EOF
# Local Inference

PLX platform repo for local LLM inference runtime and tooling.

- MC registry: \`local-inference\`
- GitHub: \`${ORG}/local-inference\`
EOF
  cat >"$root/AGENTS.md" <<'EOF'
# AGENTS.md — Local Inference

Platform repo under PLX MC governance. Link work to MC tasks (`MC-Checkout`).
EOF
  cp "$MC_ROOT/scripts/check-brand-repo-structure.py" "$root/scripts/"
  chmod +x "$root/scripts/check-brand-repo-structure.py"
  clone_push "local-inference" "$root"
}

write_brand "for-and-against" "For & Against" "--fa-" "brand-for-and-against" \
  "Consumer-facing For & Against brand; own token layer; PLX-structure bundle."
write_brand "furgenics" "Furgenics" "--fg-" "brand-furgenics" \
  "Consumer-facing Furgenics brand; own token layer; PLX-structure bundle."
write_brand "1hr-after" "1HR-After" "--1hr-" "brand-1hr-after" \
  "Consumer-facing 1HR-After brand; own token layer; PLX-structure bundle."
write_inference

rm -rf "$WORK"
echo "Bootstrap complete."
