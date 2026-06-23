#!/usr/bin/env python3
"""Repo hygiene linter — enforces docs/REPO_HYGIENE_SPEC.md.

Checks:
  1. Repo root contains only approved files (no stray reports/summaries).
  2. No root file matches a forbidden pattern (FINAL_*, *_SUMMARY.md, ...).
  3. No loose files directly under artifacts/ or artifacts/<domain>/ —
     evidence lives in dated bundle folders.
  4. Every artifact bundle has a REPORT.md (or VERDICT.md) and an index.md
     (or artifacts.json).
  5. Every archive bundle has a README.md explaining why it was archived.

Run from repo root:
    python scripts/check-repo-hygiene.py

Exit codes: 0 — clean, 1 — violations found.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Keep these aligned with config/governance-contract.yaml (repo_hygiene section).
APPROVED_ROOT_FILES = {
    "README.md",
    "AGENTS.md",
    "SOUL.md",
    "TOOLS.md",
    "LESSONS.md",
    "CLAUDE.md",
    "pyproject.toml",
    "requirements.txt",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "next.config.ts",
    "next-env.d.ts",
    "eslint.config.mjs",
    "vitest.config.ts",
    "playwright.config.ts",
    "vercel.json",
    ".gitignore",
    ".pre-commit-config.yaml",
}

FORBIDDEN_PATTERNS = [
    re.compile(r"^FINAL_", re.IGNORECASE),
    re.compile(r"^QA_", re.IGNORECASE),
    re.compile(r"_SUMMARY\.md$", re.IGNORECASE),
    re.compile(r"_REPORT\.md$", re.IGNORECASE),
    re.compile(r"_ASSESSMENT\.md$", re.IGNORECASE),
    re.compile(r"_COMPLETION", re.IGNORECASE),
    re.compile(r"_CHECKLIST\.md$", re.IGNORECASE),
    re.compile(r"_SPECIFICATION\.md$", re.IGNORECASE),
    re.compile(r"_20\d{2}.*\.md$"),
]

BUNDLE_DIR_RE = re.compile(r"^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*$")


def check_root(violations: list[str]) -> None:
    for entry in sorted(REPO_ROOT.iterdir()):
        if entry.is_dir():
            continue
        name = entry.name
        if any(p.search(name) for p in FORBIDDEN_PATTERNS):
            violations.append(f"forbidden root file pattern: {name}")
            continue
        if name.startswith("."):
            continue  # dotfile configs are allowed; still subject to forbidden patterns
        if name not in APPROVED_ROOT_FILES:
            violations.append(
                f"unapproved root file: {name} "
                "(move to docs/, artifacts/, or add to the approved list in the contract)"
            )


def check_artifacts(violations: list[str]) -> None:
    artifacts = REPO_ROOT / "artifacts"
    if not artifacts.is_dir():
        return
    for entry in artifacts.iterdir():
        if entry.is_file():
            violations.append(f"loose file directly under artifacts/: {entry.name}")
            continue
        # entry is a domain dir; its children must be dated bundles
        for child in entry.iterdir():
            if child.is_file():
                violations.append(
                    f"loose file under artifacts/{entry.name}/: {child.name}"
                )
                continue
            if not BUNDLE_DIR_RE.match(child.name):
                violations.append(
                    f"artifact bundle not dated/kebab-case: artifacts/{entry.name}/{child.name}"
                )
            has_report = (child / "REPORT.md").exists() or (
                child / "VERDICT.md"
            ).exists()
            has_index = (child / "index.md").exists() or (
                child / "artifacts.json"
            ).exists()
            if not has_report:
                violations.append(
                    f"bundle missing REPORT.md/VERDICT.md: {child.relative_to(REPO_ROOT)}"
                )
            if not has_index:
                violations.append(
                    f"bundle missing index.md/artifacts.json: {child.relative_to(REPO_ROOT)}"
                )


def check_archive(violations: list[str]) -> None:
    archive = REPO_ROOT / "archive"
    if not archive.is_dir():
        return
    for entry in archive.iterdir():
        if entry.is_dir() and not (entry / "README.md").exists():
            violations.append(f"archive bundle missing README.md: archive/{entry.name}")


def main() -> int:
    violations: list[str] = []
    check_root(violations)
    check_artifacts(violations)
    check_archive(violations)

    if violations:
        print("REPO HYGIENE VIOLATIONS:", file=sys.stderr)
        for v in violations:
            print(f"  - {v}", file=sys.stderr)
        print("See docs/REPO_HYGIENE_SPEC.md", file=sys.stderr)
        return 1
    print("repo hygiene clean")
    return 0


if __name__ == "__main__":
    sys.exit(main())
