# Removes the scheduled task and desktop shortcuts. Keeps the data directory (evidence, state, secrets) unless -Purge.
param([switch]$Purge)
$TaskName = 'Data Foundry Local Collector'
$python = [Environment]::GetEnvironmentVariable('DF_COLLECTOR_PYTHON', 'User')
$data = [Environment]::GetEnvironmentVariable('DF_COLLECTOR_DATA', 'User')
if ($python -and $data) {
  Push-Location (Split-Path -Parent $PSScriptRoot)
  try { & $python -m df_collector --data-dir $data stop; $stopped = $LASTEXITCODE } finally { Pop-Location }
  # A native command's non-zero exit is not a PowerShell error: check it, so nothing is removed under a running collector.
  if ($stopped -ne 0) { throw "The collector did not confirm it stopped (exit $stopped). Nothing was removed; run Stop, wait for the current notice to finish, then uninstall again." }
}
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Get-ChildItem ([Environment]::GetFolderPath('Desktop')) -Filter 'Data Foundry Collector - *' | Remove-Item
if ($Purge -and $data) { Remove-Item -Recurse -Force $data }
Write-Host 'Removed. Ollama and the model are left installed (ollama rm qwen3.5:4b removes the model).'
