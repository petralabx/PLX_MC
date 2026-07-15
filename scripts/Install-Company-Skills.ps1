#Requires -Version 5.1
<#
.SYNOPSIS
  One-click Windows installer for PLX company skills (no secrets).

.DESCRIPTION
  Finds or shallow-clones petralabx/PLX_MC, then runs bootstrap-company-skills.ps1.
  Safe to double-click via Install-Company-Skills.cmd.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

function Find-PlxMcRoot {
    $candidates = @(
        (Join-Path $PSScriptRoot ".."),
        (Join-Path $env:USERPROFILE "PLX_MC"),
        (Join-Path $env:USERPROFILE "source\PLX_MC"),
        (Join-Path $env:LOCALAPPDATA "PLX\PLX_MC")
    )
    foreach ($c in $candidates) {
        $bootstrap = Join-Path $c "scripts\bootstrap-company-skills.ps1"
        if (Test-Path $bootstrap) {
            return (Resolve-Path $c).Path
        }
    }
    return $null
}

Write-Host "Looking for PLX_MC..."
$root = Find-PlxMcRoot

if (-not $root) {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        throw "Git is required. Install Git for Windows from https://git-scm.com/download/win then re-run."
    }
    $root = Join-Path $env:LOCALAPPDATA "PLX\PLX_MC"
    $parent = Split-Path $root -Parent
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    Write-Host "Cloning petralabx/PLX_MC (shallow) to $root ..."
    if (Test-Path $root) {
        Remove-Item -Recurse -Force $root
    }
    git clone --depth 1 --branch main "https://github.com/petralabx/PLX_MC.git" $root
    if ($LASTEXITCODE -ne 0) {
        throw "git clone failed with exit $LASTEXITCODE"
    }
} else {
    Write-Host "Using $root"
    if (Get-Command git -ErrorAction SilentlyContinue) {
        Push-Location $root
        try {
            git pull --ff-only origin main 2>$null | Out-Null
        } catch {
            Write-Host "(skip pull — offline or detached worktree is fine)"
        }
        Pop-Location
    }
}

$bootstrap = Join-Path $root "scripts\bootstrap-company-skills.ps1"
if (-not (Test-Path $bootstrap)) {
    throw "Missing bootstrap script at $bootstrap"
}

Write-Host "Running company skills bootstrap..."
& $bootstrap -ProjectRoot $root
if ($LASTEXITCODE -ne 0) {
    throw "bootstrap-company-skills.ps1 failed with exit $LASTEXITCODE"
}

Write-Host ""
Write-Host "Skills installed under $env:USERPROFILE\.cursor\skills"
Write-Host "Restart Cursor (fully quit, then reopen) to load them."
