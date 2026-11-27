#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..");

const RELEASE_SPECS = {
  npm: {
    dirName: "kimi-web-renamer-patch-npm",
    packageName: "kimi-web-renamer-patch-npm",
    description: "Kimi Code Web 自动重命名补丁（npm 安装专用版，直接注入同源代理路由）",
    readmeTemplate: "release-templates/README.npm.md",
    files: [
      "bin/cli.js",
      "src/patcher.js",
      "src/kimi-config.js",
      "src/paths.js",
      "src/npm-patch.js",
      "src/template/kimi-renamer.js",
      "src/assets/Kimi.ico",
      "LICENSE",
    ],
    executables: ["bin/cli.js"],
    bin: {
      "kimi-patch": "./bin/cli.js",
    },
    scripts: {
      patch: "node bin/cli.js patch",
      unpatch: "node bin/cli.js unpatch",
      status: "node bin/cli.js status",
      models: "node bin/cli.js models",
    },
  },
};

function copyFileTo(srcRel, destRoot, isExecutable) {
  const srcAbs = path.join(REPO_ROOT, srcRel);
  const destAbs = path.join(destRoot, srcRel);
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  if (srcRel.endsWith(".cmd") || srcRel.endsWith(".bat")) {
    const content = fs.readFileSync(srcAbs, "utf8").replace(/\r?\n/g, "\r\n");
    fs.writeFileSync(destAbs, content, "utf8");
  } else {
    fs.copyFileSync(srcAbs, destAbs);
  }
  if (isExecutable && process.platform !== "win32") {
    fs.chmodSync(destAbs, 0o755);
  }
}

function buildReleaseVariant(variantName, outDir, rootPkg) {
  const spec = RELEASE_SPECS[variantName];
  if (!spec) throw new Error(`未知的 release 类型: ${variantName}`);

  const releaseDir = path.join(outDir, spec.dirName);
  fs.rmSync(releaseDir, { recursive: true, force: true });
  fs.mkdirSync(releaseDir, { recursive: true });

  const execSet = new Set(spec.executables);
  for (const rel of spec.files) {
    copyFileTo(rel, releaseDir, execSet.has(rel));
  }

  // 写入裁剪后的 package.json
  const pkg = {
    name: spec.packageName,
    version: rootPkg.version,
    description: spec.description,
    main: "src/patcher.js",
    bin: spec.bin,
    scripts: spec.scripts,
    keywords: rootPkg.keywords,
    engines: rootPkg.engines,
    repository: rootPkg.repository,
    author: rootPkg.author,
    license: rootPkg.license,
  };
  fs.writeFileSync(path.join(releaseDir, "package.json"), JSON.stringify(pkg, null, 2) + "\n", "utf8");

  // 写入对应版本的 README.md
  const readmeSrc = path.join(REPO_ROOT, spec.readmeTemplate);
  fs.copyFileSync(readmeSrc, path.join(releaseDir, "README.md"));

  return { variant: variantName, dirName: spec.dirName, releaseDir, version: rootPkg.version };
}

function createArchives(outDir, builtList) {
  const archives = [];
  for (const item of builtList) {
    const tarName = `${item.dirName}-v${item.version}.tar.gz`;
    const tarPath = path.join(outDir, tarName);
    const tarRes = spawnSync("tar", ["-czf", tarPath, "-C", outDir, item.dirName], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (tarRes.status === 0) {
      archives.push(tarPath);
    }

    const zipName = `${item.dirName}-v${item.version}.zip`;
    const zipPath = path.join(outDir, zipName);
    let zipOk = false;
    const zipRes = spawnSync("zip", ["-rq", zipPath, item.dirName], {
      cwd: outDir,
      encoding: "utf8",
      windowsHide: true,
    });
    if (zipRes.status === 0) {
      zipOk = true;
    } else if (process.platform === "win32") {
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
      const srcDir = path.join(outDir, item.dirName);
      const psEsc = (s) => `'${String(s).replace(/'/g, "''")}'`;
      const psRes = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          `Compress-Archive -LiteralPath ${psEsc(srcDir)} -DestinationPath ${psEsc(zipPath)} -Force`,
        ],
        {
          encoding: "utf8",
          windowsHide: true,
        }
      );
      if (psRes.status === 0 && fs.existsSync(zipPath)) {
        zipOk = true;
      }
    }
    if (zipOk) {
      archives.push(zipPath);
    }
  }
  return archives;
}

function buildReleases(options = {}) {
  const outDir = path.resolve(options.outDir || path.join(REPO_ROOT, "dist", "releases"));
  const rootPkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  fs.mkdirSync(outDir, { recursive: true });

  const built = [buildReleaseVariant("npm", outDir, rootPkg)];

  const archives = options.archive ? createArchives(outDir, built) : [];
  return { outDir, built, archives };
}

module.exports = {
  RELEASE_SPECS,
  buildReleaseVariant,
  buildReleases,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  let outDir = null;
  let archive = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") {
      outDir = args[++i];
      if (!outDir || outDir.startsWith("-")) {
        console.error("❌ --out 缺少输出目录参数");
        process.exit(1);
      }
    } else if (args[i] === "--archive") {
      archive = true;
    }
  }
  const result = buildReleases({ outDir, archive });
  console.log(`✅ 已构建 npm Release 到: ${result.outDir}`);
  for (const item of result.built) {
    console.log(`   - [${item.variant}] ${item.releaseDir}`);
  }
  for (const file of result.archives) {
    console.log(`   - [archive] ${file}`);
  }
}
