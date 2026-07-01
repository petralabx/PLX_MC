#!/usr/bin/env bash
# sync-brand-from-portal.sh — copy shared brand artifacts from plx-customer-portal
# into PLX Mission Control and refresh config/brand-portal-parity.json.
#
# Usage:
#   bash scripts/sync-brand-from-portal.sh
#   PLX_PORTAL_ROOT=/path/to/plx-customer-portal bash scripts/sync-brand-from-portal.sh
#
# Exit 0 on success; 1 if portal root missing or copy fails.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORTAL_ROOT="${PLX_PORTAL_ROOT:-}"

if [[ -z "$PORTAL_ROOT" ]]; then
  for candidate in \
    "$HOME/plx-customer-portal" \
    "/home/vinnysachet/plx-customer-portal"; do
    if [[ -d "$candidate/portal/public/brand" ]]; then
      PORTAL_ROOT="$candidate"
      break
    fi
  done
fi

if [[ -z "$PORTAL_ROOT" || ! -d "$PORTAL_ROOT/portal" ]]; then
  echo "error: set PLX_PORTAL_ROOT to plx-customer-portal checkout (portal/ subdir required)" >&2
  exit 1
fi

PORTAL_APP="$PORTAL_ROOT/portal"
MC="$REPO_ROOT"

echo "=== sync brand from portal ==="
echo "portal: $PORTAL_ROOT"
echo "mc:     $MC"

copy_file() {
  local src="$1" dest="$2"
  mkdir -p "$(dirname "$dest")"
  cp -f "$src" "$dest"
  echo "  copied $(basename "$dest")"
}

# ── Token spec + runtime mirror ──
copy_file "$PORTAL_ROOT/docs/design-system/tokens.css" "$MC/docs/design-system/tokens.css"
copy_file "$PORTAL_ROOT/docs/design-system/tokens.ts" "$MC/docs/design-system/tokens.ts"
copy_file "$PORTAL_APP/src/styles/brand-tokens.css" "$MC/src/styles/brand-tokens.css"

# ── Brand React primitives ──
for f in BrandBoundary.tsx Kicker.tsx MonoData.tsx PMark.tsx AuthStatusBanner.tsx index.ts README.md; do
  if [[ -f "$PORTAL_APP/src/components/brand/$f" ]]; then
    copy_file "$PORTAL_APP/src/components/brand/$f" "$MC/src/components/brand/$f"
  fi
done

# ── Runtime brand assets ──
mkdir -p "$MC/public/brand"
cp -f "$PORTAL_APP/public/brand/"* "$MC/public/brand/"

# ── Mazius production webfonts ──
mkdir -p "$MC/public/fonts/mazius" "$MC/docs/design-system/assets/fonts/mazius"
for f in LICENSE.txt MaziusDisplay-Regular.woff2 MaziusDisplay-Italic.otf; do
  copy_file "$PORTAL_APP/public/fonts/mazius/$f" "$MC/public/fonts/mazius/$f"
done
cp -f "$PORTAL_ROOT/docs/design-system/assets/fonts/mazius/"* "$MC/docs/design-system/assets/fonts/mazius/" 2>/dev/null || true

# ── Portal commit for provenance ──
PORTAL_COMMIT="unknown"
if git -C "$PORTAL_ROOT" rev-parse --short HEAD >/dev/null 2>&1; then
  PORTAL_COMMIT="$(git -C "$PORTAL_ROOT" rev-parse --short HEAD)"
fi
SYNCED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ── Refresh manifest ──
PY="python3"
if [[ -f "$MC/.venv/bin/python" ]]; then PY="$MC/.venv/bin/python"; fi

"$PY" - <<'PYEOF' "$MC" "$PORTAL_COMMIT" "$SYNCED_AT"
import hashlib
import json
import sys
from pathlib import Path

repo = Path(sys.argv[1])
portal_commit = sys.argv[2]
synced_at = sys.argv[3]

paths: list[str] = [
    "docs/design-system/tokens.css",
    "docs/design-system/tokens.ts",
    "src/styles/brand-tokens.css",
    "src/components/brand/BrandBoundary.tsx",
    "src/components/brand/Kicker.tsx",
    "src/components/brand/MonoData.tsx",
    "src/components/brand/PMark.tsx",
    "src/components/brand/AuthStatusBanner.tsx",
    "src/components/brand/index.ts",
    "public/fonts/mazius/LICENSE.txt",
    "public/fonts/mazius/MaziusDisplay-Regular.woff2",
    "public/fonts/mazius/MaziusDisplay-Italic.otf",
]

brand_dir = repo / "public/brand"
if brand_dir.is_dir():
    for p in sorted(brand_dir.iterdir()):
        if p.is_file():
            paths.append(str(p.relative_to(repo)))

archive = repo / "docs/design-system/assets/fonts/mazius"
if archive.is_dir():
    for p in sorted(archive.iterdir()):
        if p.is_file():
            paths.append(str(p.relative_to(repo)))

def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()

files = []
for rel in paths:
    target = repo / rel
    if not target.is_file():
        print(f"warning: skipping missing {rel}", file=sys.stderr)
        continue
    files.append({"path": rel, "sha256": sha256(target)})

manifest = {
    "schemaVersion": "plx-brand-parity/v1",
    "portalRepo": "plx-customer-portal",
    "portalCommit": portal_commit,
    "syncedAt": synced_at,
    "owner": "Vince",
    "rationale": "ADR-003 upstream authority; MC must not fork shared brand artifacts.",
    "files": files,
}

out = repo / "config/brand-portal-parity.json"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
print(f"manifest refreshed: {out} ({len(files)} artifacts)")
PYEOF

echo ""
echo "=== verify parity gate ==="
"$PY" "$MC/scripts/check-brand-portal-parity.py" --repo-root "$MC"
echo "=== sync complete ==="
