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

function writeServerConfig(config, configPath = serverConfigPath()) {
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o2770 });
  try {
    fs.chmodSync(dir, 0o2770);
  } catch (e) {
    // 某些文件系统（如挂载的 Windows 盘）不支持 chmod
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o660,
  });
  try {
    fs.chmodSync(configPath, 0o660);
  } catch (e) {
    // 某些文件系统（如挂载的 Windows 盘）不支持 chmod
  }
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

/**
 * 列出本机单文件安装的所有 dist-web 缓存目录，按版本从新到旧排序。
 * 单文件安装的静态资源缓存在 ~/.cache/kimi-code/web/<版本>/<平台>/<hash>/dist-web。
 */
function listDistWebDirs() {
  const found = [];
  const seen = new Set();
  for (const root of listCacheRoots()) {
    for (const version of safeReaddir(root)) {
      for (const platform of safeReaddir(path.join(root, version))) {
        for (const hash of safeReaddir(path.join(root, version, platform))) {
          const dir = path.join(root, version, platform, hash, "dist-web");
          if (isValidDistWebDir(dir) && !seen.has(dir)) {
            seen.add(dir);
            found.push({ dir, version });
          }
        }
      }
    }
  }

  return found
    .sort((a, b) => compareVersions(b.version, a.version))
    .map((item) => item.dir);
}

/**
 * 定位 dist-web 目录；--path 可指向 dist-web 本身或包含 dist-web 的目录
 */
function findWebAssetsDir(customPath) {
  if (customPath) {
    const resolved = path.resolve(customPath);
    if (isValidDistWebDir(resolved)) return resolved;
    const nested = path.join(resolved, "dist-web");
    if (isValidDistWebDir(nested)) return nested;
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

/**
 * 应用单文件模式补丁：注入前端脚本、写入本地 sidecar 配置
 */
function applyPatch(webDir, options = {}) {
  if (!isValidDistWebDir(webDir)) {
    throw new Error("目标目录缺少 Kimi Code Web 静态文件 (index.html)");
  }

  let modelInfo;
  if (options && options.endpoint) {
    modelInfo = options;
  } else {
    const configPath =
      (options && options.configPath) || findKimiConfigPath(null, homeFromWebDir(webDir));
    if (!configPath) {
      throw new Error("未能定位到系统的 Kimi Code 配置文件 (config.toml)");
    }
    modelInfo = resolveRenameModelInfo(configPath, options.modelId);
  }
  modelInfo = normalizeModelInfo(modelInfo);

  const port = Number(options.port || process.env.KIMI_RENAMER_PORT || DEFAULT_PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`无效的 sidecar 端口: ${options.port}`);
  }

  const configPath = options.serverConfigPath || serverConfigPath();
  const previous = readServerConfig(configPath);
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
    fs.copyFileSync(indexHtml, htmlBak);
  } else if (!htmlContent.includes(SCRIPT_TAG)) {
    // 原版文件已被 kimi web 更新或还原，刷新备份
    fs.copyFileSync(indexHtml, htmlBak);
  } else {
    // 重复应用时总是从原版备份出发，避免重复注入
    htmlContent = fs.readFileSync(htmlBak, "utf8");
  }

  let injected = htmlContent;
  if (!injected.includes(SCRIPT_TAG)) {
    if (injected.includes('<script src="/boot.js"></script>')) {
      injected = injected.replace(
        '<script src="/boot.js"></script>',
        `<script src="/boot.js"></script>\n    ${SCRIPT_TAG}`
      );
    } else {
      injected = injected.replace("</head>", `  ${SCRIPT_TAG}\n  </head>`);
    }
  }
  fs.writeFileSync(indexHtml, injected, "utf8");

  const template = fs.readFileSync(path.join(__dirname, "..", "template", "kimi-renamer.js"), "utf8");
  const frontendConfig = JSON.stringify({ mode: "sidecar", port, token });
  fs.writeFileSync(
    path.join(webDir, RENAMER_JS_NAME),
    template.replace("__CONFIG_PLACEHOLDER__", () => frontendConfig),
    "utf8"
  );
  fs.copyFileSync(
    path.join(__dirname, "..", "assets", "Kimi.ico"),
    path.join(webDir, RENAMER_ICO_NAME)
  );

  writeServerConfig(serverConfig, configPath);

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
      fs.writeFileSync(
        indexHtml,
        content.replace(`    ${SCRIPT_TAG}\n`, "").replace(`  ${SCRIPT_TAG}\n`, "").replace(SCRIPT_TAG, ""),
        "utf8"
      );
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
