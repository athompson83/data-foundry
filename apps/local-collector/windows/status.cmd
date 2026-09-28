@echo off
cd /d "%~dp0.."
"%DF_COLLECTOR_PYTHON%" -m df_collector --data-dir "%DF_COLLECTOR_DATA%" status
schtasks /Query /TN "Data Foundry Local Collector" /FO LIST 2>nul | findstr /B /C:"Status" /C:"Last Run Time" /C:"Last Result"
pause
