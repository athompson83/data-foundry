<#
.SYNOPSIS
  Install the Data Foundry Local Collector on this Windows computer.

.DESCRIPTION
  Idempotent; safe to re-run. It:
    1. measures this computer (CPU, RAM, GPU via nvidia-smi when present, free disk) and writes hardware.json;
    2. finds Python 3.11+ (installs Python 3.12 for this user with winget if missing);
    3. finds Ollama (installs it with winget if missing), sets OLLAMA_NO_CLOUD=1 and OLLAMA_HOST=127.0.0.1:11434
       for this user, restarts Ollama so it picks them up, and proves the local server answers on loopback;
    4. pulls the pinned model (qwen3.5:4b) and checks its ID matches the tested build;
    5. initialises the data directory and runs `doctor`;
    6. optionally stores the read API key and the ingestion credential (never echoed);
    7. registers a per-user Scheduled Task that starts the collector at logon (no admin rights, no wake timers,
       no change to sleep or power settings), and puts Start / Stop / Status / Dashboard shortcuts on the desktop.

  Nothing here opens a port beyond 127.0.0.1, creates a tunnel, or configures any paid or cloud model.

.PARAMETER DataDir
  Where state, evidence and secrets live. Default: %LOCALAPPDATA%\DataFoundryCollector

.PARAMETER SkipSecrets
  Do not prompt for the read API key and ingestion credential (set them later with set-secret.cmd).
#>
[CmdletBinding()]
param(
  [string]$DataDir = (Join-Path $env:LOCALAPPDATA 'DataFoundryCollector'),
  [switch]$SkipSecrets
)

$ErrorActionPreference = 'Stop'
$AppDir = Split-Path -Parent $PSScriptRoot           # ...\apps\local-collector
$Model = 'qwen3.5:4b'
$ModelId = '2a654d98e6fb'                            # `ollama list` ID of the benchmarked build
$TaskName = 'Data Foundry Local Collector'

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
# $ErrorActionPreference does not stop on a native command's non-zero exit, so each one is checked.
function Assert-Exit($what) { if ($LASTEXITCODE -ne 0) { throw "$what failed (exit code $LASTEXITCODE); nothing was scheduled. Fix the problem above and re-run install.ps1." } }

Step 'Measuring this computer'
$cs = Get-CimInstance Win32_ComputerSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
# Free space is measured on the volumes that will hold the data (SQLite, working copies) and the model weights,
# which differ when -DataDir or OLLAMA_MODELS points to another drive.
function Get-FreeGB([string]$path) {
  $root = [System.IO.Path]::GetPathRoot([System.IO.Path]::GetFullPath($path))
  return @{ root = $root; gb = [math]::Round((New-Object System.IO.DriveInfo($root)).AvailableFreeSpace / 1GB, 1) }
}
$ModelDir = if ($env:OLLAMA_MODELS) { $env:OLLAMA_MODELS } else { Join-Path $env:USERPROFILE '.ollama' }
$dataDrive = Get-FreeGB $DataDir
$modelDrive = Get-FreeGB $ModelDir
$hw = [ordered]@{
  os                = (Get-CimInstance Win32_OperatingSystem).Caption
  cpu               = $cpu.Name
  cores             = $cpu.NumberOfCores
  logical_processors = $cpu.NumberOfLogicalProcessors
  ram_total_gb      = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1)
  data_drive        = $dataDrive.root
  data_free_gb      = $dataDrive.gb
  model_drive       = $modelDrive.root
  model_free_gb     = $modelDrive.gb
  video_adapters    = @(Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name })
  nvidia            = $null
  wsl               = [bool](Get-Command wsl.exe -ErrorAction SilentlyContinue)
  docker            = [bool](Get-Command docker.exe -ErrorAction SilentlyContinue)
}
if (Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue) {
  # VRAM is read from the driver, not inferred from the adapter name or system RAM.
  $hw.nvidia = (& nvidia-smi.exe --query-gpu=name,memory.total,memory.free,driver_version --format=csv,noheader,nounits) -join '; '
}
$hw | Format-List | Out-String | Write-Host
if ($hw.ram_total_gb -lt 8) { Write-Warning 'Less than 8 GB RAM: qwen3.5:4b needs about 4-5 GB while loaded. Expect slow extraction.' }
if ($dataDrive.root -eq $modelDrive.root) {
  if ($dataDrive.gb -lt 10) { throw "Only $($dataDrive.gb) GB free on $($dataDrive.root); the model (3.4 GB) plus the collector's data needs at least 10 GB." }
} else {
  if ($modelDrive.gb -lt 4) { throw "Only $($modelDrive.gb) GB free on $($modelDrive.root) (the model store); the model needs at least 4 GB." }
  if ($dataDrive.gb -lt 7) { throw "Only $($dataDrive.gb) GB free on $($dataDrive.root) (-DataDir); the collector pauses below 5 GB free and may keep up to 2 GB, so it needs at least 7 GB." }
}

