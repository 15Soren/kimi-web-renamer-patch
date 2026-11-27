const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { buildReleases } = require("../scripts/build-releases");

function main() {
  console.log("🧪 正在运行双形态 Release 构建与冒烟测试...\n");

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kimi-releases-test-"));
  try {
    const outDir = path.join(tempDir, "releases");
    const built = buildReleases({ outDir, archive: true });
    assert.strictEqual(built.built.length, 2);
    assert.ok(
      built.archives.some((f) => f.endsWith(".zip")),
      "Release 归档构建应生成 .zip 文件（含 Windows 兜底）"
    );

    const npmDir = path.join(outDir, "kimi-web-renamer-patch-npm");
    const standaloneDir = path.join(outDir, "kimi-web-renamer-patch-standalone");

    // 1. 验证文件隔离与 package.json
    assert.ok(fs.existsSync(path.join(npmDir, "src", "modes", "npm.js")));
    assert.ok(!fs.existsSync(path.join(npmDir, "src", "modes", "standalone.js")), "npm 版不应包含 standalone 模式");
    assert.ok(!fs.existsSync(path.join(npmDir, "src", "standalone")), "npm 版不应包含 sidecar/daemon");
    assert.ok(!fs.existsSync(path.join(npmDir, "bin", "kimi-web-renamer")), "npm 版不应包含单文件包装脚本");

    assert.ok(fs.existsSync(path.join(standaloneDir, "src", "modes", "standalone.js")));
    assert.ok(fs.existsSync(path.join(standaloneDir, "src", "standalone", "server.js")));
    assert.ok(fs.existsSync(path.join(standaloneDir, "src", "standalone", "daemon.js")));
    assert.ok(fs.existsSync(path.join(standaloneDir, "src", "standalone", "win-daemon.js")));
    assert.ok(fs.existsSync(path.join(standaloneDir, "bin", "kimi-web-renamer")));
    assert.ok(fs.existsSync(path.join(standaloneDir, "bin", "kimi-web-renamer.cmd")));
    assert.ok(fs.existsSync(path.join(standaloneDir, "bin", "install-daemon")));
    assert.ok(fs.existsSync(path.join(standaloneDir, "bin", "install-daemon.cmd")));
    assert.ok(fs.existsSync(path.join(standaloneDir, "bin", "uninstall-daemon")));
    assert.ok(fs.existsSync(path.join(standaloneDir, "bin", "uninstall-daemon.cmd")));
    for (const cmdFile of ["kimi-web-renamer.cmd", "install-daemon.cmd", "uninstall-daemon.cmd"]) {
      const raw = fs.readFileSync(path.join(standaloneDir, "bin", cmdFile), "utf8");
      assert.ok(/^[\x00-\x7F]*$/.test(raw), `${cmdFile} 必须为纯 ASCII，避免中文 Windows GBK 解析异常`);
      assert.ok(raw.includes("\r\n"), `${cmdFile} 必须使用 CRLF 换行`);
      assert.ok(!/(?<!\r)\n/.test(raw), `${cmdFile} 不能包含裸 LF 换行`);
    }
    assert.ok(!fs.existsSync(path.join(standaloneDir, "src", "modes", "npm.js")), "单文件版不应包含 npm 模式");

    const npmPkg = JSON.parse(fs.readFileSync(path.join(npmDir, "package.json"), "utf8"));
    const standalonePkg = JSON.parse(fs.readFileSync(path.join(standaloneDir, "package.json"), "utf8"));
    assert.strictEqual(npmPkg.name, "kimi-web-renamer-patch-npm");
    assert.strictEqual(standalonePkg.name, "kimi-web-renamer-patch-standalone");
    assert.ok(!npmPkg.scripts.serve);
    assert.ok(standalonePkg.scripts.serve);
    console.log("✅ 1. 双形态 Release 目录结构与包元数据校验通过");

    const mockConfig = path.join(__dirname, "mock-kimi-code", "config.toml");

    // 2. 冒烟测试 npm 发行版
    const mockNpmTarget = path.join(tempDir, "mock-npm-kimi");
    fs.mkdirSync(path.join(mockNpmTarget, "dist"), { recursive: true });
    fs.mkdirSync(path.join(mockNpmTarget, "dist-web"), { recursive: true });
    fs.writeFileSync(
      path.join(mockNpmTarget, "dist-web", "index.html"),
      '<html><head><script src="/boot.js"></script></head><body></body></html>',
      "utf8"
    );
    fs.writeFileSync(
      path.join(mockNpmTarget, "dist", "main.mjs"),
      'const CONTENT_SECURITY_POLICY = "default-src \'self\';";\nregisterConfigRoutes(apiV1, core);\n',
      "utf8"
    );

    const npmCli = path.join(npmDir, "bin", "cli.js");
    const npmHelp = spawnSync(process.execPath, [npmCli, "--help"], { encoding: "utf8" });
    assert.strictEqual(npmHelp.status, 0);
    assert.ok(!npmHelp.stdout.includes("sidecar"), "npm 版帮助不应出现 sidecar 说明");

    const npmRejectStandalone = spawnSync(
      process.execPath,
      [npmCli, "patch", "--mode", "standalone", "--path", mockNpmTarget, "--config", mockConfig],
      { encoding: "utf8" }
    );
    assert.strictEqual(npmRejectStandalone.status, 1);

    const npmPatch = spawnSync(
      process.execPath,
      [npmCli, "patch", "--path", mockNpmTarget, "--config", mockConfig],
      { encoding: "utf8" }
    );
    assert.strictEqual(npmPatch.status, 0, npmPatch.stderr);

    const npmStatus = spawnSync(
      process.execPath,
      [npmCli, "status", "--path", mockNpmTarget],
      { encoding: "utf8" }
    );
    assert.strictEqual(npmStatus.status, 0, npmStatus.stderr);
    assert.ok(npmStatus.stdout.includes("补丁完全生效中"));

    const npmUnpatch = spawnSync(
      process.execPath,
      [npmCli, "unpatch", "--path", mockNpmTarget],
      { encoding: "utf8" }
    );
    assert.strictEqual(npmUnpatch.status, 0, npmUnpatch.stderr);
    console.log("✅ 2. npm 发行版独立运行（patch / status / unpatch / 拒绝 standalone）通过");

    // 3. 冒烟测试 standalone 发行版
    const mockStandaloneTarget = path.join(tempDir, "mock-standalone-web");
    fs.mkdirSync(mockStandaloneTarget, { recursive: true });
    fs.writeFileSync(
      path.join(mockStandaloneTarget, "index.html"),
      '<html><head><script src="/boot.js"></script></head><body></body></html>',
      "utf8"
    );
    const serverConfigPath = path.join(tempDir, "standalone-state", "server.json");
    const env = { ...process.env, KIMI_RENAMER_SERVER_CONFIG: serverConfigPath };

    const standaloneCli = path.join(standaloneDir, "bin", "cli.js");
    const standaloneHelp = spawnSync(process.execPath, [standaloneCli, "--help"], { encoding: "utf8" });
    assert.strictEqual(standaloneHelp.status, 0);
    assert.ok(standaloneHelp.stdout.includes("serve"), "单文件版帮助应包含 serve 命令");

    const standaloneRejectNpm = spawnSync(
      process.execPath,
      [standaloneCli, "patch", "--mode", "npm", "--path", mockStandaloneTarget, "--config", mockConfig],
      { encoding: "utf8", env }
    );
    assert.strictEqual(standaloneRejectNpm.status, 1);

    const standalonePatch = spawnSync(
      process.execPath,
      [standaloneCli, "patch", "--path", mockStandaloneTarget, "--config", mockConfig],
      { encoding: "utf8", env }
    );
    assert.strictEqual(standalonePatch.status, 0, standalonePatch.stderr);
    assert.ok(fs.existsSync(serverConfigPath));

    const standaloneStatus = spawnSync(
      process.execPath,
      [standaloneCli, "status", "--path", mockStandaloneTarget],
      { encoding: "utf8", env }
    );
    assert.strictEqual(standaloneStatus.status, 0, standaloneStatus.stderr);
    assert.ok(standaloneStatus.stdout.includes("补丁完全生效中"));

    const standaloneUnpatch = spawnSync(
      process.execPath,
      [standaloneCli, "unpatch", "--path", mockStandaloneTarget],
      { encoding: "utf8", env }
    );
    assert.strictEqual(standaloneUnpatch.status, 0, standaloneUnpatch.stderr);
    assert.ok(!fs.existsSync(serverConfigPath));
    console.log("✅ 3. standalone 发行版独立运行（patch / status / unpatch / 拒绝 npm）通过");

    console.log("\n🎉 双形态 Release 测试全部通过！\n");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main();
