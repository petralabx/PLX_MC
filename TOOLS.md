# TOOLS.md

<!-- Canonical reference for tool access, scope, and safety boundaries.
     If an agent can touch it, it is declared here — with its guardrails. -->

## Purpose

Canonical reference for tool access, scope, and safety boundaries.

## Runtime Tool Surface

| Integration | Status | Declaration |
|---|---|---|
| Microsoft Graph (SharePoint sync, directory, notifications) | Active (production SoR `/sites/plx-mission-control` provisioned 2026-07-13; staging sandbox `/sites/plx-mission-control-dev` retained; sync engine v1 shipped 2026-06-11 — outbound push + inbound delta poll on ToDos/Risk Register; webhooks/directory/notifications deferred) | Owner: Vince. Scope: runtime. Auth: client-credentials app (`MICROSOFT_GRAPH_CLIENT_ID/SECRET/TENANT_ID` from secrets manager — currently the broad "Vinces MCP" app; register a least-privilege `plx-mission-control` app before tightening). Default site: `/sites/plx-mission-control` via `sitePath()` / `PLX_MC_SHAREPOINT_SITE_PATH`. Kill switch: `PLX_MC_SYNC_ENABLED=1` gates the in-app scheduler (`src/lib/sync/scheduler.ts`); manual sweeps via `POST /api/sync/sweep`. Health: token acquisition + site/list resolution probe at sweep start. Fallback: UI degrades to read-only of last-synced state. Audit boundary: every reconciliation appends to `sync_audit_log`. |
| AWS Secrets Manager (`prod/ec2-secrets`, us-east-1) | Active (local dev provisioning) | Owner: Vince. Scope: secret source of truth for all runtimes. Loaded on this box via `~/load-secrets.ps1` (per the "AWS Secrets Runtime" provisioning doc, 2026-06-10). |
| Postgres (`plx_mc` on staging RDS `plx-postgres-staging`, us-east-1) | Active (sync persistence; provisioned 2026-06-11 via `scripts/provision-plx-mc-db.mjs`) | Owner: Vince. Scope: runtime (sync engine state: delta cursors, conflict queue, audit log, entity mirror). Auth: dedicated `plx_mc_app` role, URL in `PLX_MC_DATABASE_URL` (secrets manager) — never the trading database or its credentials. Default: schema applied by `npm run migrate` (numbered migrations, `db/migrations/`). Kill switch: the sync service flag (DB is passive storage). Health: migration runner exit code + connection probe. Fallback: UI degrades to read-only of last-synced state. Audit boundary: every reconciliation row lands in `sync_audit_log`. |
| GitHub (repo, CI via Actions) | Active | Owner: Vince. CI re-runs `scripts/preflight.sh` — the same gate as local hooks. |
| GitHub App (read-only repo Contents auth) | Active (App live; PAT fallback org-wide) | Owner: Vince. Scope: runtime (server-side read-only repo Contents/Metadata for loop-ledgers + repo validation). Auth: GitHub App credentials from secrets manager — `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (PEM), `GITHUB_APP_INSTALLATION_ID` / `GITHUB_APP_INSTALLATION_ID_PLX`; the module (`src/lib/github-app`) mints short-lived (≤1h) installation access tokens. When App mint is skipped/fails for **petralabx**, `resolveGithubToken` prefers `PETRALABX_GITHUB_TOKEN` (alias `PETRALABX_GITHUB`) over legacy `GITHUB_TOKEN`. Workstation hydrate: `. $HOME\load-secrets.ps1` and/or `. $HOME\.secrets-env.github.ps1` (see `docs/runbooks/petralabx-github-token-workstation.md`). Kill switch: unset the `GITHUB_APP_*` secrets (reverts to PAT/degraded). Health: installation-token mint success (warns + falls back on failure). Fallback: `PETRALABX_GITHUB_TOKEN` → `GITHUB_TOKEN` → null → loud degraded rows. Audit boundary: no token/key ever logged. Provisioning: `docs/runbooks/github-app-provisioning.md`. |
| PLX-MC MCP (task lifecycle + swarm compose) | Default-OFF (shipped 2026-06-24) | Owner: Vince. Scope: runtime — stdio client (`tools/plx-mc-mcp/`), HTTPS cursor API (`/api/cursor/*`), Streamable HTTP (`/api/cursor/mcp`); swarm leg loopback only. Auth: `PLX_MC_MCP_API_KEY` + allowlisted `X-MC-Operator-Email` (Secrets Manager); swarm via `SWARM_KEY_CMD`. Default: OFF — `PLX_MC_MCP_ENABLED=0`. Kill switch: same flag or remove MCP server from config; `SWARM_DISPATCH_ENABLED=0` disables dispatch tools only. Health: `mc_self_check`. Fallback: `scripts/compliance-checkout.mjs`, `/api/compliance/*`, `bin/swarm ask`. Audit: `mcp.tool.invoked` in `mc_events`. Module: `docs/modules/mcp/README.md`. |
| MC Commit/PR Routing | Default-OFF (central runtime; pilots shadow) | Owner: Vince. Scope: runtime — deterministic engine, MCP suggest, OIDC propose, Routing Inbox, maintenance cron. Auth: Entra oid (humans), `sp_mcp_cursor`, `sp_github_actions_routing`, `sp_routing_maintenance` via `authorize(...)`. Kill switches: `PLX_MC_ROUTING_SHADOW_ENABLED`, `_SUGGEST_`, `_CONFIRM_`, `_PROPOSALS_`, `_METADATA_`, `_INBOX_`, `_MAINTENANCE_`; **`PLX_MC_ROUTING_FUZZY_AUTOLINK_ENABLED` forced off** for all pilots. Health: `rolloutHealth()` + cron probe. Fallback: suggestion-only / explicit triage — sparse Task creation stays retired. Deferred: GitHub App Checks API. Config: `config/mc-routing-rollout.json`, `config/routing-pilots/*`, `.plx/mc-routing.json`. Runbook: `docs/runbooks/mc-routing-rollout.md`. Declaration: `config/integrations.yaml` → `mc-routing`. |
| Vercel (staging hosting, `petralabx/plx-mission-control`) | Active (provisioned 2026-06-11; primary app URL `https://mc.plxcustomer.io`, staging fallback `mc-staging.plxcustomer.io`, prod alias `plx-mission-control.vercel.app`) | Owner: Vince. Scope: runtime (staging). Auth: `VERCEL_API_TOKEN` from secrets manager; pushes to `main` auto-deploy via the GitHub connection. Default: generated URLs gated by Vercel SSO; the custom domain is gated by the staging middleware (`src/middleware.ts`) — Entra OIDC when `PLX_MC_AUTH_*` is configured, Basic-auth break-glass (`PLX_MC_STAGING_PASSWORD`) otherwise, dormant locally. Kill switch: unset the Vercel domain or pause the project; the in-app `setInterval` scheduler stays OFF on Vercel (`PLX_MC_SYNC_ENABLED=0` — serverless timers are unreliable), so the recurring 5-min cadence runs via **Vercel Cron** (`vercel.json` → `GET /api/cron/sweep`, authed by the Vercel-injected `CRON_SECRET` bearer); manual sweeps remain available via `POST /api/sync/sweep`. Kill switch for the scheduled sweep: remove the `crons` entry in `vercel.json` or unset `CRON_SECRET` (the route then returns 503). Health: Vercel deploy status + `/api/state` probe. Fallback: the dev box's Tailscale URL. Audit boundary: same `plx_mc` staging database and `sync_audit_log` as local. |
| Microsoft Entra ID sign-in (app registration `plx-mission-control`) | Active (created 2026-06-11 via Graph; OIDC auth-code flow for the staging gate) | Owner: Vince. Scope: runtime (staging sign-in). Auth: `PLX_MC_AUTH_CLIENT_ID` / `PLX_MC_AUTH_CLIENT_SECRET` (secrets manager; `AUTH_SECRET` stored as `PLX_MC_AUTH_SECRET`); delegated scopes openid/profile/email/User.Read only. Default: sign-in restricted server-side to the `PLX_MC_ALLOWED_USERS` allowlist (fail-closed, Petra domains only). Kill switch: remove the `PLX_MC_AUTH_*` env on Vercel (middleware falls back to the Basic gate). Health: `/api/auth/signin` reachability. Fallback: Basic-auth break-glass. Audit boundary: sign-ins logged by Entra; app writes nothing identity-related yet (directory increment pending). |

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
After hydrate, prefer `PETRALABX_GITHUB_TOKEN` for `petralabx/*` GitHub automation
(`docs/runbooks/petralabx-github-token-workstation.md`); `load-secrets.ps1` aliases
`GITHUB_TOKEN` from that key when present.

## Tool Ownership

| Tool / Surface | Owner | Notes |
|---|---|---|
| Microsoft Graph app registration | Vince | Client-credentials flow; least-privilege Graph app permissions (`Sites.ReadWrite.All`, `User.Read.All`, plus `Mail.Send` / `ChannelMessage.Send` only when notifications ship) |
| AWS Secrets Manager | Vince | One accessor; rotation happens in AWS, never in repo |
| GitHub Actions CI | Vince | Runs `scripts/preflight.sh --mode ci` then `--mode pre-push` |

## In-app sync scheduler — dev-only enablement

The 5-minute in-app sweep scheduler (`src/lib/sync/scheduler.ts`, booted by
`src/instrumentation.ts` when `NEXT_RUNTIME === "nodejs"`) is **DORMANT BY
DEFAULT** and must stay that way in every committed config. The only switch is
the `PLX_MC_SYNC_ENABLED` env var, read as an exact-string compare
(`process.env.PLX_MC_SYNC_ENABLED === "1"`):

- **Default / production / CI / E2E — OFF.** The var is unset (or `""`); on boot
  `startSyncScheduler()` logs `"[sync] scheduler disabled (PLX_MC_SYNC_ENABLED != 1)"`
  and returns without scheduling anything. Vercel pins it `0` (serverless timers
  are unreliable); the deployed app's recurring cadence runs via Vercel Cron
  (`vercel.json` → `GET /api/cron/sweep`), with on-demand sweeps via
  `POST /api/sync/sweep`. The Playwright `webServer.env` pins it `""`. **Do not
  flip the default in any committed file** (no `.env`, no config, no CI var).
- **Local dev opt-in (per developer, in your own shell only):**

  ```bash
  # bash/zsh — this shell session only; never commit this
  PLX_MC_SYNC_ENABLED=1 npm run dev
  ```

  ```powershell
  # PowerShell — this session only
  $env:PLX_MC_SYNC_ENABLED = "1"; npm run dev
  ```

  On boot you'll see `"[sync] scheduler started — sweeping every 5 min"` followed
  by `"[sync] sweep ok — pushed=… pulled=… conflicts=… errors=…"` each cadence.
  With no DB / SharePoint credentials loaded the sweep exercises the in-memory
  engine (the same path as the on-demand "Sync now"), so enabling it proves the
  **cadence**, not a real remote write.
- **Kill switch:** unset the var (close the shell, or `unset PLX_MC_SYNC_ENABLED`
  / `Remove-Item Env:PLX_MC_SYNC_ENABLED`) and restart — the scheduler logs
  "scheduler disabled" and stays dormant. The cadence itself is verified
  deterministically (fake timers, no real clock) in `tests/sync-scheduler.test.ts`.

## Guardrails

- The sync engine never deletes SharePoint items; removals are soft (status
  changes) until a human-approved retention policy says otherwise.
- Outbound notifications (Teams/email) require explicit enablement and log
  every dispatch to the audit trail.
- Non-Petra email domains are rejected server-side for any assignment or
  invite operation.
- Destructive operations against the record (bulk writes, schema changes to
  the SharePoint lists) require explicit operator approval.
