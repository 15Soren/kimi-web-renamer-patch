#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const {
  findKimiCodePath,
  checkStatus,
  applyPatch,
  restorePatch,
  findKimiConfigPath,
  resolveRenameModelInfo,
  listAvailableModels,
  setRenameModelInConfig,
} = require("../src/patcher");

// 命令行参数解析
const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith("-") ? args[0].toLowerCase() : "patch";

// 解析自定义参数
let customPath = null;
const pathIndex = args.indexOf("--path");
if (pathIndex !== -1 && args[pathIndex + 1]) {
  customPath = args[pathIndex + 1];
}

let customConfigPath = null;
const configIndex = args.indexOf("--config");
if (configIndex !== -1 && args[configIndex + 1]) {
  customConfigPath = args[configIndex + 1];
}

// 帮助信息
if (args.includes("-h") || args.includes("--help") || command === "help") {
  printHelp();
  process.exit(0);
}

// 主逻辑分发
async function main() {
  console.log("\n=======================================================");
  console.log("✨ Kimi Code Web 自动重命名补丁工具 (kimi-patch)");
  console.log("=======================================================\n");

  // 1. 定位 Kimi Code 安装目录
  const kimiDir = findKimiCodePath(customPath);
  if (!kimiDir) {
    console.error("❌ 错误: 未能自动检测到 Kimi Code 安装路径！");
    console.error("👉 请尝试使用参数手动指定路径，例如：");
    console.error('   node bin/cli.js patch --path "C:\\path\\to\\node_modules\\@moonshot-ai\\kimi-code"\n');
    process.exit(1);
  }

  // 2. 定位 Kimi Code 配置文件 (config.toml)
  const kimiConfigPath = findKimiConfigPath(customConfigPath);
  if (!kimiConfigPath) {
    console.error("❌ 错误: 未能自动检测到 Kimi Code 的配置文件 (config.toml)！");
    console.error("👉 请确保已安装并配置过 Kimi Code，或使用 --config 手动指定。\n");
    process.exit(1);
  }

  console.log(`📍 检测到 Kimi Code 目录:\n   ${kimiDir}`);
  console.log(`⚙️  检测到 Kimi 配置文件:\n   ${kimiConfigPath}\n`);

  // 3. 命令路由
  switch (command) {
    case "status": {
      const status = checkStatus(kimiDir);
      console.log("📊 补丁状态报告:");
      console.log(`   - 独立前端脚本 (kimi-renamer.js) : ${status.isRenamerJsPresent ? "✅ 已就绪" : "❌ 未注入"}`);
      console.log(`   - index.html 引用注入          : ${status.isHtmlPatched ? "✅ 已注入" : "❌ 未注入"}`);
      console.log(`   - CSP 跨域与网络访问放通       : ${status.isCspPatched ? "✅ 已放行" : "❌ 未放行"}`);
      console.log(`   - 官方文件原始备份             : ${status.hasBackup ? "✅ 已备份" : "⚪ 无备份"}`);

      try {
        const modelInfo = resolveRenameModelInfo(kimiConfigPath);
        console.log("\n🤖 当前绑定的模型配置 (读取自 config.toml):");
        console.log(`   - 目标模型 ID  : ${modelInfo.targetModelId}`);
        console.log(`   - 模型生效策略 : ${modelInfo.isInheritedFromDefault ? "默认继承 default_model" : "已单独配置 rename_model"}`);
        console.log(`   - 对应供应商   : ${modelInfo.providerName}`);
        console.log(`   - 接口端点     : ${modelInfo.endpoint}`);
      } catch (e) {
        console.warn("\n⚠️ 读取模型配置失败:", e.message);
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
      } catch (e) {}

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
      const targetModel = args[1];
      if (!targetModel) {
        console.error("❌ 错误: 请指定要设置的模型 ID，例如：");
        console.error('   node bin/cli.js set-model "Local/gemini-3.5-flash-lite"');
        console.error("👉 运行 node bin/cli.js models 可查看所有已配置的模型列表。\n");
        process.exit(1);
      }

      console.log(`🔄 正在更新 config.toml 中的 rename_model 为: ${targetModel}...`);
      try {
        setRenameModelInConfig(kimiConfigPath, targetModel);
        console.log("✅ config.toml 配置已更新！");
        console.log("🚀 正在自动重新编译并注入补丁脚本...");
        const result = applyPatch(kimiDir, { configPath: kimiConfigPath });
        printPatchSuccess(result.modelInfo);
      } catch (err) {
        handleError(err, kimiDir);
        process.exit(1);
      }
      break;
    }

    case "unpatch":
    case "restore": {
      console.log("🔄 正在还原官方原版文件...");
      try {
        const restored = restorePatch(kimiDir);
        if (restored) {
          console.log("✅ 成功还原！所有修改已撤销，注入的脚本已清理。\n");
        } else {
          console.log("ℹ️  原版文件未发现修改，无需还原。\n");
        }
      } catch (err) {
        handleError(err, kimiDir);
        process.exit(1);
      }
      break;
    }

    case "patch":
    default: {
      console.log("🚀 正在从 Kimi Code 配置中解析模型参数并应用补丁...");
      try {
        const result = applyPatch(kimiDir, { configPath: kimiConfigPath });
        printPatchSuccess(result.modelInfo);
      } catch (err) {
        handleError(err, kimiDir);
        process.exit(1);
      }
      break;
    }
  }
}

