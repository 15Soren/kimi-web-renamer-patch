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
 * 解析模型配置用到的 TOML 单行标量与表，不支持多行字符串和内联表
 */
function parseToml(content) {
  const result = {
    root: {},
    sections: {},
  };
  let currentSection = null;

  const lines = content.split(/\r?\n/);
  for (let line of lines) {
    let quote = null;
    let escaped = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (escaped) { escaped = false; continue; }
      if (quote === '"' && char === "\\") { escaped = true; continue; }
      if (quote) { if (char === quote) quote = null; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === "#") { line = line.slice(0, i); break; }
    }
    line = line.trim();
    if (!line || line.startsWith("#")) continue;

    // 匹配类似 [models."Local/gemini-3.8-flash-tiered"] 或 [thinking]
    const sectionMatch = line.match(/^\[([^\[\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
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
        if (val.startsWith('"')) {
          try { val = JSON.parse(val); }
          catch (err) { throw new Error(`不支持的 TOML 字符串: ${key}`); }
        } else {
          val = val.slice(1, -1);
        }
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
function resolveRenameModelInfo(configPath, overrideModelId) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Kimi 配置文件不存在: ${configPath}`);
  }

  const content = fs.readFileSync(configPath, "utf8");
  const parsed = parseToml(content);

  // 1. 获取目标模型 ID：优先 rename_model，未配置则默认 default_model
  const explicitRenameModel = overrideModelId || parsed.root["rename_model"];
  const defaultModel = parsed.root["default_model"];
  const targetModelId = explicitRenameModel || defaultModel;

  if (!targetModelId || typeof targetModelId !== "string") {
    throw new Error("在 config.toml 中既未找到 rename_model 也未找到 default_model");
  }

  // 2. 匹配 [models."<targetModelId>"]
  let modelEntry = null;
  for (const [secName, secData] of Object.entries(parsed.sections)) {
    if (!secName.startsWith("models.")) continue;
    const cleanSec = secName
      .replace(/^models\./, "")
      .replace(/^["']|["']$/g, "");
    if (cleanSec === targetModelId) {
      modelEntry = secData;
      break;
    }
  }

  if (!modelEntry) throw new Error(`未找到模型配置: ${targetModelId}`);

  // 3. 匹配对应的 Provider
  const providerName = modelEntry ? modelEntry.provider : null;
  let providerEntry = null;
  if (providerName) {
    for (const [secName, secData] of Object.entries(parsed.sections)) {
      if (!secName.startsWith("providers.")) continue;
      const cleanSec = secName
        .replace(/^providers\./, "")
        .replace(/^["']|["']$/g, "");
      if (cleanSec === providerName) {
        providerEntry = secData;
        break;
      }
    }
  }

  if (!providerEntry) {
    throw new Error(`未找到供应商配置: ${providerName || "未指定"}，托管登录认证暂不支持，请配置 OpenAI 兼容供应商`);
  }
  if (providerEntry.type && !["openai", "openai_legacy"].includes(providerEntry.type)) {
    throw new Error(`不支持的供应商类型: ${providerEntry.type}，目前仅支持 OpenAI Chat Completions 兼容接口`);
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
    throw new Error(`供应商 ${providerName} 缺少 base_url`);
  }

  const apiKey = providerEntry.api_key || (providerEntry.api_key_env && process.env[providerEntry.api_key_env]) || "";
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    throw new Error(`供应商 ${providerName} 缺少 api_key 或 api_key_env 对应的环境变量`);
  }
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

  if (typeof newModelId !== "string" || !listAvailableModels(configPath).some((model) => model.id === newModelId)) {
    throw new Error(`模型 ID 不在配置中: ${newModelId}`);
  }
  resolveRenameModelInfo(configPath, newModelId);
  const original = fs.readFileSync(configPath, "utf8");
  const firstSection = original.search(/^[ \t]*\[/m);
  const suffix = firstSection === -1 ? "" : original.slice(firstSection);
  let content = firstSection === -1 ? original : original.slice(0, firstSection);
  const newline = original.includes("\r\n") ? "\r\n" : "\n";
  const modelValue = JSON.stringify(newModelId);
  const renameModelRegex = /^[ \t]*rename_model[ \t]*=[ \t]*["'][^"']*["']/m;

  if (renameModelRegex.test(content)) {
    // 替换已有配置
    content = content.replace(
      renameModelRegex,
      () => `rename_model = ${modelValue}`
    );
  } else {
    // 在 default_model 附近追加，或者在顶部追加
    const defaultModelRegex = /^([ \t]*default_model[ \t]*=[^\r\n]*)/m;
    if (defaultModelRegex.test(content)) {
      content = content.replace(
        defaultModelRegex,
        (line) => `${line}${newline}${newline}# 自动会话重命名模型 (kimi-web-renamer-patch)${newline}rename_model = ${modelValue}`
      );
    } else {
      content = `# 自动会话重命名模型 (kimi-web-renamer-patch)${newline}rename_model = ${modelValue}${newline}${newline}` + content;
    }
  }

  fs.writeFileSync(configPath, content + suffix, "utf8");
  return true;
}

module.exports = {
  findKimiConfigPath,
  parseToml,
  resolveRenameModelInfo,
  listAvailableModels,
  setRenameModelInConfig,
};
