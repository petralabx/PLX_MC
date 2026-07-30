# Cloud Agent fleet wiring — design-system / governance enforcement

**Owner:** Vince · **Status:** active · **Program:** `ds-gov-cloud-enforcement`  
**Related:** TASK-682 · SPEC `artifacts/platform/2026-07-24-ds-gov-cloud-enforcement/SPEC.md`  
**Companion:** `docs/runbooks/plx-mc-mcp-team-registration.md`

## Goal

Make every Cursor Cloud Agent session on the petralabx multi-repo environment:

1. Always-apply a **thin fleet** governance + MC-checkout slice (not only ad hoc ops rules).
2. Have **PLX-MC MCP** tools available (`mc_self_check`, `mc_checkout_task`, …) with swarm dispatch default-OFF.
3. **Not** blast portal `--p-*` design-token rules onto opt-out repos.

## Paste source (team rules)

Canonical text to paste into Cursor **Team Rules** (always-apply):

`config/cloud-agent-fleet-always-apply.md`

Dashboard: [Cloud Agents environments](https://cursor.com/dashboard/cloud-agents/environments) → team rules / always-applied rules for the shared environment.

Current environment (2026-07-24 dogfood):  
https://cursor.com/dashboard/cloud-agents/environments/e/2d1524f6-8755-11f1-a7d1-d6b4613131ce

## Cloud MCP paths

Register **Streamable HTTP** Team MCP servers (Integrations → Team MCP Servers).
Do **not** rely on repo-local `.cursor/mcp.json` alone for Cloud — this session’s
MCP catalog only showed `cursor-cloud` until Team HTTP is attached.
Team registration is the dashboard-launch path, but attachment is not reliable
enough to be the only operating path.

| Name | URL | Headers |
|---|---|---|
| `PLX-MC-Hub` | `https://mc.plxcustomer.io/api/cursor/mcp` | `x-api-key: <PLX_MC_MCP_API_KEY>` · `x-mc-operator-email: cos@petrasoap.com` · `x-mc-repo: petralabx/PLX_MC` · `x-mc-runtime: cursor-cloud` |
| `PLX-MC-Portal` | same URL | same key/email · `x-mc-repo: petralabx/plx-customer-portal` · `x-mc-runtime: cursor-cloud` |

Key source: AWS Secrets Manager `prod/ec2-secrets` → `PLX_MC_MCP_API_KEY`.  
Kill switch: disable the Team MCP server entry (or Vercel `PLX_MC_MCP_ENABLED=0`).  
Keep `SWARM_DISPATCH_ENABLED=0` unless a session explicitly needs swarm.

Details and Desktop pitfalls: `docs/runbooks/plx-mc-mcp-team-registration.md`.

### Reliability SOP

1. **API-launched Cloud Agent:** pass both repo-specific servers inline through
   `POST /v1/agents` `mcpServers[]`. This is the primary reliable governed-launch
   path; use `x-mc-runtime: cursor-cloud`. An explicit `repos[]` launch does not
   inherit a named dashboard environment's Runtime Secrets; use the documented
   encrypted `envVars` fallback only for the minimum session values required.
2. **One empty inline catalog:** record which server failed and relaunch once
   with both servers. Use only the server whose `mc_self_check` identity matches
   the target repo. Do not keep retrying.
3. **Dashboard launch with empty Team MCP catalog:** call the REST
   `https://mc.plxcustomer.io/api/cursor/*` lifecycle using the same key and
   identity headers. Exact commands and request bodies are in
   `docs/runbooks/cursor-cloud-service-account-api-key.md`.
4. Never reuse a checkout minted for one `meta.actor.repo` in another repo.

## Environment.json note

This Team environment currently reports `environmentJson: null` / unrecognized
fields. Do **not** assume PLX_MC `.cursor/environment.json` (swarm terminals)
boots on Cloud. Fleet MCP must come from **Team MCP HTTP**, not swarm loopback.

Optional later: add a recognized Cloud `environment.json` for install steps only —
out of scope for TASK-682 unless needed for Node toolchain.

## Verification (fresh Cloud Agent)

After team rules + Team MCP are saved:

1. Start a new Cloud Agent on the shared multi-repo environment.
2. Confirm always-applied rules include the four fleet slices from
   `config/cloud-agent-fleet-always-apply.md`.
3. Confirm the target repo's MCP catalog is non-empty. If Team attachment is
   empty, use the inline launch path above and record the Team attach failure.
4. Call `mc_self_check` → `ok: true`, `mcpEnabled: true`.
5. Call `mc_checkout_task` on a throwaway/backlog task → receive `MC-Checkout: dsp_*`
   with `meta.actor.repo` matching the target repo.
6. Confirm a non-adopting repo session (e.g. `local-inference`) does **not** receive
   portal `--p-*` token mandates from the fleet slice.

Record results in  
`artifacts/platform/2026-07-24-ds-gov-cloud-enforcement/CLOUD-WIRING-VERDICT.md`.

## Rollback

1. Remove or disable the pasted Team Rules.
2. Disable `PLX-MC-Hub` / `PLX-MC-Portal` Team MCP entries.
3. Repo-local `.cursor/mcp.json` remains default-OFF (`PLX_MC_MCP_ENABLED=0`).
