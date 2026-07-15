"""Focused contracts for tracked-repo routing scaffolding."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
SCAFFOLD = REPO_ROOT / "scripts" / "scaffold-tracked-repo.sh"
ROUTING_FILES = {
    ".github/workflows/mc-routing-metadata.yml",
    ".github/plx-mc-routing-manifest.json",
    ".plx/mc-routing.json",
}


def _bash() -> str:
    git_bash = Path(r"C:\Program Files\Git\bin\bash.exe")
    if git_bash.exists():
        return str(git_bash)
    executable = shutil.which("bash")
    if not executable:
        pytest.skip("bash is required for scaffold contracts")
    return executable


def _run(target: Path, *, repo: str, tier: str, branch: str):
    return subprocess.run(
        [
            _bash(),
            SCAFFOLD.as_posix(),
            "--repo",
            repo,
            "--tier",
            tier,
            "--branch",
            branch,
            "--target",
            target.as_posix(),
            "--routing-only",
        ],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


def _run_full(target: Path, *, repo: str, tier: str, branch: str):
    return subprocess.run(
        [
            _bash(),
            SCAFFOLD.as_posix(),
            "--repo",
            repo,
            "--tier",
            tier,
            "--branch",
            branch,
            "--target",
            target.as_posix(),
        ],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


def _files(target: Path) -> set[str]:
    return {
        path.relative_to(target).as_posix()
        for path in target.rglob("*")
        if path.is_file()
    }


def test_routing_only_emits_exact_routing_files(tmp_path: Path):
    result = _run(
        tmp_path,
        repo="petralabx/agentic-swarm",
        tier="product_platform",
        branch="main",
    )

    assert result.returncode == 0, result.stderr
    assert _files(tmp_path) == ROUTING_FILES
    assert json.loads((tmp_path / ".plx/mc-routing.json").read_text()) == {
        "schema_version": "plx-mc-routing-local/v1",
        "repo": "petralabx/agentic-swarm",
        "policy_version": "routing.v1",
        "fuzzy_auto_link_enabled": False,
        "default_bucket": "BKT-INFRA",
        "path_rules": [],
        "note": "Path rules are non-authoritative and are not consumed by the current central runtime.",
    }


@pytest.mark.parametrize(
    ("tier", "branch", "message"),
    [
        ("tooling", "main", "tier mismatch"),
        ("product_platform", "staging", "branch mismatch"),
    ],
)
def test_routing_only_rejects_registry_mismatch(
    tmp_path: Path, tier: str, branch: str, message: str
):
    result = _run(
        tmp_path,
        repo="petralabx/agentic-swarm",
        tier=tier,
        branch=branch,
    )

    assert result.returncode != 0
    assert message in result.stderr
    assert _files(tmp_path) == set()


def test_routing_only_rejects_sandbox(tmp_path: Path):
    result = _run(
        tmp_path,
        repo="petralabx/test-perms-check",
        tier="sandbox",
        branch="main",
    )

    assert result.returncode != 0
    assert "active non-sandbox" in result.stderr
    assert _files(tmp_path) == set()


def test_routing_only_is_idempotent(tmp_path: Path):
    first = _run(
        tmp_path,
        repo="petralabx/skills",
        tier="skills",
        branch="main",
    )
    before = {
        relative: (tmp_path / relative).read_bytes() for relative in ROUTING_FILES
    }
    second = _run(
        tmp_path,
        repo="petralabx/skills",
        tier="skills",
        branch="main",
    )

    assert first.returncode == second.returncode == 0
    assert {
        relative: (tmp_path / relative).read_bytes() for relative in ROUTING_FILES
    } == before


def test_routing_only_does_not_overwrite_governance_files(tmp_path: Path):
    sentinels = {
        "CONTRIBUTING.md": "keep contributing\n",
        "docs/GOVERNANCE.md": "keep governance\n",
        ".github/workflows/plx-mc-compliance.yml": "keep compliance\n",
        ".github/workflows/compliance-gate-drift.yml": "keep drift\n",
    }
    for relative, content in sentinels.items():
        path = tmp_path / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    result = _run(
        tmp_path,
        repo="petralabx/local-inference",
        tier="tooling",
        branch="main",
    )

    assert result.returncode == 0, result.stderr
    for relative, content in sentinels.items():
        assert (tmp_path / relative).read_text(encoding="utf-8") == content


def test_full_scaffold_also_emits_local_routing_manifest(tmp_path: Path):
    result = _run_full(
        tmp_path,
        repo="petralabx/skills",
        tier="skills",
        branch="main",
    )

    assert result.returncode == 0, result.stderr
    local_manifest = json.loads((tmp_path / ".plx/mc-routing.json").read_text())
    assert local_manifest["repo"] == "petralabx/skills"
    assert local_manifest["default_bucket"] == "BKT-INFRA"
    assert local_manifest["path_rules"] == []
