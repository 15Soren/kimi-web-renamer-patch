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

  return [...new Set(roots)];
}

module.exports = {
  kimiHome,
  renamerStateDir,
  serverConfigPath,
  homeFromWebDir,
  kimiHomeForWebDir,
  listCacheRoots,
};
