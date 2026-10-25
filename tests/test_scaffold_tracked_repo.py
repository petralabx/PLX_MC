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


def _run_full(
    target: Path, *, repo: str, tier: str, branch: str, mode: str | None = None
):
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
            *([mode] if mode else []),
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


WORKFLOW_FILES = {
    ".github/workflows/mc-routing-metadata.yml",
    "scripts/compliance-pr-verify.mjs",
    "scripts/compliance-checkout.mjs",
}
HUB_FULL_FILES = WORKFLOW_FILES | ROUTING_FILES | {"docs/GOVERNANCE.md"}
ALL_SCAFFOLD_FILES = HUB_FULL_FILES | {"CONTRIBUTING.md"}


@pytest.mark.parametrize(
    ("mode", "expected"),
    [
        ("--routing-only", ROUTING_FILES),
        ("--workflows-only", WORKFLOW_FILES),
        (None, HUB_FULL_FILES),
    ],
    ids=["routing-only", "workflows-only", "full"],
)
@pytest.mark.parametrize("existing", [False, True], ids=["create", "overwrite"])
def test_hub_scaffold_exact_file_contract(
    tmp_path: Path, mode: str | None, expected: set[str], existing: bool
):
    # Existing output candidates and an unrelated file expose accidental writes
    # as well as the full hub's deliberate CONTRIBUTING skip.
    sentinels = ALL_SCAFFOLD_FILES | {"operator-notes.txt"} if existing else set()
    for relative in sentinels:
        path = tmp_path / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("operator-owned sentinel\n", encoding="utf-8")

    result = _run_full(
        tmp_path, repo="petralabx/PLX_MC", tier="hub", branch="main", mode=mode
    )

    assert result.returncode == 0, result.stderr
    assert _files(tmp_path) == expected | sentinels
    changed = {
        relative
        for relative in _files(tmp_path)
        if (tmp_path / relative).read_text(encoding="utf-8")
        != "operator-owned sentinel\n"
    }
    assert changed == expected
    if mode is None:
        assert "skip CONTRIBUTING scaffold" in result.stderr
        assert "Tier: `hub`" in (tmp_path / "docs/GOVERNANCE.md").read_text()
    if mode != "--workflows-only":
        assert json.loads((tmp_path / ".plx/mc-routing.json").read_text())["repo"] == (
            "petralabx/PLX_MC"
        )


@pytest.mark.parametrize(
    ("repo", "tier", "branch"),
    [
        ("petralabx/plx-customer-portal", "product_app", "staging"),
        ("petralabx/agentic-swarm", "product_platform", "main"),
        ("petralabx/skills", "skills", "main"),
        ("petralabx/local-inference", "tooling", "main"),
    ],
)
def test_full_non_hub_scaffold_exact_file_contract(
    tmp_path: Path, repo: str, tier: str, branch: str
):
    result = _run_full(tmp_path, repo=repo, tier=tier, branch=branch)

    assert result.returncode == 0, result.stderr
    assert _files(tmp_path) == ALL_SCAFFOLD_FILES


@pytest.mark.parametrize(
    "mode", [None, "--workflows-only"], ids=["full", "workflows-only"]
)
def test_sandbox_scaffold_current_file_contract(tmp_path: Path, mode: str | None):
    # The registered sandbox has no routing pilot: full mode fails after the
    # first three writes, whereas workflows-only returns successfully earlier.
    result = _run_full(
        tmp_path,
        repo="petralabx/test-perms-check",
        tier="sandbox",
        branch="main",
        mode=mode,
    )

    assert _files(tmp_path) == WORKFLOW_FILES
    if mode is None:
        assert result.returncode != 0
        assert "found 0" in result.stderr
    else:
        assert result.returncode == 0, result.stderr


def test_scaffold_help_describes_hub_and_restricted_modes():
    result = subprocess.run(
        [_bash(), SCAFFOLD.as_posix(), "--help"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    # Preserve the script's existing usage exit status; only text changes.
    assert result.returncode == 1
    assert "full hub scaffold is NOT a no-op" in result.stdout
    assert "Hub skips only CONTRIBUTING.md" in result.stdout
    assert "--routing-only:" in result.stdout
    assert "--workflows-only:" in result.stdout
    assert "scripts/compliance-checkout.mjs (3 files)" in result.stdout
