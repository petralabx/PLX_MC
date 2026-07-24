#!/usr/bin/env bash
# plx-ds-sync.sh — sync the pinned portal design-system package into PLX_MC (ADR-005).
#
# Copies authority design-system/** into this repo's design-system/ pin cache,
# mirrors tokens/fonts into the consumer paths, refreshes brand-portal-parity.json
# (via sync-brand-from-portal.sh), and verifies the pin gate.
#
# Usage:
#   bash scripts/plx-ds-sync.sh
#   PLX_PORTAL_ROOT=/path/to/plx-customer-portal bash scripts/plx-ds-sync.sh
#
# Requires root plx-brand.json with designSystem.adoptsPlxTokens=true and a pin.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORTAL_ROOT="${PLX_PORTAL_ROOT:-}"

if [[ -z "$PORTAL_ROOT" ]]; then
  for candidate in \
    "/agent/repos/plx-customer-portal" \
    "$HOME/plx-customer-portal" \
    "/home/vinnysachet/plx-customer-portal"; do
    if [[ -f "$candidate/design-system/manifest.json" ]]; then
      PORTAL_ROOT="$candidate"
      break
    fi
  done
fi

if [[ -z "$PORTAL_ROOT" || ! -f "$PORTAL_ROOT/design-system/manifest.json" ]]; then
  echo "error: set PLX_PORTAL_ROOT to a plx-customer-portal checkout with design-system/" >&2
  exit 1
fi

PY="python3"
if [[ -f "$REPO_ROOT/.venv/bin/python" ]]; then PY="$REPO_ROOT/.venv/bin/python"; fi

echo "=== plx-ds-sync (ADR-005 pin) ==="
echo "portal: $PORTAL_ROOT"
echo "mc:     $REPO_ROOT"

"$PY" - <<'PYEOF' "$REPO_ROOT" "$PORTAL_ROOT"
import json
import shutil
import sys
from pathlib import Path

mc = Path(sys.argv[1])
portal = Path(sys.argv[2])
brand_path = mc / "plx-brand.json"
if not brand_path.is_file():
    raise SystemExit("error: missing plx-brand.json — record adoption before sync")

brand = json.loads(brand_path.read_text(encoding="utf-8"))
ds = brand.get("designSystem") or {}
if ds.get("adoptsPlxTokens") is not True:
    raise SystemExit("error: designSystem.adoptsPlxTokens must be true to sync pin")

pinned_version = ds.get("pinnedVersion")
pinned_integrity = ds.get("pinnedIntegrity")
if not pinned_version or not pinned_integrity:
    raise SystemExit("error: pinnedVersion and pinnedIntegrity required in plx-brand.json")

auth_manifest_path = portal / "design-system" / "manifest.json"
auth = json.loads(auth_manifest_path.read_text(encoding="utf-8"))
if auth.get("version") != pinned_version:
    raise SystemExit(
        f"error: portal package version {auth.get('version')!r} != pin {pinned_version!r}"
    )
if auth.get("integrity") != pinned_integrity:
    raise SystemExit(
        f"error: portal package integrity {auth.get('integrity')!r} != pin {pinned_integrity!r}"
    )

dest = mc / "design-system"
dest.mkdir(parents=True, exist_ok=True)

# Preserve consumer ledger across syncs.
sync_log = dest / "SYNC-LOG.md"
sync_log_text = sync_log.read_text(encoding="utf-8") if sync_log.is_file() else None

copy_names = [
    "manifest.json",
    "CHANGELOG.md",
    "README.md",
    "tokens.css",
    "tokens.ts",
]
for name in copy_names:
    src = portal / "design-system" / name
    if not src.is_file():
        raise SystemExit(f"error: missing authority file design-system/{name}")
    shutil.copy2(src, dest / name)
    print(f"  pin cache: design-system/{name}")

fonts_src = portal / "design-system" / "fonts"
fonts_dest = dest / "fonts"
fonts_dest.mkdir(parents=True, exist_ok=True)
for src in sorted(fonts_src.iterdir()):
    if src.is_file():
        shutil.copy2(src, fonts_dest / src.name)
        print(f"  pin cache: design-system/fonts/{src.name}")

# Consumer mirrors for pin targets
shutil.copy2(dest / "tokens.css", mc / "docs/design-system/tokens.css")
shutil.copy2(dest / "tokens.ts", mc / "docs/design-system/tokens.ts")
print("  mirror: docs/design-system/tokens.css")
print("  mirror: docs/design-system/tokens.ts")

pub_fonts = mc / "public/fonts/mazius"
pub_fonts.mkdir(parents=True, exist_ok=True)
archive = mc / "docs/design-system/assets/fonts/mazius"
archive.mkdir(parents=True, exist_ok=True)
for src in sorted(fonts_dest.iterdir()):
    if not src.is_file():
        continue
    shutil.copy2(src, archive / src.name)
    # Production runtime fonts (subset may already exist)
    if src.name in {
        "LICENSE.txt",
        "MaziusDisplay-Regular.woff2",
        "MaziusDisplay-Italic.otf",
        "MaziusDisplay-Bold.woff2",
        "MaziusDisplay-Extraitalic.woff2",
        "MaziusDisplay-ExtraItalicBold.woff2",
    }:
        shutil.copy2(src, pub_fonts / src.name)
        print(f"  mirror: public/fonts/mazius/{src.name}")

if sync_log_text is not None:
    sync_log.write_text(sync_log_text, encoding="utf-8")
    print("  preserved: design-system/SYNC-LOG.md")

print(f"pinned v{pinned_version} integrity={pinned_integrity}")
PYEOF

# Shared brand components / runtime / parity refresh (tokens already mirrored above;
# sync script refreshes parity checksums for the full ADR-003 set).
export PLX_PORTAL_ROOT
export PLX_DS_SYNC_SKIP_TOKEN_SPEC=1
bash "$REPO_ROOT/scripts/sync-brand-from-portal.sh"

echo ""
echo "=== verify design-system pin ==="
"$PY" "$REPO_ROOT/scripts/check-ds-pin.py" --repo-root "$REPO_ROOT"
echo "=== plx-ds-sync complete ==="
