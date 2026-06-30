#Requires -Version 5.1
<#
.SYNOPSIS
  Install the company-approved Cursor/Claude skill subset for PLX contributors.

.DESCRIPTION
  Wrapper around scripts/bootstrap-company-skills.sh (requires Git Bash on Windows).
  Copies published skills from taylorvalton/plx-cursor-skills — not agentic-swarm.

.PARAMETER ProjectRoot
  Repo to mirror skills into (default: parent of scripts/).

.PARAMETER SkillsRepo
  Local plx-cursor-skills checkout (default: $env:USERPROFILE\plx-cursor-skills).

.PARAMETER DryRun
  Print actions without mutating disk.

.EXAMPLE
  cd C:\Users\you\PLX_MC
  .\scripts\bootstrap-company-skills.ps1

.EXAMPLE
  .\scripts\bootstrap-company-skills.ps1 -ProjectRoot C:\Users\you\plx-customer-portal
#>
[CmdletBinding()]
param(
    [string]$ProjectRoot = (Split-Path $PSScriptRoot -Parent),
    [string]$SkillsRepo = (Join-Path $env:USERPROFILE "plx-cursor-skills"),
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = (Resolve-Path $ProjectRoot).Path
$BashScript = Join-Path $ScriptRoot "bootstrap-company-skills.sh"
$GitBash = "C:\Program Files\Git\bin\bash.exe"

if (-not (Test-Path $GitBash)) {
    throw "Git Bash required at $GitBash. Install Git for Windows, then re-run."
}
if (-not (Test-Path $BashScript)) {
    throw "Missing bootstrap script: $BashScript"
}

$posixProject = ($ProjectRoot -replace '\\', '/').Replace('C:', '/c')
$posixSkills = ($SkillsRepo -replace '\\', '/').Replace('C:', '/c')
$posixScript = ($BashScript -replace '\\', '/').Replace('C:', '/c')

$dryFlag = if ($DryRun) { "--dry-run" } else { "" }
$cmd = "cd `"$(Split-Path $posixScript -Parent)`" && bash `"$posixScript`" --project-root `"$posixProject`" --skills-repo `"$posixSkills`" $dryFlag"

Write-Host "=== PLX company skills bootstrap (Windows) ==="
& $GitBash -lc $cmd
if ($LASTEXITCODE -ne 0) {
    throw "bootstrap-company-skills.sh failed with exit $LASTEXITCODE"
}

if (-not $DryRun) {
    $globalSkills = Join-Path $env:USERPROFILE ".cursor\skills"
    $count = (Get-ChildItem $globalSkills -Directory -ErrorAction SilentlyContinue).Count
    Write-Host ""
    Write-Host "Installed $count global skill(s) under $globalSkills"
    Write-Host "Start a NEW Cursor session to load skills."
}
