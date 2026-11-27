#!/usr/bin/env node
const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const {
  listDistWebDirs,
  checkStatus,
  applyPatch,
  readServerConfig,
} = require("../modes/standalone");
const {
  renamerStateDir,
  daemonPidPath,
  listCacheRoots,
  normalizePathKey,
} = require("../paths");

const POLL_MS = 2000;
const WATCH_DEBOUNCE_MS = 250;
const SIDECAR_CHECK_MS = 5000;
const SIDECAR_STARTUP_GRACE_MS = 10000;
const LOG_MAX_BYTES = 256 * 1024;

let lastMessage = "";
let lastSidecarSpawn = 0;
let serverChild = null;
let serverChildPort = null;
let checkingSidecar = false;
let consecutiveHealthFailures = 0;
let injecting = false;
let debounceTimer = null;
let hasLock = false;
const watchers = new Map();

function getStateDir() {
  return renamerStateDir();
}

function getLogPath() {
  return path.join(getStateDir(), "daemon.log");
}

function log(message, options = {}) {
  const { dedupe = true } = options;
  if (dedupe && message === lastMessage) return;
  lastMessage = message;
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    const stateDir = getStateDir();
    const logPath = getLogPath();
    fs.mkdirSync(stateDir, { recursive: true });
    try {
      if (fs.statSync(logPath).size > LOG_MAX_BYTES) fs.truncateSync(logPath, 0);
    } catch (e) {
      // 日志尚不存在
    }
    fs.appendFileSync(logPath, line, "utf8");
  } catch (e) {
    // 日志失败不影响守护逻辑
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === "EPERM";
  }
}

function readPidFile(pidFile) {
  try {
    const raw = fs.readFileSync(pidFile, "utf8").trim();
    if (!raw) return null;
    if (raw.startsWith("{")) {
      const parsed = JSON.parse(raw);
      return Number.isInteger(parsed.pid) ? parsed : null;
    }
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? { pid } : null;
  } catch (e) {
    return null;
  }
}

function acquireDaemonLock(pidFile = daemonPidPath()) {
  const existing = readPidFile(pidFile);
  if (existing && existing.pid !== process.pid && isProcessAlive(existing.pid)) {
    return { acquired: false, existingPid: existing.pid };
  }
  try {
    fs.mkdirSync(path.dirname(pidFile), { recursive: true });
    fs.writeFileSync(
      pidFile,
      JSON.stringify({
        pid: process.pid,
        script: __filename,
        startedAt: new Date().toISOString(),
      }) + "\n",
      "utf8"
    );
    hasLock = true;
  } catch (e) {
    log(`写入守护进程 PID 文件失败: ${e.message}`, { dedupe: false });
  }
  return { acquired: true, existingPid: null };
}

function releaseDaemonLock(pidFile = daemonPidPath()) {
  if (!hasLock) return;
  hasLock = false;
  try {
    const current = readPidFile(pidFile);
    if (current && current.pid === process.pid) {
      fs.unlinkSync(pidFile);
    }
  } catch (e) {
    // 忽略清理失败
  }
}

function stopManagedSidecar(reason) {
  if (!serverChild) return;
  const child = serverChild;
  serverChild = null;
  serverChildPort = null;
  if (child.exitCode === null) {
    try {
      child.kill();
      if (reason) log(reason, { dedupe: false });
    } catch (e) {
      // 忽略已退出进程
    }
  }
}

function ensureInjection() {
  if (injecting) return false;
  injecting = true;
  try {
    const serverCfg = readServerConfig();
    if (!serverCfg) {
      // 用户尚未执行 patch 或已执行 unpatch，不自动复活补丁
      stopManagedSidecar("检测到 sidecar 配置已移除，已停止托管的 sidecar");
      log("未检测到 sidecar 配置 (server.json)，等待执行 patch");
      return false;
    }

    const dirs = listDistWebDirs();
    if (dirs.length === 0) {
      log("未找到 dist-web，等待 kimi web 首次启动");
      return false;
    }
    let ok = true;
    for (const webDir of dirs) {
      let status;
      try {
        status = checkStatus(webDir);
      } catch (err) {
        ok = false;
        log(`检查状态失败 (${webDir}): ${err.message}`);
        continue;
      }
      if (status.isHtmlPatched && status.isRenamerJsPresent && status.isRenamerIcoPresent) continue;
      try {
        applyPatch(webDir);
        log(`已重新注入: ${webDir}`, { dedupe: false });
      } catch (err) {
        ok = false;
        log(`注入失败 (${webDir}): ${err.message}`);
      }
    }
    return ok;
  } finally {
    injecting = false;
  }
}

function scheduleEnsureInjection(delayMs = WATCH_DEBOUNCE_MS) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    ensureInjection();
  }, delayMs);
}

