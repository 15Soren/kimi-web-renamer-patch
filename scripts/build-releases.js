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
    meta: { variant: "npm", defaultMode: "npm" },
    readmeTemplate: "release-templates/README.npm.md",
    files: [
      "bin/cli.js",
      "src/patcher.js",
      "src/kimi-config.js",
      "src/paths.js",
      "src/modes/npm.js",
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
  standalone: {
    dirName: "kimi-web-renamer-patch-standalone",
    packageName: "kimi-web-renamer-patch-standalone",
    description: "Kimi Code Web 自动重命名补丁（单文件二进制安装专用版，含 sidecar 与守护进程）",
    meta: { variant: "standalone", defaultMode: "standalone" },
    readmeTemplate: "release-templates/README.standalone.md",
    files: [
      "bin/cli.js",
      "bin/kimi-web-renamer",
      "bin/install-daemon",
      "bin/uninstall-daemon",
      "src/patcher.js",
      "src/kimi-config.js",
      "src/paths.js",
      "src/modes/standalone.js",
      "src/standalone/server.js",
      "src/standalone/daemon.js",
      "src/template/kimi-renamer.js",
      "src/assets/Kimi.ico",
      "LICENSE",
    ],
    executables: [
      "bin/cli.js",
      "bin/kimi-web-renamer",
      "bin/install-daemon",
      "bin/uninstall-daemon",
      "src/standalone/daemon.js",
    ],
    bin: {
      "kimi-patch": "./bin/cli.js",
      "kimi-web-renamer": "./bin/kimi-web-renamer",
    },
    scripts: {
      patch: "node bin/cli.js patch",
      unpatch: "node bin/cli.js unpatch",
      status: "node bin/cli.js status",
      models: "node bin/cli.js models",
      serve: "node bin/cli.js serve",
      daemon: "node src/standalone/daemon.js",
    },
  },
};

function copyFileTo(srcRel, destRoot, isExecutable) {
  const srcAbs = path.join(REPO_ROOT, srcRel);
  const destAbs = path.join(destRoot, srcRel);
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  fs.copyFileSync(srcAbs, destAbs);
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

  // 写入 release-meta.js 锁定发行版模式
  const metaContent = `module.exports = ${JSON.stringify(spec.meta, null, 2)};\n`;
  fs.writeFileSync(path.join(releaseDir, "src", "release-meta.js"), metaContent, "utf8");

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
    });
    if (tarRes.status === 0) {
      archives.push(tarPath);
    }

    const zipName = `${item.dirName}-v${item.version}.zip`;
    const zipPath = path.join(outDir, zipName);
    const zipRes = spawnSync("zip", ["-rq", zipPath, item.dirName], {
      cwd: outDir,
      encoding: "utf8",
    });
    if (zipRes.status === 0) {
      archives.push(zipPath);
    }
  }
  return archives;
}

function buildReleases(options = {}) {
  const outDir = path.resolve(options.outDir || path.join(REPO_ROOT, "dist", "releases"));
  const rootPkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  fs.mkdirSync(outDir, { recursive: true });

  const built = [
    buildReleaseVariant("npm", outDir, rootPkg),
    buildReleaseVariant("standalone", outDir, rootPkg),
  ];

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
    } else if (args[i] === "--archive") {
      archive = true;
    }
  }
  const result = buildReleases({ outDir, archive });
  console.log(`✅ 已构建双形态 Release 到: ${result.outDir}`);
  for (const item of result.built) {
    console.log(`   - [${item.variant}] ${item.releaseDir}`);
  }
  for (const file of result.archives) {
    console.log(`   - [archive] ${file}`);
  }
}
