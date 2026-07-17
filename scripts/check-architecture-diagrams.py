#!/usr/bin/env python3
"""Architecture diagram pack gate — maintained C4 sources must stay honest.

Verifies the promoted diagram pack under docs/architecture/:
  - Required .mmd + matching .svg exist for context, containers, task-lifecycle
  - Required maturity / hosting phrases appear somewhere in the .mmd set
  - Forbidden honesty-oracle lies are absent anywhere under docs/architecture/

Patterned on check-arch-parity.py: cheap, deterministic, exit 1 on drift,
wired into preflight policy gates.

Usage:
    python scripts/check-architecture-diagrams.py
    python scripts/check-architecture-diagrams.py --repo-root path/to/repo
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

DEFAULT_REPO_ROOT = Path(__file__).resolve().parents[1]

DIAGRAM_STEMS = ("context", "containers", "task-lifecycle")

# Required somewhere across the combined .mmd corpus (case-sensitive substrings).
REQUIRED_MMD_PHRASES = (
    "delta engine current",
    "Graph change-notifications deferred (P11)",
)

# Hosting signal: at least one of these must appear in the .mmd set.
HOSTING_SIGNAL_ANY_OF = (
    "mc.plxcustomer.io",
    "Vercel",
)

# Forbidden anywhere under docs/architecture/ (all file types).
FORBIDDEN_ARCHITECTURE_PHRASES = (
    "Production hosting unknown",
    "still says planned",
    "needs owner reconciliation",
    "Sync engine (planned)",
)


def _normalize(text: str) -> str:
    """Collapse fancy dashes so Windows/editor variants still match."""
    return text.replace("\u2013", "—").replace("--", "—")


def check_architecture_diagrams(repo_root: Path) -> list[str]:
    violations: list[str] = []
    arch_dir = repo_root / "docs" / "architecture"

    if not arch_dir.is_dir():
        violations.append(f"missing directory: {arch_dir.as_posix()}")
        return violations

    mmd_corpus_parts: list[str] = []

    for stem in DIAGRAM_STEMS:
        mmd_path = arch_dir / f"{stem}.mmd"
        svg_path = arch_dir / f"{stem}.svg"
        if not mmd_path.is_file():
            violations.append(
                f"missing required diagram source: docs/architecture/{stem}.mmd"
            )
        else:
            mmd_corpus_parts.append(_normalize(mmd_path.read_text(encoding="utf-8")))
        if not svg_path.is_file():
            violations.append(
                f"missing required diagram render: docs/architecture/{stem}.svg"
            )

    mmd_corpus = "\n".join(mmd_corpus_parts)

    if mmd_corpus_parts:
        for phrase in REQUIRED_MMD_PHRASES:
            if phrase not in mmd_corpus:
                violations.append(
                    f"docs/architecture/*.mmd missing required phrase: {phrase!r}"
                )

        if not any(signal in mmd_corpus for signal in HOSTING_SIGNAL_ANY_OF):
            signals = " or ".join(repr(s) for s in HOSTING_SIGNAL_ANY_OF)
            violations.append(
                f"docs/architecture/*.mmd missing hosting signal ({signals})"
            )

    # Scan every file under docs/architecture/ for forbidden honesty lies.
    for path in sorted(arch_dir.rglob("*")):
        if not path.is_file():
            continue
        try:
            text = _normalize(path.read_text(encoding="utf-8"))
        except (UnicodeDecodeError, OSError):
            # Binary / unreadable artifacts are not honesty-oracle prose.
            continue
        rel = path.relative_to(repo_root).as_posix()
        for phrase in FORBIDDEN_ARCHITECTURE_PHRASES:
            if phrase in text:
                violations.append(f"forbidden phrase {phrase!r} found in {rel}")

    return violations


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Verify docs/architecture diagram pack exists and stays "
            "honesty-oracle clean."
        )
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=DEFAULT_REPO_ROOT,
        help="Mission Control repo root (default: this script's own repo root)",
    )
    args = parser.parse_args(argv)
    repo_root = args.repo_root.resolve()

    violations = check_architecture_diagrams(repo_root)
    if violations:
        print("architecture diagrams FAIL:", file=sys.stderr)
        for line in violations:
            print(f"  {line}", file=sys.stderr)
        return 1

    print(
        "architecture diagrams clean "
        "(context/containers/task-lifecycle + honesty phrases)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
