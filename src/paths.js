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
 * 从 dist-web 路径反推所属用户的 home 目录：
 * <home>/.cache/kimi-code/web/<版本>/<平台>/<hash>/dist-web
 */
function homeFromWebDir(webDir) {
  if (!webDir) return null;
  const marker = `${path.sep}.cache${path.sep}kimi-code${path.sep}web${path.sep}`;
  const index = webDir.indexOf(marker);
  if (index <= 0) return null;
  return webDir.slice(0, index);
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
  const roots = override
    ? override.split(path.delimiter).filter(Boolean)
    : [path.join(os.homedir(), ".cache", "kimi-code", "web")];

  if (!override && process.platform === "win32" && process.env.LOCALAPPDATA) {
    roots.push(
      path.join(process.env.LOCALAPPDATA, "kimi-code", "web"),
      path.join(process.env.LOCALAPPDATA, "kimi-code", "Cache", "web")
    );
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
