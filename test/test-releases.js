const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { buildReleases } = require("../scripts/build-releases");

function main() {
  console.log("🧪 正在运行 npm Release 构建与冒烟测试...\n");

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kimi-releases-test-"));
  try {
    const outDir = path.join(tempDir, "releases");
    const built = buildReleases({ outDir, archive: true });
    assert.strictEqual(built.built.length, 1);
    assert.strictEqual(built.built[0].variant, "npm");
    assert.ok(
      built.archives.some((f) => f.endsWith(".zip")),
      "Release 归档构建应生成 .zip 文件（含 Windows 兜底）"
    );

    const npmDir = path.join(outDir, "kimi-web-renamer-patch-npm");

    // 1. 验证文件与包元数据
    assert.ok(fs.existsSync(path.join(npmDir, "src", "npm-patch.js")));

    const npmPkg = JSON.parse(fs.readFileSync(path.join(npmDir, "package.json"), "utf8"));
    assert.strictEqual(npmPkg.name, "kimi-web-renamer-patch-npm");
    console.log("✅ 1. Release 目录结构与包元数据校验通过");

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
    assert.ok(npmHelp.stdout.includes("patch"));

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
    console.log("✅ 2. npm 发行版独立运行（patch / status / unpatch）通过");

    console.log("\n🎉 Release 测试全部通过！\n");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main();