Step 'Python 3.11+'
function Find-Python {
  foreach ($candidate in @('py -3.12', 'py -3.11', 'python')) {
    $parts = $candidate.Split(' ')
    # 'python' has no launcher arguments; 1..0 would count down and pass the executable name itself.
    $launcherArgs = if ($parts.Length -gt 1) { $parts[1..($parts.Length - 1)] } else { @() }
    try {
      $version = & $parts[0] $launcherArgs -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>$null
      if ($version -and [version]$version -ge [version]'3.11') {
        $exe = & $parts[0] $launcherArgs -c 'import sys; print(sys.executable)'
        return $exe.Trim()
      }
    } catch { }
  }
  return $null
}
$Python = Find-Python
if (-not $Python) {
  Write-Host 'Installing Python 3.12 for this user (winget)...'
  winget install -e --id Python.Python.3.12 --scope user --accept-package-agreements --accept-source-agreements
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $Python = Find-Python
  if (-not $Python) { throw 'Python 3.11+ is still not available; open a new terminal and re-run install.ps1.' }
}
$PythonW = Join-Path (Split-Path $Python) 'pythonw.exe'
if (-not (Test-Path $PythonW)) { $PythonW = $Python }
Write-Host "Python: $Python"

Step 'Ollama (local only)'
if (-not (Get-Command ollama.exe -ErrorAction SilentlyContinue)) {
  Write-Host 'Installing Ollama (winget)...'
  winget install -e --id Ollama.Ollama --accept-package-agreements --accept-source-agreements
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
}
[Environment]::SetEnvironmentVariable('OLLAMA_NO_CLOUD', '1', 'User')
[Environment]::SetEnvironmentVariable('OLLAMA_HOST', '127.0.0.1:11434', 'User')
$env:OLLAMA_NO_CLOUD = '1'; $env:OLLAMA_HOST = '127.0.0.1:11434'
# Restart Ollama so the server reads the variables above.
Get-Process -Name 'ollama app', 'ollama' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
$app = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama app.exe'
if (Test-Path $app) { Start-Process $app } else { Start-Process ollama.exe -ArgumentList 'serve' -WindowStyle Hidden }
$ready = $false
foreach ($i in 1..30) {
  try { Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/version' -TimeoutSec 2 | Out-Null; $ready = $true; break } catch { Start-Sleep -Seconds 1 }
}
if (-not $ready) { throw 'Ollama did not answer on http://127.0.0.1:11434 within 30 seconds.' }
# Prove cloud inference is refused by this server.
try {
  Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/chat' -Method Post -TimeoutSec 20 -ContentType 'application/json' `
    -Body '{"model":"gpt-oss:120b-cloud","stream":false,"messages":[{"role":"user","content":"ping"}]}' | Out-Null
  throw 'Ollama accepted a cloud model request: OLLAMA_NO_CLOUD is not in effect. Quit Ollama from the tray and re-run.'
} catch {
  if ($_.Exception.Message -like '*OLLAMA_NO_CLOUD is not in effect*') { throw }
  Write-Host 'Cloud models refused by the local server (expected).'
}
& ollama.exe rm gpt-oss:120b-cloud 2>$null | Out-Null

Step "Model $Model"
& ollama.exe pull $Model
Assert-Exit "ollama pull $Model"
$line = (& ollama.exe list | Select-String -SimpleMatch $Model | Select-Object -First 1).Line
if (-not $line -or $line -notmatch $ModelId) {
  Write-Warning "The pulled $Model is not the benchmarked build $ModelId. The collector refuses an unpinned build; update model_digest in collector.json only after re-running the benchmark."
}

Step 'Collector data directory'
Push-Location $AppDir
try {
  & $Python -m df_collector --data-dir $DataDir init | Write-Host
  Assert-Exit 'df_collector init'
  & $Python -m df_collector --data-dir $DataDir doctor | Tee-Object -FilePath (Join-Path $DataDir 'doctor.json') | Out-Null
  # doctor fails when the model is missing, not the pinned build, or the source policy cannot be loaded.
  Assert-Exit "df_collector doctor (details in $(Join-Path $DataDir 'doctor.json'))"
  ($hw | ConvertTo-Json -Depth 4) | Set-Content -Path (Join-Path $DataDir 'hardware-windows.json') -Encoding UTF8
  if (-not $SkipSecrets) {
    Write-Host 'Paste the Data Foundry read API key (rcl_live_...), or press Enter to skip:'
    $read = Read-Host -AsSecureString
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($read))
    if ($plain) { $plain | & $Python -m df_collector --data-dir $DataDir set-secret read-api-key; Assert-Exit 'set-secret read-api-key' }
    Write-Host 'Paste the ingestion credential (dfi_...), or press Enter to skip:'
    $ingest = Read-Host -AsSecureString
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($ingest))
    if ($plain) { $plain | & $Python -m df_collector --data-dir $DataDir set-secret ingest-token; Assert-Exit 'set-secret ingest-token' }
    $plain = $null
  }
  # Only this user may read the secrets directory.
  $secrets = Join-Path $DataDir 'secrets'
  & icacls.exe $secrets /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" | Out-Null
} finally { Pop-Location }

