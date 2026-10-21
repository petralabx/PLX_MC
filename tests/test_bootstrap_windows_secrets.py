"""Principal-aware MCP workstation bootstrap contracts."""

from __future__ import annotations

import importlib.util
import json
import os
import re
import shutil
import stat
import subprocess
import sys
from pathlib import Path
from types import ModuleType

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = REPO_ROOT / "scripts" / "bootstrap-windows-secrets.py"
SERVER_PRINCIPALS = REPO_ROOT / "src" / "lib" / "permissions" / "types.ts"
CLIENT_SELECTOR = REPO_ROOT / "tools" / "plx-mc-mcp" / "lib" / "key-resolution.mjs"


def _posix_mode(path: Path) -> int:
    if os.name == "nt":
        pytest.skip("Unix file mode is not meaningful on Windows")
    return stat.S_IMODE(path.stat().st_mode)


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
        "unset PETRALABX_GITHUB_TOKEN PETRALABX_GITHUB PLX_GITHUB_PAT GITHUB_TOKEN GH_TOKEN GH_ENTERPRISE_TOKEN"
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


def _executable(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")
    path.chmod(0o755)


def _failing_minter() -> str:
    return "#!/bin/sh\nexit 1\n"


def _token_minter() -> str:
    return "#!/bin/sh\nprintf '%s' 'ghs_from_app'\nexit 0\n"


def _recording_gh(record: Path) -> str:
    return (
        "#!/bin/sh\n"
        f"printf '%s\\n' \"GH_TOKEN=${{GH_TOKEN-}}\" "
        f'"GITHUB_TOKEN=${{GITHUB_TOKEN-unset}}" '
        f'"GH_ENTERPRISE_TOKEN=${{GH_ENTERPRISE_TOKEN-unset}}" '
        f'"GH_CONFIG_DIR=${{GH_CONFIG_DIR-}}" > {sh_quote_path(record)}\n'
        "exit 0\n"
    )


def sh_quote_path(path: Path) -> str:
    return "'" + str(path).replace("'", "'\"'\"'") + "'"


def _posix_gh_env(home: Path, real_dir: Path) -> dict[str, str]:
    env = os.environ.copy()
    env["HOME"] = str(home)
    # real gh is first. /bin and /usr/bin supply env and tr. The system gh
    # lives elsewhere and must stay off this PATH.
    env["PATH"] = os.pathsep.join([str(real_dir), "/usr/bin", "/bin"])
    env["GH_TOKEN"] = "ambient-gh"
    env["GITHUB_TOKEN"] = "ambient-github"
    env["GH_ENTERPRISE_TOKEN"] = "ambient-enterprise"
    env.pop("PLX_BOOTSTRAP_LEGACY_GITHUB_PAT", None)
    env["GIT_CONFIG_GLOBAL"] = str(home / "isolated.gitconfig")
    env["GIT_CONFIG_NOSYSTEM"] = "1"
    return env


def test_unix_fragment_mint_failure_does_not_call_gh(tmp_path: Path) -> None:
    """A failed App mint must not exec the real gh (ambient keyring or PATs)."""
    bootstrap = load_script()
    home = tmp_path / "home"
    record = tmp_path / "gh-called"
    _executable(home / ".local" / "bin" / "plx-github-app-auth", _failing_minter())
    real_dir = tmp_path / "real"
    _executable(real_dir / "gh", _recording_gh(record))
    fragment = home / "fragment.sh"
    fragment.write_text(
        "\n".join(bootstrap.github_app_shell_loader_lines(_binding(bootstrap))),
        encoding="utf-8",
        newline="\n",
    )
    proc = subprocess.run(
        ["/bin/bash", "-c", f"source {sh_quote_path(fragment)} && gh auth status"],
        env=_posix_gh_env(home, real_dir),
        capture_output=True,
        text=True,
        check=False,
    )
    assert not record.exists()
    assert proc.returncode != 0
    assert "ambient" in proc.stderr.lower() or "mint" in proc.stderr.lower()


def test_unix_fragment_legacy_flag_may_call_gh_when_mint_fails(tmp_path: Path) -> None:
    bootstrap = load_script()
    home = tmp_path / "home"
    record = tmp_path / "gh-called"
    _executable(home / ".local" / "bin" / "plx-github-app-auth", _failing_minter())
    real_dir = tmp_path / "real"
    _executable(real_dir / "gh", _recording_gh(record))
    fragment = home / "fragment.sh"
    fragment.write_text(
        "\n".join(bootstrap.github_app_shell_loader_lines(_binding(bootstrap))),
        encoding="utf-8",
        newline="\n",
    )
    env = _posix_gh_env(home, real_dir)
    env["PLX_BOOTSTRAP_LEGACY_GITHUB_PAT"] = "1"
    proc = subprocess.run(
        ["/bin/bash", "-c", f"source {sh_quote_path(fragment)} && gh auth status"],
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0
    assert record.exists()
    text = record.read_text(encoding="utf-8")
    assert "plx-github-app" not in text


def test_unix_fragment_sets_isolated_gh_env_for_the_child(tmp_path: Path) -> None:
    bootstrap = load_script()
    home = tmp_path / "home"
    record = tmp_path / "gh-called"
    _executable(home / ".local" / "bin" / "plx-github-app-auth", _token_minter())
    real_dir = tmp_path / "real"
    _executable(real_dir / "gh", _recording_gh(record))
    fragment = home / "fragment.sh"
    fragment.write_text(
        "\n".join(bootstrap.github_app_shell_loader_lines(_binding(bootstrap))),
        encoding="utf-8",
        newline="\n",
    )
    proc = subprocess.run(
        ["/bin/bash", "-c", f"source {sh_quote_path(fragment)} && gh auth status"],
        env=_posix_gh_env(home, real_dir),
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr
    text = record.read_text(encoding="utf-8")
    assert "GH_TOKEN=ghs_from_app" in text
    assert "GITHUB_TOKEN=unset" in text
    assert "GH_ENTERPRISE_TOKEN=unset" in text
    assert f"GH_CONFIG_DIR={home / '.config' / 'plx-github-app' / 'gh'}" in text
    assert "ambient-enterprise" not in text
    assert "ambient-github" not in text


def _pwsh() -> str | None:
    return shutil.which("pwsh")


def test_powershell_mint_failure_does_not_call_gh(tmp_path: Path) -> None:
    pwsh = _pwsh()
    if pwsh is None:
        pytest.skip("pwsh is not installed")
    bootstrap = load_script()
    home = tmp_path / "home"
    record = tmp_path / "gh-called"
    minter = home / "mint-fail.sh"
    _executable(minter, _failing_minter())
    real_dir = tmp_path / "real"
    _executable(real_dir / "gh", _recording_gh(record))
    fragment = home / "fragment.ps1"
    fragment.write_text(
        "\n".join(
            bootstrap.github_app_powershell_loader_lines(
                _binding(bootstrap), str(minter), str(home / "github-app-auth.py")
            )
        ),
        encoding="utf-8",
        newline="\n",
    )
    env = _posix_gh_env(home, real_dir)
    proc = subprocess.run(
        [
            pwsh,
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            f". '{fragment}'; gh auth status; exit $LASTEXITCODE",
        ],
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert not record.exists()
    assert proc.returncode != 0
    combined = (proc.stderr + proc.stdout).lower()
    assert "ambient" in combined or "mint" in combined


def test_powershell_sets_isolated_gh_env_for_the_child(tmp_path: Path) -> None:
    pwsh = _pwsh()
    if pwsh is None:
        pytest.skip("pwsh is not installed")
    bootstrap = load_script()
    home = tmp_path / "home"
    record = tmp_path / "gh-called"
    minter = home / "mint-ok.sh"
    _executable(minter, _token_minter())
    real_dir = tmp_path / "real"
    _executable(real_dir / "gh", _recording_gh(record))
    fragment = home / "fragment.ps1"
    fragment.write_text(
        "\n".join(
            bootstrap.github_app_powershell_loader_lines(
                _binding(bootstrap), str(minter), str(home / "github-app-auth.py")
            )
        ),
        encoding="utf-8",
        newline="\n",
    )
    proc = subprocess.run(
        [
            pwsh,
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            f". '{fragment}'; gh auth status; exit $LASTEXITCODE",
        ],
        env=_posix_gh_env(home, real_dir),
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr + proc.stdout
    text = record.read_text(encoding="utf-8")
    assert "GH_TOKEN=ghs_from_app" in text
    assert "GITHUB_TOKEN=unset" in text
    assert "GH_ENTERPRISE_TOKEN=unset" in text
    assert f"GH_CONFIG_DIR={home / '.config' / 'plx-github-app' / 'gh'}" in text


def test_powershell_empty_helper_reset_survives_legacy_quoting(tmp_path: Path) -> None:
    """PowerShell 5.1 drops a native '' argument. The empty helper reset must remain."""
    pwsh = _pwsh()
    if pwsh is None:
        pytest.skip("pwsh is not installed")
    bootstrap = load_script()
    home = tmp_path / "home"
    home.mkdir()
    cfg = tmp_path / "gitconfig"
    fragment = home / "fragment.ps1"
    fragment.write_text(
        "\n".join(
            bootstrap.github_app_powershell_loader_lines(
                _binding(bootstrap),
                "/usr/bin/python3",
                "/repo/scripts/github-app-auth.py",
            )
        ),
        encoding="utf-8",
        newline="\n",
    )
    env = os.environ.copy()
    env["HOME"] = str(home)
    env["GIT_CONFIG_GLOBAL"] = str(cfg)
    env["GIT_CONFIG_NOSYSTEM"] = "1"
    proc = subprocess.run(
        [
            pwsh,
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$PSNativeCommandArgumentPassing = 'Legacy'; "
            f". '{fragment}'; exit $LASTEXITCODE",
        ],
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr + proc.stdout
    listed = subprocess.run(
        [
            "git",
            "config",
            "--file",
            str(cfg),
            "--get-all",
            "credential.https://github.com.helper",
        ],
        capture_output=True,
        text=True,
        check=False,
        env=env,
    )
    assert listed.returncode == 0, listed.stderr
    values = listed.stdout.splitlines()
    assert values[0] == ""
    assert "git-credential" in values[1]
    assert len(values) == 2


def test_config_rejects_json_that_only_mentions_a_private_key() -> None:
    """A JSON blob can contain the letters PRIVATE KEY and still not be a PEM."""
    bootstrap = load_script()
    blob = json.dumps({"note": "BEGIN PRIVATE KEY", "slug": "plx-agents-writer"})
    with pytest.raises(SystemExit, match="PEM") as exc:
        bootstrap.parse_github_app_config("plx-agents-writer", APP_CONFIG, blob)
    assert "PRIVATE KEY" not in str(exc.value)


def test_config_accepts_a_json_wrapped_pem_and_drops_it() -> None:
    bootstrap = load_script()
    blob = json.dumps(
        {
            "private_key": APP_PEM,
            "webhook_secret": "webhook-sentinel",
            "app_id": "1",
        }
    )
    binding = bootstrap.parse_github_app_config("plx-agents-writer", APP_CONFIG, blob)
    joined = "".join(binding.values())
    assert binding["PLX_GITHUB_APP_ID"] == "42"
    assert "PRIVATE KEY" not in joined
    assert "webhook-sentinel" not in joined


def test_config_rejects_invalid_json_private_key_secret() -> None:
    bootstrap = load_script()
    with pytest.raises(SystemExit, match="not valid JSON") as exc:
        bootstrap.parse_github_app_config(
            "plx-agents-writer", APP_CONFIG, "{not-json PRIVATE KEY"
        )
    assert "not-json" not in str(exc.value)


def test_aws_profile_is_persisted_only_when_bootstrap_saw_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    bootstrap = load_script()
    binding = _binding(bootstrap)
    monkeypatch.delenv("AWS_PROFILE", raising=False)
    shell = "\n".join(bootstrap.github_app_shell_loader_lines(binding))
    ps = "\n".join(
        bootstrap.github_app_powershell_loader_lines(binding, "python", "auth.py")
    )
    bootstrap.write_github_app_commands(tmp_path, "python", "auth.py")
    launcher = (tmp_path / ".local" / "bin" / "plx-github-app-auth").read_text(
        encoding="utf-8"
    )
    assert "AWS_PROFILE" not in shell
    assert "AWS_PROFILE" not in ps
    assert "AWS_PROFILE" not in launcher

    monkeypatch.setenv("AWS_PROFILE", "plx-prod")
    shell = "\n".join(bootstrap.github_app_shell_loader_lines(binding))
    ps = "\n".join(
        bootstrap.github_app_powershell_loader_lines(binding, "python", "auth.py")
    )
    bootstrap.write_github_app_commands(tmp_path, "python", "auth.py")
    launcher = (tmp_path / ".local" / "bin" / "plx-github-app-auth").read_text(
        encoding="utf-8"
    )
    assert "export AWS_PROFILE='plx-prod'" in shell
    assert "$env:AWS_PROFILE = 'plx-prod'" in ps
    assert "export AWS_PROFILE='plx-prod'" in launcher


class _RecordingSecrets:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def get_secret_value(self, SecretId: str) -> dict:
        self.calls.append(SecretId)
        if SecretId == "prod/ec2-secrets":
            return {
                "SecretString": json.dumps(
                    {
                        "PLX_MC_MCP_API_KEY": "shared-mcp-key",
                        "SWARM_API_KEY": "swarm-key",
                        "PETRALABX_GITHUB_TOKEN": SENTINEL_PAT,
                    }
                )
            }
        if SecretId == "plx/prod/mc/mcp-agent-keys/v1":
            return {
                "SecretString": json.dumps(
                    {"sp_mcp_codex": "codex-mcp-key", "sp_mcp_grok": "grok-mcp-key"}
                )
            }
        if SecretId == "plx/prod/m365/cursor-graph/v1":
            return {
                "SecretString": json.dumps(
                    {
                        "tenantId": "tenant",
                        "clientId": "client",
                        "clientSecret": "secret",
                    }
                )
            }
        if SecretId.endswith("/config"):
            return {"SecretString": json.dumps({"appId": "42", "installationId": "7"})}
        if SecretId.endswith("/private-key"):
            return {"SecretString": APP_PEM}
        if SecretId == "plx/coding/compat-small":
            return {
                "SecretString": json.dumps(
                    {
                        "PLX_MC_MCP_API_KEY": "small-mcp-key",
                        "SWARM_API_KEY": "small-swarm",
                    }
                )
            }
        if SecretId == "plx/coding/legacy-compat":
            return {
                "SecretString": json.dumps(
                    {
                        "PETRALABX_GITHUB_TOKEN": SENTINEL_PAT,
                        "PLX_MC_MCP_API_KEY": "legacy-compat-mcp",
                        "SWARM_API_KEY": "legacy-swarm",
                    }
                )
            }
        if SecretId == "plx/coding/lane-override":
            return {"SecretString": "raw-override-mcp-key"}
        if SecretId.startswith("plx/prod/mc/lane-") and SecretId.endswith("-key/v1"):
            lane = SecretId[len("plx/prod/mc/lane-") : -len("-key/v1")]
            return {"SecretString": json.dumps({"api_key": f"lane-{lane}-mcp-key"})}
        raise AssertionError(SecretId)


def _run_bootstrap_main(
    bootstrap: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
    home: Path,
    argv: list[str],
    extra_env: dict[str, str] | None = None,
) -> _RecordingSecrets:
    monkeypatch.delenv("PLX_BOOTSTRAP_LEGACY_GITHUB_PAT", raising=False)
    monkeypatch.delenv("PLX_BOOTSTRAP_COMPAT_SECRET_ID", raising=False)
    monkeypatch.delenv("AWS_PROFILE", raising=False)
    for key, value in (extra_env or {}).items():
        monkeypatch.setenv(key, value)
    home.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(bootstrap, "HOME", home)
    monkeypatch.setattr(
        bootstrap, "OUTPUT_GITHUB_PS1", home / ".secrets-env.github.ps1"
    )
    monkeypatch.setattr(bootstrap, "OUTPUT_GITHUB_SH", home / ".secrets-env.github")
    monkeypatch.setattr(
        bootstrap,
        "staging_output_path",
        lambda principal_id, home_path=None: home / f"staging-{principal_id}.ps1",
    )
    monkeypatch.setattr(
        bootstrap,
        "staging_shell_output_path",
        lambda principal_id, home_path=None: home / f"staging-{principal_id}.sh",
    )
    client = _RecordingSecrets()
    monkeypatch.setattr(bootstrap.boto3, "client", lambda *_a, **_k: client)
    monkeypatch.setattr(sys, "argv", ["bootstrap-windows-secrets.py", *argv])
    bootstrap.main()
    return client


def test_app_mode_non_default_principal_never_reads_ec2_secrets(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    bootstrap = load_script()
    client = _run_bootstrap_main(
        bootstrap,
        monkeypatch,
        tmp_path / "home",
        ["--mcp-principal-id", "sp_mcp_codex"],
    )
    assert bootstrap.EC2_SECRETS_ID not in client.calls
    assert bootstrap.MCP_AGENT_KEYS_SECRET_ID not in client.calls
    assert "plx/prod/mc/lane-codex-key/v1" in client.calls
    staging = (tmp_path / "home" / "staging-sp_mcp_codex.ps1").read_text(
        encoding="utf-8"
    )
    shell = (tmp_path / "home" / "staging-sp_mcp_codex.sh").read_text(encoding="utf-8")
    assert "lane-codex-mcp-key" not in staging
    assert "lane-codex-mcp-key" not in shell
    assert "codex-mcp-key" not in staging
    assert "get-secret-value" in staging
    assert "plx/prod/mc/lane-codex-key/v1" in staging
    assert "plx/prod/mc/lane-codex-key/v1" in shell
    assert SENTINEL_PAT not in staging
    assert _posix_mode(tmp_path / "home" / "staging-sp_mcp_codex.ps1") == 0o600
    assert _posix_mode(tmp_path / "home" / "staging-sp_mcp_codex.sh") == 0o600


def test_app_mode_non_default_principal_ignores_compat_secret(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    bootstrap = load_script()
    client = _run_bootstrap_main(
        bootstrap,
        monkeypatch,
        tmp_path / "home",
        [
            "--mcp-principal-id",
            "sp_mcp_codex",
            "--compat-secret-id",
            "plx/coding/compat-small",
        ],
    )
    assert bootstrap.EC2_SECRETS_ID not in client.calls
    assert "plx/coding/compat-small" not in client.calls


def test_app_mode_default_principal_reads_ec2_secrets_unless_compat_id_is_set(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    bootstrap = load_script()
    client = _run_bootstrap_main(bootstrap, monkeypatch, tmp_path / "default", [])
    assert client.calls.count(bootstrap.EC2_SECRETS_ID) == 1

    client = _run_bootstrap_main(
        bootstrap,
        monkeypatch,
        tmp_path / "flag",
        ["--compat-secret-id", "plx/coding/compat-small"],
    )
    assert bootstrap.EC2_SECRETS_ID not in client.calls
    assert "plx/coding/compat-small" in client.calls
    staging = (tmp_path / "flag" / "staging-sp_mcp_cursor.ps1").read_text(
        encoding="utf-8"
    )
    assert "small-mcp-key" in staging
    assert "small-swarm" in staging
    assert _posix_mode(tmp_path / "flag" / "staging-sp_mcp_cursor.ps1") == 0o600

    client = _run_bootstrap_main(
        bootstrap,
        monkeypatch,
        tmp_path / "env",
        [],
        {"PLX_BOOTSTRAP_COMPAT_SECRET_ID": "plx/coding/compat-small"},
    )
    assert bootstrap.EC2_SECRETS_ID not in client.calls
    assert "plx/coding/compat-small" in client.calls


def test_legacy_mode_still_reads_ec2_secrets(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    bootstrap = load_script()
    client = _run_bootstrap_main(
        bootstrap,
        monkeypatch,
        tmp_path / "home",
        ["--legacy-personal-pat", "--mcp-principal-id", "sp_mcp_codex"],
    )
    assert bootstrap.EC2_SECRETS_ID in client.calls
    assert bootstrap.MCP_AGENT_KEYS_SECRET_ID in client.calls
    assert "plx/prod/mc/lane-codex-key/v1" not in client.calls
    staging = (tmp_path / "home" / "staging-sp_mcp_codex.ps1").read_text(
        encoding="utf-8"
    )
    assert SENTINEL_PAT in staging
    assert "codex-mcp-key" in staging
    assert _posix_mode(tmp_path / "home" / "staging-sp_mcp_codex.ps1") == 0o600


def test_legacy_mode_accepts_compat_secret_id(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    bootstrap = load_script()
    client = _run_bootstrap_main(
        bootstrap,
        monkeypatch,
        tmp_path / "home",
        [
            "--legacy-personal-pat",
            "--mcp-principal-id",
            "sp_mcp_codex",
            "--compat-secret-id",
            "plx/coding/legacy-compat",
        ],
    )
    assert bootstrap.EC2_SECRETS_ID not in client.calls
    assert "plx/coding/legacy-compat" in client.calls
    assert bootstrap.MCP_AGENT_KEYS_SECRET_ID in client.calls
    staging = (tmp_path / "home" / "staging-sp_mcp_codex.ps1").read_text(
        encoding="utf-8"
    )
    assert SENTINEL_PAT in staging


def test_shell_launchers_have_lf_endings_when_writes_translate_newlines(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Windows Python translates newline=None to CRLF. Shell launchers must not."""
    bootstrap = load_script()
    real_write = Path.write_text

    def translating(
        self: Path,
        data: str,
        encoding: str | None = None,
        errors: str | None = None,
        newline: str | None = None,
    ) -> int:
        if isinstance(data, str) and newline is None:
            data = data.replace("\n", "\r\n")
        return real_write(self, data, encoding=encoding, errors=errors, newline="")

    monkeypatch.setattr(Path, "write_text", translating)
    bootstrap.write_github_app_commands(
        tmp_path, "/usr/bin/python3", "/repo/scripts/github-app-auth.py"
    )
    for name in ("plx-github-app-auth", "gh"):
        blob = (tmp_path / ".local" / "bin" / name).read_bytes()
        assert b"\r" not in blob, name


# --- TASK-3581: per-principal lane secrets ---------------------------------


LANE_SECRET_CASES = (
    ("sp_mcp_claude_code", "plx/prod/mc/lane-claude-code-key/v1"),
    ("sp_mcp_codex", "plx/prod/mc/lane-codex-key/v1"),
    ("sp_mcp_chatgpt", "plx/prod/mc/lane-chatgpt-key/v1"),
    ("sp_mcp_grok", "plx/prod/mc/lane-grok-key/v1"),
    ("sp_mcp_hermes", "plx/prod/mc/lane-hermes-key/v1"),
    ("sp_mcp_swarm", "plx/prod/mc/lane-swarm-key/v1"),
    ("sp_mcp_agent_runner", "plx/prod/mc/lane-agent-runner-key/v1"),
    ("sp_mcp_portal", "plx/prod/mc/lane-portal-key/v1"),
    ("sp_mcp_ledger", "plx/prod/mc/lane-ledger-key/v1"),
    ("sp_mcp_cos", "plx/prod/mc/lane-cos-key/v1"),
    ("sp_mcp_workbench", "plx/prod/mc/lane-workbench-key/v1"),
    ("sp_mcp_infra", "plx/prod/mc/lane-infra-key/v1"),
    ("sp_mcp_cip_auto_undraft", "plx/prod/mc/lane-cip-auto-undraft-key/v1"),
    ("sp_mcp_workbench_intake", "plx/prod/mc/lane-workbench-intake-key/v1"),
)


@pytest.mark.parametrize(("principal_id", "secret_id"), LANE_SECRET_CASES)
def test_lane_secret_id_replaces_underscores(principal_id: str, secret_id: str) -> None:
    bootstrap = load_script()
    assert bootstrap.lane_key_secret_id(principal_id) == secret_id


def test_docs_list_every_lane_secret_and_forbid_the_bundle() -> None:
    bootstrap = load_script()
    readme = (REPO_ROOT / "docs/modules/mcp/README.md").read_text(encoding="utf-8")
    registration = (
        REPO_ROOT / "docs/runbooks/plx-mc-mcp-team-registration.md"
    ).read_text(encoding="utf-8")
    for _principal, secret_id in LANE_SECRET_CASES:
        assert secret_id in readme
        assert secret_id in registration
    for text in (readme, registration):
        assert bootstrap.MCP_AGENT_KEYS_SECRET_ID in text
        assert "must not" in text and "bundle" in text


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("raw-mcp-key", "raw-mcp-key"),
        ('  {"MC_MCP_API_KEY":"named-key","api_key":"alias-key"}  ', "named-key"),
        ('{"api_key":"alias-only"}', "alias-only"),
        ('"quoted-key"', "quoted-key"),
    ],
)
def test_parse_mcp_key_material_accepts_raw_or_json(raw: str, expected: str) -> None:
    bootstrap = load_script()
    assert (
        bootstrap.parse_mcp_key_material(raw, "plx/prod/mc/lane-codex-key/v1")
        == expected
    )


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "   ",
        "{not-json secret-echo-sentinel}",
        '{"other":"secret-echo-sentinel"}',
        '["secret-echo-sentinel"]',
        '{"MC_MCP_API_KEY":""}',
        '{"api_key":42}',
    ],
)
def test_parse_mcp_key_material_fails_closed_without_echoing(raw: str) -> None:
    bootstrap = load_script()
    with pytest.raises(SystemExit, match="invalid MCP key material") as exc:
        bootstrap.parse_mcp_key_material(raw, "plx/prod/mc/lane-codex-key/v1")
    assert "secret-echo-sentinel" not in str(exc.value)


def test_app_mode_refuses_the_bundle_as_an_override(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    bootstrap = load_script()
    with pytest.raises(SystemExit, match="agent-key bundle") as exc:
        _run_bootstrap_main(
            bootstrap,
            monkeypatch,
            tmp_path / "home",
            [
                "--mcp-principal-id",
                "sp_mcp_claude_code",
                "--mcp-key-secret-id",
                bootstrap.MCP_AGENT_KEYS_SECRET_ID,
            ],
        )
    assert "secret-echo-sentinel" not in str(exc.value)


def test_app_mode_override_reads_only_that_secret(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    bootstrap = load_script()
    client = _run_bootstrap_main(
        bootstrap,
        monkeypatch,
        tmp_path / "home",
        [
            "--mcp-principal-id",
            "sp_mcp_claude_code",
            "--mcp-key-secret-id",
            "plx/coding/lane-override",
        ],
    )
    assert bootstrap.MCP_AGENT_KEYS_SECRET_ID not in client.calls
    assert "plx/prod/mc/lane-claude-code-key/v1" not in client.calls
    assert "plx/coding/lane-override" in client.calls
    staging = (tmp_path / "home" / "staging-sp_mcp_claude_code.ps1").read_text(
        encoding="utf-8"
    )
    shell = (tmp_path / "home" / "staging-sp_mcp_claude_code.sh").read_text(
        encoding="utf-8"
    )
    assert "raw-override-mcp-key" not in staging
    assert "raw-override-mcp-key" not in shell
    assert "plx/coding/lane-override" in staging
    assert "plx/coding/lane-override" in shell


def test_app_mode_missing_lane_secret_fails_closed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from botocore.exceptions import ClientError

    bootstrap = load_script()

    class Denied(_RecordingSecrets):
        def get_secret_value(self, SecretId: str) -> dict:
            self.calls.append(SecretId)
            if SecretId.startswith("plx/prod/mc/lane-"):
                raise ClientError(
                    {
                        "Error": {
                            "Code": "AccessDeniedException",
                            "Message": "denied secret-echo-sentinel",
                        }
                    },
                    "GetSecretValue",
                )
            return super().get_secret_value(SecretId)

    client = Denied()
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setattr(bootstrap.boto3, "client", lambda *_a, **_k: client)
    monkeypatch.setattr(bootstrap, "HOME", home)
    monkeypatch.setattr(
        bootstrap, "OUTPUT_GITHUB_PS1", home / ".secrets-env.github.ps1"
    )
    monkeypatch.setattr(bootstrap, "OUTPUT_GITHUB_SH", home / ".secrets-env.github")
    monkeypatch.setattr(
        bootstrap,
        "staging_output_path",
        lambda principal_id, home_path=None: home / f"staging-{principal_id}.ps1",
    )
    monkeypatch.setattr(
        bootstrap,
        "staging_shell_output_path",
        lambda principal_id, home_path=None: home / f"staging-{principal_id}.sh",
    )
    monkeypatch.setattr(sys, "argv", ["bootstrap", "--mcp-principal-id", "sp_mcp_grok"])
    with pytest.raises(SystemExit, match="AccessDeniedException") as exc:
        bootstrap.main()
    message = str(exc.value)
    assert "secret-echo-sentinel" not in message
    assert bootstrap.MCP_AGENT_KEYS_SECRET_ID not in client.calls
    assert "Refusing to fall back" in message
    assert not (tmp_path / "home" / "staging-sp_mcp_grok.ps1").exists()


def test_app_mode_invalid_lane_payload_fails_closed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    bootstrap = load_script()

    class Bad(_RecordingSecrets):
        def get_secret_value(self, SecretId: str) -> dict:
            self.calls.append(SecretId)
            if SecretId.startswith("plx/prod/mc/lane-"):
                return {"SecretString": '{"note":"secret-echo-sentinel"}'}
            return super().get_secret_value(SecretId)

    client = Bad()
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setattr(bootstrap.boto3, "client", lambda *_a, **_k: client)
    monkeypatch.setattr(bootstrap, "HOME", home)
    monkeypatch.setattr(
        bootstrap, "OUTPUT_GITHUB_PS1", home / ".secrets-env.github.ps1"
    )
    monkeypatch.setattr(bootstrap, "OUTPUT_GITHUB_SH", home / ".secrets-env.github")
    monkeypatch.setattr(
        bootstrap,
        "staging_output_path",
        lambda principal_id, home_path=None: home / f"staging-{principal_id}.ps1",
    )
    monkeypatch.setattr(
        bootstrap,
        "staging_shell_output_path",
        lambda principal_id, home_path=None: home / f"staging-{principal_id}.sh",
    )
    monkeypatch.setattr(sys, "argv", ["bootstrap", "--mcp-principal-id", "sp_mcp_grok"])
    with pytest.raises(SystemExit, match="invalid MCP key material") as exc:
        bootstrap.main()
    assert "secret-echo-sentinel" not in str(exc.value)
    assert bootstrap.MCP_AGENT_KEYS_SECRET_ID not in client.calls


def test_legacy_denied_ec2_secret_names_compat_override(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from botocore.exceptions import ClientError

    bootstrap = load_script()

    class Denied(_RecordingSecrets):
        def get_secret_value(self, SecretId: str) -> dict:
            self.calls.append(SecretId)
            if SecretId == bootstrap.EC2_SECRETS_ID:
                raise ClientError(
                    {
                        "Error": {
                            "Code": "AccessDeniedException",
                            "Message": "secret-echo-sentinel",
                        }
                    },
                    "GetSecretValue",
                )
            return super().get_secret_value(SecretId)

    client = Denied()
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setattr(bootstrap.boto3, "client", lambda *_a, **_k: client)
    monkeypatch.setattr(bootstrap, "HOME", home)
    monkeypatch.setattr(
        bootstrap, "OUTPUT_GITHUB_PS1", home / ".secrets-env.github.ps1"
    )
    monkeypatch.setattr(bootstrap, "OUTPUT_GITHUB_SH", home / ".secrets-env.github")
    monkeypatch.setattr(
        bootstrap,
        "staging_output_path",
        lambda principal_id, home_path=None: home / f"staging-{principal_id}.ps1",
    )
    monkeypatch.setattr(
        bootstrap,
        "staging_shell_output_path",
        lambda principal_id, home_path=None: home / f"staging-{principal_id}.sh",
    )
    monkeypatch.setattr(sys, "argv", ["bootstrap", "--legacy-personal-pat"])
    with pytest.raises(SystemExit, match="AccessDeniedException") as exc:
        bootstrap.main()
    message = str(exc.value)
    assert "secret-echo-sentinel" not in message
    assert "--compat-secret-id" in message
    assert "prod/ec2-secrets" in message


def test_write_private_text_is_mode_0600_under_a_loose_umask(tmp_path: Path) -> None:
    bootstrap = load_script()
    target = tmp_path / "nested" / "loader.ps1"
    target.parent.mkdir()
    target.write_text("old\n", encoding="utf-8")
    target.chmod(0o644)
    previous = os.umask(0)
    try:
        bootstrap.write_private_text(target, "MC_MCP_API_KEY='kept-private'\n")
    finally:
        os.umask(previous)
    assert _posix_mode(target) == 0o600
    assert target.read_text(encoding="utf-8") == "MC_MCP_API_KEY='kept-private'\n"
    assert list(tmp_path.glob("nested/.loader.ps1.*.tmp")) == []


def test_unix_fragment_fetches_the_lane_key_in_memory(tmp_path: Path) -> None:
    bootstrap = load_script()
    secret_id = bootstrap.lane_key_secret_id("sp_mcp_claude_code")
    sentinel = "lane-claude-runtime-key"
    text = "\n".join(
        bootstrap.staging_shell_loader_lines(
            {
                "MC_MCP_PRINCIPAL_ID": "sp_mcp_claude_code",
                "MC_OPERATOR_EMAIL": "cos@example.test",
                "PLX_MC_MCP_ENABLED": "1",
                "PLX_GITHUB_APP_SLUG": "plx-agents-writer",
                "PLX_GITHUB_APP_ID": "42",
                "PLX_GITHUB_APP_INSTALLATION_ID": "7",
                "PLX_GITHUB_APP_PRIVATE_KEY_SECRET_ID": (
                    "plx/github/apps/plx-agents-writer/private-key"
                ),
            },
            "sp_mcp_claude_code",
            "app",
            mcp_key_secret_id=secret_id,
            python_exe=sys.executable,
        )
    )
    assert sentinel not in text
    assert bootstrap.MCP_AGENT_KEYS_SECRET_ID in text
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    aws = bin_dir / "aws"
    aws.write_text(
        f"#!/bin/sh\nprintf '%s\\n' '{json.dumps({'MC_MCP_API_KEY': sentinel})}'\n",
        encoding="utf-8",
    )
    aws.chmod(0o755)
    script = tmp_path / "loader.sh"
    script.write_text(text, encoding="utf-8")
    env = {**os.environ, "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}"}
    proc = subprocess.run(
        [
            "bash",
            "-c",
            'source "$1" && printf %s "$MC_MCP_API_KEY"',
            "bash",
            str(script),
        ],
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr
    assert proc.stdout == sentinel
    assert sentinel not in proc.stderr

    aws.write_text(
        "#!/bin/sh\necho secret-echo-sentinel >&2\nexit 1\n", encoding="utf-8"
    )
    aws.chmod(0o755)
    failed = subprocess.run(
        [
            "bash",
            "-c",
            'source "$1"; status=$?; printf %s "$MC_MCP_API_KEY"; exit $status',
            "bash",
            str(script),
        ],
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert failed.returncode != 0
    assert failed.stdout == ""
    assert "missing MC_MCP_API_KEY" in failed.stderr
    assert "secret-echo-sentinel" not in failed.stderr


def test_shell_parser_matches_parse_mcp_key_material() -> None:
    bootstrap = load_script()
    samples = [
        "raw-mcp-key",
        '{"MC_MCP_API_KEY":"named-key","api_key":"alias-key"}',
        '{"api_key":"alias-only"}',
        '"quoted-key"',
        "",
        "{not-json",
        '{"other":"nope"}',
    ]
    for raw in samples:
        try:
            expected = bootstrap.parse_mcp_key_material(raw, "secret/id")
            expect_code = 0
        except SystemExit:
            expected = ""
            expect_code = 1
        proc = subprocess.run(
            [sys.executable, "-c", bootstrap.MCP_KEY_PARSE_PROGRAM],
            input=raw,
            capture_output=True,
            text=True,
            check=False,
        )
        assert proc.returncode == expect_code
        assert proc.stdout == expected
        assert "nope" not in proc.stderr


@needs_pwsh
def test_pwsh_loader_fetches_lane_key_without_writing_it(tmp_path: Path) -> None:
    bootstrap = load_script()
    secret_id = bootstrap.lane_key_secret_id("sp_mcp_claude_code")
    sentinel = "lane-claude-pwsh-key"
    values = dict(FAKE_VALUES)
    values["MC_MCP_API_KEY"] = "embedded-key-must-not-appear"
    values["MC_MCP_PRINCIPAL_ID"] = "sp_mcp_claude_code"
    text = "\n".join(
        bootstrap.staging_loader_lines(
            values,
            "sp_mcp_claude_code",
            "app",
            mcp_key_secret_id=secret_id,
        )
    )
    assert sentinel not in text
    assert "embedded-key-must-not-appear" not in text
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    aws = bin_dir / "aws"
    aws.write_text(
        "#!/bin/sh\n"
        'case "$*" in\n'
        "  *cursor-graph*)\n"
        f"    printf '%s\\n' '{FAKE_GRAPH}'\n"
        "    ;;\n"
        f"  *{secret_id}*)\n"
        f"    printf '%s\\n' '{json.dumps({'MC_MCP_API_KEY': sentinel})}'\n"
        "    ;;\n"
        "  *)\n"
        "    echo unexpected >&2\n"
        "    exit 1\n"
        "    ;;\n"
        "esac\n",
        encoding="utf-8",
    )
    aws.chmod(0o755)
    loader = tmp_path / "loader.ps1"
    loader.write_text(text, encoding="utf-8")
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
    out = dict(line.split("=", 1) for line in proc.stdout.splitlines() if "=" in line)
    assert out["threw"] == "no", proc.stdout + proc.stderr
    assert out["env:MC_MCP_API_KEY"] == sentinel
    assert "embedded-key-must-not-appear" not in proc.stdout
