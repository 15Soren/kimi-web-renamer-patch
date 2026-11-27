const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { spawnSync } = require("child_process");
const {
  standaloneMode,
  detectInstallTarget,
} = require("../src/patcher");

const {
  isValidDistWebDir,
  listDistWebDirs,
  checkStatus,
  applyPatch,
  restorePatch,
  readServerConfig,
} = standaloneMode;

async function main() {
  console.log("🧪 正在运行单文件模式 (standalone) 自动化测试...\n");

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kimi-standalone-test-"));
  const prevCacheRoots = process.env.KIMI_RENAMER_CACHE_ROOTS;

  try {
    const cacheRoot = path.join(tempDir, "cache-web");
    const oldWebDir = path.join(cacheRoot, "1.0.0", "linux-x64", "aaa", "dist-web");
    const newWebDir = path.join(cacheRoot, "1.2.0", "linux-x64", "bbb", "dist-web");
    fs.mkdirSync(oldWebDir, { recursive: true });
    fs.mkdirSync(newWebDir, { recursive: true });

    const initialHtml =
      '<!doctype html><html><head><script src="/boot.js"></script></head><body><div id="app"></div></body></html>';
    fs.writeFileSync(path.join(oldWebDir, "index.html"), initialHtml, "utf8");
    fs.writeFileSync(path.join(newWebDir, "index.html"), initialHtml, "utf8");
    fs.writeFileSync(path.join(newWebDir, "Kimi.ico"), "original icon", "utf8");

    const serverConfigPath = path.join(tempDir, "renamer", "server.json");
    const mockConfigTomlPath = path.join(__dirname, "mock-kimi-code", "config.toml");

    // 1. 目录有效性校验与缓存版本排序
    assert.strictEqual(isValidDistWebDir(newWebDir), true);
    assert.strictEqual(isValidDistWebDir(tempDir), false);
    process.env.KIMI_RENAMER_CACHE_ROOTS = cacheRoot;
    const listed = listDistWebDirs();
    assert.deepStrictEqual(listed, [newWebDir, oldWebDir], "应按版本号从新到旧排序");
    const detected = detectInstallTarget(newWebDir, "auto");
    assert.strictEqual(detected.mode, "standalone");
    assert.strictEqual(detected.targetDir, newWebDir);
    const detectedFromParent = detectInstallTarget(cacheRoot, "auto");
    assert.strictEqual(detectedFromParent.mode, "standalone");
    assert.strictEqual(detectedFromParent.targetDir, newWebDir, "传入上级缓存目录也应自动定位到最新版本 dist-web");
    console.log("✅ 1. dist-web 目录识别、缓存版本排序与 auto 模式探测通过");

    // 2. 不兼容 HTML 拒绝且无副作用
    const badDir = path.join(tempDir, "bad-web");
    fs.mkdirSync(badDir, { recursive: true });
    fs.writeFileSync(path.join(badDir, "index.html"), "<html><body>no head</body></html>", "utf8");
    assert.throws(
      () => applyPatch(badDir, { configPath: mockConfigTomlPath, serverConfigPath }),
      /不兼容/
    );
    assert.ok(!fs.existsSync(path.join(badDir, "kimi-renamer.js")));
    assert.ok(!fs.existsSync(serverConfigPath));
    console.log("✅ 2. 不兼容 index.html 拒绝且无副作用通过");

    // 3. 应用单文件补丁与密钥隔离
    const initialStatus = checkStatus(newWebDir, { serverConfigPath });
    assert.strictEqual(initialStatus.isFullyPatched, false);
    assert.strictEqual(initialStatus.serverConfig, null);

    const result = applyPatch(newWebDir, { configPath: mockConfigTomlPath, serverConfigPath });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.mode, "standalone");
    assert.strictEqual(result.modelInfo.targetModelId, "Local/test-default-model");
    assert.strictEqual(result.modelInfo.actualModel, "test-real-model-name");

    const patchedStatus = checkStatus(newWebDir, { serverConfigPath });
    assert.strictEqual(patchedStatus.isFullyPatched, true);
    assert.strictEqual(patchedStatus.isHtmlPatched, true);
    assert.strictEqual(patchedStatus.isRenamerJsPresent, true);
    assert.strictEqual(patchedStatus.hasBackup, true);

    const script = fs.readFileSync(path.join(newWebDir, "kimi-renamer.js"), "utf8");
    assert.ok(!script.includes("mock-api-key-xyz"), "前端不能包含模型密钥");
    assert.ok(!script.includes("test-real-model-name"), "前端不能包含模型名");
    assert.ok(!script.includes(result.modelInfo.endpoint), "前端不能包含模型端点");
    assert.ok(script.includes('"mode":"sidecar"'), "单文件模式前端应使用 sidecar 传输");
    assert.ok(!script.includes("ui-icon-button"), "单文件模式同样应使用无边框按钮样式");
    new vm.Script(script);

    // 验证 VM 中 sidecar 请求行为
    const sidecarRequests = [];
    const browser = {
      window: { location: { hostname: "127.0.0.1" } },
      document: { getElementById() { return null; }, querySelectorAll() { return []; } },
      fetch: async (url, options) => {
        sidecarRequests.push({ url, options });
        return { ok: true, json: async () => ({ title: "侧车生成标题" }) };
      },
    };
    vm.runInNewContext(
      script.replace("// 初始化与监听", "globalThis.testApi = { generateTitleFromAI }; return;\n// 初始化与监听"),
      browser
    );
    const title = await browser.testApi.generateTitleFromAI("hello world");
    assert.strictEqual(title, "侧车生成标题");
    assert.strictEqual(sidecarRequests.length, 1);
    assert.strictEqual(sidecarRequests[0].url, `http://127.0.0.1:${result.port}/generate`);
    assert.strictEqual(sidecarRequests[0].options.headers["X-Kimi-Renamer-Token"], result.token);

    const serverConfig = readServerConfig(serverConfigPath);
    assert.strictEqual(serverConfig.apiKey, "mock-api-key-xyz");
    assert.strictEqual(serverConfig.model, "test-real-model-name");
    assert.strictEqual(serverConfig.token.length, 48);
    if (process.platform !== "win32") {
      const mode = fs.statSync(serverConfigPath).mode & 0o777;
      assert.strictEqual(mode, 0o660, "sidecar 配置权限应为 0660");
    }
    console.log("✅ 3. 单文件补丁注入、密钥隔离与 sidecar 传输校验通过");

    // 4. 重复应用幂等性（以及模拟 kimi web 覆盖还原 index.html 后的重注入）
    applyPatch(newWebDir, { configPath: mockConfigTomlPath, serverConfigPath, port: 60001 });
    assert.strictEqual(
      fs.readFileSync(path.join(newWebDir, "index.html"), "utf8").split("kimi-renamer.js").length,
      2
    );
    assert.strictEqual(readServerConfig(serverConfigPath).port, 60001);

    // 模拟 kimi web manifest 覆盖 index.html
    const updatedUpstreamHtml = initialHtml.replace("</div>", "<span>v2</span></div>");
    fs.writeFileSync(path.join(newWebDir, "index.html"), updatedUpstreamHtml, "utf8");
    applyPatch(newWebDir, { configPath: mockConfigTomlPath, serverConfigPath, port: 60001 });
    assert.ok(fs.readFileSync(path.join(newWebDir, "index.html"), "utf8").includes("<span>v2</span>"));
    assert.ok(fs.readFileSync(path.join(newWebDir, "index.html"), "utf8").includes("kimi-renamer.js"));
    assert.strictEqual(
      fs.readFileSync(path.join(newWebDir, "index.html.renamer.bak"), "utf8"),
      updatedUpstreamHtml,
      "上游更新后应刷新原版备份"
    );
    console.log("✅ 4. 重复应用幂等性与上游覆盖后重注入通过");

    // 5. 还原校验
    const restoreRes = restorePatch(newWebDir, { serverConfigPath });
    assert.strictEqual(restoreRes.restoredAny, true);
    assert.strictEqual(fs.readFileSync(path.join(newWebDir, "index.html"), "utf8"), updatedUpstreamHtml);
    assert.strictEqual(fs.readFileSync(path.join(newWebDir, "Kimi.ico"), "utf8"), "original icon");
    assert.ok(!fs.existsSync(serverConfigPath));
    console.log("✅ 5. 单文件模式还原逐字一致通过");

    // 6. CLI --mode standalone 校验
    const cli = path.join(__dirname, "..", "bin", "cli.js");
    const env = { ...process.env, KIMI_RENAMER_SERVER_CONFIG: serverConfigPath };
    const cliPatch = spawnSync(
      process.execPath,
      [cli, "patch", "--mode", "standalone", "--path", newWebDir, "--config", mockConfigTomlPath, "--port", "60002"],
      { encoding: "utf8", env }
    );
    assert.strictEqual(cliPatch.status, 0, cliPatch.stderr);
    const cliStatus = spawnSync(
      process.execPath,
      [cli, "status", "--mode", "standalone", "--path", newWebDir],
      { encoding: "utf8", env }
    );
    assert.strictEqual(cliStatus.status, 0, cliStatus.stderr);
    assert.ok(cliStatus.stdout.includes("sidecar 配置"));
    const cliUnpatch = spawnSync(
      process.execPath,
      [cli, "unpatch", "--mode", "standalone", "--path", newWebDir],
      { encoding: "utf8", env }
    );
    assert.strictEqual(cliUnpatch.status, 0, cliUnpatch.stderr);
    console.log("✅ 6. CLI --mode standalone 命令链路校验通过");

    console.log("\n🎉 单文件模式全部测试通过！\n");
  } finally {
    if (prevCacheRoots === undefined) delete process.env.KIMI_RENAMER_CACHE_ROOTS;
    else process.env.KIMI_RENAMER_CACHE_ROOTS = prevCacheRoots;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
