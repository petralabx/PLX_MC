# Operator agent PR setup (per runtime)

**Audience:** operators wiring MCP so agents can check out MC tasks and open
governed PRs.  
**Owner:** Vince · **Status:** active · **Effective:** 2026-08-26  
**Related:** TASK-1261 · [`AGENT-PR-SOP.md`](../AGENT-PR-SOP.md) ·
[`plx-mc-mcp-team-registration.md`](plx-mc-mcp-team-registration.md) ·
[`FLEET-SECRETS-SOP.md`](../FLEET-SECRETS-SOP.md) §4a

> **TL;DR** — One MCP server per repo. Load the repo's `AGENTS.md` /
> `CLAUDE.md` (already in the tree; do not skip). Never invent a `dsp_*`.
> Never write `MC-Checkout: pending`. `mc_complete_task` needs non-empty
> `verificationCommands` **and** `rollback`. Operator email must be on
> `PLX_MC_ALLOWED_USERS` (CSV is source of truth, including Vince-approved
> gmail/Proton exceptions).

Do **not** paste the CIP E2E auto-loop into `AGENTS.md`. That loop belongs in
the CIP / babysit path, not the runtime entry file.

---

## One MCP server per repo

Repository identity is a compliance boundary. Confirm
`meta.actor.repo` equals the exact GitHub slug under edit before checkout.

| Target repo | Connector |
|-------------|-----------|
| `petralabx/PLX_MC` | **PLX-MC-Hub** (`x-mc-repo: petralabx/PLX_MC`) |
| `petralabx/plx-customer-portal` | **PLX-MC-Portal** (`x-mc-repo: petralabx/plx-customer-portal`) |
| `petralabx/local-inference` | Hub `mc_checkout_task` with `repo: petralabx/local-inference`, or the consumer REST script `scripts/mc-checkout-local-inference.sh` |

A Hub stamp on a portal PR (and vice versa) fails GitHub verify with
`taskId:null`. Do not reuse a fixed-`x-mc-repo` entry in a different repo.

---

## Per runtime

| Runtime | How to attach MCP | Notes |
|---------|-------------------|-------|
| **Cursor desktop** | Repo `.cursor/mcp.json` or Settings → MCP. Stdio client `tools/plx-mc-mcp/` (Windows: `scripts/run-plx-mc-mcp.ps1`). | Set `MC_REPO` to the repo open in the window. Enable `PLX_MC_MCP_ENABLED=1` per session. |
| **Cursor Cloud** | Team HTTP at `https://mc.plxcustomer.io/api/cursor/mcp`, or inline `mcpServers[]` on API launch. | Register **PLX-MC-Hub** and **PLX-MC-Portal** as distinct servers. Use only the server whose `mc_self_check` identity matches the target repo. |
| **Claude Code local** | Stdio MCP with `MC_REPO` + `MC_OPERATOR_EMAIL` + matching `MC_MCP_API_KEY` / `MC_MCP_PRINCIPAL_ID`. | Read `CLAUDE.md` in the repo — it is already there. |
| **Claude Cloud** | Project-scope `.mcp.json` only (user-scope `claude mcp add` does not reach Cloud). | This Hub repo's `.mcp.json` is Hub-only. Never put Hub in the portal repo's `.mcp.json`. |
| **Copilot / Gemini / Codex** | Same one-server-per-repo rule. Copilot reads `.github/copilot-instructions.md`; Gemini reads `GEMINI.md`; Codex follows `AGENTS.md`. | Do not skip those files. Do not invent a checkout to open the PR. |

Shared env: `MC_BASE_URL=https://mc.plxcustomer.io`,
`MC_OPERATOR_EMAIL` on the CSV allowlist, `MC_REPO=<owner/name>`.
Registration details and headers:
[`plx-mc-mcp-team-registration.md`](plx-mc-mcp-team-registration.md).

---

## Checkout and complete (every runtime)

1. Search existing `TASK-*`. Do not auto-create unless routing found nothing
   **and** the conductor said to create.
2. `mc_checkout_task` on the connector scoped to the repo under edit. Confirm
   returned `taskId` is a non-null string. Copy `prBodyLine` exactly.
3. Never invent a `dsp_*`. Never write `MC-Checkout: pending`. If checkout
   tools are missing, **stop — do not open the PR**.
4. `mc_complete_task` must include non-empty `verificationCommands` **AND**
   `rollback`.
5. Then run `node scripts/compliance-pr-verify.mjs --wait` when present.

Canonical pipeline: [`AGENT-PR-SOP.md`](../AGENT-PR-SOP.md).
