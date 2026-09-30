@echo off
rem One-click start: runs the per-user Scheduled Task registered by install.ps1 (single owner of the process).
schtasks /Run /TN "Data Foundry Local Collector" >nul 2>&1
if errorlevel 1 (
  echo The scheduled task is not registered. Run install.ps1 first.
  pause
  exit /b 1
)
timeout /t 3 >nul
start "" "http://127.0.0.1:8765/"
