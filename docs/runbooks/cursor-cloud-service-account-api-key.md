# Cursor Cloud — API key for inline MCP launches

**Owner:** Vince · **Status:** active · **Related:** TASK-682 / ds-gov-cloud-enforcement  
**Why:** Team HTTP MCP servers (`PLX-MC-Hub` / `PLX-MC-Portal`) are registered but
often **fail to attach** to Cloud Agent tool catalogs (Cursor platform bug). A
**user or service-account API key** lets automation launch Cloud Agents with inline
`mcpServers[]`, bypassing the broken Team MCP attach path for verification and
governed runs.

## Create the key (human — dashboard only)

Use **either**:

1. **Personal user API key** (works now; current production secret) —
   [Dashboard → API Keys](https://cursor.com/dashboard/api) → **New API Key**.
   Must **not** be a Team Admin/spend key (those return 401 on `/v0|/v1/agents`).
2. **Enterprise service account** (preferred for shared CI later) —
   Team Settings → Service accounts → mint a key.

Store in AWS Secrets Manager `prod/ec2-secrets` as `CURSOR_CLOUD_SERVICE_API_KEY`
(name kept for continuity; value may be a personal user key).
This Cloud Agent role is **secrets-read only** and cannot `PutSecretValue`.

**Verified 2026-07-24 (Vince confirmed personal key):** secret → `GET /v1/me`
`vince@petrasoap.com`; inline MCP launch agent
`bc-83d3035f-1fa5-4191-acc4-6ccc26b65b9d` saw `PLX-MC-Hub` / `PLX-MC-Portal`
and `mc_self_check: ok`.

## Verify the key type

```bash
# Must NOT be the Team Admin spend key (crsr_… Admin). User/service keys work with:
curl -sS -u "$CURSOR_CLOUD_SERVICE_API_KEY:" \
  https://api.cursor.com/v1/me
```

If you see *“This is a team API key … only works with the Cursor Admin API”*,
you used the wrong key.

## Launch a Cloud Agent with inline PLX-MC MCP

Use **`POST /v1/agents`** with `repos` + `mcpServers`. The v0 create shape
rejects `mcpServers`.

```bash
export CURSOR_CLOUD_SERVICE_API_KEY=…   # from secrets (personal or service account)
export PLX_MC_MCP_API_KEY=…             # from prod/ec2-secrets

# v1 shape (2026-07): prompt must be { text }, repos use startingRef.
curl -sS --request POST \
  --url https://api.cursor.com/v1/agents \
  -u "${CURSOR_CLOUD_SERVICE_API_KEY}:" \
  --header 'Content-Type: application/json' \
  --data @- <<EOF
{
  "prompt": {
    "text": "Call mc_self_check via PLX-MC-Portal. Report whether Hub/Portal MCP tools are in the catalog. Do not change code."
  },
  "repos": [
    {
      "url": "https://github.com/petralabx/plx-customer-portal",
      "startingRef": "staging"
    },
    {
      "url": "https://github.com/petralabx/PLX_MC",
      "startingRef": "main"
    }
  ],
  "mcpServers": [
    {
      "name": "PLX-MC-Hub",
      "type": "http",
      "url": "https://mc.plxcustomer.io/api/cursor/mcp",
      "headers": {
        "x-api-key": "${PLX_MC_MCP_API_KEY}",
        "x-mc-operator-email": "cos@petrasoap.com",
        "x-mc-repo": "petralabx/PLX_MC",
        "x-mc-runtime": "cursor-cloud"
      }
    },
    {
      "name": "PLX-MC-Portal",
      "type": "http",
      "url": "https://mc.plxcustomer.io/api/cursor/mcp",
      "headers": {
        "x-api-key": "${PLX_MC_MCP_API_KEY}",
        "x-mc-operator-email": "cos@petrasoap.com",
        "x-mc-repo": "petralabx/plx-customer-portal",
        "x-mc-runtime": "cursor-cloud"
      }
    }
  ]
}
EOF
```

The create response is `{ agent, run }`: record `agent.id`, `agent.url`, and
`run.id`, then read terminal status from
`GET /v1/agents/{agentId}/runs/{runId}`.

`repos[]` and a named Cloud `env` are mutually exclusive in the v1 API.
Therefore an explicit multi-repo launch does **not** inherit the saved
environment's Runtime Secrets or install state. If that run needs a secret for
a REST/E2E fallback, pass only the required values through encrypted
session-scoped `envVars` and verify boolean/length presence in the agent.
`envVars` is a beta field and may be silently ignored for accounts where it has
not rolled out; never assume injection succeeded.

Verified 2026-07-29: agent `bc-a6a3aa9b-0fcc-4c4a-819e-5c726d5641ae` —
Portal MCP tools attached + `mc_self_check` ok. Either repo-specific server can
occasionally attach with an empty catalog. Record the failed server, relaunch
once with both inline, and do not use a server until `meta.actor.repo` matches
the target repository.

## Interim path (dashboard-launched agents without Team MCP attach)

Hydrate `PLX_MC_MCP_API_KEY` from AWS, set the target repo explicitly, and use
`x-mc-runtime: cursor-cloud`. This is the working fallback when a
dashboard-launched agent has no Team MCP catalog:

```bash
set -euo pipefail
: "${PLX_MC_MCP_API_KEY:?hydrate from prod/ec2-secrets}"

MC_BASE_URL=https://mc.plxcustomer.io
MC_REPO=petralabx/PLX_MC # change per target repo
MC_HEADERS=(
  -H "x-api-key: ${PLX_MC_MCP_API_KEY}"
  -H "x-mc-operator-email: cos@petrasoap.com"
  -H "x-mc-repo: ${MC_REPO}"
  -H "x-mc-runtime: cursor-cloud"
  -H "content-type: application/json"
)

self_check="$(curl -fsS "${MC_HEADERS[@]}" \
  "${MC_BASE_URL}/api/cursor/self-check")"
jq -e --arg repo "${MC_REPO}" \
  '.data.ok == true and .data.mcpEnabled == true and .meta.actor.repo == $repo' \
  <<<"${self_check}"

checkout="$(curl -fsS -X POST "${MC_HEADERS[@]}" \
  "${MC_BASE_URL}/api/cursor/checkout" \
  --data '{"taskId":"TASK-REPLACE"}')"
checkout_id="$(jq -er '.data.checkoutId' <<<"${checkout}")"
jq -r '.data.prBodyLine' <<<"${checkout}"

curl -fsS -X POST "${MC_HEADERS[@]}" \
  "${MC_BASE_URL}/api/cursor/progress" \
  --data '{"taskId":"TASK-REPLACE","stage":"progress","progressPct":75,"notes":"Cloud closeout verification"}'

jq -n --arg checkoutId "${checkout_id}" '{
  checkoutId: $checkoutId,
  summary: "Cloud Agent completed governed closeout verification",
  rollback: "Reopen the task if the evidence is invalid",
  verificationCommands: [
    "REST self-check returned the exact target repo",
    "checkout -> progress -> complete"
  ]
}' | curl -fsS -X POST "${MC_HEADERS[@]}" \
  "${MC_BASE_URL}/api/cursor/complete" --data @-
```

Use a real backlog task in the correct bucket and replace `TASK-REPLACE`
consistently. Preserve the exact returned `MC-Checkout` line; never construct
one manually.

See `docs/runbooks/cloud-agent-fleet-wiring.md` and
`docs/runbooks/plx-mc-mcp-team-registration.md`.

## Kill switch

Delete/rotate the key in the Cursor dashboard; remove
`CURSOR_CLOUD_SERVICE_API_KEY` from `prod/ec2-secrets`. Team MCP entries remain
independently disableable.
