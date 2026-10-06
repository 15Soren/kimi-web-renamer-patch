const assert = require("assert");
const {
  findKimiConfigPath,
  resolveRenameModelInfo,
  listAvailableModels,
} = require("../src/kimi-config");

console.log("🧪 正在测试 Kimi Code 配置读取与模型解析...\n");

const configPath = findKimiConfigPath();
assert.ok(configPath, "必须能够找到系统的 config.toml 路径");
console.log("✅ 1. 成功找到 config.toml 路径:", configPath);

const modelInfo = resolveRenameModelInfo(configPath);
assert.ok(modelInfo.targetModelId, "必须解析出 targetModelId");
assert.ok(modelInfo.actualModel, "必须解析出 actualModel");
assert.ok(modelInfo.endpoint, "必须解析出 endpoint");

console.log("✅ 2. 模型信息解析成功:");
console.log("   - 目标模型 ID:", modelInfo.targetModelId);
console.log("   - 来源状态:", modelInfo.isInheritedFromDefault ? "继承 default_model" : "已显式配置 rename_model");
console.log("   - 实际调用模型:", modelInfo.actualModel);
console.log("   - 对应 Provider:", modelInfo.providerName);
console.log("   - 接口 Endpoint:", modelInfo.endpoint);
console.log("   - 是否包含 API Key:", !!modelInfo.apiKey);

const availableModels = listAvailableModels(configPath);
assert.ok(availableModels.length > 0, "必须能列出可用模型");
console.log(`✅ 3. 成功获取可用模型列表 (共 ${availableModels.length} 个)`);

console.log("\n🎉 配置解析器验证完全通过！\n");
