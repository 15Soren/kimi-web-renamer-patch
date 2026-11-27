#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const http = require("http");
const {
  homeFromWebDir,
  sudoUserHome,
  serverConfigPath,
} = require("../src/paths");
const {
  releaseMeta,
  detectInstallTarget,
  checkStatus,
  applyPatch,
  restorePatch,
  findKimiConfigPath,
  resolveRenameModelInfo,
  listAvailableModels,
  setRenameModelInConfig,
} = require("../src/patcher");

function tryRequire(modPath) {
  try {
    return require(modPath);
  } catch (err) {
    if (err && err.code === "MODULE_NOT_FOUND") return null;
    throw err;
  }
}

const serverModule = tryRequire("../src/standalone/server");
const hasStandalone = !!serverModule;
const variant = (releaseMeta && releaseMeta.variant) || "unified";
const defaultMode = (releaseMeta && releaseMeta.defaultMode) || "auto";

// 命令行参数解析
const args = process.argv.slice(2);
const positional = [];
let customPath = null;
let customConfigPath = null;
let customPort = null;
let requestedMode = defaultMode;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--path" || arg === "--config" || arg === "--port" || arg === "--mode") {
    const value = args[++i];
    if (!value || value.startsWith("-")) {
      console.error(`❌ ${arg} 缺少参数值`);
      process.exit(1);
    }
    if (arg === "--path") customPath = value;
    else if (arg === "--config") customConfigPath = value;
    else if (arg === "--port") {
      const parsedPort = Number(value);
      if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
        console.error(`❌ 无效的 --port 参数: ${value}，必须为 1-65535 的整数`);
        process.exit(1);
      }
      customPort = parsedPort;
    } else requestedMode = value.toLowerCase();
  } else if (arg === "-h" || arg === "--help") {
    continue;
  } else if (arg.startsWith("-")) {
    console.error(`❌ 未知选项: ${arg}`);
    process.exit(1);
  } else {
    positional.push(arg);
  }
}

const command = (positional[0] || "patch").toLowerCase();

// 帮助信息
if (args.includes("-h") || args.includes("--help") || command === "help") {
  printHelp();
  process.exit(0);
}

