const fs = require("fs");
const path = require("path");
const assert = require("assert");
const {
  isValidKimiDir,
  checkStatus,
  applyPatch,
  restorePatch,
} = require("../src/patcher");

console.log("🧪 正在运行 Patch 逻辑自动化测试套件 (适配 config.toml)...\n");

const tempDir = path.join(__dirname, "mock-kimi-code");

// 准备测试环境
if (fs.existsSync(tempDir)) {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

fs.mkdirSync(path.join(tempDir, "dist"), { recursive: true });
fs.mkdirSync(path.join(tempDir, "dist-web"), { recursive: true });

const initialHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <script src="/boot.js"></script>
    <title>Kimi Code Web</title>
  </head>
  <body><div id="app"></div></body>
</html>`;

const initialMainMjs = `
var HSTS_VALUE = "max-age=31536000";
CONTENT_SECURITY_POLICY = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'self'";
registerConfigRoutes(apiV1, core);
//#endregion
`;

const mockTomlContent = `
default_model = "Local/test-default-model"

[models."Local/test-default-model"]
provider = "Local"
model = "test-real-model-name"
display_name = "Test Default Model"

[providers.Local]
base_url = "http://127.0.0.1:3001/v1"
type = "openai"
api_key = "mock-api-key-xyz"
`;

const mockConfigTomlPath = path.join(tempDir, "config.toml");

fs.writeFileSync(path.join(tempDir, "dist-web", "index.html"), initialHtml, "utf8");
fs.writeFileSync(path.join(tempDir, "dist", "main.mjs"), initialMainMjs, "utf8");
fs.writeFileSync(mockConfigTomlPath, mockTomlContent, "utf8");

// 1. 验证目录识别
assert.strictEqual(isValidKimiDir(tempDir), true, "mock 目录应被正确识别为 Kimi 目录");
console.log("✅ 1. 目录有效性校验通过");

// 2. 验证初始状态
const initialStatus = checkStatus(tempDir);
assert.strictEqual(initialStatus.isFullyPatched, false);
console.log("✅ 2. 初始状态检测通过");

// 3. 应用 Patch (从 mock 的 config.toml 解析模型)
const result = applyPatch(tempDir, { configPath: mockConfigTomlPath });
assert.strictEqual(result.success, true);
assert.strictEqual(result.modelInfo.targetModelId, "Local/test-default-model");
assert.strictEqual(result.modelInfo.actualModel, "test-real-model-name");
assert.strictEqual(result.modelInfo.apiKey, "mock-api-key-xyz");
assert.strictEqual(result.modelInfo.isInheritedFromDefault, true);

// 4. 验证打补丁后的状态
const patchedStatus = checkStatus(tempDir);
assert.strictEqual(patchedStatus.isFullyPatched, true);
assert.strictEqual(patchedStatus.isRenamerJsPresent, true);
assert.strictEqual(patchedStatus.isHtmlPatched, true);
assert.strictEqual(patchedStatus.isCspPatched, true);

const renamerJsContent = fs.readFileSync(path.join(tempDir, "dist-web", "kimi-renamer.js"), "utf8");
assert.ok(renamerJsContent.includes("mock-api-key-xyz"), "必须正确注入 config.toml 中的 apiKey");
assert.ok(renamerJsContent.includes("test-real-model-name"), "必须正确注入真实的 model 名称");
console.log("✅ 3. Patch 应用与 config.toml 动态解析校验通过");

// 5. 测试一键还原 Restore
restorePatch(tempDir);
const restoredStatus = checkStatus(tempDir);
assert.strictEqual(restoredStatus.isFullyPatched, false);
assert.strictEqual(restoredStatus.isRenamerJsPresent, false);

const restoredHtml = fs.readFileSync(path.join(tempDir, "dist-web", "index.html"), "utf8");
assert.strictEqual(restoredHtml.trim(), initialHtml.trim());
console.log("✅ 4. 一键还原 Restore 校验通过");

// 清理测试目录
fs.rmSync(tempDir, { recursive: true, force: true });
console.log("\n🎉 所有测试均已顺利通过！Patcher 与 config.toml 联动 100% 稳健！\n");
