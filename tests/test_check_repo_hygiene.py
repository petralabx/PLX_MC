"""Contract tests for the repo hygiene linter: the session-brain queue exemption
and module-shim expiry."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
CHECKER = REPO_ROOT / "scripts" / "check-repo-hygiene.py"

TODAY = "2026-10-15"

# Sandbox git must not inherit this repo's git environment: a commit hook
# exports GIT_INDEX_FILE (an absolute path under `git commit -a`), and the
# sandbox's `git add` would then rewrite this repo's index.
SANDBOX_ENV = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}


def _run(cwd: Path, *args: str) -> subprocess.CompletedProcess[str]:
    scripts = cwd / "scripts"
    scripts.mkdir(exist_ok=True)
    shutil.copy(CHECKER, scripts / CHECKER.name)
    # The shim check reads tracked files, so every fixture is a git work tree.
    subprocess.run(["git", "init", "-q", str(cwd)], check=True, env=SANDBOX_ENV)
    subprocess.run(["git", "-C", str(cwd), "add", "-A"], check=True, env=SANDBOX_ENV)
    return subprocess.run(
        [sys.executable, str(scripts / CHECKER.name), *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        check=False,
        env=SANDBOX_ENV,
    )


def _write_shim(root: Path, rel: str, removal_date: str, sep: str = "—") -> None:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    # Built at runtime: a literal dated marker in this file would trip the real check.
    marker = f"module-shim {sep} remove after {removal_date}"
    path.write_text(f"export * from './new';\n// {marker}\n", encoding="utf-8")


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


@pytest.mark.parametrize("sep", ["—", "-", "--", ":"])
def test_expired_module_shim_fails(tmp_path, sep):
    _write_shim(tmp_path, "src/lib/old.ts", "2026-10-01", sep)

    result = _run(tmp_path, "--today", TODAY)

    assert result.returncode == 1
    assert "expired module-shim: src/lib/old.ts:2 (last allowed day 2026-10-01" in (
        result.stderr
    )


def test_removal_date_is_the_last_allowed_day(tmp_path):
    # TASK-2924: isApprover was dated 2026-10-14 and became a violation on the 15th.
    _write_shim(tmp_path, "src/lib/mc-data/repos.ts", "2026-10-14")

    on_the_day = _run(tmp_path, "--today", "2026-10-14")
    day_after = _run(tmp_path, "--today", "2026-10-15")

    assert on_the_day.returncode == 0, on_the_day.stderr
    assert day_after.returncode == 1
    assert "expired module-shim: src/lib/mc-data/repos.ts:2" in day_after.stderr


def test_future_module_shim_passes_without_warning(tmp_path):
    _write_shim(tmp_path, "src/lib/old.ts", "2026-10-30")  # 15 days out

    result = _run(tmp_path, "--today", TODAY)

    assert result.returncode == 0, result.stderr
    assert "module-shim" not in result.stderr


def test_module_shim_due_within_14_days_warns_without_failing(tmp_path):
    _write_shim(tmp_path, "src/lib/old.ts", "2026-10-29")  # 14 days out

    result = _run(tmp_path, "--today", TODAY)

    assert result.returncode == 0, result.stderr
    assert "warning: module-shim due within 14 days: src/lib/old.ts:2" in (
        result.stderr
    )


def test_template_text_with_placeholder_date_is_ignored(tmp_path):
    rule = (
        "Compatibility shims must include a removal date comment: "
        "module-shim — remove after YYYY-MM-DD"
    )
    contract = tmp_path / "config" / "governance-contract.yaml"
    contract.parent.mkdir()
    contract.write_text(f'rules:\n  - "{rule}"\n', encoding="utf-8")

    result = _run(tmp_path, "--today", TODAY)

    assert result.returncode == 0, result.stderr
    assert "module-shim" not in result.stderr


def test_markdown_that_quotes_a_dated_marker_is_not_a_shim(tmp_path):
    _write_shim(tmp_path, "docs/specs/frontier-implementation-spec.md", "2026-09-30")
    _write_shim(tmp_path, ".cursor/rules/governance.mdc", "2026-09-30")

    result = _run(tmp_path, "--today", TODAY)

    assert result.returncode == 0, result.stderr


def test_impossible_removal_date_fails(tmp_path):
    _write_shim(tmp_path, "src/lib/old.ts", "2026-02-30")

    result = _run(tmp_path, "--today", TODAY)

    assert result.returncode == 1
    assert "not a real date: src/lib/old.ts:2 (2026-02-30)" in result.stderr


def test_shim_check_fails_closed_outside_a_git_work_tree(tmp_path):
    scripts = tmp_path / "scripts"
    scripts.mkdir()
    shutil.copy(CHECKER, scripts / CHECKER.name)
    # Stop git from finding a repository above the sandbox.
    env = {**SANDBOX_ENV, "GIT_CEILING_DIRECTORIES": str(tmp_path.parent)}

    result = subprocess.run(
        [sys.executable, str(scripts / CHECKER.name)],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        check=False,
        env=env,
    )

    assert result.returncode == 1
    assert "cannot list tracked files" in result.stderr