async function main() {
  const validCommands = ["status", "models", "list-models", "set-model", "unpatch", "restore", "patch", "serve"];
  if (!validCommands.includes(command)) {
    throw new Error(`未知命令: ${command}，运行 --help 查看用法`);
  }
  if (positional.length > (command === "set-model" ? 2 : 1)) {
    throw new Error("存在多余位置参数");
  }
  if (!["auto", "npm", "standalone"].includes(requestedMode)) {
    throw new Error(`无效的 --mode 参数: ${requestedMode}，可选值: auto, npm, standalone`);
  }
  if (variant === "npm" && requestedMode === "standalone") {
    throw new Error("当前为 npm 专用发行版，不支持 --mode standalone");
  }
  if (variant === "standalone" && requestedMode === "npm") {
    throw new Error("当前为单文件 (standalone) 专用发行版，不支持 --mode npm");
  }

  console.log("\n=======================================================");
  console.log(`✨ Kimi Code Web 自动重命名补丁工具 (${formatVariantLabel()})`);
  console.log("=======================================================\n");

  if (command === "serve") {
    if (!hasStandalone) {
      throw new Error("当前为 npm 专用发行版，不需要启动 sidecar（直接重启 kimi web 即可）");
    }
    const started = await serverModule.startServer(customPort ? { port: customPort } : {});
    const shownHost = started.host === "0.0.0.0" ? "127.0.0.1" : started.host;
    console.log(`✅ sidecar 已启动: http://${shownHost}:${started.port}/ (监听 ${started.host})`);
    console.log(`🤖 使用模型: ${started.config.model}`);
    const shutdown = () => {
      if (typeof started.server.closeAllConnections === "function") {
        started.server.closeAllConnections();
      }
      started.server.close(() => process.exit(0));
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    return;
  }

  // 1. 定位 Kimi Code 目标目录与模式
  const needsInstall = !["models", "list-models"].includes(command);
  const detected = needsInstall ? detectInstallTarget(customPath, requestedMode) : null;
  if (needsInstall && !detected) {
    console.error("❌ 错误: 未能自动检测到 Kimi Code 安装路径！");
    if (variant !== "standalone") {
      console.error('👉 npm 安装请使用 --path 指定根目录，例如:');
      console.error('   node bin/cli.js patch --path "/path/to/node_modules/@moonshot-ai/kimi-code"');
    }
    if (variant !== "npm") {
      const samplePath =
        process.platform === "win32"
          ? "%LOCALAPPDATA%\\kimi-code\\...\\dist-web"
          : "$HOME/.cache/kimi-code/web/<版本>/<平台>/<hash>/dist-web";
      console.error("👉 单文件安装请确认已运行过 kimi web，或使用 --path 指定 dist-web，例如:");
      console.error(`   node bin/cli.js patch --path "${samplePath}"`);
    }
    console.error("");
    process.exit(1);
  }

  const targetDir = detected ? detected.targetDir : null;
  const activeMode = detected ? detected.mode : null;

  // 2. 定位 Kimi Code 配置文件 (config.toml)
  const needsConfig = !["status", "unpatch", "restore"].includes(command);
  const configHomeOverride = !customConfigPath
    ? (activeMode === "standalone" && targetDir ? homeFromWebDir(targetDir) : null) || sudoUserHome()
    : null;
  let kimiConfigPath = null;
  if (needsConfig || customConfigPath) {
    kimiConfigPath = findKimiConfigPath(customConfigPath, configHomeOverride);
  } else if (command === "status") {
    try {
      kimiConfigPath = findKimiConfigPath(null, configHomeOverride);
    } catch (e) {
      kimiConfigPath = null;
    }
  }
  if (needsConfig && !kimiConfigPath) {
    console.error("❌ 错误: 未能自动检测到 Kimi Code 的配置文件 (config.toml)！");
    console.error("👉 请确保已安装并配置过 Kimi Code，或使用 --config 手动指定。\n");
    process.exit(1);
  }

  if (targetDir) {
    console.log(`🧭 运行模式: ${activeMode === "standalone" ? "单文件安装 (standalone + sidecar)" : "npm 安装 (同源路由注入)"}`);
    console.log(`📍 检测到目标目录:\n   ${targetDir}`);
  }
  if (kimiConfigPath) {
    console.log(`⚙️  检测到 Kimi 配置文件:\n   ${kimiConfigPath}\n`);
  }

  // 3. 命令路由
  switch (command) {
    case "status": {
      const status = checkStatus(targetDir, { mode: activeMode });
      let liveSidecar = null;
      console.log("📊 补丁状态报告:");
      console.log(`   - 前端脚本 (kimi-renamer.js)   : ${status.isRenamerJsPresent ? "✅ 已就绪" : "❌ 未注入"}`);
      console.log(`   - index.html 引用注入          : ${status.isHtmlPatched ? "✅ 已注入" : "❌ 未注入"}`);
      if (activeMode === "npm") {
        console.log(`   - 服务端重命名代理路由         : ${status.isProxyPatched ? "✅ 已注入" : "❌ 未注入"}`);
      } else {
        const cfgPath = serverConfigPath();
        const probePort = (status.serverConfig && status.serverConfig.port) || status.port || 58629;
        liveSidecar = await checkSidecar(probePort);
        console.log(`   - sidecar 配置文件             : ${cfgPath}`);
        console.log(`   - sidecar 配置                 : ${status.serverConfig ? "✅ 已写入" : "❌ 未写入"}`);
        if (status.serverConfig) {
          console.log(`   - sidecar 端口                 : ${status.serverConfig.port}`);
          console.log(`   - sidecar 配置模型             : ${status.serverConfig.model}`);
        }
        if (liveSidecar.alive) {
          const liveModelLabel = liveSidecar.model ? ` (实际生效模型: ${liveSidecar.model})` : "";
          console.log(`   - sidecar 运行状态             : ✅ 运行中${liveModelLabel}`);
        } else {
          console.log("   - sidecar 运行状态             : ⚪ 未运行（点击按钮前需先启动）");
        }
      }
      console.log(`   - 官方文件原始备份             : ${status.hasBackup ? "✅ 已备份" : "⚪ 无备份"}`);

      let modelInfo = null;
      if (kimiConfigPath) {
        try {
          modelInfo = resolveRenameModelInfo(kimiConfigPath);
          console.log("\n🤖 当前绑定的模型配置 (读取自 config.toml):");
          console.log(`   - 目标模型 ID  : ${modelInfo.targetModelId}`);
          console.log(`   - 实际请求模型 : ${modelInfo.actualModel}`);
          console.log(`   - 模型生效策略 : ${modelInfo.isInheritedFromDefault ? "默认继承 default_model" : "已单独配置 rename_model"}`);
          console.log(`   - 对应供应商   : ${modelInfo.providerName}`);
          console.log(`   - 接口端点     : ${modelInfo.endpoint}`);
        } catch (e) {
          console.warn("\n⚠️ 读取模型配置失败:", e.message);
        }
      }

      if (activeMode === "standalone") {
        if (liveSidecar && liveSidecar.alive && status.serverConfig && liveSidecar.model && liveSidecar.model !== status.serverConfig.model) {
          console.warn(`\n⚠️ 警告: 运行中的 sidecar 实际模型 (${liveSidecar.model}) 与当前 server.json (${status.serverConfig.model}) 不一致！`);
          console.warn("   可能是系统级守护进程使用了不同的 KIMI_CODE_HOME（例如 /opt/kimi-code），请对该目录执行 patch。");
        } else if (liveSidecar && liveSidecar.alive && !status.serverConfig && liveSidecar.model) {
          console.warn(`\n⚠️ 警告: 当前路径未找到 server.json，但检测到 127.0.0.1:${liveSidecar.port} 上已有 sidecar 运行中 (${liveSidecar.model})。`);
          console.warn("   可能是系统级守护进程使用了不同的 KIMI_CODE_HOME。");
        } else if (modelInfo && status.serverConfig && status.serverConfig.model !== modelInfo.actualModel) {
          console.warn(`\n⚠️ 提示: server.json 中的模型 (${status.serverConfig.model}) 与 config.toml (${modelInfo.actualModel}) 不一致，请重新执行 patch 使其生效。`);
        } else if (liveSidecar && liveSidecar.alive && modelInfo && liveSidecar.model && liveSidecar.model !== modelInfo.actualModel) {
          console.warn(`\n⚠️ 提示: 运行中的 sidecar 模型 (${liveSidecar.model}) 与 config.toml (${modelInfo.actualModel}) 不一致，请重新执行 patch 使其生效。`);
        }
      }

      console.log(`\n👉 最终状态: ${status.isFullyPatched ? "🎉 补丁完全生效中" : "⚪ 未打补丁或部分生效"}\n`);
      break;
    }

    case "models":
    case "list-models": {
      const models = listAvailableModels(kimiConfigPath);
      let currentInfo = null;
      try {
        currentInfo = resolveRenameModelInfo(kimiConfigPath);
      } catch (e) {
        console.warn("⚠️ 当前模型不可用于重命名:", e.message);
      }

      console.log(`📋 当前 Kimi Code 中已配置的模型列表 (共 ${models.length} 个):`);
      for (const m of models) {
        let tag = "";
        if (currentInfo && currentInfo.targetModelId === m.id) {
          tag = currentInfo.isInheritedFromDefault ? " [当前生效: default_model]" : " [当前生效: rename_model]";
        }
        console.log(`   • ${m.id} (${m.displayName || m.model}) - Provider: ${m.provider}${tag}`);
      }
      console.log("\n💡 提示: 可通过以下命令为重命名功能切换指定的模型：");
      console.log('   node bin/cli.js set-model "<模型ID>"\n');
      break;
    }

    case "set-model": {
      const targetModel = positional[1];
      if (!targetModel) {
        console.error("❌ 错误: 请指定要设置的模型 ID，例如：");
        console.error('   node bin/cli.js set-model "Local/gemini-3.5-flash-lite"');
        console.error("👉 运行 node bin/cli.js models 可查看所有已配置的模型列表。\n");
        process.exit(1);
      }

      console.log(`🔄 正在更新 config.toml 中的 rename_model 为: ${targetModel}...`);
      const originalConfig = fs.readFileSync(kimiConfigPath);
      try {
        setRenameModelInConfig(kimiConfigPath, targetModel);
        console.log("✅ config.toml 配置已更新！");
        console.log("🚀 正在自动重新应用补丁...");
        const result = applyPatch(targetDir, {
          mode: activeMode,
          configPath: kimiConfigPath,
          configPathExplicit: Boolean(customConfigPath),
          port: customPort || undefined,
        });
        printPatchSuccess(result);
      } catch (err) {
        fs.writeFileSync(kimiConfigPath, originalConfig);
        handleError(err, targetDir);
        process.exit(1);
      }
      break;
    }

    case "unpatch":
    case "restore": {
      console.log("🔄 正在还原官方原版文件...");
      try {
        const res = restorePatch(targetDir, { mode: activeMode });
        const restoredAny = typeof res === "boolean" ? res : Boolean(res && res.restoredAny);
        if (restoredAny) {
          console.log("✅ 成功还原！所有修改已撤销，注入的脚本已清理。\n");
        } else {
          console.log("ℹ️  原版文件未发现修改，无需还原。\n");
        }
      } catch (err) {
        handleError(err, targetDir);
        process.exit(1);
      }
      break;
    }

    case "patch": {
      console.log("🚀 正在从 Kimi Code 配置中解析模型参数并应用补丁...");
      try {
        const result = applyPatch(targetDir, {
          mode: activeMode,
          configPath: kimiConfigPath,
          configPathExplicit: Boolean(customConfigPath),
          port: customPort || undefined,
        });
        printPatchSuccess(result);
      } catch (err) {
        handleError(err, targetDir);
        process.exit(1);
      }
      break;
    }
  }
}

function formatVariantLabel() {
  if (variant === "npm") return "kimi-patch / npm 版";
  if (variant === "standalone") return "kimi-patch / 单文件版";
  return "kimi-patch / 双模式版";
}

function checkSidecar(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/health", timeout: 1000 }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          resolve({ alive: false, model: null, port });
          return;
        }
        let model = null;
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (parsed && typeof parsed.model === "string") model = parsed.model;
        } catch (e) {
          // 忽略非 JSON 响应
        }
        resolve({ alive: true, model, port });
      });
    });
    req.on("error", () => resolve({ alive: false, model: null, port }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ alive: false, model: null, port });
    });
  });
}

