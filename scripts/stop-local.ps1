<#
.SYNOPSIS
  Stops the local AI Scientist stack started by scripts/start-local.ps1:
  the Vite dev server and this project's Supabase containers.

.DESCRIPTION
  It stops the Vite dev server and the `supabase functions serve` process,
  then runs `supabase stop`, which also removes the edge-runtime container.
  `supabase stop` keeps the database and auth data in Docker volumes, so the
  next start-local.ps1 resumes where you left off. It never deletes volumes.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$LogDir = Join-Path $Root '.local-logs'

foreach ($entry in @(@('vite.pid', 'Vite dev server'), @('functions-serve.pid', 'edge-function server'))) {
  $pidFile = Join-Path $LogDir $entry[0]
  if (Test-Path $pidFile) {
    $procId = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($procId -and (Get-Process -Id $procId -ErrorAction SilentlyContinue)) {
      Write-Host "==> Stopping $($entry[1]) (PID $procId)" -ForegroundColor Cyan
      & taskkill.exe /PID $procId /T /F | Out-Null
    }
    Remove-Item $pidFile -ErrorAction SilentlyContinue
  }
}

$Supabase = $null
if ($env:SUPABASE_CLI -and (Test-Path $env:SUPABASE_CLI)) { $Supabase = $env:SUPABASE_CLI }
if (-not $Supabase) { $cmd = Get-Command supabase -ErrorAction SilentlyContinue; if ($cmd) { $Supabase = $cmd.Source } }
if (-not $Supabase) { $f = Join-Path $env:USERPROFILE 'tools\supabase\supabase.exe'; if (Test-Path $f) { $Supabase = $f } }
if (-not $Supabase) { throw 'Supabase CLI not found (set $env:SUPABASE_CLI).' }

Write-Host '==> Stopping the local Supabase stack (data is kept)' -ForegroundColor Cyan
$prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
& $Supabase stop 2>&1 | ForEach-Object { "    $_" }
$ErrorActionPreference = $prev
Write-Host 'Stopped.' -ForegroundColor Green
