#!/usr/bin/env bash
# EN-007 P3 acceptance — validate the compliance-gate workflow + capture hook
# without any network/DB: JS syntax, hooks-config JSON, and the workflow's
# required shape. Exit 0 when all present + valid.

set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

echo "[compliance-ci-check] node --check scripts/compliance-checkout.mjs"
node --check scripts/compliance-checkout.mjs

echo "[compliance-ci-check] .cursor/compliance-hooks.json is valid JSON + default-off"
node -e '
  const fs = require("fs");
  const cfg = JSON.parse(fs.readFileSync(".cursor/compliance-hooks.json", "utf8"));
  if (cfg.enabled !== false) { console.error("hook must ship disabled (enabled:false)"); process.exit(1); }
'

echo "[compliance-ci-check] workflow present + key fields"
wf=".github/workflows/compliance-gate.yml"
test -f "$wf"
grep -q "workflow_call" "$wf"
grep -q "/api/compliance/verify" "$wf"
grep -q "compliance gate skipped" "$wf"   # default-off skip path
grep -qE "MC-Checkout.*\|\| true" "$wf"    # stamp read is no-match-safe (operator PR under pipefail)

echo "[compliance-ci-check] OK"
