#!/usr/bin/env python3
"""MC brand application gate — surfaces must activate the brand boundary and
components must not introduce raw color literals.

Checks:
  - src/components/mc/**/*.tsx: zero raw-color findings (delegates to check-plx-theme-tokens.py)
  - src/app/signin/page.tsx: imports and uses BrandBoundary
  - src/components/mc/shell.tsx: imports and uses BrandBoundary

Usage:
    python3 scripts/check-mc-brand-application.py
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

DEFAULT_REPO_ROOT = Path(__file__).resolve().parents[1]


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def check_signin_boundary(violations: list[str], repo_root: Path) -> None:
    path = repo_root / "src/app/signin/page.tsx"
    if not path.is_file():
        violations.append("missing src/app/signin/page.tsx")
        return
    text = _read(path)
    if "BrandBoundary" not in text:
        violations.append(
            "sign-in page must wrap content in BrandBoundary (.brand-plx)"
        )


def check_shell_boundary(violations: list[str], repo_root: Path) -> None:
    path = repo_root / "src/components/mc/shell.tsx"
    if not path.is_file():
        violations.append("missing src/components/mc/shell.tsx")
        return
    text = _read(path)
    if "BrandBoundary" not in text:
        violations.append("MC shell must wrap content in BrandBoundary")


def check_component_colors(violations: list[str], repo_root: Path) -> None:
    token_check = repo_root / "scripts" / "check-plx-theme-tokens.py"
    mc_dir = repo_root / "src/components/mc"
    if not mc_dir.is_dir():
        violations.append("missing src/components/mc/")
        return
    files = sorted(mc_dir.rglob("*.tsx"))
    if not files:
        return
    cmd = [sys.executable, str(token_check), *[str(f) for f in files]]
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    output = result.stdout + result.stderr
    for line in output.splitlines():
        if line.startswith("  "):
            violations.append(line.strip())
    if "Findings: 0" not in output:
        for line in output.splitlines():
            if line.startswith("Findings:"):
                violations.append(f"MC components raw-color check failed: {line}")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Verify MC brand application invariants."
    )
    parser.add_argument("--repo-root", type=Path, default=DEFAULT_REPO_ROOT)
    args = parser.parse_args(argv)
    repo_root = args.repo_root.resolve()

    violations: list[str] = []
    check_signin_boundary(violations, repo_root)
    check_shell_boundary(violations, repo_root)
    check_component_colors(violations, repo_root)

    if violations:
        print("MC brand application FAIL:", file=sys.stderr)
        for line in violations:
            print(f"  {line}", file=sys.stderr)
        return 1

    print("MC brand application clean")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
