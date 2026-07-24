#!/usr/bin/env python3
"""Record a declined design-system update in design-system/SYNC-LOG.md.

Usage:
  python3 scripts/plx-ds-record-decline.py --version 1.0.1 --reason "defer surface audit"
"""

from __future__ import annotations

import argparse
import re
import sys
from datetime import datetime, timezone
from pathlib import Path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True)
    parser.add_argument("--reason", required=True)
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--actor", default="human")
    args = parser.parse_args(argv)

    repo = args.repo_root.resolve()
    path = repo / "design-system" / "SYNC-LOG.md"
    if not path.is_file():
        print("error: missing design-system/SYNC-LOG.md", file=sys.stderr)
        return 1

    text = path.read_text(encoding="utf-8")
    # Prefer flipping PENDING entry for this version.
    pattern = re.compile(
        rf"(## [^\n]*→ v{re.escape(args.version)}[^\n]*\n(?:.*\n)*?- decision: )\*\*PENDING\*\*[^\n]*",
        re.M,
    )
    replacement = (
        rf"\1**DECLINED** by {args.actor} — {args.reason} "
        f"({datetime.now(timezone.utc).date().isoformat()})"
    )
    new_text, n = pattern.subn(replacement, text, count=1)
    if n == 0:
        new_text = text.rstrip() + (
            f"\n\n## (pin held) → v{args.version}   "
            f"({datetime.now(timezone.utc).date().isoformat()})\n"
            f"- decision: **DECLINED** by {args.actor} — {args.reason}\n"
            f"- note: pin unchanged in plx-brand.json\n"
        )
    path.write_text(
        new_text if new_text.endswith("\n") else new_text + "\n", encoding="utf-8"
    )
    print(f"recorded decline for v{args.version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
