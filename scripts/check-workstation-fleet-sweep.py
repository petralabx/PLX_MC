#!/usr/bin/env python3
"""Fleet sweep: report this workstation's secrets-loader drift to PLX MC.

`check-workstation-loader-drift.py` answers "is this host's loader correct?".
It only helps if something asks, on every workstation, on a schedule. A GitHub
Actions runner cannot answer it: runners have no `~/.secrets-env.staging.ps1`,
so a cloud cron would sweep nothing. The sweep has to run ON each workstation.

This wrapper runs the drift check locally and POSTs a small verdict to MC so a
silently-broken workstation shows up centrally instead of waiting for a human
to notice Graph calls failing.

Schedule it per workstation:

    # Windows Task Scheduler, daily
    python scripts/check-workstation-fleet-sweep.py --report

    # dry run, no network
    python scripts/check-workstation-fleet-sweep.py

Exit codes mirror the underlying check: 0 clean, 1 drift, 2 no loader here.
`--report` failures never change the exit code: a sweep that cannot reach MC
must not mask, or invent, a drift verdict.

Never sends secret values. The payload carries host, verdict, and finding
text, which is structural by construction.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import socket
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CHECK = REPO_ROOT / "scripts" / "check-workstation-loader-drift.py"

VERDICTS = {0: "clean", 1: "drift", 2: "absent"}


def run_check(strict: bool) -> tuple[int, str]:
    cmd = [sys.executable, str(CHECK)]
    if strict:
        cmd.append("--strict")
    proc = subprocess.run(cmd, capture_output=True, text=True)
    return proc.returncode, (proc.stdout + proc.stderr).strip()


def build_payload(rc: int, output: str, strict: bool) -> dict:
    return {
        "kind": "workstation-loader-drift",
        "host": socket.gethostname(),
        "os": platform.system(),
        "user": os.environ.get("USERNAME") or os.environ.get("USER") or "unknown",
        "verdict": VERDICTS.get(rc, "error"),
        "exitCode": rc,
        "strict": strict,
        "checkedAt": datetime.now(timezone.utc).isoformat(),
        "findings": [
            line.strip()
            for line in output.splitlines()
            if line.strip().startswith(tuple("123456789"))
        ],
    }


def report(
    payload: dict, base_url: str, api_key: str, operator: str, repo: str
) -> bool:
    """POST the verdict. Returns True on success; never raises."""
    url = base_url.rstrip("/") + "/api/cursor/session-telemetry"
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("x-api-key", api_key)
    # Both headers are required by the cursor API surface; omitting either
    # returns missing_operator / missing_repo rather than a useful error.
    req.add_header("X-MC-Operator-Email", operator)
    req.add_header("X-MC-Repo", repo)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            print(f"[sweep] reported to MC (HTTP {resp.status})")
            return True
    except urllib.error.HTTPError as exc:
        print(f"[sweep] MC rejected the report: HTTP {exc.code}", file=sys.stderr)
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        print(f"[sweep] could not reach MC: {exc}", file=sys.stderr)
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--report", action="store_true", help="POST the verdict to PLX MC"
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="also require sha256 parity with freshly generated output",
    )
    args = parser.parse_args()

    rc, output = run_check(args.strict)
    print(output)

    payload = build_payload(rc, output, args.strict)
    print(f"[sweep] host={payload['host']} verdict={payload['verdict']}")

    if not args.report:
        return rc

    base_url = os.environ.get("MC_BASE_URL", "https://mc.plxcustomer.io")
    api_key = os.environ.get("MC_MCP_API_KEY", "")
    operator = os.environ.get("MC_OPERATOR_EMAIL", "")
    repo = os.environ.get("MC_REPO", "petralabx/PLX_MC")

    missing = [
        name
        for name, value in (
            ("MC_MCP_API_KEY", api_key),
            ("MC_OPERATOR_EMAIL", operator),
        )
        if not value
    ]
    if missing:
        # Absent config must not look like a clean sweep, nor fail the host.
        print(f"[sweep] not reporting — missing {', '.join(missing)}", file=sys.stderr)
        return rc

    report(payload, base_url, api_key, operator, repo)
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
