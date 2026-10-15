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
  6. No tracked file carries a module-shim marker past its removal date
     (CLAUDE.md, Module Boundaries). The marker's date is the last allowed
     day, compared with today's date in UTC: a shim dated 2026-10-14 passes
     on 2026-10-14 and fails from 2026-10-15. A shim due within 14 days
     prints a warning but does not fail. Markdown (.md, .mdc) is not scanned,
     because docs quote the marker and a shim is code. Only a real date
     matches, so the rule's own YYYY-MM-DD template text is ignored. If git
     cannot list the tracked files, that is a violation too.

`artifacts/session-brain/` is exempt from the bundle-shape checks (3-4): it is
the gitignored session-artifact offline queue documented in
`.cursor/rules/session-knowledge-artifact.mdc` (`<date>/<session_id>.json`),
not an evidence bundle.

Run from repo root:
    python scripts/check-repo-hygiene.py [--today YYYY-MM-DD]

`--today` evaluates shim dates as of another day: tests pin it, and it
previews what will expire.

Exit codes: 0 — clean, 1 — violations found.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from datetime import date, datetime, timezone
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
    "CODEX.md",
    "GEMINI.md",
    "GROK.md",
    "HERMES.md",
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
    "ui-loop.config.json",
    "ui-loop.schema.json",
    "plx-brand.json",
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

# Session-artifact offline queue (fail-open capture path); see module docstring.
EXEMPT_ARTIFACT_DOMAINS = {"session-brain"}

# Check 6. The marker is "module-shim", then "remove after", then the date. Any
# non-word characters on the same line may separate the words, so "-", "--" or
# ":" typed in place of the em dash still counts. The date must be digits,
# which keeps the rule's YYYY-MM-DD template text out.
SHIM_MARKER_RE = re.compile(
    r"module-shim[^\w\n]*remove[^\w\n]*after[^\w\n]*(\d{4}-\d{2}-\d{2})",
    re.ASCII | re.IGNORECASE,
)
# Prose that quotes the marker (rule surfaces, specs, LESSONS.md) is not a shim.
SHIM_SKIP_SUFFIXES = {".md", ".mdc"}
SHIM_WARN_DAYS = 14


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
        if entry.name in EXEMPT_ARTIFACT_DOMAINS:
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


def wsl_gitdir(root: Path) -> str | None:
    """WSL path to a Windows worktree's gitdir, or None for any other layout.

    `git worktree add` on Windows writes `gitdir: C:/...` into the worktree's
    .git file, which WSL git cannot follow. This is the translation
    check-shebang-eol.py makes, copied rather than imported because other
    repos copy this script on its own (docs/runbooks/marketing-brand-repo-setup.md).
    """
    marker = root / ".git"
    if not marker.is_file():
        return None
    entry = marker.read_text(encoding="utf-8", errors="replace").strip()
    match = re.match(r"^gitdir:\s*([A-Za-z]):[\\/](.*)$", entry)
    if not match:
        return None
    drive, rest = match.groups()
    return f"/mnt/{drive.lower()}/{rest.replace(chr(92), '/')}"


def tracked_files(violations: list[str]) -> list[str]:
    cmd = ["git", "-C", str(REPO_ROOT), "ls-files", "-z"]
    listing = subprocess.run(cmd, capture_output=True, check=False)
    if listing.returncode != 0:
        git_dir = wsl_gitdir(REPO_ROOT)
        if git_dir:
            env = {**os.environ, "GIT_DIR": git_dir, "GIT_WORK_TREE": str(REPO_ROOT)}
            listing = subprocess.run(cmd, capture_output=True, check=False, env=env)
    if listing.returncode != 0:
        # Fail closed: a check that cannot see the files must not pass.
        detail = listing.stderr.decode("utf-8", "replace").strip()
        violations.append(
            f"cannot list tracked files for the module-shim check: {detail}"
        )
        return []
    return [os.fsdecode(name) for name in listing.stdout.split(b"\0") if name]


def check_shim_expiry(violations: list[str], warnings: list[str], today: date) -> None:
    for rel in tracked_files(violations):
        path = REPO_ROOT / rel
        # Skip docs, which quote the marker, and tracked files deleted locally.
        if path.suffix.lower() in SHIM_SKIP_SUFFIXES or not path.is_file():
            continue
        data = path.read_bytes()
        if b"\0" in data[:8000]:
            continue  # binary, by git's own heuristic
        text = data.decode("utf-8", errors="replace")
        for match in SHIM_MARKER_RE.finditer(text):
            line = text.count("\n", 0, match.start()) + 1
            where = f"{rel}:{line}"
            stamp = match.group(1)
            try:
                due = date.fromisoformat(stamp)
            except ValueError:
                violations.append(
                    f"module-shim removal date is not a real date: {where} ({stamp})"
                )
                continue
            if due < today:
                violations.append(
                    f"expired module-shim: {where} "
                    f"(last allowed day {due}, today is {today} UTC)"
                )
            elif (due - today).days <= SHIM_WARN_DAYS:
                warnings.append(
                    f"module-shim due within {SHIM_WARN_DAYS} days: {where} "
                    f"(last allowed day {due})"
                )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--today",
        type=date.fromisoformat,
        default=datetime.now(timezone.utc).date(),
        help="evaluate module-shim removal dates as of this day "
        "(YYYY-MM-DD; default: today's date in UTC)",
    )
    args = parser.parse_args(argv)

    violations: list[str] = []
    warnings: list[str] = []
    check_root(violations)
    check_artifacts(violations)
    check_archive(violations)
    check_shim_expiry(violations, warnings, args.today)

    for warning in warnings:
        print(f"warning: {warning}", file=sys.stderr)
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
