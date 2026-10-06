const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  findKimiConfigPath,
  resolveRenameModelInfo,
  listAvailableModels,
  parseToml,
  setRenameModelInConfig,
} = require("../src/kimi-config");

console.log("🧪 正在测试 Kimi Code 配置读取与模型解析...\n");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kimi-config-test-"));
try {
const configPath = path.join(tempDir, "config.toml");
const fixture = fs.readFileSync(path.join(__dirname, "mock-kimi-code", "config.toml"), "utf8");
fs.writeFileSync(configPath, fixture, "utf8");
assert.strictEqual(findKimiConfigPath(configPath), fs.realpathSync(configPath));
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
assert.strictEqual(parseToml('default_model = "Local/test" # comment').root.default_model, "Local/test");
assert.strictEqual(parseToml('key = "a#b\\\"c"').root.key, 'a#b"c');
assert.strictEqual(parseToml("[models.\"中文 模型\"] # 注释\nmodel = 'test'").sections['models."中文 模型"'].model, "test");
const crlf = fixture.replace(/\r?\n/g, "\r\n").replace('"Local/test-default-model"', '"Local/test-default-model" # default');
fs.writeFileSync(configPath, crlf, "utf8");
setRenameModelInConfig(configPath, "Local/test-default-model");
const updated = fs.readFileSync(configPath, "utf8");
assert.ok(!/(?<!\r)\n/.test(updated));
assert.ok(updated.includes('# default\r\n'));
assert.strictEqual(resolveRenameModelInfo(configPath).isInheritedFromDefault, false);
assert.throws(() => setRenameModelInConfig(configPath, "missing"), /模型 ID 不在配置中/);
assert.strictEqual(fs.readFileSync(configPath, "utf8"), updated);
for (const [content, pattern] of [
  [fixture.replace('"Local/test-default-model"', '"missing"'), /未找到模型配置/],
  [fixture.replace('provider = "Local"', 'provider = "missing"'), /未找到供应商配置/],
  [fixture.replace('type = "openai"', 'type = "anthropic"'), /不支持的供应商类型/],
  [fixture.replace('api_key = "mock-api-key-xyz"', ''), /缺少 api_key/],
]) {
  fs.writeFileSync(configPath, content, "utf8");
  assert.throws(() => resolveRenameModelInfo(configPath), pattern);
}
console.log("✅ 注释、Unicode、换行保留及不兼容供应商测试通过");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
