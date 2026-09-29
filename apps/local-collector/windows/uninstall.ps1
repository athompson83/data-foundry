# Removes the scheduled task and desktop shortcuts. Keeps the data directory (evidence, state, secrets) unless -Purge.
# -Purge goes through the collector's own guarded purge: it refuses while uploads are still owed to Data Foundry or
# notices are still waiting for the model, and then nothing is removed. -Force overrides that guard and discards them.
param([switch]$Purge, [switch]$Force)
$TaskName = 'Data Foundry Local Collector'
$python = [Environment]::GetEnvironmentVariable('DF_COLLECTOR_PYTHON', 'User')
$data = [Environment]::GetEnvironmentVariable('DF_COLLECTOR_DATA', 'User')
if ($python -and $data) {
  Push-Location (Split-Path -Parent $PSScriptRoot)
  try {
    & $python -m df_collector --data-dir $data stop; $stopped = $LASTEXITCODE
    # A native command's non-zero exit is not a PowerShell error: check it, so nothing is removed under a running collector.
    if ($stopped -ne 0) { throw "The collector did not confirm it stopped (exit $stopped). Nothing was removed; run Stop, wait for the current notice to finish, then uninstall again." }
    if ($Purge) {
      $purgeArgs = @('-m', 'df_collector', '--data-dir', $data, 'purge', '--everything')
      if ($Force) { $purgeArgs += '--force' }
      & $python @purgeArgs; $purged = $LASTEXITCODE
      if ($purged -ne 0) { throw "Purge refused (exit $purged): work is still owed to Data Foundry. Nothing was removed; start the collector until its uploads finish, or uninstall with -Purge -Force to discard them." }
    }
  } finally { Pop-Location }
} elseif ($Purge -and $data) {
  # Without the collector's Python the outstanding-work guard cannot run, so the data is deleted only on -Force.
  if (-not $Force) { throw "Cannot check for unsent uploads without the collector's Python (DF_COLLECTOR_PYTHON). Nothing was removed; uninstall with -Purge -Force to delete $data anyway." }
  Remove-Item -Recurse -Force $data
}
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Get-ChildItem ([Environment]::GetFolderPath('Desktop')) -Filter 'Data Foundry Collector - *' | Remove-Item
Write-Host 'Removed. Ollama and the model are left installed (ollama rm qwen3.5:4b removes the model).'
