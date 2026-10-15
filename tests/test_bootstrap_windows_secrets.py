"""Principal-aware MCP workstation bootstrap contracts."""

from __future__ import annotations

import importlib.util
import os
import re
import shutil
import subprocess
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
        ("sp_mcp_chatgpt", "chatgpt-key"),
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
        "sp_mcp_chatgpt": "chatgpt-key",
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


def test_infra_principal_uses_only_its_dedicated_key() -> None:
    bootstrap = load_script()

    assert "sp_mcp_infra" in bootstrap.MCP_PRINCIPAL_IDS
    assert (
        bootstrap.select_mcp_key(
            "sp_mcp_infra",
            {"PLX_MC_MCP_API_KEY": "shared-key"},
            {"sp_mcp_infra": "infra-key"},
        )
        == "infra-key"
    )
    with pytest.raises(SystemExit, match="mcp principal key unavailable"):
        bootstrap.select_mcp_key(
            "sp_mcp_infra",
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


def test_github_loaders_do_not_shadow_gh_keyring_credentials() -> None:
    bootstrap = load_script()

    powershell = "\n".join(bootstrap.github_powershell_loader_lines("org-token"))
    shell = "\n".join(bootstrap.github_shell_loader_lines("org-token"))

    assert "$env:PETRALABX_GITHUB_TOKEN = 'org-token'" in powershell
    assert "Remove-Item Env:GITHUB_TOKEN" in powershell
    assert "Remove-Item Env:GH_TOKEN" in powershell
    assert "$env:GITHUB_TOKEN = 'org-token'" not in powershell
    assert "$env:GH_TOKEN = 'org-token'" not in powershell

    assert "export PETRALABX_GITHUB_TOKEN='org-token'" in shell
    assert "unset GITHUB_TOKEN GH_TOKEN" in shell
    assert "export GITHUB_TOKEN='org-token'" not in shell
    assert "export GH_TOKEN='org-token'" not in shell


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


# --- TASK-614: atomic, fail-closed hydration -------------------------------

FAKE_VALUES = {
    "MC_MCP_API_KEY": "fake-mcp-key",
    "MC_MCP_PRINCIPAL_ID": "sp_mcp_cursor",
    "MC_OPERATOR_EMAIL": "cos@example.test",
    "PLX_MC_MCP_ENABLED": "1",
    "PETRALABX_GITHUB_TOKEN": "fake-gh-token",
}
FAKE_GRAPH = '{"tenantId":"fake-tenant","clientId":"fake-client","clientSecret":"fake-graph-secret"}'


def generated_loader() -> str:
    bootstrap = load_script()
    return "\n".join(bootstrap.staging_loader_lines(FAKE_VALUES, "sp_mcp_cursor"))


def test_loader_template_has_no_warn_and_continue() -> None:
    bootstrap = load_script()
    text = generated_loader()
    code = "\n".join(
        line for line in text.splitlines() if not line.lstrip().startswith("#")
    )

    assert "Write-Warning" not in code
    assert "PlxSecretsLoaderStatus" in code
    assert "throw" in code
    # Every required name is validated; nothing is exported before validation.
    for name in bootstrap.LOADER_REQUIRED_ENV:
        assert f"'{name}'" in code
    assert code.index("throw") < code.index("Set-Item")
    assert "$env:" not in code.split("Set-Item")[0]


def test_loader_template_declares_optional_names_explicitly() -> None:
    bootstrap = load_script()
    assert set(bootstrap.LOADER_OPTIONAL_ENV) == {
        "PETRALABX_GITHUB_TOKEN",
        "SWARM_API_KEY",
    }
    assert not set(bootstrap.LOADER_OPTIONAL_ENV) & set(bootstrap.LOADER_REQUIRED_ENV)


def test_loader_template_rejects_undeclared_names() -> None:
    bootstrap = load_script()
    with pytest.raises(SystemExit, match="not declared"):
        bootstrap.staging_loader_lines({"SOME_NEW_KEY": "x"}, "sp_mcp_cursor")


PWSH = shutil.which("pwsh")
needs_pwsh = pytest.mark.skipif(PWSH is None, reason="pwsh not installed on this host")

PROBE = (
    "$ErrorActionPreference='Continue'; $threw='no'; "
    "try { . $env:TEST_LOADER } catch { $threw='yes'; $msg=$_.Exception.Message }; "
    "'threw=' + $threw; 'status=' + $global:PlxSecretsLoaderStatus; "
    "'missing=' + $global:PlxSecretsLoaderMissing; "
    "'msg=' + $msg; "
    "foreach ($n in 'MC_MCP_API_KEY','MICROSOFT_GRAPH_CLIENT_SECRET','AZURE_CLIENT_ID',"
    "'PETRALABX_GITHUB_TOKEN') { 'env:' + $n + '=' + [Environment]::GetEnvironmentVariable($n) }"
)


def run_loader(tmp_path: Path, aws_body: str) -> dict[str, str]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    aws = bin_dir / "aws"
    aws.write_text("#!/bin/sh\n" + aws_body + "\n", encoding="utf-8")
    aws.chmod(0o755)
    loader = tmp_path / "loader.ps1"
    loader.write_text(generated_loader(), encoding="utf-8")
    env = {
        "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
        "HOME": str(tmp_path),
        "TEST_LOADER": str(loader),
    }
    proc = subprocess.run(
        [PWSH, "-NoProfile", "-NonInteractive", "-Command", PROBE],
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
        check=True,
        cwd=tmp_path,
    )
    return dict(line.split("=", 1) for line in proc.stdout.splitlines() if "=" in line)


@needs_pwsh
def test_pwsh_loader_assigns_everything_when_fetch_succeeds(tmp_path: Path) -> None:
    out = run_loader(tmp_path, f"echo '{FAKE_GRAPH}'")
    assert out["threw"] == "no"
    assert out["status"] == "ok"
    assert out["env:MC_MCP_API_KEY"] == "fake-mcp-key"
    assert out["env:MICROSOFT_GRAPH_CLIENT_SECRET"] == "fake-graph-secret"
    assert out["env:AZURE_CLIENT_ID"] == "fake-client"


@needs_pwsh
def test_pwsh_loader_assigns_nothing_when_fetch_fails(tmp_path: Path) -> None:
    out = run_loader(tmp_path, "exit 1")
    assert out["threw"] == "yes"
    assert out["status"] == "failed"
    assert "MICROSOFT_GRAPH_CLIENT_SECRET" in out["missing"]
    # No partial environment: even the statically known values stay unset.
    assert out["env:MC_MCP_API_KEY"] == ""
    assert out["env:PETRALABX_GITHUB_TOKEN"] == ""
    assert out["env:AZURE_CLIENT_ID"] == ""
    # Names only, never values.
    assert "fake-" not in out["msg"]


@needs_pwsh
def test_pwsh_loader_assigns_nothing_when_payload_is_partial(tmp_path: Path) -> None:
    out = run_loader(tmp_path, """echo '{"tenantId":"fake-tenant","clientId":""}'""")
    assert out["threw"] == "yes"
    assert out["status"] == "failed"
    assert set(out["missing"].split(",")) >= {
        "MICROSOFT_GRAPH_CLIENT_ID",
        "MICROSOFT_GRAPH_CLIENT_SECRET",
    }
    assert out["env:MC_MCP_API_KEY"] == ""


def test_task_614_fixtures_hold_no_secret_looking_values() -> None:
    suspicious = re.compile(
        r"AKIA[0-9A-Z]{16}|['\"][A-Za-z0-9+/=]{32,}['\"]|ghp_\w+|-----" "BEGIN"
    )
    for name in (
        "test_bootstrap_windows_secrets.py",
        "test_run_plx_mc_mcp_launcher.py",
        "mcp-launch-partial-env.test.ts",
    ):
        text = (REPO_ROOT / "tests" / name).read_text(encoding="utf-8")
        # Ignore this test's own pattern line and import/path tokens.
        for line in text.splitlines():
            if "suspicious" in line:
                continue
            assert not suspicious.search(line), f"{name}: {line.strip()[:60]}"
