@echo off
rem Usage: set-secret.cmd read-api-key   or   set-secret.cmd ingest-token   (the value is prompted for, not echoed)
cd /d "%~dp0.."
"%DF_COLLECTOR_PYTHON%" -m df_collector --data-dir "%DF_COLLECTOR_DATA%" set-secret %1
pause
