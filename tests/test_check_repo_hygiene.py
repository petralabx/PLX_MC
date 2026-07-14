"""Contract tests for the repo hygiene linter's session-brain queue exemption."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
CHECKER = REPO_ROOT / "scripts" / "check-repo-hygiene.py"


def _run(cwd: Path) -> subprocess.CompletedProcess[str]:
    scripts = cwd / "scripts"
    scripts.mkdir(exist_ok=True)
    shutil.copy(CHECKER, scripts / CHECKER.name)
    return subprocess.run(
        [sys.executable, str(scripts / CHECKER.name)],
        cwd=cwd,
        capture_output=True,
        text=True,
        check=False,
    )


def test_session_brain_offline_queue_is_exempt_from_bundle_shape(tmp_path):
    queue_dir = tmp_path / "artifacts" / "session-brain" / "2026-07-13"
    queue_dir.mkdir(parents=True)
    (queue_dir / "abc123.json").write_text("{}\n", encoding="utf-8")

    result = _run(tmp_path)

    assert result.returncode == 0, result.stderr
    assert "session-brain" not in result.stderr


def test_other_domain_bundles_still_enforce_dated_kebab_case_and_report(tmp_path):
    bad_bundle = tmp_path / "artifacts" / "platform" / "not-a-dated-bundle"
    bad_bundle.mkdir(parents=True)
    (bad_bundle / "notes.txt").write_text("x", encoding="utf-8")

    result = _run(tmp_path)

    assert result.returncode == 1
    assert "artifact bundle not dated/kebab-case" in result.stderr
    assert "bundle missing REPORT.md/VERDICT.md" in result.stderr
