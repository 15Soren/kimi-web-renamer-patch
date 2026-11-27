@echo off
setlocal
set "VBS_FILE=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\kimi-renamer-watch.vbs"
if exist "%VBS_FILE%" del /f /q "%VBS_FILE%"

powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and ($_.CommandLine -like '*src\standalone\daemon.js*' -or $_.CommandLine -like '*src\standalone\server.js*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1

echo 守护进程与 sidecar 已停止并移除开机自启
