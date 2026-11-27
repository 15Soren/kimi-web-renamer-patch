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
const { renamerStateDir, listCacheRoots } = require("../paths");

const STATE_DIR = renamerStateDir();
const LOG_PATH = path.join(STATE_DIR, "daemon.log");
const POLL_MS = 1000;
const SIDECAR_CHECK_MS = 5000;
const LOG_MAX_BYTES = 256 * 1024;

let lastMessage = "";
let lastSidecarSpawn = 0;
let serverChild = null;

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  if (message === lastMessage) return;
  lastMessage = message;
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    try {
      if (fs.statSync(LOG_PATH).size > LOG_MAX_BYTES) fs.truncateSync(LOG_PATH, 0);
    } catch (e) {
      // 日志尚不存在
    }
    fs.appendFileSync(LOG_PATH, line, "utf8");
  } catch (e) {
    // 日志失败不影响守护逻辑
  }
}

function ensureInjection() {
  const dirs = listDistWebDirs();
  if (dirs.length === 0) {
    log("未找到 dist-web，等待 kimi web 首次启动");
    return false;
  }
  let ok = true;
  for (const webDir of dirs) {
    const status = checkStatus(webDir);
    if (status.isHtmlPatched && status.isRenamerJsPresent && status.isRenamerIcoPresent) continue;
    try {
      applyPatch(webDir);
      log(`已重新注入: ${webDir}`);
    } catch (err) {
      ok = false;
      log(`注入失败 (${webDir}): ${err.message}`);
    }
  }
  return ok;
}

function checkSidecar() {
  const config = readServerConfig();
  if (!config) return;
  const port = Number(config.port) || 58629;
  const req = http.get({ host: "127.0.0.1", port, path: "/health", timeout: 800 }, (res) => {
    res.resume();
    if (res.statusCode !== 200) startSidecar();
  });
  req.on("error", startSidecar);
  req.on("timeout", () => {
    req.destroy();
    startSidecar();
  });
}

function startSidecar() {
  const now = Date.now();
  if (now - lastSidecarSpawn < SIDECAR_CHECK_MS) return;
  if (serverChild && serverChild.exitCode === null) return;
  lastSidecarSpawn = now;
  try {
    serverChild = spawn(process.execPath, [path.join(__dirname, "server.js")], {
      detached: true,
      stdio: ["ignore", "ignore", "ignore"],
    });
    serverChild.unref();
    log("sidecar 未运行，已尝试启动");
  } catch (err) {
    log(`sidecar 启动失败: ${err.message}`);
  }
}

const watched = new Set();

function watchAssets() {
  for (const root of listCacheRoots()) {
    if (watched.has(root) || !fs.existsSync(root)) continue;
    try {
      fs.watch(root, { recursive: true }, () => {
        ensureInjection();
      });
      watched.add(root);
    } catch (e) {
      log(`inotify 监听不可用 (${root})，退回轮询: ${e.message}`);
    }
  }
}

function main() {
  log("守护进程启动");
  watchAssets();
  ensureInjection();
  checkSidecar();
  setInterval(() => {
    watchAssets();
    ensureInjection();
  }, POLL_MS);
  setInterval(checkSidecar, SIDECAR_CHECK_MS);

  const shutdown = () => {
    log("守护进程退出");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
