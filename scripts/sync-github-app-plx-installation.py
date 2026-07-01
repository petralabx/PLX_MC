#!/usr/bin/env python3
"""Detect or apply the petralabx GitHub App installation id and sync secrets.

After an org owner installs **PLX MC Compliance** on `petralabx`, run:

  python scripts/sync-github-app-plx-installation.py

Or pass the installation id from the org settings URL:

  python scripts/sync-github-app-plx-installation.py --installation-id 12345678

Updates AWS Secrets Manager (`staging/ec2-secrets`, `prod/ec2-secrets`) and
Vercel project env (`petralabx/plx-mission-control`, production + preview),
then verifies an installation token can read `petralabx/furgenics`.
"""

from __future__ import annotations

import argparse
import json
import os
import time
import urllib.request
from typing import Any

import boto3
import jwt

ORG = "petralabx"
VERIFY_REPO = "furgenics"
AWS_SECRETS = ("staging/ec2-secrets", "prod/ec2-secrets")
VERCEL_TEAM = "petralabx"
VERCEL_PROJECT = "plx-mission-control"
ENV_KEY = "GITHUB_APP_INSTALLATION_ID_PLX"
GH_API = "https://api.github.com"


def _require(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"missing required env: {name}")
    return value


def _gh_request(
    path: str, *, token: str, method: str = "GET", body: dict | None = None
) -> Any:
    data = None
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(
        f"{GH_API}{path}", data=data, headers=headers, method=method
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read().decode())


def mint_app_jwt(app_id: str, private_key_pem: str) -> str:
    now = int(time.time())
    return jwt.encode(
        {"iat": now - 60, "exp": now + 600, "iss": app_id},
        private_key_pem.replace("\\n", "\n"),
        algorithm="RS256",
    )


def discover_org_installation_id() -> str | None:
    app_id = _require("GITHUB_APP_ID")
    private_key = _require("GITHUB_APP_PRIVATE_KEY")
    app_jwt = mint_app_jwt(app_id, private_key)
    installations = _gh_request("/app/installations", token=app_jwt)
    for inst in installations:
        account = inst.get("account") or {}
        if account.get("login") == ORG and account.get("type") == "Organization":
            return str(inst["id"])
    return None


def poll_for_installation(timeout_seconds: int, interval_seconds: int) -> str:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        installation_id = discover_org_installation_id()
        if installation_id:
            print(f"detected {ORG} installation id: {installation_id}")
            return installation_id
        remaining = int(deadline - time.time())
        print(f"waiting for {ORG} App install… ({remaining}s left)")
        time.sleep(interval_seconds)
    raise SystemExit(
        f"timed out after {timeout_seconds}s — install the App on {ORG} first:\n"
        "https://github.com/apps/plx-mc-compliance/installations/new"
        "?target_id=298417875&target_type=Organization"
    )


def merge_aws_secret(secret_id: str, installation_id: str) -> None:
    client = boto3.client("secretsmanager", region_name="us-east-1")
    current = json.loads(client.get_secret_value(SecretId=secret_id)["SecretString"])
    if current.get(ENV_KEY) == installation_id:
        print(f"{secret_id}: {ENV_KEY} already {installation_id}")
        return
    current[ENV_KEY] = installation_id
    client.put_secret_value(SecretId=secret_id, SecretString=json.dumps(current))
    print(f"{secret_id}: set {ENV_KEY}={installation_id}")


def _vercel_request(path: str, *, method: str = "GET", body: dict | None = None) -> Any:
    token = _require("VERCEL_API_TOKEN")
    data = None
    headers = {"Authorization": f"Bearer {token}"}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(
        f"https://api.vercel.com{path}", data=data, headers=headers, method=method
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        raw = res.read().decode()
        return json.loads(raw) if raw else {}


def sync_vercel_env(installation_id: str) -> None:
    project = _vercel_request(f"/v9/projects/{VERCEL_PROJECT}?teamId={VERCEL_TEAM}")
    project_id = project["id"]
    existing = next(
        (item for item in project.get("env", []) if item.get("key") == ENV_KEY),
        None,
    )
    targets = ["production", "preview"]
    if existing:
        _vercel_request(
            f"/v9/projects/{project_id}/env/{existing['id']}?teamId={VERCEL_TEAM}",
            method="PATCH",
            body={"value": installation_id, "type": "encrypted", "target": targets},
        )
        print(f"vercel: updated {ENV_KEY} for {targets}")
    else:
        _vercel_request(
            f"/v10/projects/{project_id}/env?teamId={VERCEL_TEAM}",
            method="POST",
            body={
                "key": ENV_KEY,
                "value": installation_id,
                "type": "encrypted",
                "target": targets,
            },
        )
        print(f"vercel: created {ENV_KEY} for {targets}")


def verify_installation_access(installation_id: str) -> None:
    app_id = _require("GITHUB_APP_ID")
    private_key = _require("GITHUB_APP_PRIVATE_KEY")
    app_jwt = mint_app_jwt(app_id, private_key)
    token_resp = _gh_request(
        f"/app/installations/{installation_id}/access_tokens",
        token=app_jwt,
        method="POST",
        body={"repository": f"{ORG}/{VERIFY_REPO}"},
    )
    access_token = token_resp["token"]
    repo = _gh_request(f"/repos/{ORG}/{VERIFY_REPO}", token=access_token)
    print(
        f"verified: installation {installation_id} can read {repo['full_name']} (private={repo.get('private')})"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--installation-id", help="Org installation id (skip auto-detect)"
    )
    parser.add_argument(
        "--poll-timeout", type=int, default=0, help="Seconds to poll for new install"
    )
    parser.add_argument(
        "--poll-interval", type=int, default=10, help="Poll interval seconds"
    )
    parser.add_argument("--skip-vercel", action="store_true")
    parser.add_argument("--skip-aws", action="store_true")
    parser.add_argument("--skip-verify", action="store_true")
    args = parser.parse_args()

    if args.installation_id:
        installation_id = args.installation_id.strip()
    elif args.poll_timeout > 0:
        installation_id = poll_for_installation(args.poll_timeout, args.poll_interval)
    else:
        installation_id = discover_org_installation_id()
        if not installation_id:
            raise SystemExit(
                f"no {ORG} installation found — pass --installation-id or --poll-timeout, "
                "or install the App first (see docs/runbooks/github-app-provisioning.md Step 2b)."
            )

    if not args.skip_aws:
        for secret_id in AWS_SECRETS:
            merge_aws_secret(secret_id, installation_id)
    if not args.skip_vercel:
        sync_vercel_env(installation_id)
    if not args.skip_verify:
        verify_installation_access(installation_id)

    print("done")


if __name__ == "__main__":
    main()
