"""Principal-aware MCP workstation bootstrap contracts."""

from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path
from types import ModuleType

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = REPO_ROOT / "scripts" / "bootstrap-windows-secrets.py"
SERVER_PRINCIPALS = REPO_ROOT / "src" / "lib" / "permissions" / "types.ts"
CLIENT_SELECTOR = REPO_ROOT / "tools" / "plx-mc-mcp" / "lib" / "key-resolution.mjs"


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
        ("sp_mcp_grok", "grok-key"),
        ("sp_mcp_hermes", "hermes-key"),
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
        "sp_mcp_grok": "grok-key",
        "sp_mcp_hermes": "hermes-key",
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


def test_client_principal_registries_match_server_reviewed_ids() -> None:
    bootstrap = load_script()
    server_source = SERVER_PRINCIPALS.read_text(encoding="utf-8")
    registry_block = server_source.split(
        "export const MCP_AGENT_SERVICE_PRINCIPAL_IDS = [", 1
    )[1].split("] as const", 1)[0]
    server_ids = set(re.findall(r'"(sp_mcp_[a-z_]+)"', registry_block))
    selector_ids = set(
        re.findall(
            r'"(sp_mcp_[a-z_]+)"',
            CLIENT_SELECTOR.read_text(encoding="utf-8"),
        )
    )

    assert bootstrap.MCP_PRINCIPAL_IDS == server_ids
    assert selector_ids == server_ids
