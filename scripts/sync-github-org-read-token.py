#!/usr/bin/env python3
"""Update GITHUB_TOKEN in AWS + Vercel so petralabx repos are readable.

Interim EN-008 bridge until `GITHUB_APP_INSTALLATION_ID_PLX` is provisioned.
GitHub does not expose a free-tier API to install Apps on organizations — this
uses a user OAuth/classic token that can read org private repos.

Usage:
  source ~/.secrets-env.staging
  python scripts/sync-github-org-read-token.py
  python scripts/sync-github-org-read-token.py --token ghp_...
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import urllib.request
from typing import Any

import boto3

AWS_SECRETS = ("staging/ec2-secrets", "prod/ec2-secrets")
VERCEL_TEAM = "petralabx"
VERCEL_PROJECT = "plx-mission-control"
VERIFY_REPOS = ("taylorvalton/PLX_MC", "petralabx/furgenics")


def resolve_token(explicit: str | None) -> str:
    if explicit:
        return explicit.strip()
    env = os.environ.copy()
    env.pop("GITHUB_TOKEN", None)
    env.pop("GH_TOKEN", None)
    token = subprocess.check_output(["gh", "auth", "token"], env=env, text=True).strip()
    if not token:
        raise SystemExit(
            "could not resolve a GitHub token — pass --token or run gh auth login"
        )
    return token


def verify_token(token: str) -> None:
    for repo in VERIFY_REPOS:
        req = urllib.request.Request(
            f"https://api.github.com/repos/{repo}",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
            },
        )
        with urllib.request.urlopen(req, timeout=30) as res:
            if res.status != 200:
                raise SystemExit(f"token cannot read {repo} (HTTP {res.status})")
        print(f"verified read: {repo}")


def merge_aws(secret_id: str, token: str) -> None:
    client = boto3.client("secretsmanager", region_name="us-east-1")
    current = json.loads(client.get_secret_value(SecretId=secret_id)["SecretString"])
    if current.get("GITHUB_TOKEN") == token:
        print(f"{secret_id}: GITHUB_TOKEN unchanged")
        return
    current["GITHUB_TOKEN"] = token
    client.put_secret_value(SecretId=secret_id, SecretString=json.dumps(current))
    print(f"{secret_id}: updated GITHUB_TOKEN")


def vercel_request(path: str, *, method: str = "GET", body: dict | None = None) -> Any:
    api_token = os.environ["VERCEL_API_TOKEN"].strip()
    data = None
    headers = {"Authorization": f"Bearer {api_token}"}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(
        f"https://api.vercel.com{path}", data=data, headers=headers, method=method
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        raw = res.read().decode()
        return json.loads(raw) if raw else {}


def sync_vercel(token: str) -> None:
    project = vercel_request(f"/v9/projects/{VERCEL_PROJECT}?teamId={VERCEL_TEAM}")
    project_id = project["id"]
    existing = next(
        (item for item in project.get("env", []) if item.get("key") == "GITHUB_TOKEN"),
        None,
    )
    targets = ["production", "preview"]
    if existing:
        vercel_request(
            f"/v9/projects/{project_id}/env/{existing['id']}?teamId={VERCEL_TEAM}",
            method="PATCH",
            body={"value": token, "type": "encrypted", "target": targets},
        )
        print(f"vercel: updated GITHUB_TOKEN for {targets}")
    else:
        vercel_request(
            f"/v10/projects/{project_id}/env?teamId={VERCEL_TEAM}",
            method="POST",
            body={
                "key": "GITHUB_TOKEN",
                "value": token,
                "type": "encrypted",
                "target": targets,
            },
        )
        print(f"vercel: created GITHUB_TOKEN for {targets}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--token", help="GitHub token with org repo read access")
    parser.add_argument("--skip-aws", action="store_true")
    parser.add_argument("--skip-vercel", action="store_true")
    args = parser.parse_args()

    if not args.skip_vercel and not os.environ.get("VERCEL_API_TOKEN"):
        raise SystemExit("missing VERCEL_API_TOKEN — source ~/.secrets-env.staging")

    token = resolve_token(args.token)
    verify_token(token)
    if not args.skip_aws:
        for secret_id in AWS_SECRETS:
            merge_aws(secret_id, token)
    if not args.skip_vercel:
        sync_vercel(token)
    print("done")


if __name__ == "__main__":
    main()
