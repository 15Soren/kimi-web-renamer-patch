const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { createServer, stripTitle } = require("../src/standalone/server");

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kimi-server-"));
  const upstreamRequests = [];
  const upstream = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      upstreamRequests.push({ url: req.url, headers: req.headers, body: JSON.parse(body) });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "<think>hidden</think>“测试标题”" } }] }));
    });
  });
  const upstreamPort = await listen(upstream);

  try {
    const configPath = path.join(tempDir, "server.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        endpoint: `http://127.0.0.1:${upstreamPort}/v1/chat/completions`,
        apiKey: "test-key",
        model: "test-model",
        systemPrompt: "generate title",
        port: 1,
        token: "test-token",
        host: "127.0.0.1",
      })
    );

    const sidecar = createServer({ configPath, logger: { warn() {} } });
    const port = await listen(sidecar);
    const base = `http://127.0.0.1:${port}`;

    // CORS 预检
    const preflight = await fetch(`${base}/generate`, {
      method: "OPTIONS",
      headers: { Origin: "http://127.0.0.1:58627", "Access-Control-Request-Method": "POST" },
    });
    assert.strictEqual(preflight.status, 204);
    assert.strictEqual(preflight.headers.get("access-control-allow-origin"), "*");
    console.log("✅ 1. CORS 预检通过");

    // 健康检查
    const health = await fetch(`${base}/health`);
    assert.strictEqual(health.status, 200);
    assert.strictEqual((await health.json()).model, "test-model");
    console.log("✅ 2. /health 通过");

    // 无令牌拒绝
    const denied = await fetch(`${base}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "hello" }),
    });
    assert.strictEqual(denied.status, 403);
    assert.strictEqual(upstreamRequests.length, 0);
    console.log("✅ 3. 令牌校验通过");

    // 正常生成
    const ok = await fetch(`${base}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Kimi-Renamer-Token": "test-token" },
      body: JSON.stringify({ prompt: "x".repeat(1000) }),
    });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual((await ok.json()).title, "测试标题");
    assert.strictEqual(upstreamRequests[0].headers.authorization, "Bearer test-key");
    assert.strictEqual(upstreamRequests[0].body.model, "test-model");
    assert.strictEqual(upstreamRequests[0].body.messages[1].content.length, 800);
    console.log("✅ 4. 生成标题、密钥透传与截断通过");

    // 参数校验
    const bad = await fetch(`${base}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Kimi-Renamer-Token": "test-token" },
      body: JSON.stringify({ prompt: 42 }),
    });
    assert.strictEqual(bad.status, 400);
    console.log("✅ 5. 参数校验通过");

    assert.strictEqual(stripTitle("<think>a</think>“标题”"), "标题");
    console.log("✅ 6. 标题清洗通过");

    sidecar.close();
    console.log("\n🎉 sidecar 测试全部通过！\n");
  } finally {
    upstream.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
