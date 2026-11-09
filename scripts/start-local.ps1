<#
.SYNOPSIS
  Starts the self-hosted AI Scientist stack on this PC:
  local Supabase (Postgres, Auth, Realtime, REST, edge functions) and the
  Vite frontend on http://localhost:5180.

.DESCRIPTION
  Safe to run repeatedly. Steps:
    1. checks Docker, the Supabase CLI, Node and bun
    2. creates supabase/functions/.env from .env.example on first run
    3. supabase start (data in Docker volumes is kept between runs)
    4. applies supabase/local-bootstrap.sql as the local superuser, then
       `supabase migration up` (pending migrations only)
    5. writes .env.development.local so the dev server talks to the local stack
    6. creates the test users in .local-test-user.json (first run only)
    7. checks that the configured Ollama models are available
    8. serves the edge functions with `supabase functions serve --inspect-mode run`.
       Inspect mode is the only way the local edge runtime lifts its
       400-second wall-clock limit per worker; plan generation on a CPU-only
       local model takes far longer than that. Once the runtime is up the
       CLI process (and with it the file watcher) is stopped; the runtime
       container keeps serving. On Windows the watcher also fires on NTFS
       last-access updates (git status, a directory listing, a virus scan),
       and every "change" restarts the runtime and kills runs in progress.
       If the runtime is already serving it is left alone (use
       -RestartFunctions after editing function code, or -Watch to keep hot
       reload while developing).
       It also lifts the per-worker CPU budget the CLI hard-codes into the
       runtime's main service (1 s soft / 2 s hard, cumulative over the
       worker's life, background work included). A run on a CPU-only local
       model streams for an hour or more, and its heartbeats and stream
       parsing alone exceed 2 s; at the hard limit the worker and every run
       in it are killed. The patch is local to this project's runtime
       container and is redone after every recreation.
    9. starts the Vite dev server in the background (PID in .local-logs/vite.pid)

  Stop everything with scripts/stop-local.ps1.

.PARAMETER Port
  Frontend port (default 5180).

.PARAMETER NoFrontend
  Start only the backend.

.PARAMETER RestartFunctions
  Recreate the edge-function runtime even if it is already serving (picks up
  edited function code or supabase/functions/.env; aborts runs in progress).

.PARAMETER Watch
  Keep `supabase functions serve` running with hot reload (PID in
  .local-logs/functions-serve.pid). Any file event under supabase/functions
  restarts the runtime and aborts runs in progress.