function checkSidecar() {
  if (checkingSidecar) return;
  const config = readServerConfig();
  if (!config) {
    stopManagedSidecar();
    return;
  }

  const port = Number(process.env.KIMI_RENAMER_PORT || config.port) || 58629;
  if (serverChild && serverChild.exitCode === null && serverChildPort !== null && serverChildPort !== port) {
    stopManagedSidecar(`sidecar 端口变更 (${serverChildPort} -> ${port})，准备重启`);
  }

  checkingSidecar = true;
  let settled = false;
  const finish = (healthy) => {
    if (settled) return;
    settled = true;
    checkingSidecar = false;
    if (healthy) {
      consecutiveHealthFailures = 0;
    } else {
      consecutiveHealthFailures += 1;
      startSidecar(port);
    }
  };

  const req = http.get({ host: "127.0.0.1", port, path: "/health", timeout: 1500 }, (res) => {
    res.resume();
    finish(res.statusCode === 200);
  });
  req.on("error", () => finish(false));
  req.on("timeout", () => {
    req.destroy();
    finish(false);
  });
}

function startSidecar(port) {
  const now = Date.now();
  if (now - lastSidecarSpawn < SIDECAR_CHECK_MS) return;

  if (serverChild && serverChild.exitCode === null) {
    // 刚启动不久的 sidecar 给予启动宽限期；若持续健康检查失败则重启
    if (serverChildPort === port && now - lastSidecarSpawn < SIDECAR_STARTUP_GRACE_MS) {
      return;
    }
    if (consecutiveHealthFailures >= 2 || serverChildPort !== port) {
      stopManagedSidecar(`托管的 sidecar 无响应，准备重新启动 (端口 ${port})`);
    } else {
      return;
    }
  }

  lastSidecarSpawn = now;
  try {
    const child = spawn(process.execPath, [path.join(__dirname, "server.js")], {
      detached: true,
      windowsHide: true,
      stdio: ["ignore", "ignore", "ignore"],
      env: {
        ...process.env,
        KIMI_RENAMER_PORT: String(port),
        KIMI_RENAMER_LOG_FILE: getLogPath(),
      },
    });
    serverChild = child;
    serverChildPort = port;
    child.on("error", (err) => {
      log(`sidecar 进程启动异常: ${err.message}`, { dedupe: false });
      if (serverChild === child) {
        serverChild = null;
        serverChildPort = null;
      }
    });
    child.on("exit", (code, signal) => {
      if (serverChild === child) {
        serverChild = null;
        serverChildPort = null;
      }
      if (code !== 0 && code !== null) {
        log(`sidecar 异常退出 (code=${code})`, { dedupe: false });
      } else if (signal) {
        log(`sidecar 收到信号退出 (${signal})`, { dedupe: false });
      }
    });
    child.unref();
    log(`sidecar 未运行，已尝试启动 (端口 ${port})`, { dedupe: false });
  } catch (err) {
    log(`sidecar 启动失败: ${err.message}`, { dedupe: false });
  }
}

function watchAssets() {
  // 清理已被删除目录的旧 watcher
  for (const [key, entry] of watchers.entries()) {
    if (!fs.existsSync(entry.root)) {
      try {
        entry.watcher.close();
      } catch (e) {
        // 忽略关闭错误
      }
      watchers.delete(key);
    }
  }

  for (const root of listCacheRoots()) {
    const key = normalizePathKey(root);
    if (watchers.has(key) || !fs.existsSync(root)) continue;
    try {
      const watcher = fs.watch(root, { recursive: true }, () => {
        scheduleEnsureInjection();
      });
      watcher.on("error", (err) => {
        log(`文件监听异常 (${root})，将在轮询时自动重建: ${err.message}`, { dedupe: false });
        try {
          watcher.close();
        } catch (e) {
          // 忽略关闭错误
        }
        watchers.delete(key);
      });
      watchers.set(key, { root, watcher });
    } catch (e) {
      log(`目录监听不可用 (${root})，退回轮询: ${e.message}`);
    }
  }
}

function closeAllWatchers() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  for (const entry of watchers.values()) {
    try {
      entry.watcher.close();
    } catch (e) {
      // 忽略关闭错误
    }
  }
  watchers.clear();
}

function main() {
  const lock = acquireDaemonLock();
  if (!lock.acquired) {
    log(`已有守护进程运行中 (PID ${lock.existingPid})，当前实例退出`, { dedupe: false });
    process.exit(0);
  }

  log(`守护进程启动 (PID ${process.pid})`, { dedupe: false });
  watchAssets();
  ensureInjection();
  checkSidecar();

  const pollTimer = setInterval(() => {
    watchAssets();
    ensureInjection();
  }, POLL_MS);
  const sidecarTimer = setInterval(checkSidecar, SIDECAR_CHECK_MS);

  const shutdown = () => {
    clearInterval(pollTimer);
    clearInterval(sidecarTimer);
    closeAllWatchers();
    releaseDaemonLock();
    log("守护进程退出", { dedupe: false });
    process.exit(0);
  };

  process.on("exit", () => {
    closeAllWatchers();
    releaseDaemonLock();
  });
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("uncaughtException", (err) => {
    log(`未捕获异常: ${err && err.stack ? err.stack : err}`, { dedupe: false });
  });
  process.on("unhandledRejection", (err) => {
    log(`未处理的 Promise 拒绝: ${err && err.stack ? err.stack : err}`, { dedupe: false });
  });
}

module.exports = {
  isProcessAlive,
  readPidFile,
  acquireDaemonLock,
  releaseDaemonLock,
  ensureInjection,
  watchAssets,
  closeAllWatchers,
};

if (require.main === module) {
  main();
}
