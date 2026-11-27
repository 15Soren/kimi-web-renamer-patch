@echo off
setlocal
set "ROOT=%~dp0.."
for %%I in ("%ROOT%") do set "ROOT=%%~fI"

for /f "delims=" %%N in ('where node 2^>nul') do (
  set "NODE_EXE=%%N"
  goto :found_node
)
echo [kimi-renamer] 找不到 node，请先安装 Node.js 18+ >&2
exit /b 1

:found_node
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
if not exist "%STARTUP_DIR%" mkdir "%STARTUP_DIR%"
set "VBS_FILE=%STARTUP_DIR%\kimi-renamer-watch.vbs"
set "DAEMON_JS=%ROOT%\src\standalone\daemon.js"

(
  echo CreateObject("WScript.Shell"^).Run """%NODE_EXE%"" ""%DAEMON_JS%""", 0, False
) > "%VBS_FILE%"

start "" wscript.exe "%VBS_FILE%"
echo 守护进程已安装并启动（开机自启）: %VBS_FILE%
echo 日志位于: %USERPROFILE%\.kimi-code\kimi-renamer\daemon.log
