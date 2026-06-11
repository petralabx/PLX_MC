"""Migration numbering gate keeps its exit-code contract.

The contract's database rules require globally serialized numbered migrations
(no duplicate numeric prefixes) enforced by CI; scripts/check-migrations.py is
that enforcement and these tests pin its exit codes.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
GATE = REPO_ROOT / "scripts" / "check-migrations.py"


def _run(migrations_dir: Path) -> int:
    return subprocess.run(
        [sys.executable, str(GATE), "--dir", str(migrations_dir)],
        capture_output=True,
        text=True,
    ).returncode


def test_repo_migrations_are_clean():
    assert _run(REPO_ROOT / "db" / "migrations") == 0


def test_exit_0_on_serialized_prefixes(tmp_path):
    (tmp_path / "001_first.sql").write_text("SELECT 1;\n", encoding="utf-8")
    (tmp_path / "002_second.sql").write_text("SELECT 1;\n", encoding="utf-8")
    assert _run(tmp_path) == 0


def test_exit_1_on_duplicate_prefix(tmp_path):
    (tmp_path / "001_first.sql").write_text("SELECT 1;\n", encoding="utf-8")
    (tmp_path / "001_other.sql").write_text("SELECT 1;\n", encoding="utf-8")
    assert _run(tmp_path) == 1


def test_exit_1_on_bad_name(tmp_path):
    (tmp_path / "1_first.sql").write_text("SELECT 1;\n", encoding="utf-8")
    assert _run(tmp_path) == 1


def test_exit_0_when_no_migrations_dir(tmp_path):
    assert _run(tmp_path / "missing") == 0
