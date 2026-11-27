const assert = require("assert");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { standaloneMode } = require("../src/patcher");
const winDaemon = require("../src/standalone/win-daemon");

const ROOT = path.resolve(__dirname, "..");
const DAEMON_JS = path.join(ROOT, "src", "standalone", "daemon.js");
const LAUNCHER_JS = path.join(ROOT, "bin", "kimi-web-renamer");
const LAUNCHER_CMD = path.join(ROOT, "bin", "kimi-web-renamer.cmd");
const MOCK_CONFIG = path.join(__dirname, "mock-kimi-code", "config.toml");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function checkHealth(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/health", timeout: 800 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitFor(predicate, timeoutMs = 10000, intervalMs = 150) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(intervalMs);
  }
  return false;
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === "EPERM";
  }
}

function forceKill(pid) {
  if (!pid) return;
  try {
    process.kill(pid);
  } catch (e) {
    // 忽略已退出
  }
}

async function main() {
  console.log("🧪 正在运行守护进程 / 启动器 / Windows 静默自启端到端测试...\n");

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kimi-daemon-e2e-"));
  const trackedPids = new Set();

  try {
    const kimiHome = path.join(tempDir, "kimi-home");
    const cacheRoot = path.join(tempDir, "cache-root");
    const webDir = path.join(cacheRoot, "2.8.1", "win32-x64", "hash123", "dist-web");
    const stateDir = path.join(kimiHome, "kimi-renamer");
    const serverConfigPath = path.join(stateDir, "server.json");
    const daemonPidFile = path.join(stateDir, "daemon.pid");
    const sidecarPidFile = path.join(stateDir, "sidecar.pid");
    const initialHtml =
      '<!doctype html><html><head><script src="/boot.js"></script></head><body><div id="app"></div></body></html>';

    fs.mkdirSync(webDir, { recursive: true });
    fs.writeFileSync(path.join(webDir, "index.html"), initialHtml, "utf8");

    const port = await getFreePort();
    const patched = standaloneMode.applyPatch(webDir, {
      configPath: MOCK_CONFIG,
      serverConfigPath,
      port,
      host: "127.0.0.1",
    });
    assert.strictEqual(patched.port, port);

    const daemonEnv = {
      ...process.env,
      KIMI_CODE_HOME: kimiHome,
      KIMI_RENAMER_CACHE_ROOTS: cacheRoot,
      KIMI_RENAMER_SERVER_CONFIG: serverConfigPath,
    };

    // 1. 启动 daemon.js，验证 PID 文件、sidecar 拉起与单实例保护
    const daemonChild = spawn(process.execPath, [DAEMON_JS], {
      env: daemonEnv,
      windowsHide: true,
      stdio: "ignore",
    });
    trackedPids.add(daemonChild.pid);

    const sidecarUp = await waitFor(() => checkHealth(port), 10000);
    assert.strictEqual(sidecarUp, true, "daemon 应在 10 秒内自动拉起 sidecar 并通过 /health");
    assert.ok(fs.existsSync(daemonPidFile), "daemon 启动后应写入 daemon.pid");
    assert.ok(fs.existsSync(sidecarPidFile), "sidecar 启动后应写入 sidecar.pid");

    const sidecarPidInfo = JSON.parse(fs.readFileSync(sidecarPidFile, "utf8"));
    trackedPids.add(sidecarPidInfo.pid);

    // 启动第二个 daemon 实例，验证单实例锁立即退出
    const dupDaemon = spawnSync(process.execPath, [DAEMON_JS], {
      env: daemonEnv,
      windowsHide: true,
      encoding: "utf8",
      timeout: 5000,
    });
    assert.strictEqual(dupDaemon.status, 0, "重复启动的 daemon 应检测到单实例锁并干净退出");
    assert.strictEqual(isAlive(daemonChild.pid), true, "首个 daemon 实例应持续存活");
    console.log("✅ 1. daemon 启动、自动拉起 sidecar 与单实例锁校验通过");

    // 2. 模拟 kimi web 覆写还原 index.html，验证 daemon 自动重注入且保留自定义端口与 token
    fs.writeFileSync(path.join(webDir, "index.html"), initialHtml, "utf8");
    const reinjected = await waitFor(
      () => fs.readFileSync(path.join(webDir, "index.html"), "utf8").includes("/kimi-renamer.js"),
      8000
    );
    assert.strictEqual(reinjected, true, "index.html 被覆盖后 daemon 应自动重注入");
    const afterReinjectCfg = standaloneMode.readServerConfig(serverConfigPath);
    assert.strictEqual(afterReinjectCfg.port, port, "重注入后应保留自定义端口");
    assert.strictEqual(afterReinjectCfg.token, patched.token, "重注入后应保留原 token");
    console.log("✅ 2. index.html 被覆写后自动重注入且保留自定义端口与 token 通过");

    // 3. 模拟监听目录被删除再重建，验证 daemon 不崩溃且自动恢复守护
    fs.rmSync(webDir, { recursive: true, force: true });
    await sleep(500);
    assert.strictEqual(isAlive(daemonChild.pid), true, "目录被删除后 daemon 不应因 fs.watch error 崩溃");
    fs.mkdirSync(webDir, { recursive: true });
    fs.writeFileSync(path.join(webDir, "index.html"), initialHtml, "utf8");
    const recovered = await waitFor(
      () => fs.readFileSync(path.join(webDir, "index.html"), "utf8").includes("/kimi-renamer.js"),
      8000
    );
    assert.strictEqual(recovered, true, "目录重建后 daemon 应自动恢复重注入");
    console.log("✅ 3. 目录删除/重建防崩溃与自动恢复守护通过");

    // 4. 模拟用户执行 unpatch（删除 server.json），验证 daemon 不复活补丁且停止托管 sidecar
    standaloneMode.restorePatch(webDir, { serverConfigPath });
    assert.ok(!fs.existsSync(serverConfigPath));
    const sidecarStoppedAfterUnpatch = await waitFor(async () => !(await checkHealth(port)), 8000);
    assert.strictEqual(sidecarStoppedAfterUnpatch, true, "unpatch 后 daemon 应停止托管的 sidecar");
    await sleep(2500);
    assert.ok(!fs.existsSync(serverConfigPath), "unpatch 后 daemon 不能擅自复活 server.json");
    assert.ok(
      !fs.readFileSync(path.join(webDir, "index.html"), "utf8").includes("/kimi-renamer.js"),
      "unpatch 后 daemon 不能擅自复活 index.html 注入"
    );
    console.log("✅ 4. unpatch 后不复活补丁且自动停止托管 sidecar 通过");

    // 5. 停止 daemon（在 Windows 上真实测试 win-daemon.stopRunningDaemons）
    if (process.platform === "win32") {
      // 设置临时 KIMI_CODE_HOME 让 stopRunningDaemons 同时验证 PID 文件 + PowerShell 清理
      const prevHome = process.env.KIMI_CODE_HOME;
      process.env.KIMI_CODE_HOME = kimiHome;
      try {
        const stopRes = winDaemon.stopRunningDaemons();
        assert.strictEqual(stopRes.ok, true, `stopRunningDaemons 失败: ${stopRes.error}`);
      } finally {
        if (prevHome === undefined) delete process.env.KIMI_CODE_HOME;
        else process.env.KIMI_CODE_HOME = prevHome;
      }
      const stopped = await waitFor(() => !isAlive(daemonChild.pid), 5000);
      assert.strictEqual(stopped, true, "Windows stopRunningDaemons 必须真正结束 daemon 进程");
      console.log("✅ 5. Windows stopRunningDaemons 真实进程清理通过");
    } else {
      forceKill(daemonChild.pid);
      await waitFor(() => !isAlive(daemonChild.pid), 5000);
      console.log("✅ 5. daemon 优雅停止通过");
    }

    // 6. 端到端测试 kimi-web-renamer 启动器（含空格路径 mock kimi、无 DEP0190、进程内重注入、退出清理 sidecar）
    const port2 = await getFreePort();
    standaloneMode.applyPatch(webDir, {
      configPath: MOCK_CONFIG,
      serverConfigPath,
      port: port2,
      host: "127.0.0.1",
    });

    const mockBinDir = path.join(tempDir, "mock kimi bin");
    fs.mkdirSync(mockBinDir, { recursive: true });
    const mockKimiScript = path.join(mockBinDir, "mock-kimi-runner.js");
    const mockReportFile = path.join(tempDir, "kimi-run-report.json");
    fs.writeFileSync(
      mockKimiScript,
      `
const fs = require("fs");
const indexHtml = process.env.TEST_INDEX_HTML;
const initialHtml = process.env.TEST_INITIAL_HTML;
// 模拟单文件 kimi web 启动时覆写还原 index.html
fs.writeFileSync(indexHtml, initialHtml, "utf8");
const deadline = Date.now() + 6000;
const timer = setInterval(() => {
  const cur = fs.readFileSync(indexHtml, "utf8");
  if (cur.includes("/kimi-renamer.js") || Date.now() > deadline) {
    clearInterval(timer);
    fs.writeFileSync(process.env.TEST_REPORT_FILE, JSON.stringify({
      argv: process.argv.slice(2),
      reinjected: cur.includes("/kimi-renamer.js"),
    }));
    process.exit(0);
  }
}, 150);
`,
      "utf8"
    );

    let mockKimiBin;
    if (process.platform === "win32") {
      mockKimiBin = path.join(mockBinDir, "kimi.cmd");
      fs.writeFileSync(
        mockKimiBin,
        `@echo off\r\n"${process.execPath}" "${mockKimiScript}" %*\r\n`,
        "utf8"
      );
    } else {
      mockKimiBin = path.join(mockBinDir, "kimi");
      fs.writeFileSync(
        mockKimiBin,
        `#!/bin/sh\nexec "${process.execPath}" "${mockKimiScript}" "$@"\n`,
        "utf8"
      );
      fs.chmodSync(mockKimiBin, 0o755);
    }

    const launcherEnv = {
      ...daemonEnv,
      KIMI_BIN: mockKimiBin,
      TEST_INDEX_HTML: path.join(webDir, "index.html"),
      TEST_INITIAL_HTML: initialHtml,
      TEST_REPORT_FILE: mockReportFile,
    };

    const launcherRes =
      process.platform === "win32"
        ? spawnSync(
            process.env.ComSpec || "cmd.exe",
            ["/d", "/s", "/c", `""${LAUNCHER_CMD}" --host 127.0.0.1"`],
            {
              env: launcherEnv,
              encoding: "utf8",
              windowsHide: true,
              windowsVerbatimArguments: true,
              timeout: 15000,
            }
          )
        : spawnSync(process.execPath, [LAUNCHER_JS, "--host", "127.0.0.1"], {
            env: launcherEnv,
            encoding: "utf8",
            timeout: 15000,
          });

    assert.strictEqual(launcherRes.status, 0, `kimi-web-renamer 运行失败: ${launcherRes.stderr}\n${launcherRes.stdout}`);
    assert.ok(!launcherRes.stderr.includes("DEP0190"), `不应触发 Node DEP0190 警告: ${launcherRes.stderr}`);
    const report = JSON.parse(fs.readFileSync(mockReportFile, "utf8"));
    assert.deepStrictEqual(report.argv, ["web", "--host", "127.0.0.1"]);
    assert.strictEqual(report.reinjected, true, "kimi-web-renamer 应在 kimi web 覆写 index.html 后自动重注入");

    const sidecarClosedAfterExit = await waitFor(async () => !(await checkHealth(port2)), 5000);
    assert.strictEqual(sidecarClosedAfterExit, true, "kimi-web-renamer 退出后应自动关闭 sidecar");
    console.log("✅ 6. kimi-web-renamer 含空格路径启动、无 DEP0190、自动重注入与退出清理通过");

    // 7. Windows 真实 WScript 执行 UTF-16LE 自启脚本测试（含中文路径 & 目标不存在静默退出）
    if (process.platform === "win32") {
      const cnDir = path.join(tempDir, "中文 目录测试");
      fs.mkdirSync(cnDir, { recursive: true });
      const markerFile = path.join(cnDir, "vbs-ran.txt");
      const probeJs = path.join(cnDir, "probe.js");
      fs.writeFileSync(
        probeJs,
        `require("fs").writeFileSync(${JSON.stringify(markerFile)}, "ok", "utf8");\n`,
        "utf8"
      );

      const vbsPath = path.join(cnDir, "test-startup.vbs");
      fs.writeFileSync(vbsPath, winDaemon.buildStartupVbsBuffer(process.execPath, probeJs));
      const vbsRun = spawnSync("wscript.exe", ["//B", "//Nologo", vbsPath], {
        windowsHide: true,
        timeout: 10000,
      });
      assert.strictEqual(vbsRun.status, 0, "wscript 执行 UTF-16LE 自启脚本应返回 0");
      const markerCreated = await waitFor(() => fs.existsSync(markerFile), 5000);
      assert.strictEqual(markerCreated, true, "UTF-16LE VBS 应静默成功拉起含中文路径的 Node 脚本");

      // 目标文件不存在时应静默退出，不报错不弹窗
      const missingVbsPath = path.join(cnDir, "test-missing.vbs");
      fs.writeFileSync(
        missingVbsPath,
        winDaemon.buildStartupVbsBuffer(process.execPath, path.join(cnDir, "non-existent.js"))
      );
      const missingRun = spawnSync("wscript.exe", ["//B", "//Nologo", missingVbsPath], {
        windowsHide: true,
        timeout: 5000,
      });
      assert.strictEqual(missingRun.status, 0, "目标文件不存在时 VBS 应静默正常退出");
      console.log("✅ 7. Windows WScript UTF-16LE 自启脚本（含中文路径与缺失文件兜底）真实执行通过");

      // 8. Windows 真实调用 bin\install-daemon.cmd 与 bin\uninstall-daemon.cmd 完整闭环测试（隔离 APPDATA）
      const installCmd = path.join(ROOT, "bin", "install-daemon.cmd");
      const uninstallCmd = path.join(ROOT, "bin", "uninstall-daemon.cmd");
      const isolatedAppData = path.join(tempDir, "isolated-appdata-测试");
      const port3 = await getFreePort();
      standaloneMode.applyPatch(webDir, {
        configPath: MOCK_CONFIG,
        serverConfigPath,
        port: port3,
        host: "127.0.0.1",
      });
      const cmdEnv = {
        ...daemonEnv,
        APPDATA: isolatedAppData,
      };
      const installRes = spawnSync(
        process.env.ComSpec || "cmd.exe",
        ["/d", "/s", "/c", `""${installCmd}""`],
        {
          env: cmdEnv,
          encoding: "utf8",
          windowsHide: true,
          windowsVerbatimArguments: true,
          timeout: 20000,
        }
      );
      assert.strictEqual(installRes.status, 0, `install-daemon.cmd 失败: ${installRes.stderr}\n${installRes.stdout}`);
      const expectedVbs = winDaemon.getVbsPath({ APPDATA: isolatedAppData });
      assert.ok(fs.existsSync(expectedVbs), "install-daemon.cmd 应在 Startup 目录生成 VBS");
      const cmdSidecarUp = await waitFor(() => checkHealth(port3), 10000);
      assert.strictEqual(cmdSidecarUp, true, "install-daemon.cmd 应成功拉起守护进程与 sidecar");

      const installedDaemonPid = JSON.parse(fs.readFileSync(daemonPidFile, "utf8")).pid;
      trackedPids.add(installedDaemonPid);
      if (fs.existsSync(sidecarPidFile)) {
        trackedPids.add(JSON.parse(fs.readFileSync(sidecarPidFile, "utf8")).pid);
      }

      // 覆写 index.html 确认后台守护进程静默重注入正常
      fs.writeFileSync(path.join(webDir, "index.html"), initialHtml, "utf8");
      const cmdReinjected = await waitFor(
        () => fs.readFileSync(path.join(webDir, "index.html"), "utf8").includes("/kimi-renamer.js"),
        8000
      );
      assert.strictEqual(cmdReinjected, true, "install-daemon.cmd 拉起的守护进程应自动重注入 index.html");

      // 运行 uninstall-daemon.cmd 完整停止并移除自启
      const uninstallRes = spawnSync(
        process.env.ComSpec || "cmd.exe",
        ["/d", "/s", "/c", `""${uninstallCmd}""`],
        {
          env: cmdEnv,
          encoding: "utf8",
          windowsHide: true,
          windowsVerbatimArguments: true,
          timeout: 20000,
        }
      );
      assert.strictEqual(uninstallRes.status, 0, `uninstall-daemon.cmd 失败: ${uninstallRes.stderr}\n${uninstallRes.stdout}`);
      assert.ok(!fs.existsSync(expectedVbs), "uninstall-daemon.cmd 应删除 Startup VBS");
      const daemonGone = await waitFor(() => !isAlive(installedDaemonPid), 5000);
      assert.strictEqual(daemonGone, true, "uninstall-daemon.cmd 必须彻底停止后台 daemon 进程");
      const sidecarGone = await waitFor(async () => !(await checkHealth(port3)), 5000);
      assert.strictEqual(sidecarGone, true, "uninstall-daemon.cmd 必须彻底停止后台 sidecar 进程");
      console.log("✅ 8. Windows install-daemon.cmd / uninstall-daemon.cmd 完整安装-守护-卸载闭环通过");
    }

    console.log("\n🎉 守护进程 / 启动器 / Windows 静默自启端到端测试全部通过！\n");
  } finally {
    for (const pid of trackedPids) {
      forceKill(pid);
    }
    await sleep(300);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
