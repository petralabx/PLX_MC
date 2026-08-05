#!/usr/bin/env python3
"""Sync the dedicated MCP agent-key registry to Vercel without exposing keys."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from typing import Any
from urllib.parse import quote

import boto3
import requests
from botocore.exceptions import ClientError

DEDICATED_SECRET_ID = "plx/prod/mc/mcp-agent-keys/v1"
COMPATIBILITY_SECRET_ID = "prod/ec2-secrets"
REGISTRY_ENV_NAME = "PLX_MC_MCP_AGENT_KEYS"
SHARED_KEY_NAME = "PLX_MC_MCP_API_KEY"
CLAUDE_PRINCIPAL_ID = "sp_mcp_claude_code"
SHARED_PRINCIPAL_ID = "sp_mcp_cursor"
VERCEL_API = "https://api.vercel.com"
TERMINAL_DEPLOYMENT_STATES = {"BLOCKED", "CANCELED", "ERROR", "READY"}


class SyncError(RuntimeError):
    """A redacted operational error safe to print."""


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def parse_json_object(raw: str, label: str) -> dict[str, Any]:
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SyncError(f"{label}_invalid_json") from exc
    if not isinstance(parsed, dict):
        raise SyncError(f"{label}_not_object")
    return parsed


def get_secret_string(client: Any, secret_id: str) -> str:
    try:
        result = client.get_secret_value(SecretId=secret_id)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "unknown")
        raise SyncError(f"aws_get_failed:{code}") from exc
    raw = result.get("SecretString")
    if not isinstance(raw, str) or not raw:
        raise SyncError("aws_secret_string_missing")
    return raw


def validate_registry(raw: str) -> dict[str, str]:
    parsed = parse_json_object(raw, "registry")
    registry: dict[str, str] = {}
    for principal_id, key in parsed.items():
        if not isinstance(principal_id, str) or not isinstance(key, str) or not key:
            raise SyncError("registry_entry_invalid")
        registry[principal_id] = key
    if not registry.get(CLAUDE_PRINCIPAL_ID):
        raise SyncError("registry_claude_principal_missing")
    return registry


def request_json(
    session: requests.Session,
    method: str,
    url: str,
    *,
    operation: str,
    headers: dict[str, str],
    params: dict[str, str] | None = None,
    body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    try:
        response = session.request(
            method,
            url,
            headers=headers,
            params=params,
            json=body,
            timeout=30,
        )
    except requests.RequestException as exc:
        raise SyncError(f"{operation}_request_failed") from exc
    if not 200 <= response.status_code < 300:
        raise SyncError(f"{operation}_http_{response.status_code}")
    try:
        data = response.json()
    except requests.JSONDecodeError as exc:
        raise SyncError(f"{operation}_invalid_json") from exc
    if not isinstance(data, dict):
        raise SyncError(f"{operation}_invalid_response")
    return data


def vercel_headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


def upsert_production_registry(
    session: requests.Session,
    *,
    token: str,
    team_slug: str,
    project_id: str,
    registry_raw: str,
) -> str:
    result = request_json(
        session,
        "POST",
        f"{VERCEL_API}/v10/projects/{quote(project_id, safe='')}/env",
        operation="vercel_env_upsert",
        headers=vercel_headers(token),
        params={"slug": team_slug, "upsert": "true"},
        body={
            "key": REGISTRY_ENV_NAME,
            "value": registry_raw,
            "type": "sensitive",
            "target": ["production"],
            "comment": "Canonical source: AWS Secrets Manager plx/prod/mc/mcp-agent-keys/v1",
        },
    )
    failed = result.get("failed")
    if isinstance(failed, list) and failed:
        raise SyncError("vercel_env_upsert_failed")
    created = result.get("created")
    if isinstance(created, list):
        created = created[0] if len(created) == 1 else None
    env_id = created.get("id") if isinstance(created, dict) else None
    if not isinstance(env_id, str) or not env_id:
        raise SyncError("vercel_env_upsert_missing_id")
    return env_id


def verify_production_registry_metadata(
    session: requests.Session,
    *,
    token: str,
    team_slug: str,
    project_id: str,
) -> bool:
    result = request_json(
        session,
        "GET",
        f"{VERCEL_API}/v10/projects/{quote(project_id, safe='')}/env",
        operation="vercel_env_list",
        headers=vercel_headers(token),
        params={"slug": team_slug},
    )
    envs = result.get("envs")
    if not isinstance(envs, list):
        raise SyncError("vercel_env_list_missing_envs")
    matches = [
        item
        for item in envs
        if isinstance(item, dict)
        and item.get("key") == REGISTRY_ENV_NAME
        and item.get("type") == "sensitive"
        and "production" in (item.get("target") or [])
    ]
    return len(matches) == 1


def get_deployment(
    session: requests.Session,
    *,
    token: str,
    team_slug: str,
    deployment_id_or_domain: str,
) -> dict[str, Any]:
    return request_json(
        session,
        "GET",
        f"{VERCEL_API}/v13/deployments/{quote(deployment_id_or_domain, safe='')}",
        operation="vercel_deployment_get",
        headers=vercel_headers(token),
        params={"slug": team_slug, "withGitRepoInfo": "true"},
    )


def create_production_redeployment(
    session: requests.Session,
    *,
    token: str,
    team_slug: str,
    project_id: str,
    project_name: str,
    previous_deployment_id: str,
) -> dict[str, Any]:
    return request_json(
        session,
        "POST",
        f"{VERCEL_API}/v13/deployments",
        operation="vercel_deployment_create",
        headers=vercel_headers(token),
        params={"slug": team_slug, "forceNew": "1"},
        body={
            "name": project_name,
            "project": project_id,
            "deploymentId": previous_deployment_id,
            "target": "production",
        },
    )


def wait_for_deployment(
    session: requests.Session,
    *,
    token: str,
    team_slug: str,
    deployment_id: str,
    timeout_seconds: int,
    poll_seconds: int,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout_seconds
    last_state = ""
    while time.monotonic() < deadline:
        deployment = get_deployment(
            session,
            token=token,
            team_slug=team_slug,
            deployment_id_or_domain=deployment_id,
        )
        state = str(
            deployment.get("readyState") or deployment.get("status") or "UNKNOWN"
        )
        if state != last_state:
            print(f"deployment_status={state}")
            last_state = state
        if state in TERMINAL_DEPLOYMENT_STATES:
            if state != "READY":
                raise SyncError(f"deployment_terminal_status:{state}")
            return deployment
        time.sleep(poll_seconds)
    raise SyncError("deployment_timeout")


def wait_for_domain_activation(
    session: requests.Session,
    *,
    token: str,
    team_slug: str,
    production_domain: str,
    deployment_id: str,
    timeout_seconds: int,
    poll_seconds: int,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        deployment = get_deployment(
            session,
            token=token,
            team_slug=team_slug,
            deployment_id_or_domain=production_domain,
        )
        if deployment.get("id") == deployment_id:
            return deployment
        time.sleep(poll_seconds)
    raise SyncError("production_domain_activation_timeout")


def verify_self_check(
    session: requests.Session,
    *,
    production_url: str,
    api_key: str,
    expected_principal_id: str,
    operator_email: str,
    repo: str,
    runtime: str,
) -> bool:
    result = request_json(
        session,
        "GET",
        f"{production_url.rstrip('/')}/api/cursor/self-check",
        operation=f"self_check_{expected_principal_id}",
        headers={
            "x-api-key": api_key,
            "x-mc-operator-email": operator_email,
            "x-mc-repo": repo,
            "x-mc-runtime": runtime,
        },
    )
    data = result.get("data")
    meta = result.get("meta")
    if not isinstance(data, dict) or not isinstance(meta, dict):
        return False
    actor = meta.get("actor")
    return (
        data.get("ok") is True
        and data.get("mcpEnabled") is True
        and isinstance(actor, dict)
        and actor.get("servicePrincipalId") == expected_principal_id
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument("--secret-id", default=DEDICATED_SECRET_ID)
    parser.add_argument("--compatibility-secret-id", default=COMPATIBILITY_SECRET_ID)
    parser.add_argument("--project-id", default="prj_hOCeE8Kz64ZCHXybEloJGXeqEuvw")
    parser.add_argument("--project-name", default="plx-mission-control")
    parser.add_argument("--vercel-team-slug", default="petralabx")
    parser.add_argument("--production-url", default="https://mc.plxcustomer.io")
    parser.add_argument("--production-domain", default="mc.plxcustomer.io")
    parser.add_argument("--operator-email", default="cos@petrasoap.com")
    parser.add_argument("--repo", default="petralabx/local-inference")
    parser.add_argument("--runtime", default="cursor-cloud")
    parser.add_argument("--timeout-seconds", type=int, default=900)
    parser.add_argument("--poll-seconds", type=int, default=10)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    token = os.environ.get("VERCEL_TOKEN", "").strip()
    if not token:
        raise SyncError("vercel_token_missing")

    secrets = boto3.client("secretsmanager", region_name=args.region)
    registry_raw = get_secret_string(secrets, args.secret_id)
    registry = validate_registry(registry_raw)

    compatibility_raw = get_secret_string(secrets, args.compatibility_secret_id)
    compatibility = parse_json_object(compatibility_raw, "compatibility_secret")
    shared_key = compatibility.get(SHARED_KEY_NAME)
    mirror = compatibility.get(REGISTRY_ENV_NAME)
    if not isinstance(shared_key, str) or not shared_key:
        raise SyncError("compatibility_shared_key_missing")
    mirror_matches = mirror == registry_raw

    session = requests.Session()
    env_id = upsert_production_registry(
        session,
        token=token,
        team_slug=args.vercel_team_slug,
        project_id=args.project_id,
        registry_raw=registry_raw,
    )
    metadata_ok = verify_production_registry_metadata(
        session,
        token=token,
        team_slug=args.vercel_team_slug,
        project_id=args.project_id,
    )
    if not metadata_ok:
        raise SyncError("vercel_env_metadata_invalid")

    previous = get_deployment(
        session,
        token=token,
        team_slug=args.vercel_team_slug,
        deployment_id_or_domain=args.production_domain,
    )
    previous_id = previous.get("id")
    if not isinstance(previous_id, str) or not previous_id:
        raise SyncError("previous_deployment_id_missing")

    created = create_production_redeployment(
        session,
        token=token,
        team_slug=args.vercel_team_slug,
        project_id=args.project_id,
        project_name=args.project_name,
        previous_deployment_id=previous_id,
    )
    deployment_id = created.get("id")
    if not isinstance(deployment_id, str) or not deployment_id:
        raise SyncError("deployment_id_missing")

    ready = wait_for_deployment(
        session,
        token=token,
        team_slug=args.vercel_team_slug,
        deployment_id=deployment_id,
        timeout_seconds=args.timeout_seconds,
        poll_seconds=args.poll_seconds,
    )
    active = wait_for_domain_activation(
        session,
        token=token,
        team_slug=args.vercel_team_slug,
        production_domain=args.production_domain,
        deployment_id=deployment_id,
        timeout_seconds=120,
        poll_seconds=args.poll_seconds,
    )

    claude_ok = verify_self_check(
        session,
        production_url=args.production_url,
        api_key=registry[CLAUDE_PRINCIPAL_ID],
        expected_principal_id=CLAUDE_PRINCIPAL_ID,
        operator_email=args.operator_email,
        repo=args.repo,
        runtime=args.runtime,
    )
    shared_ok = verify_self_check(
        session,
        production_url=args.production_url,
        api_key=shared_key,
        expected_principal_id=SHARED_PRINCIPAL_ID,
        operator_email=args.operator_email,
        repo=args.repo,
        runtime=args.runtime,
    )
    if not claude_ok or not shared_ok:
        raise SyncError("production_identity_verification_failed")

    git_source = (
        ready.get("gitSource") if isinstance(ready.get("gitSource"), dict) else {}
    )
    print(f"registry_sha256={sha256(registry_raw)}")
    print(f"shared_key_sha256={sha256(shared_key)}")
    print(f"compatibility_mirror_matches={mirror_matches}")
    print(f"vercel_env_id={env_id}")
    print("vercel_env_sensitive_production=True")
    print(f"previous_deployment_id={previous_id}")
    print(f"deployment_id={deployment_id}")
    print(f"deployment_status={ready.get('readyState') or ready.get('status')}")
    print(f"deployment_ref={git_source.get('ref') or 'unknown'}")
    print(f"deployment_sha={git_source.get('sha') or 'unknown'}")
    print(f"production_domain_active={active.get('id') == deployment_id}")
    print(f"claude_identity_ok={claude_ok}")
    print(f"shared_identity_ok={shared_ok}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SyncError as exc:
        print(f"sync_status=failed:{exc}", file=sys.stderr)
        raise SystemExit(1) from None
    except Exception as exc:  # Fail closed without printing provider payloads.
        print(f"sync_status=failed:{type(exc).__name__}", file=sys.stderr)
        raise SystemExit(1) from None
