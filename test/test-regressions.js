const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { spawnSync } = require("child_process");
const { applyPatch, restorePatch, checkStatus } = require("../src/patcher");

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kimi-regressions-"));
  try {
    const htmlPath = path.join(tempDir, "dist-web", "index.html");
    const mainPath = path.join(tempDir, "dist", "main.mjs");
    fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
    fs.mkdirSync(path.dirname(mainPath), { recursive: true });
    const html = '<head><script src="/boot.js"></script></head>';
    const backend = 'const CONTENT_SECURITY_POLICY = "default-src \'self\';";\nregisterConfigRoutes(apiV1, core);';
    const config = {
      endpoint: "https://model.example/v1/chat/completions",
      apiKey: "regression-secret-$&",
      actualModel: "test-model",
      systemPrompt: "generate title",
    };
    fs.writeFileSync(htmlPath, html, "utf8");
    fs.writeFileSync(mainPath, "// incompatible backend", "utf8");
    assert.throws(() => applyPatch(tempDir, config), /不兼容/);
    assert.strictEqual(fs.readFileSync(htmlPath, "utf8"), html);
    assert.ok(!fs.existsSync(path.join(tempDir, "dist-web", "kimi-renamer.js")));
    assert.ok(!fs.existsSync(mainPath + ".renamer.bak"));

    fs.writeFileSync(mainPath, backend, "utf8");
    fs.writeFileSync(path.join(tempDir, "dist-web", "Kimi.ico"), "original icon", "utf8");
    applyPatch(tempDir, config);
    assert.ok(checkStatus(tempDir).isFullyPatched);
    const script = fs.readFileSync(path.join(tempDir, "dist-web", "kimi-renamer.js"), "utf8");
    assert.ok(!script.includes(config.apiKey));
    assert.ok(!script.includes(config.endpoint));
    new vm.Script(script);
    const browserRequests = [];
    const nativeButton = { innerText: "重命名", className: "native", remove() { throw new Error("不能删除原生重命名按钮"); } };
    const browser = {
      document: { getElementById() { return null; }, querySelectorAll() { return [nativeButton]; } },
      fetch: async (url, options) => {
        browserRequests.push({ url, options });
        return { ok: false, status: 404, json: async () => ({ error: "Not Found" }) };
      },
    };
    vm.runInNewContext(script.replace("// 初始化与监听", "globalThis.testApi = { generateTitleFromAI, cleanupLegacyButtons }; return;\n// 初始化与监听"), browser);
    browser.testApi.cleanupLegacyButtons();
    await assert.rejects(browser.testApi.generateTitleFromAI("first message", "web-secret", "client"), /停止并重新启动 kimi web/);
    assert.strictEqual(browserRequests.length, 1);
    assert.strictEqual(browserRequests[0].url, "/api/v1/custom-renamer/generate");
    assert.deepStrictEqual(JSON.parse(browserRequests[0].options.body), { prompt: "first message" });
    const patched = fs.readFileSync(mainPath, "utf8");
    assert.ok(patched.includes(config.apiKey));
    assert.ok(!patched.includes("connect-src *"));

    let handler;
    const requests = [];
    vm.runInNewContext(patched, {
      registerConfigRoutes() {},
      core: {},
      apiV1: { post(route, fn) { assert.strictEqual(route, "/custom-renamer/generate"); handler = fn; } },
      AbortSignal,
      fetch: async (url, options) => {
        requests.push({ url, options });
        return { ok: true, json: async () => ({ choices: [{ message: { content: '<think>hidden</think>“测试标题”' } }] }) };
      },
    });
    const reply = {
      status: 200,
      code(status) { this.status = status; return this; },
      send(body) { this.body = body; return this; },
    };
    await handler({ body: { prompt: 42 }, headers: {} }, reply);
    assert.strictEqual(reply.status, 400);
    assert.strictEqual(requests.length, 0);
    await handler({ body: { prompt: "x".repeat(1000), endpoint: "http://private.example", apiKey: "attacker", model: "attacker" }, headers: { authorization: "Bearer web-secret" } }, reply);
    assert.strictEqual(requests[0].url, config.endpoint);
    assert.strictEqual(requests[0].options.headers.Authorization, `Bearer ${config.apiKey}`);
    assert.strictEqual(requests[0].options.redirect, "error");
    assert.ok(requests[0].options.signal);
    assert.strictEqual(JSON.parse(requests[0].options.body).messages[1].content.length, 800);
    assert.strictEqual(reply.body.title, "测试标题");

    applyPatch(tempDir, { ...config, apiKey: "updated-key", actualModel: "updated-model" });
    const repatched = fs.readFileSync(mainPath, "utf8");
    assert.ok(repatched.includes("updated-key"));
    assert.ok(!repatched.includes(config.apiKey));
    assert.strictEqual(repatched.split('apiV1.post("/custom-renamer/generate"').length, 2);
    restorePatch(tempDir);
    assert.strictEqual(fs.readFileSync(mainPath, "utf8"), backend);
    assert.strictEqual(fs.readFileSync(htmlPath, "utf8"), html);
    assert.strictEqual(fs.readFileSync(path.join(tempDir, "dist-web", "Kimi.ico"), "utf8"), "original icon");

    applyPatch(tempDir, config);
    fs.unlinkSync(mainPath + ".renamer.bak");
    fs.unlinkSync(htmlPath + ".renamer.bak");
    assert.throws(() => applyPatch(tempDir, config), /缺少原版备份/);
    restorePatch(tempDir);
    assert.ok(!fs.readFileSync(mainPath, "utf8").includes("__KIMI_RENAMER_PROXY_ROUTE__"));
    assert.ok(!fs.readFileSync(htmlPath, "utf8").includes("kimi-renamer.js"));

    const cli = path.join(__dirname, "..", "bin", "cli.js");
    for (const args of [["unknown"], ["patch", "--path"], ["--unknown"]]) {
      const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
      assert.strictEqual(result.status, 1);
    }
    const status = spawnSync(process.execPath, [cli, "--path", tempDir, "status"], { encoding: "utf8" });
    assert.strictEqual(status.status, 0, status.stderr);
    const restore = spawnSync(process.execPath, [cli, "unpatch", "--path", tempDir], { encoding: "utf8" });
    assert.strictEqual(restore.status, 0, restore.stderr);
    const configPath = path.join(tempDir, "config.toml");
    const fixture = fs.readFileSync(path.join(__dirname, "mock-kimi-code", "config.toml"), "utf8");
    fs.writeFileSync(configPath, fixture, "utf8");
    fs.writeFileSync(mainPath, "// incompatible backend", "utf8");
    const setModel = spawnSync(process.execPath, [cli, "set-model", "Local/test-default-model", "--path", tempDir, "--config", configPath], { encoding: "utf8" });
    assert.strictEqual(setModel.status, 1);
    assert.strictEqual(fs.readFileSync(configPath, "utf8"), fixture);
    console.log("✅ 服务端凭证隔离、固定代理目标、重复补丁、无备份还原、原始图标保留及 CLI 回归测试通过");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
