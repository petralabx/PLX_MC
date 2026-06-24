# swarm-dispatch MCP server

A tiny, **dependency-free** MCP (Model Context Protocol) stdio server that lets
Cursor agents — both the local IDE agent and **Cloud Agents** — delegate work to
the [`agentic-swarm`](https://github.com/taylorvalton/agentic-swarm) (41 agents /
7 teams) through its HTTP dispatch API.

It is a thin HTTP client over `POST /dispatch`; it has **no dependency on the
swarm source**. Point it at a local `swarm serve` today, or a hosted endpoint
later by changing `SWARM_API_URL`.

> **Governance:** this integration acts autonomously, so per `AGENTS.md` →
> "Agentic Swarm Delegation" it ships **disabled** (`SWARM_DISPATCH_ENABLED=0`).
> Enable it explicitly per session/operator.

## Tools

| Tool | What it does |
|---|---|
| `dispatch_to_swarm` | POST a task to the swarm (`team` defaults to `ceo` COS orchestration). |
| `list_swarm_teams` | List the valid dispatch routes. |
| `swarm_health` | `GET /health` to check the swarm is reachable. |

## Configuration (env)

| Var | Default | Notes |
|---|---|---|
| `SWARM_API_URL` | `http://127.0.0.1:8900` | The running `swarm serve` (or a hosted endpoint). |
| `SWARM_API_KEY` | _(unset)_ | Explicit `X-API-Key`. Usually left unset in favour of `SWARM_KEY_CMD`. Unsubstituted `${env:...}` placeholders are ignored. |
| `SWARM_KEY_CMD` | _(set in `.cursor/mcp.json`)_ | Shell command whose stdout is the key. Defaults to the swarm's own `get_secret` accessor, which pulls `SWARM_API_KEY` from **AWS Secrets Manager** via the VM IAM role — so auth stays on with **no duplicated secret**. |
| `SWARM_DEFAULT_TEAM` | `ceo` | Default dispatch route. |
| `SWARM_DISPATCH_TIMEOUT_MS` | `900000` | Client-side timeout (15 min). |
| `SWARM_DISPATCH_ENABLED` | `1` | Committed config sets `0` (opt-in); set `1` to enable. |

### API-key resolution

`SWARM_API_KEY` (explicit) → `SWARM_KEY_CMD` (stdout) → none (unauthenticated;
works against a loopback server started with `SWARM_API_KEY_REQUIRED=0`). The key
is resolved once and cached, and `${env:...}` placeholders are treated as unset.

## Local use

1. The swarm is cloned to `./.swarm` and its venv built by
   `.cursor/environment.json` (or run that install manually).
2. Start it: `bin/swarm serve --host 127.0.0.1 --port 8900`.
3. Set `SWARM_DISPATCH_ENABLED=1` in `.cursor/mcp.json` and reload Cursor MCP servers.
4. Requires **Node ≥ 18** (global `fetch`).

## Cloud Agent use

`.cursor/mcp.json` is **not** read by Cloud Agents — register this server as a
team **stdio** MCP at <https://cursor.com/agents> (MCP dropdown):

- **Command:** `node`
- **Args:** `tools/swarm-dispatch-mcp/server.mjs`
- **Env:**
  - `SWARM_API_URL=http://127.0.0.1:8900`
  - `SWARM_DISPATCH_ENABLED=1`
  - `SWARM_KEY_CMD=.swarm/.venv/bin/python -c "import sys; sys.path.insert(0,'.swarm'); from src.secrets import get_secret; sys.stdout.write(get_secret('SWARM_API_KEY'))"`

The swarm itself is brought up in the VM by `.cursor/environment.json`, and the
key resolver above reads `SWARM_API_KEY` straight from AWS Secrets Manager via the
VM's assumed IAM role.

## Quick test

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | node tools/swarm-dispatch-mcp/server.mjs
```
