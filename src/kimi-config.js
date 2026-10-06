const fs = require("fs");
const path = require("path");
const os = require("os");

const DEFAULT_SYSTEM_PROMPT =
  "你是一个专业的对话标题生成助手。根据用户对话的第一条消息，提炼一个简短、精准的主题标题。\n【严格限定】\n1. 长度在4-12个字之间，言简意赅。\n2. 严禁出现书名号、引号、句号等标点符号。\n3. 严禁输出任何解释、思考过程、前缀说明或多余文字。\n4. 只能且仅输出最终标题本身。";

/**
 * 跨平台查找 Kimi Code 的 config.toml 路径
 */
function findKimiConfigPath(customPath) {
  if (customPath) {
    const resolved = path.resolve(customPath);
    if (fs.existsSync(resolved)) return fs.realpathSync(resolved);
    throw new Error(`指定的配置文件不存在: ${resolved}`);
  }

  const homedir = os.homedir();
  const candidates = [
    path.join(homedir, ".kimi-code", "config.toml"),
    path.join(homedir, ".kimi", "config.toml"),
    path.join(homedir, ".config", "kimi-code", "config.toml"),
    "D:\\ProgramData\\.kimi-code\\config.toml",
    "C:\\ProgramData\\.kimi-code\\config.toml",
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        return fs.realpathSync(candidate);
      } catch (e) {
        return candidate;
      }
    }
  }

  return null;
}

/**
 * 轻量且健壮的 TOML 解析器
 */
function parseToml(content) {
  const result = {
    root: {},
    sections: {},
  };
  let currentSection = null;

  const lines = content.split(/\r?\n/);
  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;

    // 匹配类似 [models."Local/gemini-3.8-flash-tiered"] 或 [thinking]
    const sectionMatch = line.match(/^\[([A-Za-z0-9_.\-:\"\'\/]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      result.sections[currentSection] = {};
      continue;
    }

    // 匹配 key = value
    const kvMatch = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1].trim();
      let val = kvMatch[2].trim();

      // 去除两端引号
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      } else if (val === "true") {
        val = true;
      } else if (val === "false") {
        val = false;
      } else if (!isNaN(Number(val)) && val !== "") {
        val = Number(val);
      }

      if (currentSection) {
        result.sections[currentSection][key] = val;
      } else {
        result.root[key] = val;
      }
    }
  }

  return result;
}

/**
 * 解析出用于自动重命名的模型与连接配置
 */
function resolveRenameModelInfo(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Kimi 配置文件不存在: ${configPath}`);
  }

  const content = fs.readFileSync(configPath, "utf8");
  const parsed = parseToml(content);

  // 1. 获取目标模型 ID：优先 rename_model，未配置则默认 default_model
  const explicitRenameModel = parsed.root["rename_model"];
  const defaultModel = parsed.root["default_model"];
  const targetModelId = explicitRenameModel || defaultModel;

  if (!targetModelId) {
    throw new Error("在 config.toml 中既未找到 rename_model 也未找到 default_model");
  }

  // 2. 匹配 [models."<targetModelId>"]
  let modelEntry = null;
  for (const [secName, secData] of Object.entries(parsed.sections)) {
    const cleanSec = secName
      .replace(/^models\./, "")
      .replace(/^["']|["']$/g, "");
    if (cleanSec === targetModelId) {
      modelEntry = secData;
      break;
    }
  }

  // 3. 匹配对应的 Provider
  const providerName = modelEntry ? modelEntry.provider : null;
  let providerEntry = null;
  if (providerName) {
    for (const [secName, secData] of Object.entries(parsed.sections)) {
      const cleanSec = secName
        .replace(/^providers\./, "")
        .replace(/^["']|["']$/g, "");
      if (cleanSec === providerName) {
        providerEntry = secData;
        break;
      }
    }
  }

  // 4. 组装实际调用的模型名与 Endpoint
  const actualModel = (modelEntry && modelEntry.model) || targetModelId.split("/").pop();
  let baseUrl = (providerEntry && providerEntry.base_url) || "";
  let endpoint = "";
  if (baseUrl) {
    baseUrl = baseUrl.replace(/\/+$/, "");
    if (baseUrl.endsWith("/chat/completions")) {
      endpoint = baseUrl;
    } else {
      endpoint = `${baseUrl}/chat/completions`;
    }
  } else {
    // 若未配置，默认走官方 coding 接口
    endpoint = "https://api.kimi.com/coding/v1/chat/completions";
  }

  const apiKey = (providerEntry && providerEntry.api_key) || "";
  const providerType = (providerEntry && providerEntry.type) || "openai";

  return {
    configPath,
    targetModelId,
    isInheritedFromDefault: !explicitRenameModel,
    actualModel,
    providerName: providerName || "managed:kimi-code",
    providerType,
    endpoint,
    apiKey,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    temperature: 0.2,
    maxTokens: 80,
  };
}

/**
 * 列出 config.toml 中所有可用模型列表
 */
function listAvailableModels(configPath) {
  if (!fs.existsSync(configPath)) return [];
  const content = fs.readFileSync(configPath, "utf8");
  const parsed = parseToml(content);

  const models = [];
  for (const [secName, secData] of Object.entries(parsed.sections)) {
    if (secName.startsWith("models.")) {
      const modelId = secName.replace(/^models\./, "").replace(/^["']|["']$/g, "");
      models.push({
        id: modelId,
        displayName: secData.display_name || modelId,
        provider: secData.provider || "unknown",
        model: secData.model || modelId,
      });
    }
  }
  return models;
}

/**
 * 在 config.toml 中写入或更新 rename_model 参数
 */
function setRenameModelInConfig(configPath, newModelId) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`配置文件不存在: ${configPath}`);
  }

  let content = fs.readFileSync(configPath, "utf8");
  const renameModelRegex = /^[ \t]*rename_model[ \t]*=[ \t]*["'][^"']*["']/m;

  if (renameModelRegex.test(content)) {
    // 替换已有配置
    content = content.replace(
      renameModelRegex,
      `rename_model = "${newModelId}"`
    );
  } else {
    // 在 default_model 附近追加，或者在顶部追加
    const defaultModelRegex = /^([ \t]*default_model[ \t]*=[ \t]*["'][^"']*["'])/m;
    if (defaultModelRegex.test(content)) {
      content = content.replace(
        defaultModelRegex,
        `$1\n\n# 自动会话重命名模型 (kimi-web-renamer-patch)\nrename_model = "${newModelId}"`
      );
    } else {
      content = `# 自动会话重命名模型 (kimi-web-renamer-patch)\nrename_model = "${newModelId}"\n\n` + content;
    }
  }

  fs.writeFileSync(configPath, content, "utf8");
  return true;
}

module.exports = {
  findKimiConfigPath,
  parseToml,
  resolveRenameModelInfo,
  listAvailableModels,
  setRenameModelInConfig,
};
