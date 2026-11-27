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

    // 7. Windows 守护进程安装/卸载模块校验（Unicode 路径、UTF-16LE BOM、双击探测）
    const winDaemon = require("../src/standalone/win-daemon");
    const mockAppData = path.join(tempDir, "mock-appdata-张三");
    const winEnv = { APPDATA: mockAppData };
    const installed = winDaemon.installDaemon({
      env: winEnv,
      nodeExe: "C:\\Program Files\\nodejs\\node.exe",
      daemonJs: "D:\\我的程序\\kimi-web-renamer\\src\\standalone\\daemon.js",
      skipSpawn: true,
    });
    assert.ok(fs.existsSync(installed.vbsPath), "应创建 Startup .vbs 文件");
    const vbsBuf = fs.readFileSync(installed.vbsPath);
    assert.strictEqual(vbsBuf[0], 0xff, "VBS 应包含 UTF-16LE BOM");
    assert.strictEqual(vbsBuf[1], 0xfe, "VBS 应包含 UTF-16LE BOM");
    const vbsText = vbsBuf.slice(2).toString("utf16le");
    assert.ok(vbsText.includes('"""C:\\Program Files\\nodejs\\node.exe"" ""D:\\我的程序\\kimi-web-renamer\\src\\standalone\\daemon.js"""'));
    assert.ok(vbsText.endsWith("\r\n"));
    assert.strictEqual(
      winDaemon.isExplorerDoubleClick({ CMDCMDLINE: 'C:\\Windows\\system32\\cmd.exe /c ""D:\\bin\\install-daemon.cmd" "' }),
      true
    );
    assert.strictEqual(
      winDaemon.isExplorerDoubleClick({ CMDCMDLINE: "cmd.exe" }),
      false
    );
    const uninstalled = winDaemon.uninstallDaemon({ env: winEnv, skipStop: true });
    assert.strictEqual(uninstalled.removedVbs, true);
    assert.ok(!fs.existsSync(installed.vbsPath));
    assert.ok(vbsText.includes("On Error Resume Next"), "VBS 应包含静默错误兜底");
    assert.ok(vbsText.includes("FileExists"), "VBS 应校验文件存在避免移动目录后开机弹窗");

    // 校验 PowerShell 停止脚本语法合法性（修复之前 .join("; ") 导致的语法错误）
    const psScript = winDaemon.buildStopProcessesScript(process.pid);
    assert.ok(!psScript.includes("-and (;"), "PowerShell 脚本不能包含非法分号");
    assert.ok(!psScript.includes("-or;"), "PowerShell 脚本不能包含非法分号");
    if (process.platform === "win32") {
      // 使用 PowerShell AST Parser 纯语法检查，不执行杀进程
      const parserCheck = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `$errs = $null; [System.Management.Automation.Language.Parser]::ParseInput(@'\n${psScript}\n'@, [ref]$null, [ref]$errs) | Out-Null; if ($errs.Count -gt 0) { $errs | ForEach-Object { Write-Error $_.Message }; exit 1 }`,
        ],
        { encoding: "utf8", windowsHide: true }
      );
      assert.strictEqual(parserCheck.status, 0, `PowerShell 语法校验失败: ${parserCheck.stderr}`);
    }
    console.log("✅ 7. Windows 守护进程安装/卸载模块、UTF-16LE 自启脚本与 PowerShell 语法校验通过");

    // 8. Windows 5 层缓存结构探测、自定义端口/配置保留、localhost IPv4 归一化与纯 Node PATH 查找
    const deepRoot = path.join(tempDir, "local-appdata-kimi-code");
    const deepWebDir = path.join(deepRoot, "web", "2.8.1", "win32-x64", "abc123hash", "dist-web");
    fs.mkdirSync(deepWebDir, { recursive: true });
    fs.writeFileSync(path.join(deepWebDir, "index.html"), initialHtml, "utf8");
    const detectedDeep = detectInstallTarget(deepRoot, "standalone");
    assert.strictEqual(detectedDeep.targetDir, deepWebDir, "5 层深度的 kimi-code 上级目录应能定位到 dist-web");

    // 验证重复 applyPatch（模拟 daemon 不传 port/configPath）保留之前的自定义端口与 configPath
    const keepServerConfig = path.join(tempDir, "keep-state", "server.json");
    applyPatch(deepWebDir, { configPath: mockConfigTomlPath, serverConfigPath: keepServerConfig, port: 60003 });
    // 模拟 kimi web 还原 index.html 后 daemon 无参重注入
    fs.writeFileSync(path.join(deepWebDir, "index.html"), initialHtml, "utf8");
    const reinjected = applyPatch(deepWebDir, { serverConfigPath: keepServerConfig });
    assert.strictEqual(reinjected.port, 60003, "daemon 重注入应保留用户自定义端口");
    assert.strictEqual(readServerConfig(keepServerConfig).port, 60003);
    assert.ok(fs.readFileSync(path.join(deepWebDir, "kimi-renamer.js"), "utf8").includes('"port":60003'));

    // 验证 localhost / ::1 归一为 127.0.0.1（避开 Windows IPv6 loopback 陷阱）
    const deepScript = fs.readFileSync(path.join(deepWebDir, "kimi-renamer.js"), "utf8");
    for (const [hostIn, expectedHost] of [
      ["localhost", "127.0.0.1"],
      ["::1", "127.0.0.1"],
      ["[::1]", "127.0.0.1"],
      ["192.168.1.25", "192.168.1.25"],
    ]) {
      const ctx = { window: { location: { hostname: hostIn } } };
      vm.runInNewContext(
        deepScript.replace("// 初始化与监听", "globalThis.testApi = { renamerBaseUrl }; return;\n// 初始化与监听"),
        ctx
      );
      assert.strictEqual(ctx.testApi.renamerBaseUrl(), `http://${expectedHost}:60003`);
    }

    // 验证纯 Node.js PATH 查找（含空格目录与引号包裹）
    const { findExecutablesInPath } = require("../src/paths");
    const spacedBinDir = path.join(tempDir, "bin dir with space");
    fs.mkdirSync(spacedBinDir, { recursive: true });
    const fakeBinName = process.platform === "win32" ? "fake-kimi-test.cmd" : "fake-kimi-test";
    const fakeBinPath = path.join(spacedBinDir, fakeBinName);
    fs.writeFileSync(fakeBinPath, process.platform === "win32" ? "@echo off\r\n" : "#!/bin/sh\n", "utf8");
    if (process.platform !== "win32") fs.chmodSync(fakeBinPath, 0o755);
    const foundBins = findExecutablesInPath("fake-kimi-test", {
      PATH: `"${spacedBinDir}"${path.delimiter}${process.env.PATH || ""}`,
      PATHEXT: ".EXE;.CMD;.BAT",
    });
    assert.strictEqual(foundBins.length, 1);
    assert.strictEqual(foundBins[0].toLowerCase(), fakeBinPath.toLowerCase());

    // 验证 CLI 拒绝非法端口
    for (const badPort of ["abc", "0", "70000", "-1"]) {
      const badPortRes = spawnSync(
        process.execPath,
        [cli, "patch", "--mode", "standalone", "--path", deepWebDir, "--config", mockConfigTomlPath, "--port", badPort],
        { encoding: "utf8", env }
      );
      assert.strictEqual(badPortRes.status, 1, `非法端口 ${badPort} 应返回非零退出码`);
    }
    console.log("✅ 8. 深层缓存探测、自定义端口保留、IPv4 归一化、纯 Node PATH 查找与非法端口拦截通过");

    // 9. 多用户 (KIMI_RENAMER_ALL_USERS) 场景：历史非显式 sourceConfigPath 不能劫持其他用户自己的 config.toml
    const userAHome = path.join(tempDir, "home-user-a");
    const userBHome = path.join(tempDir, "home-user-b");
    const userAConfig = path.join(userAHome, ".kimi-code", "config.toml");
    const userBConfig = path.join(userBHome, ".kimi-code", "config.toml");
    const userBWebDir = path.join(userBHome, ".cache", "kimi-code", "web", "2.8.1", "linux-x64", "hashb", "dist-web");
    fs.mkdirSync(path.dirname(userAConfig), { recursive: true });
    fs.mkdirSync(path.dirname(userBConfig), { recursive: true });
    fs.mkdirSync(userBWebDir, { recursive: true });
    fs.writeFileSync(path.join(userBWebDir, "index.html"), initialHtml, "utf8");
    const makeToml = (modelName) => [
      `rename_model = "magpie/${modelName}"`,
      `default_model = "magpie/${modelName}"`,
      `[providers.magpie]`,
      `type = "kimi"`,
      `base_url = "http://127.0.0.1:3425/v1"`,
      `api_key = "test-key"`,
      `[models."magpie/${modelName}"]`,
      `provider = "magpie"`,
      `model = "${modelName}"`,
    ].join("\n") + "\n";
    fs.writeFileSync(userAConfig, makeToml("old-root-model"), "utf8");
    fs.writeFileSync(userBConfig, makeToml("trae-cn/Doubao-Seed-2.1-Turbo"), "utf8");

    // 模拟旧版 v1.2.3 遗留的 server.json（带非显式的 sourceConfigPath 指向 userA）
    const sharedServerConfig = path.join(tempDir, "shared-opt-state", "server.json");
    standaloneMode.writeServerConfig(
      {
        version: 1,
        endpoint: "http://127.0.0.1:3425/v1/chat/completions",
        apiKey: "test-key",
        model: "old-root-model",
        host: "0.0.0.0",
        port: 60004,
        token: "a".repeat(48),
        sourceConfigPath: userAConfig,
      },
      sharedServerConfig
    );

    const userBPatched = applyPatch(userBWebDir, { serverConfigPath: sharedServerConfig });
    assert.strictEqual(
      userBPatched.modelInfo.actualModel,
      "trae-cn/Doubao-Seed-2.1-Turbo",
      "非显式历史 sourceConfigPath 不应劫持 dist-web 所属用户自己的 config.toml"
    );
    assert.strictEqual(readServerConfig(sharedServerConfig).model, "trae-cn/Doubao-Seed-2.1-Turbo");
    assert.strictEqual(readServerConfig(sharedServerConfig).port, 60004, "应继续保留原端口");

    // 验证 status 在 config.toml 变更但尚未 patch 时会给出不一致提示
    fs.writeFileSync(userBConfig, makeToml("newer-model-after-edit"), "utf8");
    const mismatchStatus = spawnSync(
      process.execPath,
      [cli, "status", "--mode", "standalone", "--path", userBWebDir],
      { encoding: "utf8", env: { ...process.env, KIMI_RENAMER_SERVER_CONFIG: sharedServerConfig } }
    );
    assert.strictEqual(mismatchStatus.status, 0, mismatchStatus.stderr);
    assert.ok(
      mismatchStatus.stdout.includes("newer-model-after-edit") &&
        mismatchStatus.stderr.includes("不一致"),
      "status 应显示 config.toml 实际模型并对 server.json 不一致发出提醒"
    );
    console.log("✅ 9. Linux 多用户配置归属隔离与 status 模型一致性诊断通过");

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
