#!/usr/bin/env bash
#
# provision-cloud-agent-aws-access.sh — mint least-privilege AWS access for
# Cursor Cloud Agents working on PLX_MC.
#
# RUN THIS WHERE ADMIN AWS CREDENTIALS EXIST (e.g. the EC2 ops box or an
# operator shell) — NOT inside a cloud agent VM (which has no AWS access;
# that's the gap this script closes).
#
# What it does:
#   1. Creates (or reuses) IAM user $IAM_USER with a policy scoped to exactly
#      what PLX_MC agents need:
#        - secretsmanager:GetSecretValue / DescribeSecret on $SECRET_ID only
#        - ce:GetCostAndUsage (read-only Cost Explorer, for the vendor-spend
#          AWS adapter)
#   2. Creates an access key and prints the THREE values to paste into
#      Cursor Dashboard -> Cloud Agents -> Secrets (repo scope: PLX_MC).
#   3. --check-keys reports which vendor-spend credentials already exist in
#      the shared secret (names only — never values).
#
# The paste-into-dashboard step is deliberately human: nothing can (or
# should) push secrets into Cursor programmatically.
#
# Usage:
#   ./scripts/provision-cloud-agent-aws-access.sh [--rotate] [--check-keys]
#       [--user plx-mc-cloud-agent] [--secret-id prod/ec2-secrets]
#       [--region us-east-1]
#
# Exit codes: 0 ok, 1 failure (missing CLI, no admin creds, IAM error).

set -euo pipefail

IAM_USER="plx-mc-cloud-agent"
POLICY_NAME="plx-mc-cloud-agent-read"
SECRET_ID="prod/ec2-secrets"
REGION="us-east-1"
ROTATE=0
CHECK_KEYS=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user) IAM_USER="$2"; shift 2 ;;
    --secret-id) SECRET_ID="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    --rotate) ROTATE=1; shift ;;
    --check-keys) CHECK_KEYS=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

command -v aws >/dev/null || { echo "aws CLI not found — install it or run from the ops box." >&2; exit 1; }

echo "== Caller identity (needs IAM + SecretsManager admin) =="
aws sts get-caller-identity --output table

SECRET_ARN=$(aws secretsmanager describe-secret --region "$REGION" --secret-id "$SECRET_ID" \
  --query 'ARN' --output text)
echo "shared secret: $SECRET_ARN"

# ── Optional: report which vendor-spend keys exist (names only) ──────────────
if [[ $CHECK_KEYS -eq 1 ]]; then
  echo
  echo "== Vendor-spend credential presence in $SECRET_ID (names only) =="
  PRESENT=$(aws secretsmanager get-secret-value --region "$REGION" --secret-id "$SECRET_ID" \
    --query 'SecretString' --output text | python3 -c '
import json, sys
keys = set(json.load(sys.stdin).keys())
for want in ("ANTHROPIC_ADMIN_API_KEY", "CURSOR_ADMIN_API_KEY", "PLX_MC_DATABASE_URL", "CRON_SECRET"):
    status = "present" if want in keys else "MISSING"
    print("  " + want + ": " + status)')
  echo "$PRESENT"
  echo "  (MISSING admin keys keep those vendors visibly DEGRADED in AI Spend — add them"
  echo "   to $SECRET_ID when provisioned; no code change needed.)"
fi

# ── Policy (idempotent) ───────────────────────────────────────────────────────
ACCOUNT_ID=$(aws sts get-caller-identity --query 'Account' --output text)
POLICY_ARN="arn:aws:iam::${ACCOUNT_ID}:policy/${POLICY_NAME}"
POLICY_DOC=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadSharedSecret",
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
      "Resource": "${SECRET_ARN}"
    },
    {
      "Sid": "CostExplorerRead",
      "Effect": "Allow",
      "Action": ["ce:GetCostAndUsage"],
      "Resource": "*"
    }
  ]
}
JSON
)

if aws iam get-policy --policy-arn "$POLICY_ARN" >/dev/null 2>&1; then
  echo "policy exists: $POLICY_ARN (leaving as-is; edit in IAM console if the scope changed)"
else
  aws iam create-policy --policy-name "$POLICY_NAME" --policy-document "$POLICY_DOC" \
    --description "Cursor Cloud Agents (PLX_MC): read $SECRET_ID + Cost Explorer read" >/dev/null
  echo "created policy: $POLICY_ARN"
fi

# ── User (idempotent) ─────────────────────────────────────────────────────────
if aws iam get-user --user-name "$IAM_USER" >/dev/null 2>&1; then
  echo "user exists: $IAM_USER"
else
  aws iam create-user --user-name "$IAM_USER" \
    --tags Key=purpose,Value=cursor-cloud-agents Key=repo,Value=PLX_MC >/dev/null
  echo "created user: $IAM_USER"
fi
aws iam attach-user-policy --user-name "$IAM_USER" --policy-arn "$POLICY_ARN"

# ── Access key ────────────────────────────────────────────────────────────────
if [[ $ROTATE -eq 1 ]]; then
  for key in $(aws iam list-access-keys --user-name "$IAM_USER" \
      --query 'AccessKeyMetadata[].AccessKeyId' --output text); do
    aws iam delete-access-key --user-name "$IAM_USER" --access-key-id "$key"
    echo "rotated out old key: $key"
  done
fi

KEY_COUNT=$(aws iam list-access-keys --user-name "$IAM_USER" \
  --query 'length(AccessKeyMetadata)' --output text)
if [[ "$KEY_COUNT" -ge 2 ]]; then
  echo "user already has $KEY_COUNT access keys (IAM max 2) — re-run with --rotate." >&2
  exit 1
fi

CREDS=$(aws iam create-access-key --user-name "$IAM_USER" \
  --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)
ACCESS_KEY_ID=$(echo "$CREDS" | awk '{print $1}')
SECRET_ACCESS_KEY=$(echo "$CREDS" | awk '{print $2}')

cat <<EOF

== DONE — paste these into Cursor Dashboard -> Cloud Agents -> Secrets ==
   (cursor.com/dashboard -> Cloud Agents -> Secrets; scope them to the PLX_MC
    repo. New agent VMs get them as env vars; running agents need a fresh VM.)

  AWS_ACCESS_KEY_ID     = ${ACCESS_KEY_ID}
  AWS_SECRET_ACCESS_KEY = ${SECRET_ACCESS_KEY}
  AWS_REGION            = ${REGION}

The secret access key is shown ONCE — store it in the dashboard now, then
clear this terminal. Rotate any key that leaks with: $0 --rotate

What this unlocks for cloud agents on PLX_MC:
  - vendor-spend AWS adapter pulls live Cost Explorer spend
  - agents fetch ANTHROPIC_ADMIN_API_KEY / CURSOR_ADMIN_API_KEY etc. from
    ${SECRET_ID} on demand (pip install boto3; get_secret_value)
  - the local agentic-swarm (.swarm) hydrates its keys the same way

Reminder: the DEPLOYED app (Vercel) reads its own env — add the same vendor
keys there separately when enabling automated pulls in production.
EOF
