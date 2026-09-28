@echo off
rem One-click stop: asks the collector to finish its current step and exit, then ends the scheduled task.
cd /d "%~dp0.."
"%DF_COLLECTOR_PYTHON%" -m df_collector --data-dir "%DF_COLLECTOR_DATA%" stop
schtasks /End /TN "Data Foundry Local Collector" >nul 2>&1
pause
