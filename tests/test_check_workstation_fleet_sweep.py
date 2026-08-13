"""Fleet-sweep wrapper and preflight exit-code contracts.

The drift check is only useful if it runs everywhere and blocks nothing it
should not. Two failure modes are covered here:

  * exit 2 (no loader on this host) is the NORMAL result on CI runners and
    servers. If preflight treated it as failure it would break every CI run.
  * exit 1 (real drift) must still block, or the gate is decorative.
"""

from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path
from types import ModuleType

REPO_ROOT = Path(__file__).resolve().parents[1]
SWEEP = REPO_ROOT / "scripts" / "check-workstation-fleet-sweep.py"
PREFLIGHT = REPO_ROOT / "scripts" / "preflight.sh"


def load_sweep() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "check_workstation_fleet_sweep", SWEEP
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_verdict_names_cover_every_exit_code() -> None:
    sweep = load_sweep()
    assert sweep.VERDICTS == {0: "clean", 1: "drift", 2: "absent"}


def test_absent_loader_is_not_reported_as_clean() -> None:
    """A host with no loader must not look like a passing host."""
    sweep = load_sweep()
    payload = sweep.build_payload(2, "SKIP: no loader", strict=False)
    assert payload["verdict"] == "absent"
    assert payload["verdict"] != "clean"


def test_drift_verdict_carries_findings() -> None:
    sweep = load_sweep()
    output = "DRIFT: 2 finding(s)\n\n  1. provenance: missing header\n  2. TASK-756: reads ~/.aws txt"
    payload = sweep.build_payload(1, output, strict=False)
    assert payload["verdict"] == "drift"
    assert len(payload["findings"]) == 2


def test_unexpected_exit_code_is_error_not_clean() -> None:
    sweep = load_sweep()
    assert sweep.build_payload(7, "boom", strict=False)["verdict"] == "error"


def test_payload_carries_no_secret_material() -> None:
    """The payload is structural: host, verdict, finding text. Nothing else."""
    sweep = load_sweep()
    payload = sweep.build_payload(0, "OK: loader matches", strict=False)
    assert set(payload) == {
        "kind",
        "host",
        "os",
        "user",
        "verdict",
        "exitCode",
        "strict",
        "checkedAt",
        "findings",
    }


def test_preflight_tolerates_absent_loader_but_blocks_drift() -> None:
    """Guard the exit-code branch in preflight.sh.

    CI runners have no workstation loader, so exit 2 must pass. A rewrite that
    drops the `-eq 1` / `-gt 2` split would either break every CI run or let a
    drifted workstation through.
    """
    text = PREFLIGHT.read_text(encoding="utf-8")
    assert "check-workstation-loader-drift.py" in text, (
        "drift check not wired into preflight"
    )

    branch = re.search(
        r'loader_drift_rc"?\s*-eq 1 \|\| .*loader_drift_rc"?\s*-gt 2', text
    )
    assert branch, "preflight must block on exit 1 and >2, but tolerate exit 2"


def test_preflight_captures_rc_instead_of_aborting() -> None:
    """preflight.sh runs under `set -e`; the call must not abort the script."""
    text = PREFLIGHT.read_text(encoding="utf-8")
    assert "|| loader_drift_rc=$?" in text, (
        "the drift check must capture its exit code; a bare call aborts under set -e"
    )
