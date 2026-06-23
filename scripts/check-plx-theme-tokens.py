#!/usr/bin/env python3
"""Raw-color design-token checker for the ui-ux-design-loop G1 gate.

Scans the given files for raw color literals (hex, rgb/rgba, hsl/hsla, oklch and
friends) that should instead come from the ``--p-*`` design tokens behind the
``.brand-plx`` boundary (governance: no raw hex in components). It prints one
indented line per finding and a final ``Findings: N`` summary line that the
gate wrapper (``.cursor/skills/ui-ux-design-loop/scripts/ui-conformance-scan.sh``)
parses. Exit code is always 0 — the wrapper decides pass/fail from the count.

Usage:
    python3 scripts/check-plx-theme-tokens.py <file> [<file> ...]
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

# Hex colors (#rgb, #rrggbb, #rrggbbaa) and CSS color functions. Commit SHAs and
# ids never carry a leading '#', so the hex rule does not match them.
_HEX = re.compile(r"#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b")
_FUNC = re.compile(r"\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\s*\(")


def scan_file(path: Path) -> list[str]:
    findings: list[str] = []
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return findings
    for lineno, line in enumerate(text.splitlines(), start=1):
        for pattern in (_HEX, _FUNC):
            match = pattern.search(line)
            if match:
                findings.append(
                    f"  {path}:{lineno}: {match.group(0)}  | {line.strip()[:100]}"
                )
    return findings


def main(argv: list[str]) -> int:
    findings: list[str] = []
    for arg in argv:
        findings.extend(scan_file(Path(arg)))
    for finding in findings:
        print(finding)
    print(f"Findings: {len(findings)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
