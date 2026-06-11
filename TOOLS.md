# TOOLS.md

<!-- Canonical reference for tool access, scope, and safety boundaries.
     If an agent can touch it, it is declared here — with its guardrails. -->

## Purpose

Canonical reference for tool access, scope, and safety boundaries.

## Runtime Tool Surface

| Integration | Status | Declaration |
|---|---|---|
| Microsoft Graph (SharePoint sync, directory, notifications) | Active for provisioning (staging site `/sites/plx-mission-control-dev` provisioned 2026-06-11 via `scripts/provision-sharepoint.py`); sync engine not yet implemented | Owner: Vince. Scope: runtime. Auth: client-credentials app (`MICROSOFT_GRAPH_CLIENT_ID/SECRET/TENANT_ID` from secrets manager — currently the broad "Vinces MCP" app; register a least-privilege `plx-mission-control` app before production). Default: off until the sync module lands. Kill switch: env flag on the sync service. Health: token acquisition + site reachability probe. Fallback: UI degrades to read-only of last-synced state. Audit boundary: every write mirrored to the sync audit log. |
| AWS Secrets Manager (`prod/ec2-secrets`, us-east-1) | Active (local dev provisioning) | Owner: Vince. Scope: secret source of truth for all runtimes. Loaded on this box via `~/load-secrets.ps1` (per the "AWS Secrets Runtime" provisioning doc, 2026-06-10). |
| Postgres (`plx_mc` on staging RDS `plx-postgres-staging`, us-east-1) | Active (sync persistence; provisioned 2026-06-11 via `scripts/provision-plx-mc-db.mjs`) | Owner: Vince. Scope: runtime (sync engine state: delta cursors, conflict queue, audit log, entity mirror). Auth: dedicated `plx_mc_app` role, URL in `PLX_MC_DATABASE_URL` (secrets manager) — never the trading database or its credentials. Default: schema applied by `npm run migrate` (numbered migrations, `db/migrations/`). Kill switch: the sync service flag (DB is passive storage). Health: migration runner exit code + connection probe. Fallback: UI degrades to read-only of last-synced state. Audit boundary: every reconciliation row lands in `sync_audit_log`. |
| GitHub (repo, CI via Actions) | Active | Owner: Vince. CI re-runs `scripts/preflight.sh` — the same gate as local hooks. |

Every new external provider, MCP server, or operator-side tool must complete
the declaration checklist (owner, scope, auth source, default state, kill
switch, health check, fallback, audit boundary) **before merge** — see the
External Integrations section of the governance block in `AGENTS.md`.

## Access Control

- Local/dev: secrets load into the shell session from AWS Secrets Manager;
  nothing secret is committed.
- Production: not yet provisioned (deploy target is an open decision — see
  LESSONS/next-session notes). Auth model for the app itself will be Microsoft
  365 identity (the audience is internal Petra staff only).

## Secrets Source of Truth

AWS Secrets Manager, secret id `prod/ec2-secrets`, region `us-east-1`.
Loaded into the environment by `~/load-secrets.ps1` (dev box) and read by code
through **one shared accessor module** (to be created with the first runtime
code that needs a secret). No hardcoded keys, no scattered `process.env` reads.

## Tool Ownership

| Tool / Surface | Owner | Notes |
|---|---|---|
| Microsoft Graph app registration | Vince | Client-credentials flow; least-privilege Graph app permissions (`Sites.ReadWrite.All`, `User.Read.All`, plus `Mail.Send` / `ChannelMessage.Send` only when notifications ship) |
| AWS Secrets Manager | Vince | One accessor; rotation happens in AWS, never in repo |
| GitHub Actions CI | Vince | Runs `scripts/preflight.sh --mode ci` then `--mode pre-push` |

## Guardrails

- The sync engine never deletes SharePoint items; removals are soft (status
  changes) until a human-approved retention policy says otherwise.
- Outbound notifications (Teams/email) require explicit enablement and log
  every dispatch to the audit trail.
- Non-Petra email domains are rejected server-side for any assignment or
  invite operation.
- Destructive operations against the record (bulk writes, schema changes to
  the SharePoint lists) require explicit operator approval.
