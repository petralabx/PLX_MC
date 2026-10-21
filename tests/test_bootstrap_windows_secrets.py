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


def test_cip_auto_undraft_principal_uses_only_its_dedicated_key() -> None:
    bootstrap = load_script()

    assert "sp_mcp_cip_auto_undraft" in bootstrap.MCP_PRINCIPAL_IDS
    assert (
        bootstrap.select_mcp_key(
            "sp_mcp_cip_auto_undraft",
            {"PLX_MC_MCP_API_KEY": "shared-key"},
            {"sp_mcp_cip_auto_undraft": "cip-key"},
        )
        == "cip-key"
    )
    with pytest.raises(SystemExit, match="mcp principal key unavailable"):
        bootstrap.select_mcp_key(
            "sp_mcp_cip_auto_undraft",
            {"PLX_MC_MCP_API_KEY": "shared-key"},
            {"sp_mcp_claude_code": "claude-key"},
        )


def test_workbench_intake_principal_uses_only_its_dedicated_key() -> None:
    bootstrap = load_script()

    assert "sp_mcp_workbench_intake" in bootstrap.MCP_PRINCIPAL_IDS
    assert (
        bootstrap.select_mcp_key(
            "sp_mcp_workbench_intake",
            {"PLX_MC_MCP_API_KEY": "shared-key"},
            {"sp_mcp_workbench_intake": "intake-key"},
        )
        == "intake-key"
    )
    with pytest.raises(SystemExit, match="mcp principal key unavailable"):
        bootstrap.select_mcp_key(
            "sp_mcp_workbench_intake",
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
    "PLX_GITHUB_APP_SLUG": "plx-agents-writer",
    "PLX_GITHUB_APP_ID": "42",
    "PLX_GITHUB_APP_INSTALLATION_ID": "7",
    "PLX_GITHUB_APP_PRIVATE_KEY_SECRET_ID": "plx/github/apps/plx-agents-writer/private-key",
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
    assert set(bootstrap.LOADER_OPTIONAL_ENV) == {"SWARM_API_KEY"}
    assert set(bootstrap.LOADER_LEGACY_PAT_ENV) == {"PETRALABX_GITHUB_TOKEN"}
    assert not set(bootstrap.LOADER_OPTIONAL_ENV) & set(bootstrap.LOADER_REQUIRED_ENV)
    required, optional = bootstrap.loader_contract("app")
    assert "PETRALABX_GITHUB_TOKEN" not in required + optional
    assert "PLX_GITHUB_APP_PRIVATE_KEY_SECRET_ID" in required
    legacy_required, legacy_optional = bootstrap.loader_contract("legacy-personal-pat")
    assert "PETRALABX_GITHUB_TOKEN" in legacy_optional
    assert "PLX_GITHUB_APP_ID" not in legacy_required


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
    "'PETRALABX_GITHUB_TOKEN','PLX_GITHUB_APP_ID') { "
    "'env:' + $n + '=' + [Environment]::GetEnvironmentVariable($n) }"
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
    assert out["env:PLX_GITHUB_APP_ID"] == "42"
    assert out["env:PETRALABX_GITHUB_TOKEN"] == ""


@needs_pwsh
def test_pwsh_loader_assigns_nothing_when_fetch_fails(tmp_path: Path) -> None:
    out = run_loader(tmp_path, "exit 1")
    assert out["threw"] == "yes"
    assert out["status"] == "failed"
    assert "MICROSOFT_GRAPH_CLIENT_SECRET" in out["missing"]
    # No partial environment: even the statically known values stay unset.
    assert out["env:MC_MCP_API_KEY"] == ""
    assert out["env:PETRALABX_GITHUB_TOKEN"] == ""
    assert out["env:PLX_GITHUB_APP_ID"] == ""
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


# --- GitHub App coding-box auth (personal PATs stay behind a flag) ---------

SENTINEL_PAT = "personal-pat-sentinel"
APP_CONFIG = {"appId": "42", "installationId": "7"}
APP_PEM = "BEGIN PRIVATE KEY"


def _binding(bootstrap: ModuleType) -> dict[str, str]:
    return bootstrap.parse_github_app_config("plx-agents-writer", APP_CONFIG, APP_PEM)


def _pat_secret() -> dict[str, str]:
    return {
        "PETRALABX_GITHUB_TOKEN": SENTINEL_PAT,
        "PETRALABX_GITHUB": "alias-pat",
        "PLX_GITHUB_PAT": "plx-pat",
        "GITHUB_TOKEN": "legacy-pat",
    }


def test_app_mode_drops_every_personal_pat() -> None:
    bootstrap = load_script()
    binding = _binding(bootstrap)
    values = bootstrap.github_auth_values(_pat_secret(), mode="app", binding=binding)
    blob = "\n".join(values.values())
    assert SENTINEL_PAT not in blob
    assert "alias-pat" not in blob
    assert "plx-pat" not in blob
    assert "legacy-pat" not in blob
    assert "PRIVATE KEY" not in blob
    assert values["PLX_GITHUB_APP_PRIVATE_KEY_SECRET_ID"].endswith("/private-key")


def test_app_mode_loader_rejects_a_personal_pat_value() -> None:
    bootstrap = load_script()
    values = dict(FAKE_VALUES)
    values["PETRALABX_GITHUB_TOKEN"] = SENTINEL_PAT
    with pytest.raises(SystemExit, match="not declared"):
        bootstrap.staging_loader_lines(values, "sp_mcp_cursor", "app")


def test_app_shell_fragment_references_the_key_and_clears_pats() -> None:
    bootstrap = load_script()
    text = "\n".join(bootstrap.github_app_shell_loader_lines(_binding(bootstrap)))
    assert "export PETRALABX_GITHUB_TOKEN" not in text
    assert (
        "unset PETRALABX_GITHUB_TOKEN PETRALABX_GITHUB PLX_GITHUB_PAT GITHUB_TOKEN GH_TOKEN"
        in text
    )
    assert "plx/github/apps/plx-agents-writer/private-key" in text
    assert "git-credential" in text
    assert "CIP owns merges" in text
    assert SENTINEL_PAT not in text
    assert "PRIVATE KEY" not in text


def test_legacy_pat_precedence_and_flag() -> None:
    bootstrap = load_script()
    assert bootstrap.personal_pat_from_secret(_pat_secret()) == SENTINEL_PAT
    assert (
        bootstrap.personal_pat_from_secret({"PETRALABX_GITHUB": "alias-pat"})
        == "alias-pat"
    )
    assert (
        bootstrap.personal_pat_from_secret(
            {"PLX_GITHUB_PAT": "plx-pat", "GITHUB_TOKEN": "legacy-pat"}
        )
        == "plx-pat"
    )
    assert (
        bootstrap.personal_pat_from_secret({"GITHUB_TOKEN": "legacy-pat"})
        == "legacy-pat"
    )
    legacy = bootstrap.github_auth_values(
        _pat_secret(), mode="legacy-personal-pat", binding=None
    )
    assert legacy == {"PETRALABX_GITHUB_TOKEN": SENTINEL_PAT}
    text = "\n".join(
        bootstrap.staging_loader_lines(
            {
                **{
                    k: v
                    for k, v in FAKE_VALUES.items()
                    if not k.startswith("PLX_GITHUB_APP")
                },
                **legacy,
            },
            "sp_mcp_cursor",
            "legacy-personal-pat",
        )
    )
    assert SENTINEL_PAT in text
    assert "PLX_GITHUB_APP_ID" not in text


def test_slug_rejects_path_traversal_and_defaults_to_writer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bootstrap = load_script()
    with pytest.raises(SystemExit, match="invalid github app slug"):
        bootstrap.github_app_secret_ids("../prod/ec2-secrets")
    config_id, key_id = bootstrap.github_app_secret_ids("cursor-cloud")
    assert config_id == "plx/github/apps/cursor-cloud/config"
    assert key_id == "plx/github/apps/cursor-cloud/private-key"
    monkeypatch.delenv("PLX_GITHUB_APP_SLUG", raising=False)
    assert bootstrap.resolve_github_app_slug(None) == "plx-agents-writer"
    assert bootstrap.resolve_github_app_slug("cursor-cloud") == "cursor-cloud"
    monkeypatch.setenv("PLX_GITHUB_APP_SLUG", "codex-bot")
    assert bootstrap.resolve_github_app_slug(None) == "codex-bot"


def test_legacy_env_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    bootstrap = load_script()
    monkeypatch.delenv("PLX_BOOTSTRAP_LEGACY_GITHUB_PAT", raising=False)
    assert bootstrap.legacy_personal_pat_from_env() is False
    monkeypatch.setenv("PLX_BOOTSTRAP_LEGACY_GITHUB_PAT", "1")
    assert bootstrap.legacy_personal_pat_from_env() is True
    monkeypatch.setenv("PLX_BOOTSTRAP_LEGACY_GITHUB_PAT", "0")
    assert bootstrap.legacy_personal_pat_from_env() is False


def test_config_requires_numeric_ids_and_a_pem() -> None:
    bootstrap = load_script()
    with pytest.raises(SystemExit, match="numeric"):
        bootstrap.parse_github_app_config(
            "plx-agents-writer", {"appId": "abc", "installationId": "1"}, APP_PEM
        )
    with pytest.raises(SystemExit, match="PEM"):
        bootstrap.parse_github_app_config(
            "plx-agents-writer", {"appId": "1", "installationId": "2"}, "not-a-key"
        )
    binding = bootstrap.parse_github_app_config(
        "plx-agents-writer", {"app_id": "1", "installation_id": "2"}, APP_PEM
    )
    assert binding["PLX_GITHUB_APP_ID"] == "1"
    assert "PRIVATE KEY" not in "".join(binding.values())


def test_missing_app_secret_names_the_legacy_flag() -> None:
    from botocore.exceptions import ClientError

    bootstrap = load_script()

    class Missing:
        def get_secret_value(self, SecretId: str) -> dict:
            raise ClientError(
                {"Error": {"Code": "ResourceNotFoundException"}},
                "GetSecretValue",
            )

    with pytest.raises(SystemExit, match="legacy-personal-pat") as exc:
        bootstrap.load_github_app_binding(Missing(), "plx-agents-writer")
    assert "PRIVATE KEY" not in str(exc.value)
    assert SENTINEL_PAT not in str(exc.value)


def test_load_binding_keeps_the_pem_out_of_the_result() -> None:
    bootstrap = load_script()

    class Fake:
        def get_secret_value(self, SecretId: str) -> dict:
            if SecretId.endswith("/config"):
                return {"SecretString": '{"appId":"12","installationId":"34"}'}
            if SecretId.endswith("/private-key"):
                return {"SecretString": APP_PEM}
            raise AssertionError(SecretId)

    binding = bootstrap.load_github_app_binding(Fake(), "plx-agents-writer")
    assert binding["PLX_GITHUB_APP_ID"] == "12"
    assert binding["PLX_GITHUB_APP_INSTALLATION_ID"] == "34"
    assert "PRIVATE KEY" not in "".join(binding.values())


def test_generated_wrapper_is_removed_in_legacy_mode_only(tmp_path: Path) -> None:
    bootstrap = load_script()
    bootstrap.write_github_app_commands(
        tmp_path, "/usr/bin/python3", "/repo/scripts/github-app-auth.py"
    )
    wrapper = tmp_path / ".local" / "bin" / "gh"
    launcher = tmp_path / ".local" / "bin" / "plx-github-app-auth"
    assert "plx-github-app-auth" in wrapper.read_text(encoding="utf-8")
    assert "github-app-auth.py" in launcher.read_text(encoding="utf-8")
    assert "PRIVATE KEY" not in launcher.read_text(encoding="utf-8")
    bootstrap.remove_generated_gh_wrapper(tmp_path)
    assert not wrapper.exists()
    assert not (tmp_path / ".local" / "bin" / "plx-github-app-auth").exists()

    unrelated = tmp_path / ".local" / "bin" / "gh"
    unrelated.parent.mkdir(parents=True, exist_ok=True)
    unrelated.write_text('#!/bin/sh\nexec /usr/bin/gh "$@"\n', encoding="utf-8")
    bootstrap.remove_generated_gh_wrapper(tmp_path)
    assert unrelated.exists()
