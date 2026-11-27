@echo off
chcp 65001 >nul 2>&1
where node >nul 2>&1
if errorlevel 1 (
  echo [kimi-renamer] Node.js 18+ not found in PATH.
  exit /b 1
)
node "%~dp0kimi-web-renamer" %*
