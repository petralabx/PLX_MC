@echo off
REM Double-click installer for PLX company skills (no secrets).
REM Clones/updates PLX_MC if needed, then runs the approved bootstrap.
title PLX Company Skills Installer
echo.
echo === PLX company skills installer ===
echo This copies approved Cursor skills onto this PC. No API keys involved.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Company-Skills.ps1"
set EXITCODE=%ERRORLEVEL%
echo.
if %EXITCODE% NEQ 0 (
  echo Install failed with exit code %EXITCODE%.
  echo If Git is missing, install Git for Windows, then double-click this file again.
) else (
  echo Done. Close Cursor completely and open a new window so skills load.
)
echo.
pause
exit /b %EXITCODE%