#>
[CmdletBinding()]
param(
  [int]$Port = 5180,
  [switch]$NoFrontend,
  [switch]$RestartFunctions,
  [switch]$Watch
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$LogDir = Join-Path $Root '.local-logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$ProjectId = 'ai-research-assistant'
$DbContainer = "supabase_db_$ProjectId"

function Write-Step([string]$msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Warn([string]$msg) { Write-Host "WARNING: $msg" -ForegroundColor Yellow }

# Run a native command without PowerShell 5.1 turning stderr lines into
# terminating errors. Returns @{ Code; Output }.
function Invoke-Native {
  param([string]$Exe, [string[]]$Arguments, [string]$LogFile)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $out = & $Exe @Arguments 2>&1 | ForEach-Object { "$_" }
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prev
  }
  if ($LogFile) { $out | Out-File -FilePath $LogFile -Encoding utf8 }
  return @{ Code = $code; Output = $out }
}

function Find-SupabaseCli {
  if ($env:SUPABASE_CLI -and (Test-Path $env:SUPABASE_CLI)) { return $env:SUPABASE_CLI }
  $cmd = Get-Command supabase -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $fallback = Join-Path $env:USERPROFILE 'tools\supabase\supabase.exe'
  if (Test-Path $fallback) { return $fallback }
  throw 'Supabase CLI not found. Install Supabase CLI v3 and put it on PATH, or set $env:SUPABASE_CLI to the full path of supabase.exe.'
}

# --- 1. prerequisites -------------------------------------------------------
Write-Step 'Checking prerequisites'
$docker = Invoke-Native -Exe 'docker' -Arguments @('info', '--format', '{{.ServerVersion}}')
if ($docker.Code -ne 0) {
  throw 'Docker is not running. Start Docker Desktop first (on Gopal''s PC only with: powershell -ExecutionPolicy Bypass -File C:\Users\gopal\Downloads\start-docker-desktop.ps1), then run this script again.'
}
$Supabase = Find-SupabaseCli
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is not on PATH (Node 20+ needed).' }
if (-not (Test-Path (Join-Path $Root 'node_modules\vite\bin\vite.js'))) {
  if (-not (Get-Command bun -ErrorAction SilentlyContinue)) { throw 'node_modules is missing and bun is not on PATH. Install bun, then run: bun install' }
  Write-Step 'Installing frontend dependencies (bun install)'
  $r = Invoke-Native -Exe 'bun' -Arguments @('install') -LogFile (Join-Path $LogDir 'bun-install.log')
  if ($r.Code -ne 0) { throw "bun install failed; see .local-logs\bun-install.log" }
}

# --- 2. edge-function env -----------------------------------------------------
$fnEnv = Join-Path $Root 'supabase\functions\.env'
if (-not (Test-Path $fnEnv)) {
  Copy-Item (Join-Path $Root 'supabase\functions\.env.example') $fnEnv
  Write-Step 'Created supabase\functions\.env from .env.example (local Ollama defaults)'
}

# --- 3. Supabase stack ------------------------------------------------------
Write-Step 'Starting the local Supabase stack (first run downloads images; this can take minutes)'
$r = Invoke-Native -Exe $Supabase -Arguments @('start') -LogFile (Join-Path $LogDir 'supabase-start.log')
if ($r.Code -ne 0 -and -not ($r.Output -match 'already running')) {
  throw "supabase start failed; see .local-logs\supabase-start.log"
}

# --- 4. bootstrap + migrations ------------------------------------------------
Write-Step 'Applying local bootstrap grant and pending migrations'
$sql = Get-Content (Join-Path $Root 'supabase\local-bootstrap.sql') -Raw
$prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
$bootOut = $sql | docker exec -i $DbContainer psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 2>&1 | ForEach-Object { "$_" }
$bootCode = $LASTEXITCODE
$ErrorActionPreference = $prev
$bootOut | Out-File -FilePath (Join-Path $LogDir 'bootstrap.log') -Encoding utf8
if ($bootCode -ne 0) { throw "local-bootstrap.sql failed; see .local-logs\bootstrap.log" }
$r = Invoke-Native -Exe $Supabase -Arguments @('migration', 'up') -LogFile (Join-Path $LogDir 'migration-up.log')
if ($r.Code -ne 0) { throw "supabase migration up failed; see .local-logs\migration-up.log" }

# --- 5. frontend env ----------------------------------------------------------
$status = Invoke-Native -Exe $Supabase -Arguments @('status', '-o', 'env')
if ($status.Code -ne 0) { throw 'supabase status failed' }
$envMap = @{}
foreach ($line in $status.Output) {
  if ($line -match '^\s*([A-Z_]+)="?(.*?)"?\s*$') { $envMap[$Matches[1]] = $Matches[2] }
}
foreach ($k in 'API_URL', 'ANON_KEY', 'SERVICE_ROLE_KEY') {
  if (-not $envMap[$k]) { throw "supabase status did not report $k" }
}
$apiUrl = $envMap['API_URL']
$viteEnv = @(
  '# Generated by scripts/start-local.ps1 - points the Vite dev server at the LOCAL Supabase stack.',
  '# Gitignored. The committed .env still holds the original (now deleted) Lovable Cloud project.',
  "VITE_SUPABASE_URL=""$apiUrl""",
  "VITE_SUPABASE_PUBLISHABLE_KEY=""$($envMap['ANON_KEY'])""",
  "VITE_SUPABASE_PROJECT_ID=""$ProjectId"""
)
[System.IO.File]::WriteAllLines((Join-Path $Root '.env.development.local'), $viteEnv)

# --- 6. test users --------------------------------------------------------------
Write-Step 'Ensuring local test users (.local-test-user.json)'
$env:SUPABASE_API_URL = $apiUrl
$env:SUPABASE_ANON_KEY = $envMap['ANON_KEY']
$env:SUPABASE_SERVICE_ROLE_KEY = $envMap['SERVICE_ROLE_KEY']
try {
  $r = Invoke-Native -Exe 'node' -Arguments @((Join-Path $Root 'scripts\create-test-users.mjs'))
  $r.Output | ForEach-Object { Write-Host "    $_" }
  if ($r.Code -ne 0) { throw 'creating test users failed' }
} finally {
  Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY, Env:SUPABASE_ANON_KEY, Env:SUPABASE_API_URL -ErrorAction SilentlyContinue
}

# --- 7. AI provider check -------------------------------------------------------
$fnSettings = @{}
foreach ($line in Get-Content $fnEnv) {
  if ($line -match '^\s*([A-Z_]+)\s*=\s*(.*)\s*$') { $fnSettings[$Matches[1]] = $Matches[2].Trim('"') }
}
$base = $fnSettings['AI_BASE_URL']
$LocalVariant = 'qwen2.5-3b-4threads'
if ($base -and $base -match 'host\.docker\.internal:11434|localhost:11434|127\.0\.0\.1:11434') {
  try {
    $tags = Invoke-RestMethod -Uri 'http://localhost:11434/api/tags' -TimeoutSec 10
    $have = @($tags.models | ForEach-Object { $_.name })
    $want = @()
    foreach ($k in $fnSettings.Keys) { if ($k -like 'AI_MODEL*' -or $k -eq 'AI_EMBED_MODEL') { $want += ($fnSettings[$k] -split ',') } }
    foreach ($m in ($want | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Select-Object -Unique)) {
      if ($m -eq $LocalVariant) {
        # The default local chat model is a variant of qwen2.5:3b (shares its
        # weights, no download) with 4 CPU threads and an 8192-token context.
        # Ollama's default context is 4096 tokens, and a planner prompt plus
        # its plan does not fit in that: Ollama then "shifts" the context,
        # dropping the start of the prompt (the instructions) mid-answer.
        # Ollama's OpenAI-compatible API cannot set either per request, so
        # both live in the model. Created or updated here when missing.
        $params = ''
        try {
          $show = Invoke-RestMethod -Method Post -Uri 'http://localhost:11434/api/show' -Body (@{ model = $m } | ConvertTo-Json) -TimeoutSec 30
          $params = "$($show.parameters)"
        } catch { }
        if ($params -match 'num_ctx\s+8192' -and $params -match 'num_thread\s+4') { continue }
        if (-not ($have | Where-Object { $_ -eq 'qwen2.5:3b' })) {
          Write-Warn "Ollama model '$m' needs qwen2.5:3b first. Run: docker exec cvfix-ollama ollama pull qwen2.5:3b  (or: ollama pull qwen2.5:3b), then start again."
          continue
        }
        Write-Step "Creating Ollama model $m (qwen2.5:3b, 4 threads, 8192-token context; no download)"
        $spec = @{ model = $m; from = 'qwen2.5:3b'; parameters = @{ num_thread = 4; num_ctx = 8192 }; stream = $false } | ConvertTo-Json -Depth 4
        try {
          Invoke-RestMethod -Method Post -Uri 'http://localhost:11434/api/create' -Body $spec -TimeoutSec 600 | Out-Null
        } catch {
          Write-Warn "Could not create Ollama model '$m': $($_.Exception.Message)"
        }
        continue
      }
      $ok = $have | Where-Object { $_ -eq $m -or $_ -eq "$($m):latest" }
      if (-not $ok) {
        Write-Warn "Ollama model '$m' is not pulled. Run: docker exec cvfix-ollama ollama pull $m  (or: ollama pull $m)"
      }
    }
  } catch {
    Write-Warn 'Ollama is not reachable on http://localhost:11434. Plan generation will fail until it runs (see RUNNING.md).'
  }
}

# --- 8. edge functions without the 400 s wall-clock limit ---------------------
function Test-PidAlive([string]$file) {
  if (-not (Test-Path $file)) { return $false }
  $id = Get-Content $file -ErrorAction SilentlyContinue
  return [bool]($id -and (Get-Process -Id $id -ErrorAction SilentlyContinue))
}
$EdgeContainer = "supabase_edge_runtime_$ProjectId"
$fsPid = Join-Path $LogDir 'functions-serve.pid'
# Is the runtime already up in inspect mode (no wall-clock limit)?
$prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
$edgeCmd = (docker inspect $EdgeContainer --format '{{.State.Running}} {{json .Config.Cmd}}' 2>$null) -join ' '
$ErrorActionPreference = $prev
$edgeServing = $edgeCmd -match '^true ' -and $edgeCmd -match '--inspect'

# Raise the CLI's per-worker CPU limits (see step 8 above) and restart the
# runtime so its main service reloads. Idempotent. Returns $true when done.
function Set-EdgeCpuLimit {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try {
    $patched = (docker exec $EdgeContainer grep -c 'cpuTimeHardLimitMs:72e5' /root/index.ts 2>$null) -join ''
    if ($patched -match '^[1-9]') { return $true }
    docker exec $EdgeContainer sed -i -E 's/cpuTimeSoftLimitMs:[A-Za-z_$][A-Za-z0-9_$]*,cpuTimeHardLimitMs:[A-Za-z_$][A-Za-z0-9_$]*/cpuTimeSoftLimitMs:36e5,cpuTimeHardLimitMs:72e5/' /root/index.ts 2>$null | Out-Null
    $patched = (docker exec $EdgeContainer grep -c 'cpuTimeHardLimitMs:72e5' /root/index.ts 2>$null) -join ''
    if (-not ($patched -match '^[1-9]')) {
      Write-Warn 'Could not raise the edge runtime CPU limit (the Supabase CLI main service changed). Long local runs may be killed after 2 s of CPU.'
      return $false
    }
    docker restart $EdgeContainer | Out-Null
  } finally {
    $ErrorActionPreference = $prev
  }
  $probe = "$apiUrl/functions/v1/run-experiment"
  $deadline = (Get-Date).AddSeconds(120)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 3
    try {
      Invoke-RestMethod -Uri $probe -Headers @{ apikey = $envMap['ANON_KEY']; Authorization = "Bearer $($envMap['ANON_KEY'])" } -TimeoutSec 30 | Out-Null
      return $true
    } catch { }
  }
  Write-Warn "Edge runtime did not answer on $probe within 120 s after the restart."
  return $false
}