function printPatchSuccess(result) {
  const modelInfo = result.modelInfo;
  console.log("✅ 恭喜！补丁已成功应用！");
  console.log("\n🤖 本次补丁绑定的模型信息:");
  console.log(`   - 选定模型 ID  : ${modelInfo.targetModelId}`);
  console.log(`   - 配置来源     : ${modelInfo.isInheritedFromDefault ? "继承自 default_model (默认)" : "来自专属 rename_model"}`);
  console.log(`   - 所属供应商   : ${modelInfo.providerName}`);
  console.log(`   - 接口 Endpoint: ${modelInfo.endpoint}`);

  if (result.mode === "standalone") {
    const wrapperHint =
      process.platform === "win32" ? "bin\\kimi-web-renamer.cmd" : "./bin/kimi-web-renamer";
    const daemonHint =
      process.platform === "win32" ? "bin\\install-daemon.cmd" : "./bin/install-daemon";
    console.log("\n🛰️  单文件模式 Sidecar 信息:");
    console.log(`   - 前端目录     : ${result.webDir}`);
    console.log(`   - sidecar 配置 : ${result.serverConfigPath}`);
    console.log(`   - sidecar 地址 : http://127.0.0.1:${result.port}/`);
    console.log("\n📌 接下来:");
    console.log(`   1. 启动 sidecar: node bin/cli.js serve（或运行 ${wrapperHint} 同时启动）`);
    console.log(`   2. 如需常驻自动守护（防止 kimi web 启动时校验覆盖 index.html），运行 ${daemonHint}`);
    console.log("   3. 刷新页面后，在会话标题栏点击重命名图标。\n");
  } else {
    console.log("\n📌 接下来:");
    console.log("   1. 若 `kimi web` 已运行，请在其终端按 Ctrl+C 停止，再执行 `kimi web` 重新启动。");
    console.log("   2. 打开网页后，标题栏将显示重命名图标。");
    console.log("   3. 在兼容的 Kimi Web 会话页面中点击图标生成标题。\n");
  }
}