Step 'Start at logon (per-user Scheduled Task)'
$action = New-ScheduledTaskAction -Execute $PythonW -Argument "-m df_collector --data-dir `"$DataDir`" run" -WorkingDirectory $AppDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
# Restart after a crash; no time limit; never wake the computer; one instance only.
$settings = New-ScheduledTaskSettingsSet -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 5) -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "Registered '$TaskName'."

Step 'Desktop shortcuts'
$desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell
foreach ($name in 'start', 'stop', 'status') {
  $lnk = $shell.CreateShortcut((Join-Path $desktop "Data Foundry Collector - $name.lnk"))
  $lnk.TargetPath = Join-Path $PSScriptRoot "$name.cmd"
  $lnk.WorkingDirectory = $PSScriptRoot
  $lnk.Save()
}
$url = $shell.CreateShortcut((Join-Path $desktop 'Data Foundry Collector - dashboard.url'))
$url.TargetPath = 'http://127.0.0.1:8765/'
$url.Save()
[Environment]::SetEnvironmentVariable('DF_COLLECTOR_DATA', $DataDir, 'User')
[Environment]::SetEnvironmentVariable('DF_COLLECTOR_PYTHON', $Python, 'User')

Step 'Starting'
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 5
& $Python -m df_collector --data-dir $DataDir status | Select-Object -First 15 | Write-Host
Write-Host "`nDashboard: http://127.0.0.1:8765/  (loopback only)"
Write-Host 'Collection pauses while this computer sleeps, shuts down or is offline; the hosted Data Foundry API keeps serving.'
