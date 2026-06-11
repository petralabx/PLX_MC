#!/usr/bin/env python3
"""Migration numbering gate — enforces the contract's database rules.

Numbered migrations are globally serialized: two PRs must never ship the same
numeric prefix, and every file must match NNN_snake_case.sql. Runs in every
preflight mode (scripts/preflight.sh policy step) so a duplicate prefix fails
locally and in CI before it can ever reach the migration runner.

Run from repo root:
    python scripts/check-migrations.py [--dir db/migrations]

Exit codes: 0 — clean (or no migrations dir yet), 1 — violations found.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
NAME_RE = re.compile(r"^(\d{3})_[a-z0-9_]+\.sql$")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", default=str(REPO_ROOT / "db" / "migrations"))
    args = parser.parse_args()

    migrations_dir = Path(args.dir)
    if not migrations_dir.is_dir():
        print("no migrations directory — nothing to check")
        return 0

    violations: list[str] = []
    prefixes: dict[str, str] = {}
    for entry in sorted(migrations_dir.iterdir()):
        if entry.is_dir() or entry.suffix != ".sql":
            violations.append(
                f"non-migration entry in {migrations_dir.name}/: {entry.name}"
            )
            continue
        match = NAME_RE.match(entry.name)
        if not match:
            violations.append(
                f"migration name violates NNN_snake_case.sql: {entry.name}"
            )
            continue
        prefix = match.group(1)
        if prefix in prefixes:
            violations.append(
                f"duplicate migration prefix {prefix}: {prefixes[prefix]} and {entry.name}"
            )
        else:
            prefixes[prefix] = entry.name

    if violations:
        print("MIGRATION VIOLATIONS:", file=sys.stderr)
        for violation in violations:
            print(f"  - {violation}", file=sys.stderr)
        return 1
    print(f"migrations clean ({len(prefixes)} files, serialized prefixes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
