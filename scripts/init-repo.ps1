# One-time setup: creates the git repo and moves the CI workflow into place.
# Run from the repo root:  powershell -ExecutionPolicy Bypass -File scripts\init-repo.ps1
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

New-Item -ItemType Directory -Force -Path ".github\workflows" | Out-Null
Move-Item -Force "scripts\ci.yml" ".github\workflows\ci.yml"

if (-not (Test-Path ".git")) { git init -b main | Out-Null }
git add -A
git commit -m "Scaffold v0.1: Tauri desktop dictation app, core pipeline, eval, docs"
Write-Host "Repo ready. Next: pnpm install; pnpm dev:desktop"
Remove-Item -Force "scripts\init-repo.ps1"
git add -A
git commit -m "Remove one-time init script" | Out-Null