function printPatchSuccess(modelInfo) {
  console.log("✅ 恭喜！原生补丁已成功应用！");
  console.log("\n🤖 本次补丁绑定的模型信息:");
  console.log(`   - 选定模型 ID  : ${modelInfo.targetModelId}`);
  console.log(`   - 配置来源     : ${modelInfo.isInheritedFromDefault ? "继承自 default_model (默认)" : "来自专属 rename_model"}`);
  console.log(`   - 所属供应商   : ${modelInfo.providerName}`);
  console.log(`   - 接口 Endpoint: ${modelInfo.endpoint}`);
  console.log("\n📌 接下来:");
  console.log("   1. 执行 `kimi web` 启动 Kimi Code Web 服务。");
  console.log("   2. 打开网页后，右下角将常驻精致的「✨ 重命名」悬浮按钮。");
  console.log("   3. 无需安装任何浏览器插件，任何浏览器/设备打开均可使用！");
  console.log("\n💡 提示: 若日后需要在 config.toml 中修改重命名模型，直接修改 rename_model 或运行：");
  console.log('   node bin/cli.js set-model "<模型ID>"\n');
}

function handleError(err, kimiDir) {
  if (err.code === "EPERM" || err.code === "EACCES") {
    console.error("❌ 权限不足 (EPERM / EACCES)！");
    console.error(`   目标 Kimi Code 安装在受系统权限保护的目录:\n   ${kimiDir}\n`);
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
  console.log(`
Kimi Code Web 自动重命名补丁工具 (kimi-patch)

核心特性:
  直接复用 Kimi Code 自身的 config.toml 配置文件，无需单独配置供应商与 Key！
  默认使用 config.toml 中的 default_model，亦可在配置中添加 rename_model 指定专属模型。

用法:
  node bin/cli.js [命令] [选项]

可用命令:
  patch                  应用原生补丁（默认命令，自动读取 config.toml）
  models, list-models    列出 config.toml 中所有已配置的模型
  set-model <model_id>   为重命名指定新模型，更新 config.toml 并自动应用 patch
  unpatch, restore       还原为官方原版，撤销所有修改并清理脚本
  status                 检查当前补丁状态与绑定的模型信息
  help                   显示此帮助信息

选项:
  --path <dir>           手动指定 kimi-code 安装根目录
  --config <path>        手动指定 config.toml 路径
  -h, --help             显示帮助信息

示例:
  node bin/cli.js
  node bin/cli.js models
  node bin/cli.js set-model "Local/gemini-3.5-flash-lite"
  node bin/cli.js status
  node bin/cli.js unpatch
`);
}

main().catch((err) => {
  console.error("❌ 发生未捕获错误:", err);
  process.exit(1);
});