if ($edgeServing -and -not $RestartFunctions -and -not ($Watch -and -not (Test-PidAlive $fsPid))) {
  Write-Step 'Edge functions already served (no wall-clock limit); use -RestartFunctions to reload code'
  if (-not (Test-PidAlive $fsPid)) {
    if (Set-EdgeCpuLimit) { Write-Step 'Edge runtime CPU limit raised for long local runs' }
  }
} else {
  if (Test-PidAlive $fsPid) {
    & taskkill.exe /PID (Get-Content $fsPid) /T /F | Out-Null
    Remove-Item $fsPid -ErrorAction SilentlyContinue
  }
  Write-Step 'Serving edge functions (supabase functions serve --inspect-mode run)'
  $fsLog = Join-Path $LogDir 'functions-serve.log'
  Remove-Item $fsLog -ErrorAction SilentlyContinue
  $p = Start-Process -FilePath $Supabase -ArgumentList @('functions', 'serve', '--inspect-mode', 'run') `
    -WorkingDirectory $Root -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $fsLog -RedirectStandardError (Join-Path $LogDir 'functions-serve.err.log')
  Set-Content -Path $fsPid -Value $p.Id
  $deadline = (Get-Date).AddSeconds(180)
  $served = $false
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 3
    if ((Test-Path $fsLog) -and (Select-String -Path $fsLog -Pattern 'Serving functions' -Quiet)) { $served = $true; break }
    if ($p.HasExited) { break }
  }
  if (-not $served) {
    Write-Warn 'Edge functions did not report "Serving functions" within 180 s; see .local-logs\functions-serve*.log'
  } elseif (-not $Watch) {
    # Detach: stop the CLI (and its file watcher); the runtime container stays up.
    & taskkill.exe /PID $p.Id /T /F | Out-Null
    Remove-Item $fsPid -ErrorAction SilentlyContinue
    Write-Step 'Edge runtime is serving; file watcher stopped (re-run with -RestartFunctions after code changes)'
    if (Set-EdgeCpuLimit) { Write-Step 'Edge runtime CPU limit raised for long local runs' }
  } else {
    Write-Warn '-Watch: hot reload on, CLI CPU limit (2 s per worker) kept; long local runs will be killed. Use it only for quick edits.'
  }
}

# --- 9. frontend --------------------------------------------------------------------
$viteUrl = "http://localhost:$Port"
if (-not $NoFrontend) {
  $pidFile = Join-Path $LogDir 'vite.pid'
  $running = $false
  if (Test-Path $pidFile) {
    $old = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($old -and (Get-Process -Id $old -ErrorAction SilentlyContinue)) { $running = $true }
  }
  if ($running) {
    Write-Step "Vite dev server already running (PID $old)"
  } else {
    Write-Step "Starting Vite dev server on $viteUrl"
    $p = Start-Process -FilePath 'node' `
      -ArgumentList @('node_modules/vite/bin/vite.js', '--port', "$Port", '--strictPort', '--host', 'localhost') `
      -WorkingDirectory $Root -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput (Join-Path $LogDir 'vite.log') `
      -RedirectStandardError (Join-Path $LogDir 'vite.err.log')
    Set-Content -Path $pidFile -Value $p.Id
    $deadline = (Get-Date).AddSeconds(90)
    $up = $false
    while ((Get-Date) -lt $deadline) {
      try { Invoke-WebRequest -Uri $viteUrl -UseBasicParsing -TimeoutSec 5 | Out-Null; $up = $true; break } catch { Start-Sleep -Seconds 2 }
    }
    if (-not $up) { Write-Warn "Vite did not answer on $viteUrl within 90 s; see .local-logs\vite.log and vite.err.log" }
  }
}

Write-Host ''
Write-Host 'AI Scientist is running locally:' -ForegroundColor Green
if (-not $NoFrontend) { Write-Host "  App            $viteUrl" }
Write-Host "  Supabase API   $apiUrl  (edge functions: $apiUrl/functions/v1/<name>)"
Write-Host "  Studio         $($envMap['STUDIO_URL'])"
Write-Host "  Mailpit        $($envMap['MAILPIT_URL'])  (sign-up / reset emails)"
Write-Host "  AI provider    $base  model $($fnSettings['AI_MODEL'])"
Write-Host '  Test users     .local-test-user.json'
Write-Host '  Logs           .local-logs\   edge functions: docker logs -f supabase_edge_runtime_ai-research-assistant'
Write-Host 'Stop with: powershell -ExecutionPolicy Bypass -File scripts\stop-local.ps1'
