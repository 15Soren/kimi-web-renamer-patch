const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  findKimiConfigPath,
  resolveRenameModelInfo,
} = require("../kimi-config");
const {
  serverConfigPath,
  listCacheRoots,
  homeFromWebDir,
  normalizePathKey,
  uniquePaths,
  findExecutablesInPath,
} = require("../paths");

const SCRIPT_TAG = '<script src="/kimi-renamer.js"></script>';
const RENAMER_JS_NAME = "kimi-renamer.js";
const RENAMER_ICO_NAME = "kimi-renamer.ico";
const HTML_BACKUP_SUFFIX = ".renamer.bak";
const DEFAULT_PORT = 58629;
const DEFAULT_HOST = "0.0.0.0";

function readServerConfig(configPath = serverConfigPath()) {
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (e) {
    return null;
  }
}

function writeFileAtomicUtf8(targetPath, content, mode) {
  const dir = path.dirname(targetPath);
  const tmpPath = path.join(
    dir,
    `.${path.basename(targetPath)}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`
  );
  try {
    fs.writeFileSync(tmpPath, content, {
      encoding: "utf8",
      ...(mode ? { mode } : {}),
    });
    if (mode) {
      try {
        fs.chmodSync(tmpPath, mode);
      } catch (e) {
        // 某些文件系统（如 Windows）不支持 chmod
      }
    }
    try {
      fs.renameSync(tmpPath, targetPath);
    } catch (err) {
      if (err && (err.code === "EPERM" || err.code === "EACCES" || err.code === "EBUSY" || err.code === "EXDEV")) {
        // Windows 目标文件瞬时被占用时回退直接覆写
        fs.writeFileSync(targetPath, content, {
          encoding: "utf8",
          ...(mode ? { mode } : {}),
        });
      } else {
        throw err;
      }
    }
  } finally {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch (e) {
      // 忽略清理失败
    }
  }
  if (mode) {
    try {
      fs.chmodSync(targetPath, mode);
    } catch (e) {
      // 某些文件系统（如挂载的 Windows 盘）不支持 chmod
    }
  }
}

function writeServerConfig(config, configPath = serverConfigPath()) {
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o2770 });
  try {
    fs.chmodSync(dir, 0o2770);
  } catch (e) {
    // 某些文件系统（如挂载的 Windows 盘）不支持 chmod
  }
  const serialized = JSON.stringify(config, null, 2) + "\n";
  try {
    if (fs.existsSync(configPath) && fs.readFileSync(configPath, "utf8") === serialized) {
      return configPath;
    }
  } catch (e) {
    // 无法读取旧文件时继续写入
  }
  writeFileAtomicUtf8(configPath, serialized, 0o660);
  return configPath;
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch (e) {
    return [];
  }
}

/**
 * 校验目录是否为 Kimi Code Web 的静态资源目录
 */
function isValidDistWebDir(dirPath) {
  if (!dirPath) return false;
  try {
    return fs.statSync(path.join(dirPath, "index.html")).isFile();
  } catch (e) {
    return false;
  }
}

