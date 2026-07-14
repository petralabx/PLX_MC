#!/usr/bin/env python3
"""Brand parity gate — MC shared brand artifacts must match the committed manifest.

The manifest (config/brand-portal-parity.json) records SHA-256 checksums for every
file Mission Control mirrors from plx-customer-portal (ADR-003 upstream authority).
Preflight runs this gate on every commit so token, component, asset, and font drift
cannot merge silently.

Refresh the manifest after syncing from portal:
    bash scripts/sync-brand-from-portal.sh

Usage:
    python3 scripts/check-brand-portal-parity.py
    python3 scripts/check-brand-portal-parity.py --manifest path/to/manifest.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

DEFAULT_REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = Path("config/brand-portal-parity.json")


TEXT_SUFFIXES = {".css", ".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".txt", ".svg"}


def sha256_file(path: Path) -> str:
    data = path.read_bytes()
    # Manifest hashes are LF-normalized (git blob / Linux CI). Windows checkouts
    # with core.autocrlf=true would otherwise false-fail text artifacts. Never
    # rewrite binaries — PNG/OTF/WOFF2 may contain incidental 0x0D0A bytes.
    if path.suffix.lower() in TEXT_SUFFIXES:
        data = data.replace(b"\r\n", b"\n")
    return hashlib.sha256(data).hexdigest()


def load_manifest(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid manifest {path}: {exc}") from exc


def check_manifest(repo_root: Path, manifest_path: Path) -> list[str]:
    violations: list[str] = []
    manifest = load_manifest(manifest_path)
    portal_commit = manifest.get("portalCommit", "unknown")
    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        violations.append(f"{manifest_path}: files[] missing or empty")
        return violations

    for entry in files:
        if not isinstance(entry, dict):
            violations.append(f"{manifest_path}: each files[] entry must be an object")
            continue
        rel = entry.get("path")
        expected = entry.get("sha256")
        if not rel or not expected:
            violations.append(f"{manifest_path}: files[] entry missing path or sha256")
            continue
        target = repo_root / rel
        if not target.is_file():
            violations.append(f"missing brand artifact: {rel} (portal@{portal_commit})")
            continue
        actual = sha256_file(target)
        if actual != expected:
            violations.append(
                f"drift: {rel} sha256={actual[:12]}… expected {expected[:12]}… "
                f"(run: bash scripts/sync-brand-from-portal.sh)"
            )
    return violations


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Verify MC brand artifacts match manifest."
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=DEFAULT_REPO_ROOT,
        help="Mission Control repo root (default: this script's own repo root)",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=DEFAULT_MANIFEST,
        help="Parity manifest path relative to repo root unless absolute",
    )
    args = parser.parse_args(argv)
    repo_root = args.repo_root.resolve()
    manifest_path = (
        args.manifest if args.manifest.is_absolute() else repo_root / args.manifest
    )

    if not manifest_path.is_file():
        print(f"FAIL: manifest not found: {manifest_path}", file=sys.stderr)
        return 1

    violations = check_manifest(repo_root, manifest_path)
    if violations:
        print("brand portal parity FAIL:", file=sys.stderr)
        for line in violations:
            print(f"  {line}", file=sys.stderr)
        return 1

    manifest = load_manifest(manifest_path)
    count = len(manifest.get("files", []))
    commit = manifest.get("portalCommit", "unknown")
    print(f"brand portal parity clean ({count} artifacts, portal@{commit})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
