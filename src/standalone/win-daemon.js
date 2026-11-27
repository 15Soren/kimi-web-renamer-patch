#!/usr/bin/env node
// Windows 守护进程安装与卸载逻辑（由 bin/install-daemon.cmd 和 bin/uninstall-daemon.cmd 调用）
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { renamerStateDir, daemonPidPath, sidecarPidPath } = require("../paths");
const { readServerConfig } = require("../modes/standalone");

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
 * 附带文件存在性判断与静默错误兜底，避免目录移动/卸载 Node 后开机弹出 WScript 报错框
 */
function buildStartupVbsBuffer(nodeExe = process.execPath, daemonJs = DAEMON_JS) {
  const cmd = `"${nodeExe}" "${daemonJs}"`;
  const lines = [
    "On Error Resume Next",
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    `If fso.FileExists("${escapeVbsString(nodeExe)}") And fso.FileExists("${escapeVbsString(daemonJs)}") Then`,
    `  CreateObject("WScript.Shell").Run "${escapeVbsString(cmd)}", 0, False`,
    "End If",
    "",
  ];
  const script = lines.join("\r\n");
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(script, "utf16le")]);
}

/**
 * 构造用于停止残留 daemon.js / server.js 进程的合法 PowerShell 脚本
 */
function buildStopProcessesScript(excludePid = process.pid) {
  const safePid = Number.isInteger(excludePid) ? excludePid : 0;
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" | Where-Object {",
    `  $_.ProcessId -ne ${safePid} -and $_.CommandLine -and (`,
    "    $_.CommandLine -like '*src\\standalone\\daemon.js*' -or",
    "    $_.CommandLine -like '*src/standalone/daemon.js*' -or",
    "    $_.CommandLine -like '*src\\standalone\\server.js*' -or",
    "    $_.CommandLine -like '*src/standalone/server.js*'",
    "  )",
    "} | ForEach-Object {",
    "  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue",
    "}",
  ].join("\n");
}

function killPidFromFile(pidFile, excludePid = process.pid) {
  let pid = null;
  try {
    const raw = fs.readFileSync(pidFile, "utf8").trim();
    if (raw.startsWith("{")) {
      const parsed = JSON.parse(raw);
      pid = Number(parsed.pid);
    } else if (raw) {
      pid = Number(raw);
    }
  } catch (e) {
    return false;
  }

  let killed = false;
  if (Number.isInteger(pid) && pid > 0 && pid !== excludePid) {
    try {
      process.kill(pid);
      killed = true;
    } catch (e) {
      // 进程已不存在
    }
  }
  try {
    if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
  } catch (e) {
    // 忽略清理失败
  }
  return killed;
}

function waitBriefly(ms) {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}

function stopRunningDaemons() {
  if (process.platform !== "win32") return { ok: true };

  // 1. 优先根据 PID 文件精准结束
  killPidFromFile(daemonPidPath());
  killPidFromFile(sidecarPidPath());

  // 2. 用合法的 PowerShell 命令行匹配兜底清理所有残留 daemon.js / server.js
  const psScript = buildStopProcessesScript(process.pid);
  const res = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", psScript],
    {
      windowsHide: true,
      encoding: "utf8",
      timeout: 15000,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  // 给系统短暂时间释放进程句柄与端口
  waitBriefly(250);

  if (res.error || res.status !== 0) {
    const detail = (res.stderr || (res.error && res.error.message) || "").trim();
    return { ok: false, error: detail || `PowerShell 退出码: ${res.status}` };
  }
  return { ok: true };
}

function installDaemon(options = {}) {
  const env = options.env || process.env;
  const nodeExe = options.nodeExe || process.execPath;
  const daemonJs = options.daemonJs || DAEMON_JS;
  const vbsPath = getVbsPath(env);
  const startupDir = path.dirname(vbsPath);

  fs.mkdirSync(startupDir, { recursive: true });
  fs.writeFileSync(vbsPath, buildStartupVbsBuffer(nodeExe, daemonJs));

  let spawnedPid = null;
  let stopWarning = null;
  if (!options.skipSpawn) {
    const stopRes = stopRunningDaemons();
    if (!stopRes.ok) {
      stopWarning = stopRes.error;
    }
    const child = spawn(nodeExe, [daemonJs], {
      detached: true,
      windowsHide: true,
      stdio: "ignore",
    });
    spawnedPid = child.pid || null;
    child.unref();
  }

  return {
    vbsPath,
    logPath: path.join(renamerStateDir(), "daemon.log"),
    pid: spawnedPid,
    stopWarning,
    hasServerConfig: Boolean(readServerConfig()),
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
  let stopResult = { ok: true };
  if (!options.skipStop) {
    stopResult = stopRunningDaemons();
  }
  return { vbsPath, removedVbs, stopOk: stopResult.ok, stopError: stopResult.error || null };
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
    if (res.pid) {
      console.log(`   进程 PID: ${res.pid}`);
    }
    if (res.stopWarning) {
      console.warn(`⚠️  清理旧进程时出现警告: ${res.stopWarning}`);
    }
    if (!res.hasServerConfig) {
      console.warn("\n⚠️  提示: 尚未检测到 sidecar 配置 (server.json)，请先运行一次补丁命令：");
      console.warn(`   node "${path.join(ROOT, "bin", "cli.js")}" patch`);
    }
  } else if (action === "uninstall") {
    const res = uninstallDaemon();
    if (res.stopOk) {
      console.log("✅ 守护进程与 sidecar 已停止，并移除开机自启");
    } else {
      console.warn(`⚠️  已移除开机自启，但停止后台进程时出现异常: ${res.stopError}`);
    }
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
  buildStopProcessesScript,
  stopRunningDaemons,
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
