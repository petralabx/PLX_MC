"""Exit-code behavior for the MC brand application gate."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
GATE = REPO_ROOT / "scripts" / "check-mc-brand-application.py"


def _run() -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(GATE), "--repo-root", str(REPO_ROOT)],
        capture_output=True,
        text=True,
    )


def test_exit_0_on_current_repo():
    result = _run()
    assert result.returncode == 0, result.stderr
    assert "MC brand application clean" in result.stdout
