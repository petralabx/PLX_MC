#Requires -Version 5.1
<#
.SYNOPSIS
  One-click Windows installer for PLX company skills (no secrets).

.DESCRIPTION
  Finds or shallow-clones petralabx/PLX_MC (via a signed-in GitHub CLI; runs
  'gh auth login' if needed), then runs bootstrap-company-skills.ps1.
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
    # PLX_MC is (or will be) private: require a signed-in GitHub CLI and clone
    # through it so credentials come from `gh auth`, never an anonymous URL.
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        throw "GitHub CLI (gh) is required. Install it from https://cli.github.com/ then run 'gh auth login' and re-run."
    }
    # Native stderr must not trip $ErrorActionPreference=Stop on Windows PowerShell 5.1.
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & gh auth status --hostname github.com *> $null
    $signedIn = ($LASTEXITCODE -eq 0)
    if (-not $signedIn) {
        Write-Host "You are not signed in to GitHub. Running 'gh auth login' now (choose GitHub.com, HTTPS, and sign in with your petralabx account)..."
        & gh auth login --hostname github.com --git-protocol https --web
        & gh auth status --hostname github.com *> $null
        $signedIn = ($LASTEXITCODE -eq 0)
    }
    if ($signedIn) { & gh auth setup-git --hostname github.com *> $null }
    $ErrorActionPreference = $prevEap
    if (-not $signedIn) {
        throw "Not signed in to GitHub. Run 'gh auth login' yourself, then re-run this installer."
    }
    $root = Join-Path $env:LOCALAPPDATA "PLX\PLX_MC"
    $parent = Split-Path $root -Parent
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    Write-Host "Cloning petralabx/PLX_MC (shallow) to $root ..."
    if (Test-Path $root) {
        Remove-Item -Recurse -Force $root
    }
    & gh repo clone petralabx/PLX_MC $root -- --depth 1 --branch main
    if ($LASTEXITCODE -ne 0) {
        throw "gh repo clone failed with exit $LASTEXITCODE (check that your GitHub account has access to petralabx/PLX_MC)"
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
