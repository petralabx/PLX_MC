#!/usr/bin/env pwsh
# Launch PLX-MC stdio MCP with machine-local secrets loaded.
# Requires ~/.secrets-env.staging.ps1 (see scripts/bootstrap-windows-secrets.py).
$ErrorActionPreference = 'Stop'
$loader = Join-Path $HOME '.secrets-env.staging.ps1'
if (Test-Path $loader) { . $loader }
if (-not $env:MC_MCP_API_KEY) {
  throw 'MC_MCP_API_KEY missing — run: python scripts/bootstrap-windows-secrets.py'
}
if (-not $env:MC_OPERATOR_EMAIL) { $env:MC_OPERATOR_EMAIL = 'cos@petrasoap.com' }
if (-not $env:PLX_MC_MCP_ENABLED) { $env:PLX_MC_MCP_ENABLED = '0' }
$env:MC_BASE_URL = 'https://mc.plxcustomer.io'
$env:MC_REPO = 'taylorvalton/PLX_MC'
$env:MC_RUNTIME = 'cursor'
$root = Split-Path -Parent $PSScriptRoot
Set-Location (Join-Path $root 'tools/plx-mc-mcp')
& npx tsx index.ts
