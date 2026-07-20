# PLX-MC MCP — Team Registration

Register one MCP entry **per target repository** at
[cursor.com/agents](https://cursor.com/agents), or use a repo-local
`.cursor/mcp.json`. Repository identity is a compliance boundary: never reuse a
fixed-`x-mc-repo` entry in a different repo. Use distinct names such as
`PLX-MC-Portal` and `PLX-MC-Hub`.

## Stdio (local IDE + Cloud Agents)

### Linux / macOS / Cloud Agent (env vars in team MCP config)

| Field | Value |
|-------|-------|
| Name | Repo-specific, e.g. `PLX-MC-Portal` |
| Command | `npx` |
| Args | `tsx tools/plx-mc-mcp/index.ts` |
| `MC_BASE_URL` | `https://mc.plxcustomer.io` |
| `MC_MCP_API_KEY` | from AWS Secrets Manager (`PLX_MC_MCP_API_KEY` in `prod/ec2-secrets`) |
| `MC_OPERATOR_EMAIL` | allowlisted `@petrasoap.com` operator — **agents:** `cos@petrasoap.com`; **human:** `vince@petrasoap.com` |
| `MC_REPO` | target repo slug (e.g. `petralabx/plx-customer-portal`) |
| `PLX_MC_MCP_ENABLED` | `1` |
| `SWARM_DISPATCH_ENABLED` | `0` until swarm is needed |

### Windows workstation (Cursor shell env unreliable)

Cursor MCP child processes do not inherit PowerShell env vars. Use the repo launcher:

1. One-time bootstrap (writes `~/.secrets-env.staging.ps1`, enables MCP locally):

   ```powershell
   python scripts/bootstrap-windows-secrets.py
   ```

2. Override the local `PLX-MC` block in `.cursor/mcp.json` to run the Windows launcher
   (do **not** commit this override — Linux/macOS keep `node tools/plx-mc-mcp/launch.mjs`):

   ```json
   "command": "pwsh",
   "args": ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/run-plx-mc-mcp.ps1"]
   ```

   The script dot-sources `~/.secrets-env.staging.ps1` and starts the stdio client.

3. Reload Cursor MCP servers after bootstrap or key rotation.

Server allowlist: set `PLX_MC_ALLOWED_USERS` on Vercel Production (comma-separated Petra emails), then **redeploy**.

Consumer repos: run `scripts/sync-plx-mc-mcp.sh` or copy `.cursor/mcp.json` `PLX-MC` block; set `MC_REPO` per repo.

## Streamable HTTP (remote, no local Node) — **recommended for team registration**

Register at [cursor.com/agents](https://cursor.com/agents) → MCP servers → Add server:

| Field | Value |
|-------|-------|
| Name | Repo-specific, e.g. `PLX-MC-Portal` |
| URL | `https://mc.plxcustomer.io/api/cursor/mcp` |
| Header `x-api-key` | `PLX_MC_MCP_API_KEY` from `prod/ec2-secrets` (AWS Secrets Manager) |
| Header `x-mc-operator-email` | `cos@petrasoap.com` (agents) or `vince@petrasoap.com` (human operator) |
| Header `x-mc-repo` | Target repo slug, e.g. `petralabx/plx-customer-portal` or `petralabx/PLX_MC` |
| Header `x-mc-runtime` | `cursor` |

Requires `PLX_MC_MCP_ENABLED=1` on the Vercel production deployment (already live).

**Verified 2026-06-30:** `GET /api/cursor/self-check` returns `200 { ok: true, mcpEnabled: true }` with the headers above.

After registration, reload MCP in Cursor and run `mc_self_check`. Confirm the
returned `meta.actor.repo` exactly matches the repo being edited before checkout.

### Workstation pitfall (2026-07-20)

A single user-level `~/.cursor/mcp.json` entry named `PLX-MC` with
`MC_REPO=petralabx/plx-customer-portal` will mint portal-scoped checkouts even
when the open worktree is `PLX_MC` (repo-local `.cursor/mcp.json` does not win
if the user server is enabled). Split into:

| Name | `MC_REPO` / `x-mc-repo` |
|---|---|
| `PLX-MC-Hub` | `petralabx/PLX_MC` |
| `PLX-MC-Portal` | `petralabx/plx-customer-portal` |

Then reload MCP servers. If a stamp was minted under the wrong slug, re-checkout
with `COMPLIANCE_CAPTURE=1 MC_REPO=petralabx/PLX_MC node scripts/compliance-checkout.mjs`
and replace the PR body line before re-running compliance.

## Health

Call tool `mc_self_check` or `GET /api/cursor/self-check` with the same headers.

## Skills Directory Tools

The same tools are available through Streamable HTTP and the local stdio MCP:

| Tool | Purpose |
|------|---------|
| `mc_list_skills` | List approved skills; accepts `q`, `tag`, and `status` filters. The response `meta` includes `catalogVersion`. |
| `mc_install_skills` | Build local install/sync scripts; accepts `ids`, `mode`, `runtimes`, `projectRoot`, and `localRegistry`. |
| `mc_sync_skills` | Compare a local registry against the approved package; accepts `packageId`, `localRegistry`, and `runtimes`. |
| `mc_submit_skill` | Submit a proposed skill for review with `id`, `name`, `description`, `skillMd`, optional `tags`, and optional `owner`. |

Use `mc_install_skills` in dry-run style first: the server returns scripts and drift metadata, then the operator or agent executes the script in the intended local project.

## Rollback

Set `PLX_MC_MCP_ENABLED=0` in team MCP env and redeploy without the cursor carve-out if needed (revert PR).