function compareVersions(a, b) {
  const pa = String(a).split(/[.-]/).map((v) => parseInt(v, 10) || 0);
  const pb = String(b).split(/[.-]/).map((v) => parseInt(v, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

const SKIP_SCAN_DIRS = new Set(["node_modules", ".git", "sessions", "logs", "assets", "kimi-renamer"]);

function extractVersionFromPath(dirPath) {
  const segments = String(dirPath || "").split(/[\\/]+/);
  for (let i = segments.length - 1; i >= 0; i--) {
    const match = segments[i].match(/^v?(\d+\.\d+(?:\.\d+)?(?:[-+].*)?)$/i);
    if (match) return match[1];
  }
  return "0";
}

function getIndexMtimeMs(webDir) {
  try {
    return fs.statSync(path.join(webDir, "index.html")).mtimeMs || 0;
  } catch (e) {
    return 0;
  }
}

function scanDistWebDirsFromRoot(root, maxDepth = 6) {
  const found = [];
  const seen = new Set();

  const record = (dir) => {
    const normalized = path.resolve(dir);
    const key = normalizePathKey(normalized);
    if (seen.has(key) || !isValidDistWebDir(normalized)) return;
    seen.add(key);
    found.push({
      dir: normalized,
      version: extractVersionFromPath(normalized),
      mtimeMs: getIndexMtimeMs(normalized),
    });
  };

  if (!root || !fs.existsSync(root)) return found;
  record(root);

  const walk = (current, depth) => {
    if (depth >= maxDepth) return;
    for (const entry of safeReaddir(current)) {
      if (SKIP_SCAN_DIRS.has(entry)) continue;
      const full = path.join(current, entry);
      let stat;
      try {
        stat = fs.statSync(full);
      } catch (e) {
        continue;
      }
      if (!stat.isDirectory()) continue;
      if (entry === "dist-web") {
        record(full);
        continue;
      }
      walk(full, depth + 1);
    }
  };

  walk(root, 0);
  return found;
}

function listBinarySiblingRoots() {
  if (process.env.KIMI_RENAMER_CACHE_ROOTS) return [];
  const roots = [];
  try {
    const binPaths = findExecutablesInPath("kimi");
    for (const binPath of binPaths) {
      const dirs = [path.dirname(binPath)];
      try {
        const realDir = path.dirname(fs.realpathSync(binPath));
        if (!dirs.some((d) => normalizePathKey(d) === normalizePathKey(realDir))) {
          dirs.push(realDir);
        }
      } catch (e) {
        // 忽略无法解析符号链接的情况
      }
      for (const binDir of dirs) {
        const parentDir = path.resolve(binDir, "..");
        roots.push(
          path.join(binDir, "dist-web"),
          path.join(parentDir, "dist-web"),
          path.join(parentDir, "web"),
          path.join(parentDir, "resources", "dist-web")
        );
      }
    }
  } catch (e) {
    // PATH 中找不到 kimi 时忽略
  }
  return uniquePaths(roots);
}

/**
 * 列出本机单文件安装的所有 dist-web 缓存/资源目录，按版本从新到旧排序。
 * 兼容 Linux (~/.cache/kimi-code/web/...)、macOS 与 Windows (%LOCALAPPDATA% / %APPDATA% / %USERPROFILE%\.kimi-code 等)。
 */
function listDistWebDirs() {
  const found = [];
  const seen = new Set();
  const roots = uniquePaths([...listCacheRoots(), ...listBinarySiblingRoots()]);

  for (const root of roots) {
    for (const item of scanDistWebDirsFromRoot(root, 6)) {
      const key = normalizePathKey(item.dir);
      if (!seen.has(key)) {
        seen.add(key);
        found.push(item);
      }
    }
  }

  return found
    .sort((a, b) => compareVersions(b.version, a.version) || b.mtimeMs - a.mtimeMs)
    .map((item) => item.dir);
}

/**
 * 定位 dist-web 目录；--path 可指向 dist-web 本身、包含 dist-web 的目录或其上级缓存目录
 */
function findWebAssetsDir(customPath) {
  if (customPath) {
    const resolved = path.resolve(customPath);
    if (isValidDistWebDir(resolved)) return resolved;
    const nested = path.join(resolved, "dist-web");
    if (isValidDistWebDir(nested)) return nested;
    const scanned = scanDistWebDirsFromRoot(resolved, 6).sort(
      (a, b) => compareVersions(b.version, a.version) || b.mtimeMs - a.mtimeMs
    );
    if (scanned.length > 0) return scanned[0].dir;
    throw new Error(`指定的路径不是有效的 Kimi Code Web 静态资源目录: ${resolved}`);
  }

  const dirs = listDistWebDirs();
  if (dirs.length > 0) return dirs[0];
  return null;
}

/**
 * 检查当前单文件模式补丁状态
 */
function checkStatus(webDir, options = {}) {
  const indexHtml = path.join(webDir, "index.html");
  const renamerJs = path.join(webDir, RENAMER_JS_NAME);
  const renamerIco = path.join(webDir, RENAMER_ICO_NAME);
  const htmlBak = indexHtml + HTML_BACKUP_SUFFIX;

  const htmlContent = fs.existsSync(indexHtml) ? fs.readFileSync(indexHtml, "utf8") : "";
  const isHtmlPatched = htmlContent.includes(SCRIPT_TAG);
  const isRenamerJsPresent = fs.existsSync(renamerJs);
  const isRenamerIcoPresent = fs.existsSync(renamerIco);
  const hasBackup = fs.existsSync(htmlBak);
  const config = readServerConfig(options.serverConfigPath);

  return {
    mode: "standalone",
    targetDir: webDir,
    webDir,
    isHtmlPatched,
    isRenamerJsPresent,
    isRenamerIcoPresent,
    hasBackup,
    isFullyPatched: isHtmlPatched && isRenamerJsPresent && hasBackup && !!config,
    serverConfig: config,
    port: config ? config.port : DEFAULT_PORT,
  };
}

function normalizeModelInfo(modelInfo) {
  const endpoint = new URL(modelInfo.endpoint);
  if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw new Error("模型 Endpoint 必须为不含账户信息的 HTTP(S) 地址");
  }
  if (typeof modelInfo.apiKey !== "string" || !modelInfo.apiKey.trim()) {
    throw new Error("重命名模型需要显式 api_key 或 api_key_env，不能使用 Web 会话凭证调用模型");
  }
  return {
    ...modelInfo,
    endpoint: endpoint.href,
  };
}

/**
 * 守护进程以 root 运行时，把注入产物归还给 dist-web 所属用户
 */
function alignOwnership(webDir, files) {
  if (typeof process.getuid !== "function" || process.getuid() !== 0) return;
  try {
    const stat = fs.statSync(webDir);
    for (const file of files) {
      try {
        fs.chownSync(file, stat.uid, stat.gid);
      } catch (e) {
        // 文件系统不支持 chown 时忽略
      }
    }
  } catch (e) {
    // 目录不可访问时忽略
  }
}

function writeIfChangedUtf8(filePath, content) {
  try {
    if (fs.existsSync(filePath) && fs.readFileSync(filePath, "utf8") === content) {
      return false;
    }
  } catch (e) {
    // 读取失败时直接覆盖
  }
  fs.writeFileSync(filePath, content, "utf8");
  return true;
}

function copyIfChanged(srcPath, destPath) {
  try {
    if (fs.existsSync(destPath)) {
      const srcBuf = fs.readFileSync(srcPath);
      const destBuf = fs.readFileSync(destPath);
      if (srcBuf.equals(destBuf)) return false;
    }
  } catch (e) {
    // 读取失败时直接覆盖
  }
  fs.copyFileSync(srcPath, destPath);
  return true;
}

/**
 * 应用单文件模式补丁：注入前端脚本、写入本地 sidecar 配置
 */
function applyPatch(webDir, options = {}) {
  if (!isValidDistWebDir(webDir)) {
    throw new Error("目标目录缺少 Kimi Code Web 静态文件 (index.html)");
  }

  const configPath = options.serverConfigPath || serverConfigPath();
  const previous = readServerConfig(configPath);

  let modelInfo;
  let shouldPersistExplicitConfig = false;
  if (options && options.endpoint) {
    modelInfo = options;
  } else {
    const explicitOpt = Boolean(options && options.configPath && options.configPathExplicit !== false);
    const savedConfigPath =
      previous && typeof previous.sourceConfigPath === "string" && fs.existsSync(previous.sourceConfigPath)
        ? previous.sourceConfigPath
        : null;
    const savedIsExplicit = Boolean(previous && previous.sourceConfigExplicit === true);
    const webDirHome = homeFromWebDir(webDir);
    const webDirConfigPath = webDirHome ? findKimiConfigPath(null, webDirHome) : null;

    let tomlConfigPath = null;
    if (options && options.configPath) {
      tomlConfigPath = options.configPath;
      shouldPersistExplicitConfig = explicitOpt;
    } else if (savedConfigPath && savedIsExplicit) {
      tomlConfigPath = savedConfigPath;
      shouldPersistExplicitConfig = true;
    } else if (webDirConfigPath) {
      // 多用户守护进程 (KIMI_RENAMER_ALL_USERS=1) 优先读取当前 dist-web 所属用户自己的 config.toml，
      // 避免被其他用户（如 root）历史写入的 sourceConfigPath 劫持
      tomlConfigPath = webDirConfigPath;
    } else if (savedConfigPath) {
      tomlConfigPath = savedConfigPath;
    } else {
      tomlConfigPath = findKimiConfigPath(null, webDirHome);
    }

    if (!tomlConfigPath) {
      throw new Error("未能定位到系统的 Kimi Code 配置文件 (config.toml)");
    }
    modelInfo = resolveRenameModelInfo(tomlConfigPath, options.modelId);
  }
  modelInfo = normalizeModelInfo(modelInfo);

  const rawPort =
    options.port !== undefined && options.port !== null
      ? options.port
      : process.env.KIMI_RENAMER_PORT || (previous && previous.port) || DEFAULT_PORT;
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`无效的 sidecar 端口: ${rawPort}`);
  }

  const token = previous && previous.token ? previous.token : crypto.randomBytes(24).toString("hex");

  const serverConfig = {
    version: 1,
    endpoint: modelInfo.endpoint,
    apiKey: modelInfo.apiKey,
    model: modelInfo.actualModel || modelInfo.model,
    systemPrompt: modelInfo.systemPrompt,
    temperature: typeof modelInfo.temperature === "number" ? modelInfo.temperature : 0.2,
    maxTokens: typeof modelInfo.maxTokens === "number" ? modelInfo.maxTokens : 1024,
    host: options.host || (previous && previous.host) || DEFAULT_HOST,
    port,
    token,
    ...(shouldPersistExplicitConfig && modelInfo.configPath
      ? { sourceConfigPath: modelInfo.configPath, sourceConfigExplicit: true }
      : {}),
  };

  const indexHtml = path.join(webDir, "index.html");
  const htmlBak = indexHtml + HTML_BACKUP_SUFFIX;
  let htmlContent = fs.readFileSync(indexHtml, "utf8");

  if (!fs.existsSync(htmlBak) && htmlContent.includes(SCRIPT_TAG)) {
    throw new Error("已安装补丁但缺少原版备份，请先 unpatch 再重新应用");
  }
  if (!htmlContent.includes("</head>")) {
    throw new Error("不兼容的 index.html：缺少脚本注入位置");
  }

  if (!fs.existsSync(htmlBak)) {
    fs.writeFileSync(htmlBak, htmlContent, "utf8");
  } else if (!htmlContent.includes(SCRIPT_TAG)) {
    // 原版文件已被 kimi web 更新或还原，刷新备份
    writeIfChangedUtf8(htmlBak, htmlContent);
  } else {
    // 重复应用时总是从原版备份出发，避免重复注入
    htmlContent = fs.readFileSync(htmlBak, "utf8");
  }

  let injected = htmlContent;
  if (!injected.includes(SCRIPT_TAG)) {
    const eol = injected.includes("\r\n") ? "\r\n" : "\n";
    if (injected.includes('<script src="/boot.js"></script>')) {
      injected = injected.replace(
        '<script src="/boot.js"></script>',
        `<script src="/boot.js"></script>${eol}    ${SCRIPT_TAG}`
      );
    } else {
      injected = injected.replace("</head>", `  ${SCRIPT_TAG}${eol}  </head>`);
    }
  }

  const template = fs.readFileSync(path.join(__dirname, "..", "template", "kimi-renamer.js"), "utf8");
  const frontendConfig = JSON.stringify({ mode: "sidecar", port, token });
  const renderedJs = template.replace("__CONFIG_PLACEHOLDER__", () => frontendConfig);

  // 先写静态脚本、图标与 sidecar 配置，最后更新 index.html，确保浏览器加载时所有资源已就绪
  writeIfChangedUtf8(path.join(webDir, RENAMER_JS_NAME), renderedJs);
  copyIfChanged(
    path.join(__dirname, "..", "assets", "Kimi.ico"),
    path.join(webDir, RENAMER_ICO_NAME)
  );
  writeServerConfig(serverConfig, configPath);
  writeIfChangedUtf8(indexHtml, injected);

  alignOwnership(webDir, [
    indexHtml,
    htmlBak,
    path.join(webDir, RENAMER_JS_NAME),
    path.join(webDir, RENAMER_ICO_NAME),
  ]);

  return {
    success: true,
    mode: "standalone",
    targetDir: webDir,
    webDir,
    modelInfo,
    serverConfigPath: configPath,
    port,
    host: serverConfig.host,
    token,
  };
}

