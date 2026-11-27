const fs = require("fs");
const os = require("os");
const path = require("path");

function kimiHome() {
  return process.env.KIMI_CODE_HOME || path.join(os.homedir(), ".kimi-code");
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
    const key = isWin ? path.resolve(candidate).toLowerCase() : path.resolve(candidate);
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
 * Linux/POSIX 下通过 sudo 以 root 运行时，解析原调用用户 (SUDO_USER) 的 home 目录
 */
function sudoUserHome(env = process.env) {
  if (process.platform === "win32") return null;
  if (typeof process.getuid === "function" && process.getuid() !== 0) return null;
  const sudoUser = env.SUDO_USER;
  if (!sudoUser || sudoUser === "root") return null;
  try {
    const passwd = fs.readFileSync("/etc/passwd", "utf8");
    for (const line of passwd.split("\n")) {
      const parts = line.split(":");
      if (parts.length >= 6 && parts[0] === sudoUser && parts[5]) {
        return parts[5];
      }
    }
  } catch (e) {
    // 忽略读取 /etc/passwd 失败
  }
  return null;
}

module.exports = {
  kimiHome,
  findExecutablesInPath,
  sudoUserHome,
};
