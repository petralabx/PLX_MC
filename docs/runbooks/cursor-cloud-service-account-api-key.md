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

curl -sS --request POST \
  --url https://api.cursor.com/v1/agents \
  -u "${CURSOR_CLOUD_SERVICE_API_KEY}:" \
  --header 'Content-Type: application/json' \
  --data @- <<EOF
{
  "prompt": "Call mc_self_check via PLX-MC-Hub. Report whether Hub/Portal MCP tools are in the catalog. Do not change code.",
  "repos": [
    {
      "url": "https://github.com/petralabx/PLX_MC",
      "ref": "main"
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

## Interim path (dashboard-launched agents without Team MCP attach)

Hydrate `PLX_MC_MCP_API_KEY` from AWS and call REST:

- `GET /api/cursor/self-check`
- `POST /api/cursor/checkout`
- `POST /api/cursor/progress`
- `POST /api/cursor/complete`

See `docs/runbooks/cloud-agent-fleet-wiring.md` and
`docs/runbooks/plx-mc-mcp-team-registration.md`.

## Kill switch

Delete/rotate the key in the Cursor dashboard; remove
`CURSOR_CLOUD_SERVICE_API_KEY` from `prod/ec2-secrets`. Team MCP entries remain
independently disableable.
