# Removes the scheduled task and desktop shortcuts. Keeps the data directory (evidence, state, secrets) unless -Purge.
param([switch]$Purge)
$TaskName = 'Data Foundry Local Collector'
$python = [Environment]::GetEnvironmentVariable('DF_COLLECTOR_PYTHON', 'User')
$data = [Environment]::GetEnvironmentVariable('DF_COLLECTOR_DATA', 'User')
if ($python -and $data) { Push-Location (Split-Path -Parent $PSScriptRoot); & $python -m df_collector --data-dir $data stop; Pop-Location }
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Get-ChildItem ([Environment]::GetFolderPath('Desktop')) -Filter 'Data Foundry Collector - *' | Remove-Item
if ($Purge -and $data) { Remove-Item -Recurse -Force $data }
Write-Host 'Removed. Ollama and the model are left installed (ollama rm qwen3.5:4b removes the model).'
