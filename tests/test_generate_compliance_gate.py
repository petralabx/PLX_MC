"""Focused contracts for the generated PLX MC compliance workflow."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
GENERATOR = REPO_ROOT / "scripts" / "generate-compliance-gate.py"
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "compliance-gate.yml"


def _run(*arguments: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(GENERATOR), *arguments],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


def test_compliance_generator_check_passes_for_canonical_workflow():
    assert _run("--check").returncode == 0


def test_compliance_generator_emit_matches_canonical_workflow():
    result = _run("--emit", "canonical")

    assert result.returncode == 0
    assert result.stdout == WORKFLOW.read_text(encoding="utf-8")


def test_canonical_and_downstream_send_full_and_legacy_repo_names():
    for variant in ("canonical", "downstream"):
        workflow = _run("--emit", variant).stdout

        assert "REPO_FULL_NAME: ${{ github.repository }}" in workflow
        assert "REPO_NAME: ${{ github.event.repository.name }}" in workflow
        assert '--arg repoFullName "$REPO_FULL_NAME"' in workflow
        assert (
            "{repo:$repo, repoFullName:$repoFullName, "
            "prNumber:$prNumber, headSha:$headSha"
        ) in workflow
        assert "module-shim — remove after 2026-10-15" in workflow
