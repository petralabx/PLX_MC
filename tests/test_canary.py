"""Canary: governance tooling stays importable and gates keep their exit-code contract.

Every governance enforcement script must have at least one test verifying its
exit-code behavior (contract: testing rules). TypeScript import health is
covered separately by `npm run typecheck` in the preflight gate.
"""

from __future__ import annotations

import importlib.util
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = REPO_ROOT / "scripts"


def _load(script_name: str):
    spec = importlib.util.spec_from_file_location(
        script_name.replace("-", "_"), SCRIPTS / f"{script_name}.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run(script: Path, cwd: Path) -> int:
    return subprocess.run(
        [sys.executable, str(script)], cwd=cwd, capture_output=True, text=True
    ).returncode


def test_governance_scripts_are_importable():
    for name in ("check-repo-hygiene", "generate-governance-surfaces"):
        module = _load(name)
        assert callable(module.main), f"{name}.main is not callable"


def test_drift_gate_passes_on_aligned_repo():
    rc = subprocess.run(
        [
            sys.executable,
            str(SCRIPTS / "generate-governance-surfaces.py"),
            "--check",
        ],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    ).returncode
    assert rc == 0, "drift gate must exit 0 when surfaces match the contract"


def test_drift_gate_fails_on_hand_edited_surface(tmp_path):
    for rel in ("scripts", "config"):
        shutil.copytree(REPO_ROOT / rel, tmp_path / rel)
    for rel in ("AGENTS.md", "CLAUDE.md"):
        shutil.copy(REPO_ROOT / rel, tmp_path / rel)
    rules = tmp_path / ".cursor" / "rules"
    rules.mkdir(parents=True)
    shutil.copy(REPO_ROOT / ".cursor" / "rules" / "governance.mdc", rules)

    agents = tmp_path / "AGENTS.md"
    agents.write_text(
        agents.read_text(encoding="utf-8").replace("Mission First", "Mission Maybe"),
        encoding="utf-8",
    )
    rc = subprocess.run(
        [
            sys.executable,
            str(tmp_path / "scripts" / "generate-governance-surfaces.py"),
            "--check",
        ],
        cwd=tmp_path,
        capture_output=True,
        text=True,
    ).returncode
    assert rc == 1, "drift gate must exit 1 when a generated block is hand-edited"


def test_hygiene_gate_exit_codes(tmp_path):
    sandbox_scripts = tmp_path / "scripts"
    sandbox_scripts.mkdir()
    shutil.copy(SCRIPTS / "check-repo-hygiene.py", sandbox_scripts)
    checker = sandbox_scripts / "check-repo-hygiene.py"

    (tmp_path / "README.md").write_text("clean\n", encoding="utf-8")
    assert _run(checker, tmp_path) == 0, "hygiene gate must exit 0 on a clean root"

    (tmp_path / "FINAL_X_SUMMARY.md").write_text("probe\n", encoding="utf-8")
    assert _run(checker, tmp_path) == 1, (
        "hygiene gate must exit 1 on a forbidden root file"
    )


def test_pipeline_contract_forbids_pending_stamps():
    """TASK-1199: generated surfaces + SOP forbid placeholder stamps."""
    surfaces = [
        REPO_ROOT / "AGENTS.md",
        REPO_ROOT / "CLAUDE.md",
        REPO_ROOT / ".cursor" / "rules" / "governance.mdc",
        REPO_ROOT / "docs" / "AGENT-PR-SOP.md",
        REPO_ROOT / "config" / "governance-contract.yaml",
    ]
    for path in surfaces:
        text = path.read_text(encoding="utf-8")
        assert "or create one" not in text, f"{path.name} still says create-then-stamp"
        assert "checks out or creates" not in text, f"{path.name} still auto-creates"
        assert "MC-Checkout: pending" in text, f"{path.name} must forbid pending stamps"
        assert "verificationCommands" in text, (
            f"{path.name} must require verificationCommands"
        )

    sop = (REPO_ROOT / "docs" / "AGENT-PR-SOP.md").read_text(encoding="utf-8")
    assert "create-a-task-then-stamp" in sop
    assert "do not open the PR" in sop

    pipeline = (REPO_ROOT / "docs" / "runbooks" / "CI-PIPELINE.md").read_text(
        encoding="utf-8"
    )
    for marker in (
        "AGENTS.md",
        "CLAUDE.md",
        ".cursorrules",
        "mc-compliance.mdc",
        "prompts/uat-agent/v2",
        "copilot-instructions.md",
        "GEMINI.md",
        "silent-failure-audit",
    ):
        assert marker in pipeline, f"CI-PIPELINE.md must name {marker}"
