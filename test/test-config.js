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
assert.match(modelInfo.systemPrompt, /快速/, "默认提示词应包含快速输出要求");
assert.match(modelInfo.systemPrompt, /严禁调用任何工具/, "默认提示词应禁止调用任何工具");
assert.match(modelInfo.systemPrompt, /猜测其属性.*原样保留/, "默认提示词应包含生词猜测属性后原样保留规则");

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
const magpieConfig = 'rename_model = "Magpie/test-default-model"\n' + fixture
  .replace(/Local/g, "Magpie")
  .replace('type = "openai"', 'type = "kimi"');
fs.writeFileSync(configPath, magpieConfig, "utf8");
const magpieInfo = resolveRenameModelInfo(configPath);
assert.strictEqual(magpieInfo.providerType, "kimi");
assert.strictEqual(magpieInfo.providerName, "Magpie");
assert.strictEqual(magpieInfo.actualModel, modelInfo.actualModel);
assert.strictEqual(magpieInfo.endpoint, modelInfo.endpoint);
assert.strictEqual(magpieInfo.apiKey, modelInfo.apiKey);
assert.strictEqual(magpieInfo.isInheritedFromDefault, false);
setRenameModelInConfig(configPath, "Magpie/test-default-model");
assert.strictEqual(resolveRenameModelInfo(configPath).providerType, "kimi");
console.log("✅ Magpie 的 kimi 类型配置、rename_model 解析与模型切换测试通过");

const bomFixture = "\uFEFF" + fixture.replace(/\r?\n/g, "\r\n");
fs.writeFileSync(configPath, bomFixture, "utf8");
setRenameModelInConfig(configPath, "Local/test-default-model");
const bomUpdated = fs.readFileSync(configPath, "utf8");
assert.ok(bomUpdated.startsWith("\uFEFF"), "写回后必须保留 UTF-8 BOM");
assert.ok(!/(?<!\r)\n/.test(bomUpdated), "写回后不能出现裸 LF");
assert.ok(bomUpdated.includes('\r\nrename_model = "Local/test-default-model"'));
console.log("✅ UTF-8 BOM 保留测试通过");

if (process.platform !== "win32") {
  const { execFileSync } = require("child_process");
  const fakeHome = path.join(tempDir, "home");
  const xdgDir = path.join(tempDir, "xdg", "kimi-code");
  fs.mkdirSync(fakeHome, { recursive: true });
  fs.mkdirSync(xdgDir, { recursive: true });
  fs.writeFileSync(path.join(xdgDir, "config.toml"), fixture, "utf8");
  const env = { ...process.env, HOME: fakeHome, XDG_CONFIG_HOME: path.join(tempDir, "xdg") };
  delete env.KIMI_CODE_HOME;
  const script = `process.stdout.write(require(${JSON.stringify(path.resolve(__dirname, "../src/kimi-config"))}).findKimiConfigPath() || "")`;
  const found = execFileSync(process.execPath, ["-e", script], { env, encoding: "utf8" });
  assert.strictEqual(found, fs.realpathSync(path.join(xdgDir, "config.toml")));
  console.log("✅ XDG_CONFIG_HOME 配置探测测试通过");
}
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
