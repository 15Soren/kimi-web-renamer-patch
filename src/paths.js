const fs = require("fs");
const os = require("os");
const path = require("path");

function kimiHome() {
  return process.env.KIMI_CODE_HOME || path.join(os.homedir(), ".kimi-code");
}

function renamerStateDir() {
  return path.join(kimiHome(), "kimi-renamer");
}

function serverConfigPath() {
  return process.env.KIMI_RENAMER_SERVER_CONFIG || path.join(renamerStateDir(), "server.json");
}

function daemonPidPath() {
  return path.join(renamerStateDir(), "daemon.pid");
}

function sidecarPidPath() {
  return path.join(renamerStateDir(), "sidecar.pid");
}

function normalizePathKey(targetPath) {
  const resolved = path.resolve(targetPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function uniquePaths(pathsList) {
  const out = [];
  const seen = new Set();
  for (const item of pathsList) {
    if (!item) continue;
    const key = normalizePathKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function isExecutableFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    if (process.platform === "win32") return true;
    return (stat.mode & 0o111) !== 0;
  } catch (e) {
    return false;
  }
}

/**
 * 纯 Node.js 在 PATH 中查找可执行文件（避免在 Windows 后台进程调用 where.exe 弹出控制台窗口）
 */
function findExecutablesInPath(commandName, env = process.env) {
  if (!commandName || typeof commandName !== "string") return [];
  const isWin = process.platform === "win32";
  const pathExts = isWin
    ? (env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
        .split(";")
        .map((ext) => ext.trim())
        .filter(Boolean)
    : [""];

  const hasSeparator = commandName.includes("/") || commandName.includes("\\");
  const hasKnownExt =
    isWin && pathExts.some((ext) => commandName.toLowerCase().endsWith(ext.toLowerCase()));

  const buildCandidates = (basePath) => {
    if (!isWin) return [basePath];
    const list = [];
    if (hasKnownExt) {
      list.push(basePath);
    } else {
      for (const ext of pathExts) {
        list.push(basePath + ext);
      }
      list.push(basePath);
    }
    return list;
  };

  const results = [];
  const seen = new Set();
  const pushIfValid = (candidate) => {
    if (!isExecutableFile(candidate)) return;
    const key = normalizePathKey(candidate);
    if (seen.has(key)) return;
    seen.add(key);
    results.push(path.resolve(candidate));
  };

  if (hasSeparator) {
    for (const candidate of buildCandidates(commandName)) {
      pushIfValid(candidate);
    }
    return results;
  }

  const rawPath = env.PATH || env.Path || "";
  for (const rawDir of rawPath.split(path.delimiter)) {
    const dir = rawDir.trim().replace(/^"+|"+$/g, "");
    if (!dir) continue;
    const base = path.join(dir, commandName);
    for (const candidate of buildCandidates(base)) {
      pushIfValid(candidate);
    }
  }

  return results;
}

/**
 * 从 dist-web 路径反推所属用户的 home 目录
 */
function homeFromWebDir(webDir) {
  if (!webDir) return null;
  const normalized = path.normalize(webDir);
  const lower = normalized.toLowerCase();
  const markers = [
    `${path.sep}.cache${path.sep}kimi-code${path.sep}web${path.sep}`,
    `${path.sep}.kimi-code${path.sep}`,
    `${path.sep}appdata${path.sep}local${path.sep}`,
    `${path.sep}appdata${path.sep}roaming${path.sep}`,
  ];
  for (const marker of markers) {
    const index = lower.indexOf(marker);
    if (index > 0) return normalized.slice(0, index);
  }
  return null;
}

/**
 * 返回 dist-web 所属用户的 Kimi 配置目录（非缓存目录）
 */
function kimiHomeForWebDir(webDir) {
  const home = homeFromWebDir(webDir);
  return home ? path.join(home, ".kimi-code") : null;
}

function listCacheRoots() {
  const override = process.env.KIMI_RENAMER_CACHE_ROOTS;
  if (override) {
    return [...new Set(override.split(path.delimiter).filter(Boolean))];
  }

  const homedir = os.homedir();
  const home = kimiHome();
  const roots = [];

  if (process.env.XDG_CACHE_HOME) {
    roots.push(path.join(process.env.XDG_CACHE_HOME, "kimi-code", "web"));
  }

  roots.push(
    path.join(homedir, ".cache", "kimi-code", "web"),
    path.join(home, "web"),
    path.join(home, "cache", "web"),
    path.join(home, "dist-web"),
    path.join(home, "bin", "dist-web"),
    path.join(home, "versions")
  );

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || path.join(homedir, "AppData", "Local");
    const appData = process.env.APPDATA || path.join(homedir, "AppData", "Roaming");
    roots.push(
      path.join(localAppData, "kimi-code", "web"),
      path.join(localAppData, "kimi-code"),
      path.join(localAppData, "cache", "kimi-code", "web"),
      path.join(localAppData, "Programs", "kimi-code"),
      path.join(appData, "kimi-code"),
      path.join(os.tmpdir(), "kimi-code", "web")
    );
  } else if (process.platform === "darwin") {
    roots.push(path.join(homedir, "Library", "Caches", "kimi-code", "web"));
  }

  if (process.env.KIMI_RENAMER_ALL_USERS === "1") {
    let passwd = "";
    try {
      passwd = fs.readFileSync("/etc/passwd", "utf8");
    } catch (e) {
      passwd = "";
    }
    for (const line of passwd.split("\n")) {
      const parts = line.split(":");
      if (parts.length < 7) continue;
      const uid = Number(parts[2]);
      const home = parts[5];
      const shell = parts[6];
      if (!(uid === 0 || uid >= 1000)) continue;
      if (!home || /(?:nologin|false)$/.test(shell)) continue;
      roots.push(path.join(home, ".cache", "kimi-code", "web"));
    }
  }

  return uniquePaths(roots);
}

module.exports = {
  kimiHome,
  renamerStateDir,
  serverConfigPath,
  daemonPidPath,
  sidecarPidPath,
  normalizePathKey,
  uniquePaths,
  findExecutablesInPath,
  homeFromWebDir,
  kimiHomeForWebDir,
  listCacheRoots,
};
