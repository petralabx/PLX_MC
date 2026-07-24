#!/usr/bin/env python3
"""Design-system pin gate (ADR-005) — consumer mirrors must match the pinned package.

Reads root plx-brand.json. When adoptsPlxTokens is true:
  1. designSystem.pinnedVersion / pinnedIntegrity are required
  2. design-system/manifest.json must match the pin
  3. Each package artifact under design-system/ must match its sha256
  4. Consumer mirrors of pin targets must be byte-identical to the package:
       docs/design-system/tokens.css|.ts
       public/fonts/mazius/* (for fonts present in the package)

Exit 0 when clean or when plx-brand.json is absent / adoptsPlxTokens is false.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

DEFAULT_REPO_ROOT = Path(__file__).resolve().parents[1]

MIRROR_MAP = {
    "tokens.css": "docs/design-system/tokens.css",
    "tokens.ts": "docs/design-system/tokens.ts",
}


def sha256_file(path: Path) -> str:
    # Match portal design-system-manifest.py / release gate (raw bytes).
    return hashlib.sha256(path.read_bytes()).hexdigest()


def package_integrity(artifacts: list[dict]) -> str:
    # Match portal scripts/design-system-manifest.py: join hashes in
    # manifest artifacts[] order (not sorted).
    hashes = [str(a.get("sha256", "")) for a in artifacts]
    digest = hashlib.sha256("\n".join(hashes).encode()).hexdigest()
    return f"sha256-{digest}"


def check_pin(repo_root: Path) -> list[str]:
    violations: list[str] = []
    brand_path = repo_root / "plx-brand.json"
    if not brand_path.is_file():
        return []

    try:
        brand = json.loads(brand_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return [f"plx-brand.json: invalid JSON — {exc}"]

    ds = brand.get("designSystem") or {}
    if ds.get("adoptsPlxTokens") is not True:
        return []

    for key in ("authority", "channel", "pinnedVersion", "pinnedIntegrity"):
        if not ds.get(key):
            violations.append(
                f"plx-brand.json designSystem.{key} required when adopting"
            )

    pinned_version = ds.get("pinnedVersion")
    pinned_integrity = ds.get("pinnedIntegrity")

    manifest_path = repo_root / "design-system" / "manifest.json"
    if not manifest_path.is_file():
        violations.append(
            "missing design-system/manifest.json (run scripts/plx-ds-sync.sh)"
        )
        return violations

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return violations + [f"design-system/manifest.json: invalid JSON — {exc}"]

    if pinned_version and manifest.get("version") != pinned_version:
        violations.append(
            f"pin version drift: plx-brand.json={pinned_version!r} "
            f"design-system/manifest.json={manifest.get('version')!r}"
        )

    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, list) or not artifacts:
        violations.append("design-system/manifest.json artifacts[] missing or empty")
        return violations

    actual_integrity = package_integrity(artifacts)
    expected_integrity = manifest.get("integrity")
    if expected_integrity != actual_integrity:
        violations.append(
            "design-system/manifest.json integrity does not match artifact hashes"
        )
    if pinned_integrity and pinned_integrity != expected_integrity:
        violations.append(
            f"pin integrity drift: plx-brand.json={pinned_integrity!r} "
            f"manifest={expected_integrity!r}"
        )

    for entry in artifacts:
        if not isinstance(entry, dict):
            violations.append(
                "design-system/manifest.json artifacts[] entry must be object"
            )
            continue
        rel = entry.get("path")
        expected = entry.get("sha256")
        if not rel or not expected:
            violations.append(
                "design-system/manifest.json artifacts[] missing path/sha256"
            )
            continue
        package_file = repo_root / "design-system" / rel
        if not package_file.is_file():
            violations.append(f"missing pinned artifact: design-system/{rel}")
            continue
        actual = sha256_file(package_file)
        if actual != expected:
            violations.append(
                f"drift: design-system/{rel} sha256={actual[:12]}… expected {expected[:12]}…"
            )

        mirror_rel = MIRROR_MAP.get(rel)
        if rel.startswith("fonts/"):
            mirror_rel = f"public/fonts/mazius/{Path(rel).name}"
        if not mirror_rel:
            continue
        mirror = repo_root / mirror_rel
        if not mirror.is_file():
            violations.append(f"missing consumer mirror: {mirror_rel}")
            continue
        if sha256_file(mirror) != actual:
            violations.append(
                f"mirror drift: {mirror_rel} != design-system/{rel} "
                "(run: bash scripts/plx-ds-sync.sh)"
            )

    return violations


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=DEFAULT_REPO_ROOT,
        help="Mission Control repo root",
    )
    args = parser.parse_args(argv)
    repo_root = args.repo_root.resolve()
    violations = check_pin(repo_root)

    brand_path = repo_root / "plx-brand.json"
    if not brand_path.is_file() and not violations:
        print("design-system pin: skip (no plx-brand.json)")
        return 0

    if brand_path.is_file():
        try:
            brand = json.loads(brand_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            brand = {}
        if (brand.get("designSystem") or {}).get(
            "adoptsPlxTokens"
        ) is not True and not violations:
            print("design-system pin: skip (adoptsPlxTokens is false)")
            return 0

    if violations:
        print("design-system pin violations:")
        for v in violations:
            print(f"  - {v}")
        return 1

    print("design-system pin clean")
    return 0


if __name__ == "__main__":
    sys.exit(main())
