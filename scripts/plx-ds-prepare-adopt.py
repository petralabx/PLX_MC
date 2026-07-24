#!/usr/bin/env python3
"""Prepare a design-system adopt working tree from an authority package checkout.

Copies authority design-system/ → MC pin cache + token/font mirrors, bumps
plx-brand.json pin, refreshes parity checksums for pin targets, and appends a
PENDING SYNC-LOG entry. Does not commit or open a PR (CI does that).

Usage:
  python3 scripts/plx-ds-prepare-adopt.py \\
    --authority-root /path/to/plx-customer-portal \\
    --version 1.0.1 \\
    --integrity sha256-… \\
    [--changelog-excerpt-file excerpt.md] \\
    [--repo-root .]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

TEXT_SUFFIXES = {".css", ".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".txt", ".svg"}


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def semver_tuple(v: str) -> tuple[int, int, int]:
    parts = v.split(".")
    if len(parts) != 3:
        raise ValueError(f"invalid semver {v!r}")
    return int(parts[0]), int(parts[1]), int(parts[2])


def package_integrity(artifacts: list[dict]) -> str:
    hashes = [str(a.get("sha256", "")) for a in artifacts]
    return "sha256-" + hashlib.sha256("\n".join(hashes).encode()).hexdigest()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--authority-root", type=Path, required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--integrity", required=True)
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--changelog-excerpt-file", type=Path, default=None)
    parser.add_argument(
        "--allow-same-version",
        action="store_true",
        help="Rebuild mirrors even when pin already matches (workflow dry-run).",
    )
    args = parser.parse_args(argv)

    repo = args.repo_root.resolve()
    authority = args.authority_root.resolve()
    brand_path = repo / "plx-brand.json"
    if not brand_path.is_file():
        print("error: missing plx-brand.json", file=sys.stderr)
        return 1

    brand = json.loads(brand_path.read_text(encoding="utf-8"))
    ds = brand.setdefault("designSystem", {})
    if ds.get("adoptsPlxTokens") is not True:
        print("error: repo does not adopt PLX tokens", file=sys.stderr)
        return 1

    pinned = str(ds.get("pinnedVersion") or "")
    if pinned and not args.allow_same_version:
        if semver_tuple(args.version) < semver_tuple(pinned):
            print(
                f"error: refusing downgrade {pinned} → {args.version}",
                file=sys.stderr,
            )
            return 1
        if args.version == pinned and ds.get("pinnedIntegrity") == args.integrity:
            print(f"skip: already pinned at v{pinned}")
            return 0

    auth_manifest_path = authority / "design-system" / "manifest.json"
    auth = json.loads(auth_manifest_path.read_text(encoding="utf-8"))
    if auth.get("version") != args.version:
        print(
            f"error: authority version {auth.get('version')!r} != {args.version!r}",
            file=sys.stderr,
        )
        return 1
    if auth.get("integrity") != args.integrity:
        print(
            f"error: authority integrity {auth.get('integrity')!r} != {args.integrity!r}",
            file=sys.stderr,
        )
        return 1
    if package_integrity(auth.get("artifacts") or []) != args.integrity:
        print("error: authority manifest integrity mismatch", file=sys.stderr)
        return 1

    dest = repo / "design-system"
    dest.mkdir(parents=True, exist_ok=True)
    sync_log = dest / "SYNC-LOG.md"
    sync_log_text = (
        sync_log.read_text(encoding="utf-8")
        if sync_log.is_file()
        else "# Design-system sync log\n"
    )

    for name in (
        "manifest.json",
        "CHANGELOG.md",
        "README.md",
        "tokens.css",
        "tokens.ts",
    ):
        src = authority / "design-system" / name
        if not src.is_file():
            print(f"error: missing authority design-system/{name}", file=sys.stderr)
            return 1
        shutil.copy2(src, dest / name)

    fonts_src = authority / "design-system" / "fonts"
    fonts_dest = dest / "fonts"
    fonts_dest.mkdir(parents=True, exist_ok=True)
    for src in sorted(fonts_src.iterdir()):
        if src.is_file():
            shutil.copy2(src, fonts_dest / src.name)

    shutil.copy2(dest / "tokens.css", repo / "docs/design-system/tokens.css")
    shutil.copy2(dest / "tokens.ts", repo / "docs/design-system/tokens.ts")

    pub = repo / "public/fonts/mazius"
    archive = repo / "docs/design-system/assets/fonts/mazius"
    pub.mkdir(parents=True, exist_ok=True)
    archive.mkdir(parents=True, exist_ok=True)
    for src in sorted(fonts_dest.iterdir()):
        if src.is_file():
            shutil.copy2(src, archive / src.name)
            shutil.copy2(src, pub / src.name)

    # Runtime mirror: prefer authority portal runtime when present.
    runtime = authority / "portal/src/styles/brand-tokens.css"
    if runtime.is_file():
        shutil.copy2(runtime, repo / "src/styles/brand-tokens.css")

    ds["pinnedVersion"] = args.version
    ds["pinnedIntegrity"] = args.integrity
    ds["channel"] = auth.get("channel") or ds.get("channel") or "staging"
    brand_path.write_text(json.dumps(brand, indent=2) + "\n", encoding="utf-8")

    # Refresh pin-target rows in parity manifest (keep other ADR-003 artifacts).
    parity_path = repo / "config/brand-portal-parity.json"
    if parity_path.is_file():
        parity = json.loads(parity_path.read_text(encoding="utf-8"))
    else:
        parity = {
            "schemaVersion": "plx-brand-parity/v1",
            "portalRepo": "plx-customer-portal",
            "owner": "Vince",
            "rationale": "ADR-003 upstream authority; MC must not fork shared brand artifacts.",
            "files": [],
        }
    by_path = {
        e["path"]: e
        for e in parity.get("files", [])
        if isinstance(e, dict) and e.get("path")
    }
    pin_paths = [
        "docs/design-system/tokens.css",
        "docs/design-system/tokens.ts",
        "src/styles/brand-tokens.css",
    ]
    for font in sorted(pub.iterdir()):
        if font.is_file():
            pin_paths.append(str(font.relative_to(repo)))
    for font in sorted(archive.iterdir()):
        if font.is_file():
            pin_paths.append(str(font.relative_to(repo)))
    for rel in pin_paths:
        target = repo / rel
        if target.is_file():
            by_path[rel] = {"path": rel, "sha256": sha256_file(target)}
    parity["files"] = [by_path[k] for k in sorted(by_path)]
    parity["authorityVersion"] = args.version
    parity["authorityIntegrity"] = args.integrity
    parity["syncedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    parity_path.write_text(json.dumps(parity, indent=2) + "\n", encoding="utf-8")

    excerpt = ""
    if args.changelog_excerpt_file and args.changelog_excerpt_file.is_file():
        excerpt = args.changelog_excerpt_file.read_text(encoding="utf-8").strip()
    prior = pinned or "(none)"
    entry = (
        f"\n## {prior} → v{args.version}   ({datetime.now(timezone.utc).date().isoformat()})\n"
        f"- integrity: `{args.integrity}`\n"
        f"- decision: **PENDING** — human ADOPT (merge) or DECLINE (close PR)\n"
    )
    if excerpt:
        entry += f"- changelog:\n\n{excerpt}\n"
    if f"→ v{args.version}" not in sync_log_text:
        sync_log.write_text(sync_log_text.rstrip() + "\n" + entry, encoding="utf-8")
    else:
        sync_log.write_text(sync_log_text, encoding="utf-8")

    print(f"prepared adopt v{args.version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
