#!/usr/bin/env python3
"""Architecture maturity parity gate — AGENTS.md sync rows must match TOOLS.md.

Defends the honesty-oracle maturity split so the AGENTS.md architecture table
cannot drift back to "Sync engine (planned)" while TOOLS.md (and the shipped
engine) say otherwise. Patterned on check-brand-portal-parity.py: cheap,
deterministic, exit 1 on drift, wired into preflight policy gates.

Maturity facts that must agree:
  - Sync engine (delta) is current in AGENTS.md; TOOLS.md must describe the
    live delta path (inbound delta / delta sweep), not a planned engine.
  - Graph change-notifications are deferred (P11) in both docs.

Usage:
    python scripts/check-arch-parity.py
    python scripts/check-arch-parity.py --repo-root path/to/repo
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

DEFAULT_REPO_ROOT = Path(__file__).resolve().parents[1]

# Canonical AGENTS.md architecture-table cells.
AGENTS_REQUIRED_CELLS = (
    "Sync engine (delta) — current",
    "Graph change-notifications — deferred (P11)",
)

# Phrase that must appear in BOTH docs (cross-file maturity lock).
SHARED_DEFERRED_PHRASE = "Graph change-notifications — deferred (P11)"

# Historical lie that must never recur in AGENTS.md.
FORBIDDEN_AGENTS_PHRASES = ("Sync engine (planned)",)

# TOOLS.md signals that the delta engine is the live correctness path.
TOOLS_DELTA_CURRENT_PATTERNS = (
    re.compile(r"inbound\s+delta", re.IGNORECASE),
    re.compile(r"delta\s+sweep", re.IGNORECASE),
)


def _normalize(text: str) -> str:
    """Collapse fancy dashes so Windows/editor variants still match."""
    return text.replace("\u2013", "—").replace("--", "—")


def check_arch_parity(repo_root: Path) -> list[str]:
    violations: list[str] = []
    agents_path = repo_root / "AGENTS.md"
    tools_path = repo_root / "TOOLS.md"

    if not agents_path.is_file():
        violations.append(f"missing {agents_path.name}")
        return violations
    if not tools_path.is_file():
        violations.append(f"missing {tools_path.name}")
        return violations

    agents = _normalize(agents_path.read_text(encoding="utf-8"))
    tools = _normalize(tools_path.read_text(encoding="utf-8"))

    for phrase in FORBIDDEN_AGENTS_PHRASES:
        if phrase in agents:
            violations.append(
                f"AGENTS.md still contains forbidden maturity lie: {phrase!r}"
            )

    for cell in AGENTS_REQUIRED_CELLS:
        if cell not in agents:
            violations.append(f"AGENTS.md missing maturity cell: {cell!r}")

    if SHARED_DEFERRED_PHRASE not in tools:
        violations.append(
            f"drift: AGENTS.md has {SHARED_DEFERRED_PHRASE!r} but TOOLS.md does not"
        )

    if not any(pat.search(tools) for pat in TOOLS_DELTA_CURRENT_PATTERNS):
        violations.append(
            "drift: TOOLS.md does not describe a live delta path "
            "(expected 'inbound delta' or 'delta sweep') while AGENTS.md "
            "marks Sync engine (delta) — current"
        )

    # TOOLS must not re-label the push path as shipped/live.
    if re.search(
        r"change-notifications?\s+[—\-]\s*(current|shipped|live)",
        tools,
        re.IGNORECASE,
    ):
        violations.append(
            "drift: TOOLS.md marks change-notifications as current/shipped/live "
            "while AGENTS.md marks them deferred (P11)"
        )

    return violations


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Verify AGENTS.md sync maturity cells match TOOLS.md."
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=DEFAULT_REPO_ROOT,
        help="Mission Control repo root (default: this script's own repo root)",
    )
    args = parser.parse_args(argv)
    repo_root = args.repo_root.resolve()

    violations = check_arch_parity(repo_root)
    if violations:
        print("arch parity FAIL:", file=sys.stderr)
        for line in violations:
            print(f"  {line}", file=sys.stderr)
        return 1

    print("arch parity clean (delta current / Graph change-notifications deferred P11)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
