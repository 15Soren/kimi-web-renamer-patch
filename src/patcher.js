const path = require("path");
const {
  findKimiConfigPath,
  resolveRenameModelInfo,
  listAvailableModels,
  setRenameModelInConfig,
} = require("./kimi-config");

function tryRequire(modPath) {
  try {
    return require(modPath);
  } catch (err) {
    if (err && err.code === "MODULE_NOT_FOUND") return null;
    throw err;
  }
}

const releaseMeta = tryRequire("./release-meta") || {
  variant: "unified",
  defaultMode: "auto",
};
const npmMode = tryRequire("./modes/npm");
const standaloneMode = tryRequire("./modes/standalone");

function ensureModeAvailable(mode) {
  if (mode === "npm" && !npmMode) {
    throw new Error("当前发行版仅支持单文件 (standalone) 模式，请使用 npm 发行版或完整源码仓库");
  }
  if (mode === "standalone" && !standaloneMode) {
    throw new Error("当前发行版仅支持 npm 模式，请使用 standalone 发行版或完整源码仓库");
  }
}

/**
 * 探测安装目标与运行模式 (npm / standalone)
 */
function detectInstallTarget(customPath, preferredMode = releaseMeta.defaultMode || "auto") {
  const mode = String(preferredMode || "auto").toLowerCase();
  if (!["auto", "npm", "standalone"].includes(mode)) {
    throw new Error(`不支持的模式: ${preferredMode}，可选值: auto, npm, standalone`);
  }

  if (mode === "npm") {
    ensureModeAvailable("npm");
    const targetDir = npmMode.findKimiCodePath(customPath);
    return targetDir ? { mode: "npm", targetDir } : null;
  }

  if (mode === "standalone") {
    ensureModeAvailable("standalone");
    const targetDir = standaloneMode.findWebAssetsDir(customPath);
    return targetDir ? { mode: "standalone", targetDir } : null;
  }

  // auto 模式
  if (customPath) {
    const resolved = path.resolve(customPath);
    if (npmMode && npmMode.isValidKimiDir(resolved)) {
      return { mode: "npm", targetDir: resolved };
    }
    if (standaloneMode) {
      try {
        const webDir = standaloneMode.findWebAssetsDir(resolved);
        if (webDir) return { mode: "standalone", targetDir: webDir };
      } catch (e) {
        // 继续抛出统一错误
      }
    }
    throw new Error(`指定的路径既不是有效的 npm 安装目录也不是有效的 dist-web 目录: ${resolved}`);
  }

  if (npmMode) {
    const npmDir = npmMode.findKimiCodePath();
    if (npmDir) return { mode: "npm", targetDir: npmDir };
  }
  if (standaloneMode) {
    const webDir = standaloneMode.findWebAssetsDir();
    if (webDir) return { mode: "standalone", targetDir: webDir };
  }
  return null;
}

function resolveModeForDir(targetDir, explicitMode) {
  if (explicitMode && explicitMode !== "auto") {
    ensureModeAvailable(explicitMode);
    return explicitMode;
  }
  if (releaseMeta.defaultMode && releaseMeta.defaultMode !== "auto") {
    ensureModeAvailable(releaseMeta.defaultMode);
    return releaseMeta.defaultMode;
  }
  if (npmMode && npmMode.isValidKimiDir(targetDir)) return "npm";
  if (standaloneMode && standaloneMode.isValidDistWebDir(targetDir)) return "standalone";
  if (npmMode) return "npm";
  if (standaloneMode) return "standalone";
  throw new Error("未找到可用的补丁模式模块");
}

function checkStatus(targetDir, options = {}) {
  const mode = resolveModeForDir(targetDir, options && options.mode);
  return mode === "standalone"
    ? standaloneMode.checkStatus(targetDir, options)
    : npmMode.checkStatus(targetDir);
}

function applyPatch(targetDir, options = {}) {
  const mode = resolveModeForDir(targetDir, options && options.mode);
  return mode === "standalone"
    ? standaloneMode.applyPatch(targetDir, options)
    : npmMode.applyPatch(targetDir, options);
}

function restorePatch(targetDir, options = {}) {
  const mode = resolveModeForDir(targetDir, options && options.mode);
  return mode === "standalone"
    ? standaloneMode.restorePatch(targetDir, options)
    : npmMode.restorePatch(targetDir);
}

module.exports = {
  releaseMeta,
  npmMode,
  standaloneMode,
  detectInstallTarget,
  resolveModeForDir,
  checkStatus,
  applyPatch,
  restorePatch,
  // npm 模式兼容导出
  findKimiCodePath: npmMode ? npmMode.findKimiCodePath : undefined,
  isValidKimiDir: npmMode ? npmMode.isValidKimiDir : undefined,
  // standalone 模式兼容导出
  DEFAULT_PORT: standaloneMode ? standaloneMode.DEFAULT_PORT : 58629,
  serverConfigPath: standaloneMode ? standaloneMode.serverConfigPath : undefined,
  readServerConfig: standaloneMode ? standaloneMode.readServerConfig : undefined,
  writeServerConfig: standaloneMode ? standaloneMode.writeServerConfig : undefined,
  isValidDistWebDir: standaloneMode ? standaloneMode.isValidDistWebDir : undefined,
  listDistWebDirs: standaloneMode ? standaloneMode.listDistWebDirs : undefined,
  findWebAssetsDir: standaloneMode ? standaloneMode.findWebAssetsDir : undefined,
  // 配置相关导出
  findKimiConfigPath,
  resolveRenameModelInfo,
  listAvailableModels,
  setRenameModelInConfig,
};
