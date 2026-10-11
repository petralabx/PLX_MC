#!/usr/bin/env pwsh
# Launch PLX-MC stdio MCP with machine-local secrets loaded.
# Requires ~/.secrets-env.staging.ps1 (see scripts/bootstrap-windows-secrets.py).
# Loader path: -LoaderPath, then $env:PLX_SECRETS_LOADER, then $HOME default.
# Aborts (exit 1) before starting node if the loader is missing or hydration is partial.
param([string]$LoaderPath)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib/plx-secrets-loader.ps1')
try {
  Import-PlxSecretsLoader -LoaderPath $LoaderPath -RequiredEnv @('MC_MCP_API_KEY')
} catch {
  [Console]::Error.WriteLine("[run-plx-mc-mcp] $($_.Exception.Message)")
  exit 1
}
if (-not $env:MC_OPERATOR_EMAIL) { $env:MC_OPERATOR_EMAIL = 'cos@petrasoap.com' }
if (-not $env:PLX_MC_MCP_ENABLED) { $env:PLX_MC_MCP_ENABLED = '0' }
$env:MC_BASE_URL = 'https://mc.plxcustomer.io'
$env:MC_MCP_PRINCIPAL_ID = 'sp_mcp_cursor'
$env:MC_REPO = 'petralabx/PLX_MC'
$env:MC_RUNTIME = 'cursor'
$root = Split-Path -Parent $PSScriptRoot
Set-Location (Join-Path $root 'tools/plx-mc-mcp')
& npx tsx index.ts
