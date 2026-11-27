#!/usr/bin/env node
// Windows 守护进程安装与卸载逻辑（由 bin/install-daemon.cmd 和 bin/uninstall-daemon.cmd 调用）
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { renamerStateDir } = require("../paths");

const ROOT = path.resolve(__dirname, "..", "..");
const DAEMON_JS = path.join(ROOT, "src", "standalone", "daemon.js");
const VBS_NAME = "kimi-renamer-watch.vbs";

function getStartupDir(env = process.env) {
  const appData = env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
}

function getVbsPath(env = process.env) {
  return path.join(getStartupDir(env), VBS_NAME);
}

function escapeVbsString(str) {
  return String(str).replace(/"/g, '""');
}

/**
 * 生成静默启动 daemon.js 的 VBScript 内容（返回 UTF-16LE + BOM Buffer，避免中文用户名乱码）
 */
function buildStartupVbsBuffer(nodeExe = process.execPath, daemonJs = DAEMON_JS) {
  const cmd = `"${nodeExe}" "${daemonJs}"`;
  const script = `CreateObject("WScript.Shell").Run "${escapeVbsString(cmd)}", 0, False\r\n`;
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(script, "utf16le")]);
}

function stopRunningDaemons() {
  if (process.platform !== "win32") return;
  const psScript = [
    "Get-CimInstance Win32_Process | Where-Object {",
    `  $_.Name -eq 'node.exe' -and $_.ProcessId -ne ${process.pid} -and (`,
    "    $_.CommandLine -like '*src\\standalone\\daemon.js*' -or",
    "    $_.CommandLine -like '*src/standalone/daemon.js*' -or",
    "    $_.CommandLine -like '*src\\standalone\\server.js*' -or",
    "    $_.CommandLine -like '*src/standalone/server.js*'",
    "  )",
    "} | ForEach-Object {",
    "  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue",
    "}",
  ].join("; ");

  spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psScript], {
    windowsHide: true,
    stdio: "ignore",
  });
}

function installDaemon(options = {}) {
  const env = options.env || process.env;
  const nodeExe = options.nodeExe || process.execPath;
  const daemonJs = options.daemonJs || DAEMON_JS;
  const vbsPath = getVbsPath(env);
  const startupDir = path.dirname(vbsPath);

  fs.mkdirSync(startupDir, { recursive: true });
  fs.writeFileSync(vbsPath, buildStartupVbsBuffer(nodeExe, daemonJs));

  if (!options.skipSpawn) {
    stopRunningDaemons();
    const child = spawn(nodeExe, [daemonJs], {
      detached: true,
      windowsHide: true,
      stdio: "ignore",
    });
    child.unref();
  }

  return {
    vbsPath,
    logPath: path.join(renamerStateDir(), "daemon.log"),
  };
}

function uninstallDaemon(options = {}) {
  const env = options.env || process.env;
  const vbsPath = getVbsPath(env);
  let removedVbs = false;
  if (fs.existsSync(vbsPath)) {
    fs.unlinkSync(vbsPath);
    removedVbs = true;
  }
  if (!options.skipStop) {
    stopRunningDaemons();
  }
  return { vbsPath, removedVbs };
}

function isExplorerDoubleClick(env = process.env) {
  const cmdLine = env.CMDCMDLINE || "";
  return /\/c\s+""/i.test(cmdLine);
}

function maybePauseForExplorer() {
  if (!isExplorerDoubleClick() || !process.stdin.isTTY) return Promise.resolve();
  return new Promise((resolve) => {
    process.stdout.write("\n按回车键关闭窗口...");
    process.stdin.resume();
    process.stdin.once("data", () => {
      process.stdin.pause();
      resolve();
    });
  });
}

async function main() {
  const action = (process.argv[2] || "").toLowerCase();
  if (action === "install") {
    const res = installDaemon();
    console.log("✅ 守护进程已安装并启动（已加入开机自启）");
    console.log(`   自启脚本: ${res.vbsPath}`);
    console.log(`   运行日志: ${res.logPath}`);
  } else if (action === "uninstall") {
    const res = uninstallDaemon();
    console.log("✅ 守护进程与 sidecar 已停止，并移除开机自启");
    if (res.removedVbs) {
      console.log(`   已删除: ${res.vbsPath}`);
    }
  } else {
    console.error("用法: node src/standalone/win-daemon.js <install|uninstall>");
    process.exitCode = 1;
  }
  await maybePauseForExplorer();
}

module.exports = {
  VBS_NAME,
  getStartupDir,
  getVbsPath,
  escapeVbsString,
  buildStartupVbsBuffer,
  installDaemon,
  uninstallDaemon,
  isExplorerDoubleClick,
};

if (require.main === module) {
  main().catch(async (err) => {
    console.error(`❌ 操作失败: ${err.message || err}`);
    process.exitCode = 1;
    await maybePauseForExplorer();
  });
}
