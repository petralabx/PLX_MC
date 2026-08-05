"""Principal-aware MCP workstation bootstrap contracts."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = REPO_ROOT / "scripts" / "bootstrap-windows-secrets.py"


def load_script() -> ModuleType:
    spec = importlib.util.spec_from_file_location("bootstrap_windows_secrets", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_cursor_principal_uses_shared_compatibility_key() -> None:
    bootstrap = load_script()

    assert (
        bootstrap.select_mcp_key(
            "sp_mcp_cursor",
            {"PLX_MC_MCP_API_KEY": "shared-key"},
            {"sp_mcp_cursor": "registry-key"},
        )
        == "shared-key"
    )


@pytest.mark.parametrize(
    ("principal_id", "expected"),
    [
        ("sp_mcp_claude_code", "claude-key"),
        ("sp_mcp_codex", "codex-key"),
        ("sp_mcp_swarm", "swarm-key"),
    ],
)
def test_agent_principals_use_only_the_dedicated_registry(
    principal_id: str, expected: str
) -> None:
    bootstrap = load_script()
    registry = {
        "sp_mcp_claude_code": "claude-key",
        "sp_mcp_codex": "codex-key",
        "sp_mcp_swarm": "swarm-key",
    }

    assert (
        bootstrap.select_mcp_key(
            principal_id,
            {"PLX_MC_MCP_API_KEY": "shared-key"},
            registry,
        )
        == expected
    )


def test_missing_dedicated_key_fails_closed_without_shared_fallback() -> None:
    bootstrap = load_script()

    with pytest.raises(SystemExit, match="mcp principal key unavailable"):
        bootstrap.select_mcp_key(
            "sp_mcp_codex",
            {"PLX_MC_MCP_API_KEY": "shared-key"},
            {"sp_mcp_claude_code": "claude-key"},
        )


def test_unreviewed_principal_is_rejected() -> None:
    bootstrap = load_script()

    with pytest.raises(SystemExit, match="unsupported mcp principal id"):
        bootstrap.select_mcp_key(
            "sp_unreviewed",
            {"PLX_MC_MCP_API_KEY": "shared-key"},
            {},
        )


def test_dedicated_principals_use_separate_loader_files(tmp_path: Path) -> None:
    bootstrap = load_script()

    assert bootstrap.staging_output_path("sp_mcp_cursor", tmp_path) == (
        tmp_path / ".secrets-env.staging.ps1"
    )
    assert bootstrap.staging_output_path("sp_mcp_claude_code", tmp_path) == (
        tmp_path / ".secrets-env.staging.sp_mcp_claude_code.ps1"
    )
