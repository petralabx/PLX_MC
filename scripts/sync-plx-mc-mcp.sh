#!/usr/bin/env bash
# Sync PLX-MC stdio MCP registration into ~/.cursor/mcp.json (operator-local).
set -euo pipefail
REPO_PATH="$(cd "$(dirname "$0")/.." && pwd)"
MCP_JSON="${MCP_JSON:-$HOME/.cursor/mcp.json}"
ENTRY="$REPO_PATH/tools/plx-mc-mcp/index.ts"
python3 - "$MCP_JSON" "$ENTRY" <<'PY'
import json, sys
path, entry = sys.argv[1], sys.argv[2]
try:
    data = json.load(open(path))
except FileNotFoundError:
    data = {}
servers = data.setdefault("mcpServers", {})
servers["PLX-MC"] = {
    "command": "npx",
    "args": ["tsx", entry],
    "env": {
        "MC_BASE_URL": "https://mc.plxcustomer.io",
        "MC_MCP_API_KEY": "${env:MC_MCP_API_KEY}",
        "MC_OPERATOR_EMAIL": "${env:MC_OPERATOR_EMAIL}",
        "MC_REPO": "taylorvalton/PLX_MC",
        "MC_RUNTIME": "cursor",
        "PLX_MC_MCP_ENABLED": "0",
        "SWARM_API_URL": "http://127.0.0.1:8900",
        "SWARM_DISPATCH_ENABLED": "0",
    },
}
json.dump(data, open(path, "w"), indent=2)
print(f"[sync-plx-mc-mcp] updated {path}")
PY
