"""Secret-redaction and deployment-contract tests for MCP registry sync."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = REPO_ROOT / "scripts" / "sync-mcp-agent-keys.py"


def load_script() -> ModuleType:
    spec = importlib.util.spec_from_file_location("sync_mcp_agent_keys", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class FakeResponse:
    def __init__(self, status_code: int, payload: dict) -> None:
        self.status_code = status_code
        self.payload = payload

    def json(self) -> dict:
        return self.payload


class FakeSession:
    def __init__(self, *responses: FakeResponse) -> None:
        self.responses = list(responses)
        self.calls: list[dict] = []

    def request(self, method: str, url: str, **kwargs) -> FakeResponse:
        self.calls.append({"method": method, "url": url, **kwargs})
        return self.responses.pop(0)


class FakeSecrets:
    def __init__(self, dedicated: str, compatibility: str) -> None:
        self.values = {
            "plx/prod/mc/mcp-agent-keys/v1": dedicated,
            "prod/ec2-secrets": compatibility,
        }

    def get_secret_value(self, *, SecretId: str) -> dict[str, str]:
        return {"SecretString": self.values[SecretId]}


def test_registry_requires_claude_principal() -> None:
    sync = load_script()
    with pytest.raises(sync.SyncError, match="registry_claude_principal_missing"):
        sync.validate_registry(json.dumps({"sp_mcp_codex": "codex-secret"}))


def test_registry_rejects_unreviewed_principal() -> None:
    sync = load_script()
    with pytest.raises(sync.SyncError, match="registry_principal_unreviewed"):
        sync.validate_registry(
            json.dumps(
                {
                    "sp_mcp_claude_code": "claude-secret",
                    "sp_mcp_unreviewed": "rogue-secret",
                }
            )
        )


def test_vercel_upsert_is_sensitive_and_production_only() -> None:
    sync = load_script()
    session = FakeSession(
        FakeResponse(201, {"created": {"id": "env_redacted"}, "failed": []})
    )

    env_id = sync.upsert_production_registry(
        session,
        token="vercel-secret",
        team_slug="petralabx",
        project_id="project-id",
        registry_raw='{"sp_mcp_claude_code":"claude-secret"}',
    )

    assert env_id == "env_redacted"
    call = session.calls[0]
    assert call["json"] == {
        "key": "PLX_MC_MCP_AGENT_KEYS",
        "value": '{"sp_mcp_claude_code":"claude-secret"}',
        "type": "sensitive",
        "target": ["production"],
        "comment": "Canonical source: AWS Secrets Manager plx/prod/mc/mcp-agent-keys/v1",
    }
    assert call["params"] == {"slug": "petralabx", "upsert": "true"}


def test_provider_error_does_not_echo_response_body() -> None:
    sync = load_script()
    session = FakeSession(
        FakeResponse(
            400,
            {"error": "rejected claude-secret and vercel-secret"},
        )
    )

    with pytest.raises(sync.SyncError) as caught:
        sync.upsert_production_registry(
            session,
            token="vercel-secret",
            team_slug="petralabx",
            project_id="project-id",
            registry_raw='{"sp_mcp_claude_code":"claude-secret"}',
        )

    message = str(caught.value)
    assert message == "vercel_env_upsert_http_400"
    assert "claude-secret" not in message
    assert "vercel-secret" not in message


def test_main_reports_only_redacted_evidence(monkeypatch, capsys) -> None:
    sync = load_script()
    registry = json.dumps(
        {
            "sp_mcp_claude_code": "claude-secret",
            "sp_mcp_codex": "codex-secret",
            "sp_mcp_grok": "grok-secret",
            "sp_mcp_hermes": "hermes-secret",
            "sp_mcp_swarm": "swarm-secret",
        }
    )
    compatibility = json.dumps(
        {
            "PLX_MC_MCP_AGENT_KEYS": '{"sp_mcp_claude_code":"stale-mirror-secret"}',
            "PLX_MC_MCP_API_KEY": "shared-secret",
        }
    )
    secrets = FakeSecrets(registry, compatibility)
    monkeypatch.delenv("VERCEL_TOKEN", raising=False)
    monkeypatch.setenv("VERCEL_API_TOKEN", "vercel-secret")
    monkeypatch.setattr(sync.boto3, "client", lambda *_args, **_kwargs: secrets)
    monkeypatch.setattr(sync.requests, "Session", lambda: object())
    monkeypatch.setattr(
        sync, "upsert_production_registry", lambda *_args, **_kwargs: "env_123"
    )
    monkeypatch.setattr(
        sync,
        "verify_production_registry_metadata",
        lambda *_args, **_kwargs: True,
    )
    deployments = iter(
        [
            {"id": "dpl_previous"},
        ]
    )
    monkeypatch.setattr(
        sync, "get_deployment", lambda *_args, **_kwargs: next(deployments)
    )
    monkeypatch.setattr(
        sync,
        "create_production_redeployment",
        lambda *_args, **_kwargs: {"id": "dpl_current"},
    )
    monkeypatch.setattr(
        sync,
        "wait_for_deployment",
        lambda *_args, **_kwargs: {
            "id": "dpl_current",
            "readyState": "READY",
            "gitSource": {"ref": "main", "sha": "abc123"},
        },
    )
    monkeypatch.setattr(
        sync,
        "wait_for_domain_activation",
        lambda *_args, **_kwargs: {"id": "dpl_current"},
    )
    monkeypatch.setattr(sync, "verify_self_check", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(sys, "argv", [str(SCRIPT)])

    assert sync.main() == 0
    output = capsys.readouterr().out
    assert "claude-secret" not in output
    assert "codex-secret" not in output
    assert "grok-secret" not in output
    assert "hermes-secret" not in output
    assert "swarm-secret" not in output
    assert "stale-mirror-secret" not in output
    assert "shared-secret" not in output
    assert "vercel-secret" not in output
    assert "compatibility_mirror_matches=False" in output
    assert "vercel_env_sensitive_production=True" in output
    assert "production_domain_active=True" in output
    assert "claude_identity_ok=True" in output
    assert "codex_identity_ok=True" in output
    assert "grok_identity_ok=True" in output
    assert "hermes_identity_ok=True" in output
    assert "swarm_identity_ok=True" in output
    assert "shared_identity_ok=True" in output
