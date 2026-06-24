# PLX-MC MCP — Team Registration

Register **one** MCP server for the team at [cursor.com/agents](https://cursor.com/agents).

## Stdio (local IDE + Cloud Agents)

| Field | Value |
|-------|-------|
| Name | `PLX-MC` |
| Command | `npx` |
| Args | `tsx tools/plx-mc-mcp/index.ts` |
| `MC_BASE_URL` | `https://mc.plxcustomer.io` |
| `MC_MCP_API_KEY` | from AWS Secrets Manager (`PLX_MC_MCP_API_KEY` in `prod/ec2-secrets`) |
| `MC_OPERATOR_EMAIL` | allowlisted operator (e.g. `vince@petrasoap.com`) |
| `MC_REPO` | target repo slug (e.g. `taylorvalton/plx-customer-portal`) |
| `PLX_MC_MCP_ENABLED` | `1` |
| `SWARM_DISPATCH_ENABLED` | `0` until swarm is needed |

Consumer repos: run `scripts/sync-plx-mc-mcp.sh` or copy `.cursor/mcp.json` `PLX-MC` block; set `MC_REPO` per repo.

## Streamable HTTP (remote, no local Node)

| Field | Value |
|-------|-------|
| URL | `https://mc.plxcustomer.io/api/cursor/mcp` |
| Auth | `X-API-Key: $MC_MCP_API_KEY` + identity headers (see module README) |

Requires `PLX_MC_MCP_ENABLED=1` and `PLX_MC_MCP_API_KEY` on the Vercel/staging deployment.

## Health

Call tool `mc_self_check` or `GET /api/cursor/self-check` with the same headers.

## Rollback

Set `PLX_MC_MCP_ENABLED=0` in team MCP env and redeploy without the cursor carve-out if needed (revert PR).