/**
 * 还原单文件模式补丁
 */
function restorePatch(webDir, options = {}) {
  const indexHtml = path.join(webDir, "index.html");
  const htmlBak = indexHtml + HTML_BACKUP_SUFFIX;
  let restoredAny = false;

  if (fs.existsSync(htmlBak)) {
    fs.copyFileSync(htmlBak, indexHtml);
    fs.unlinkSync(htmlBak);
    restoredAny = true;
  } else if (fs.existsSync(indexHtml)) {
    const content = fs.readFileSync(indexHtml, "utf8");
    if (content.includes(SCRIPT_TAG)) {
      const cleaned = content
        .replace(new RegExp(`[ \\t]*${SCRIPT_TAG.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\r?\\n?`, "g"), "");
      fs.writeFileSync(indexHtml, cleaned, "utf8");
      restoredAny = true;
    }
  }

  for (const name of [RENAMER_JS_NAME, RENAMER_ICO_NAME]) {
    const file = path.join(webDir, name);
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      restoredAny = true;
    }
  }

  const configPath = options.serverConfigPath || serverConfigPath();
  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);
    restoredAny = true;
    try {
      fs.rmdirSync(path.dirname(configPath));
    } catch (e) {
      // 目录非空或不存在，忽略
    }
  }

  return { success: true, mode: "standalone", webDir, restoredAny };
}

module.exports = {
  SCRIPT_TAG,
  DEFAULT_PORT,
  DEFAULT_HOST,
  serverConfigPath,
  readServerConfig,
  writeServerConfig,
  isValidDistWebDir,
  listDistWebDirs,
  findWebAssetsDir,
  checkStatus,
  applyPatch,
  restorePatch,
};