function handleError(err, targetDir) {
  if (err.code === "EPERM" || err.code === "EACCES") {
    console.error("❌ 权限不足 (EPERM / EACCES)！");
    console.error(`   目标 Kimi Code 目录受系统权限保护:\n   ${targetDir}\n`);
    console.error("👉 解决方案:");
    if (process.platform === "win32") {
      console.error("   请【右键以管理员身份运行】打开终端 (PowerShell 或 CMD)，再执行以下命令：");
      console.error(`   cd "${path.resolve(__dirname, "..")}"`);
      console.error("   node bin/cli.js patch\n");
    } else {
      console.error("   请在命令前添加 sudo 重新执行：");
      console.error("   sudo node bin/cli.js patch\n");
    }
  } else {
    console.error("❌ 操作失败:", err.message);
  }
}

function printHelp() {
  const serveLine = hasStandalone
    ? "  serve                  启动本地 sidecar 模型代理（仅单文件模式）\n"
    : "";
  const modeOption = variant === "unified"
    ? "  --mode <mode>          指定安装模式: auto（默认）, npm, standalone\n"
    : "";
  const portOption = hasStandalone
    ? "  --port <port>          指定 sidecar 监听端口（默认 58629，仅单文件模式）\n"
    : "";

  console.log(`
Kimi Code Web 自动重命名补丁工具 (${formatVariantLabel()})

核心特性:
  直接复用 Kimi Code 自身的 config.toml 配置文件，无需单独配置供应商与 Key！
  默认使用 config.toml 中的 default_model，亦可在配置中添加 rename_model 指定专属模型。

用法:
  node bin/cli.js [命令] [选项]

可用命令:
  patch                  应用补丁（默认命令，自动读取 config.toml）
${serveLine}  models, list-models    列出 config.toml 中所有已配置的模型
  set-model <model_id>   为重命名指定新模型，更新 config.toml 并自动应用 patch
  unpatch, restore       还原为官方原版，撤销所有修改并清理脚本
  status                 检查当前补丁状态与绑定的模型信息
  help                   显示此帮助信息

选项:
${modeOption}  --path <dir>           手动指定 Kimi Code 安装根目录或 dist-web 目录
  --config <path>        手动指定 config.toml 路径
${portOption}  -h, --help             显示帮助信息

示例:
  node bin/cli.js
  node bin/cli.js models
  node bin/cli.js set-model "Local/gemini-3.5-flash-lite"
  node bin/cli.js status
  node bin/cli.js unpatch
`);
}

main().catch((err) => {
  console.error("❌ 发生错误:", err.message || err);
  process.exit(1);
});
