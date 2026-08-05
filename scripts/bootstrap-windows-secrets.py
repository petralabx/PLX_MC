#!/usr/bin/env python3
"""Write workstation secret env files from AWS Secrets Manager only.

Precedence (authoritative — do not reverse):
  1. AWS Secrets Manager is the only credential source this script reads.
  2. Never read credential values from files under ~/.aws (that preference
     caused the 2026-07-26 Graph 401 outage / TASK-742 / TASK-756).
  3. MICROSOFT_GRAPH_TENANT_ID / _CLIENT_ID / _CLIENT_SECRET are always a
     matched set from one secret: plx/prod/m365/cursor-graph/v1
     (PLX_Cursor_Graph). The generated loader fetches that secret at
     source-time so the three values cannot be paired across apps.
  4. The shared Cursor MCP key comes from prod/ec2-secrets. Dedicated agent
     keys come from plx/prod/mc/mcp-agent-keys/v1 and never fall back to the
     shared key.

Outputs (never commit):
  ~/.secrets-env.staging.ps1   — full PLX agent workstation hydrate (Windows)
  ~/.secrets-env.staging.<principal>.ps1
                                — isolated non-Cursor MCP principal hydrate
  ~/.secrets-env.github.ps1    — GitHub org PAT only (Windows; safe to profile-source)
  ~/.secrets-env.github        — same for bash/zsh (Linux/macOS/DGX)

Usage:
  python scripts/bootstrap-windows-secrets.py
  . ~/.secrets-env.staging.ps1          # full session
  . ~/.secrets-env.github.ps1           # GitHub org PAT only (Windows)
  source ~/.secrets-env.github          # GitHub org PAT only (Unix)

See docs/runbooks/petralabx-github-token-workstation.md and
docs/FLEET-SECRETS-SOP.md § workstation Graph precedence.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import boto3

HOME = Path.home()
OUTPUT_GITHUB_PS1 = HOME / ".secrets-env.github.ps1"
OUTPUT_GITHUB_SH = HOME / ".secrets-env.github"

# Graph app-only credential for Cursor / workstation mail (cos@-scoped).
# Must stay a matched set — never mix with prod/ec2-secrets Graph keys
# (those are the broad 3013790b "Vinces MCP" app used by servers).
CURSOR_GRAPH_SECRET_ID = "plx/prod/m365/cursor-graph/v1"
EC2_SECRETS_ID = "prod/ec2-secrets"
MCP_AGENT_KEYS_SECRET_ID = "plx/prod/mc/mcp-agent-keys/v1"
MCP_CURSOR_PRINCIPAL_ID = "sp_mcp_cursor"
MCP_PRINCIPAL_IDS = {
    MCP_CURSOR_PRINCIPAL_ID,
    "sp_mcp_claude_code",
    "sp_mcp_codex",
    "sp_mcp_grok",
    "sp_mcp_hermes",
    "sp_mcp_swarm",
}


def sh_quote(value: str) -> str:
    return "'" + value.replace("'", "'\"'\"'") + "'"


def get_secret_dict(client, secret_id: str) -> dict:
    raw = client.get_secret_value(SecretId=secret_id)["SecretString"]
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise SystemExit(f"{secret_id}: expected JSON object")
    return data


def select_mcp_key(
    principal_id: str,
    compatibility: dict,
    registry: dict,
) -> str:
    if principal_id not in MCP_PRINCIPAL_IDS:
        raise SystemExit(f"unsupported mcp principal id: {principal_id}")
    if principal_id == MCP_CURSOR_PRINCIPAL_ID:
        key = compatibility.get("PLX_MC_MCP_API_KEY", "")
    else:
        key = registry.get(principal_id, "")
    if not isinstance(key, str) or not key:
        raise SystemExit(f"mcp principal key unavailable: {principal_id}")
    return key


def staging_output_path(principal_id: str, home: Path = HOME) -> Path:
    if principal_id == MCP_CURSOR_PRINCIPAL_ID:
        return home / ".secrets-env.staging.ps1"
    return home / f".secrets-env.staging.{principal_id}.ps1"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--mcp-principal-id",
        default=os.environ.get("MC_MCP_PRINCIPAL_ID", MCP_CURSOR_PRINCIPAL_ID),
        choices=sorted(MCP_PRINCIPAL_IDS),
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output_staging = staging_output_path(args.mcp_principal_id)
    client = boto3.client("secretsmanager", region_name="us-east-1")
    sec = get_secret_dict(client, EC2_SECRETS_ID)
    registry = (
        {}
        if args.mcp_principal_id == MCP_CURSOR_PRINCIPAL_ID
        else get_secret_dict(client, MCP_AGENT_KEYS_SECRET_ID)
    )
    mcp_key = select_mcp_key(args.mcp_principal_id, sec, registry)
    # Validate cursor-graph exists and has the three keys as a set (fail closed
    # at bootstrap time rather than writing a half-wired loader).
    graph = get_secret_dict(client, CURSOR_GRAPH_SECRET_ID)
    for key in ("tenantId", "clientId", "clientSecret"):
        if not graph.get(key):
            raise SystemExit(
                f"{CURSOR_GRAPH_SECRET_ID}: missing {key} — refusing to write "
                "MICROSOFT_GRAPH_* from any other source"
            )

    # Secrets Manager only — no ~/.aws text-file fallbacks.
    petra = sec.get("PETRALABX_GITHUB_TOKEN") or sec.get("PETRALABX_GITHUB") or ""
    github = petra or sec.get("GITHUB_TOKEN", "")

    values = {
        "PETRALABX_GITHUB_TOKEN": petra or github,
        "GITHUB_TOKEN": github,
        # MICROSOFT_GRAPH_* intentionally omitted here: emitted as a runtime
        # fetch of CURSOR_GRAPH_SECRET_ID so tenant/client/secret stay matched.
        "MC_MCP_API_KEY": mcp_key,
        "MC_MCP_PRINCIPAL_ID": args.mcp_principal_id,
        "MC_OPERATOR_EMAIL": "cos@petrasoap.com",
        "PLX_MC_MCP_ENABLED": "1",
        "SWARM_API_KEY": sec.get("SWARM_API_KEY", ""),
    }

    lines = [
        "# Machine-local secrets loader for PLX agent workstations",
        "# Generated by scripts/bootstrap-windows-secrets.py — do not commit",
        "#",
        "# Precedence: AWS Secrets Manager only. This file must NEVER fall back",
        "# to credential text files under ~/.aws (TASK-756 / 2026-07-26 outage).",
        "#",
        "# MICROSOFT_GRAPH_TENANT_ID / _CLIENT_ID / _CLIENT_SECRET:",
        f"#   matched set from {CURSOR_GRAPH_SECRET_ID} (PLX_Cursor_Graph).",
        "#   Do not substitute prod/ec2-secrets Graph keys (different app).",
        "",
    ]

    for key, val in values.items():
        if not val:
            continue
        esc = val.replace("'", "''")
        lines.append(f"$env:{key} = '{esc}'")

    # Runtime fetch keeps the three Graph vars a matched set from one secret.
    lines.extend(
        [
            "",
            "# Microsoft Graph app-only — PLX_Cursor_Graph (matched set)",
            f"# Source of truth: AWS Secrets Manager {CURSOR_GRAPH_SECRET_ID}",
            "# Mail.Send is restricted to cos@petrasoap.com by Exchange RestrictAccess.",
            "$__awsCli = if (Test-Path 'C:\\Program Files\\Amazon\\AWSCLIV2\\aws.exe') {",
            "  'C:\\Program Files\\Amazon\\AWSCLIV2\\aws.exe'",
            "} else { 'aws' }",
            "try {",
            f"  $__graph = & $__awsCli secretsmanager get-secret-value --region us-east-1 --secret-id {CURSOR_GRAPH_SECRET_ID} --query SecretString --output text 2>$null | ConvertFrom-Json",
            "  if (-not $__graph.clientSecret) { throw 'secret payload missing clientSecret' }",
            "  $env:MICROSOFT_GRAPH_TENANT_ID     = $__graph.tenantId",
            "  $env:MICROSOFT_GRAPH_CLIENT_ID     = $__graph.clientId",
            "  $env:MICROSOFT_GRAPH_CLIENT_SECRET = $__graph.clientSecret",
            "} catch {",
            f'  Write-Warning "Graph credential unavailable from {CURSOR_GRAPH_SECRET_ID}: $($_.Exception.Message)"',
            '  Write-Warning "Check AWS credentials (aws sts get-caller-identity), then re-source this file."',
            "} finally {",
            "  Remove-Variable __graph, __awsCli -ErrorAction SilentlyContinue",
            "}",
            "",
            "$env:AZURE_TENANT_ID = $env:MICROSOFT_GRAPH_TENANT_ID",
            "$env:AZURE_CLIENT_ID = $env:MICROSOFT_GRAPH_CLIENT_ID",
            "$env:AZURE_CLIENT_SECRET = $env:MICROSOFT_GRAPH_CLIENT_SECRET",
            "",
            "# Also keep a GitHub-only fragment for profile auto-source:",
            "#   . $HOME\\.secrets-env.github.ps1",
            "",
        ]
    )

    output_staging.write_text("\n".join(lines), encoding="utf-8")

    gh_token = values.get("PETRALABX_GITHUB_TOKEN") or values.get("GITHUB_TOKEN") or ""
    if gh_token:
        esc = gh_token.replace("'", "''")
        OUTPUT_GITHUB_PS1.write_text(
            "\n".join(
                [
                    "# GitHub org PAT for petralabx agent work — do not commit",
                    "# Generated by scripts/bootstrap-windows-secrets.py",
                    "# Source: AWS Secrets Manager prod/ec2-secrets (PETRALABX_GITHUB_TOKEN)",
                    f"$env:PETRALABX_GITHUB_TOKEN = '{esc}'",
                    f"$env:GITHUB_TOKEN = '{esc}'",
                    "",
                ]
            ),
            encoding="utf-8",
        )
        OUTPUT_GITHUB_SH.write_text(
            "\n".join(
                [
                    "# GitHub org PAT for petralabx agent work — do not commit",
                    "# Generated by scripts/bootstrap-windows-secrets.py",
                    "# Source: AWS Secrets Manager prod/ec2-secrets (PETRALABX_GITHUB_TOKEN)",
                    f"export PETRALABX_GITHUB_TOKEN={sh_quote(gh_token)}",
                    f"export GITHUB_TOKEN={sh_quote(gh_token)}",
                    "",
                ]
            ),
            encoding="utf-8",
        )
        try:
            OUTPUT_GITHUB_SH.chmod(0o600)
        except OSError:
            pass

    print(f"wrote {output_staging}")
    if gh_token:
        print(f"wrote {OUTPUT_GITHUB_PS1}")
        print(f"wrote {OUTPUT_GITHUB_SH}")
    print("keys loaded:", ", ".join(k for k, v in values.items() if v))
    print(f"graph source: {CURSOR_GRAPH_SECRET_ID} (runtime matched set)")
    print(f"mcp principal: {args.mcp_principal_id}")
    print(
        "tip: profile-source GitHub PAT with "
        "`. $HOME\\.secrets-env.github.ps1` (Windows) or "
        "`source ~/.secrets-env.github` (Unix) — see "
        "docs/runbooks/petralabx-github-token-workstation.md"
    )


if __name__ == "__main__":
    main()
