@echo off
setlocal
chcp 65001 >nul 2>&1
where node >nul 2>&1
if errorlevel 1 (
  echo [kimi-renamer] Node.js 18+ not found in PATH.
  setlocal enabledelayedexpansion
  set "KIMI_CMD=!CMDCMDLINE:"=!"
  if /i not "!KIMI_CMD!"=="!KIMI_CMD:/c=!" pause
  exit /b 1
)
node "%~dp0..\src\standalone\win-daemon.js" uninstall %*
exit /b %errorlevel%
