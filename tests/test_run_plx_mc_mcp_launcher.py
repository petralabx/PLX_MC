"""TASK-614: the MCP launcher fails closed on a missing or partial loader.

Uses fake loaders and a fake `npx` on PATH that records whether it ran. No real
loader, AWS call, or credential is touched.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
LAUNCHER = REPO_ROOT / "scripts" / "run-plx-mc-mcp.ps1"

PWSH = shutil.which("pwsh")
pytestmark = pytest.mark.skipif(PWSH is None, reason="pwsh not installed on this host")

OK_LOADER = """\
$env:MC_MCP_API_KEY = 'fake-mcp-key'
$global:PlxSecretsLoaderStatus = 'ok'
"""


def run_launcher(
    tmp_path: Path,
    loader_body: str | None,
    *,
    use_override: bool = True,
    home: str | None = None,
) -> tuple[subprocess.CompletedProcess[str], Path]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    sentinel = tmp_path / "npx-ran"
    npx = bin_dir / "npx"
    npx.write_text(f"#!/bin/sh\ntouch '{sentinel}'\n", encoding="utf-8")
    npx.chmod(0o755)
    env = {
        "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
        "HOME": home if home is not None else str(tmp_path),
    }
    if use_override:
        loader = tmp_path / "loader.ps1"
        if loader_body is not None:
            loader.write_text(loader_body, encoding="utf-8")
        env["PLX_SECRETS_LOADER"] = str(loader)
    proc = subprocess.run(
        [PWSH, "-NoProfile", "-NonInteractive", "-File", str(LAUNCHER)],
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
        cwd=tmp_path,
    )
    return proc, sentinel


def test_launcher_aborts_on_missing_loader(tmp_path: Path) -> None:
    proc, sentinel = run_launcher(tmp_path, None)
    assert proc.returncode != 0
    assert "secrets loader not found" in proc.stderr
    assert not sentinel.exists()


def test_launcher_aborts_on_missing_default_loader(tmp_path: Path) -> None:
    proc, sentinel = run_launcher(tmp_path, None, use_override=False)
    assert proc.returncode != 0
    assert ".secrets-env.staging.ps1" in proc.stderr
    assert not sentinel.exists()


def test_launcher_aborts_when_home_and_override_are_empty(tmp_path: Path) -> None:
    proc, sentinel = run_launcher(tmp_path, None, use_override=False, home="")
    assert proc.returncode != 0
    assert not sentinel.exists()


def test_launcher_aborts_on_failed_hydration(tmp_path: Path) -> None:
    body = (
        "$global:PlxSecretsLoaderStatus = 'failed'\n"
        "$global:PlxSecretsLoaderMissing = 'MICROSOFT_GRAPH_CLIENT_SECRET'\n"
        "throw 'PLX secrets loader failed'\n"
    )
    proc, sentinel = run_launcher(tmp_path, body)
    assert proc.returncode != 0
    assert "MICROSOFT_GRAPH_CLIENT_SECRET" in proc.stderr
    assert not sentinel.exists()


def test_launcher_aborts_on_partial_env_without_status_marker(tmp_path: Path) -> None:
    # A pre-TASK-614 loader: sets the key, never reports completion.
    proc, sentinel = run_launcher(tmp_path, "$env:MC_MCP_API_KEY = 'fake-mcp-key'\n")
    assert proc.returncode != 0
    assert "regenerate" in proc.stderr
    assert not sentinel.exists()


def test_launcher_aborts_when_required_env_is_empty(tmp_path: Path) -> None:
    body = "$env:MC_MCP_API_KEY = ''\n$global:PlxSecretsLoaderStatus = 'ok'\n"
    proc, sentinel = run_launcher(tmp_path, body)
    assert proc.returncode != 0
    assert "MC_MCP_API_KEY" in proc.stderr
    assert not sentinel.exists()


def test_launcher_never_echoes_values(tmp_path: Path) -> None:
    proc, _ = run_launcher(tmp_path, "$env:MC_MCP_API_KEY = 'fake-mcp-key'\n")
    assert "fake-mcp-key" not in proc.stderr + proc.stdout


def test_launcher_starts_node_after_complete_hydration(tmp_path: Path) -> None:
    proc, sentinel = run_launcher(tmp_path, OK_LOADER)
    assert proc.returncode == 0, proc.stderr
    assert sentinel.exists()
