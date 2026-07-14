"""Contract tests for the metadata-only GitHub routing workflow generator."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
GENERATOR = REPO_ROOT / "scripts" / "generate-routing-workflow.py"
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "mc-routing-metadata.yml"
MANIFEST = REPO_ROOT / "docs" / "templates" / "mc-routing-manifest.json"
REGISTRY = REPO_ROOT / "config" / "tracked-repos-registry.json"


def _run(
    *arguments: str, cwd: Path = REPO_ROOT, generator: Path = GENERATOR
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(generator), *arguments],
        cwd=cwd,
        capture_output=True,
        text=True,
        check=False,
    )


def test_generator_check_passes_for_committed_workflow():
    assert _run("--check").returncode == 0


def test_generator_check_rejects_workflow_drift(tmp_path):
    scripts = tmp_path / "scripts"
    workflows = tmp_path / ".github" / "workflows"
    scripts.mkdir()
    workflows.mkdir(parents=True)
    shutil.copy(GENERATOR, scripts)
    (workflows / WORKFLOW.name).write_text("hand edited\n", encoding="utf-8")

    result = _run("--check", cwd=tmp_path, generator=scripts / GENERATOR.name)

    assert result.returncode == 1
    assert "ROUTING WORKFLOW DRIFT" in result.stderr


def test_generator_emit_matches_committed_workflow():
    result = _run("--emit")

    assert result.returncode == 0
    assert result.stdout == WORKFLOW.read_text(encoding="utf-8")


def test_workflow_security_contract_is_metadata_only():
    workflow = WORKFLOW.read_text(encoding="utf-8")

    assert "pull_request:" in workflow
    assert "types: [opened, reopened, synchronize, closed]" in workflow
    assert "actions/github-script@v7" in workflow
    assert "github.rest.pulls.listFiles" in workflow
    assert 'core.getIDToken("plx-mc-routing-propose")' in workflow
    assert "/api/routing/propose" in workflow
    assert "id-token: write" in workflow
    for forbidden in (
        "actions/checkout",
        "pull_request_target",
        "run:",
        "npm ",
        "pip ",
        "git checkout",
        "restore-cache",
    ):
        assert forbidden not in workflow.lower()


def test_security_contract_rejects_checkout():
    spec = importlib.util.spec_from_file_location("routing_workflow", GENERATOR)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)

    with pytest.raises(ValueError, match="actions/checkout"):
        module.validate_security_contract("steps:\n  - uses: actions/checkout@v4\n")


def test_routing_manifest_metadata_matches_template_digest():
    # Digest is LF-normalized so Windows CRLF checkouts match Linux CI/git blobs.
    normalized_manifest = MANIFEST.read_bytes().replace(b"\r\n", b"\n")
    expected_digest = f"sha256:{hashlib.sha256(normalized_manifest).hexdigest()}"
    registry = json.loads(REGISTRY.read_text(encoding="utf-8"))

    assert registry["repos"]
    for repo in registry["repos"]:
        manifest = repo["routing_manifest"]
        assert manifest["path"] == ".github/plx-mc-routing-manifest.json"
        assert manifest["schema_version"] == "plx-mc-routing-manifest/v1"
        assert manifest["digest"] == expected_digest
