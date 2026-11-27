const fs = require("fs");
const http = require("http");
const crypto = require("crypto");
const path = require("path");
const { serverConfigPath, sidecarPidPath } = require("../paths");
const { stripTitle } = require("../kimi-config");

const DEFAULT_SERVER_CONFIG = serverConfigPath();
const MAX_BODY_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 30000;

function loadServerConfig(configPath = serverConfigPath()) {
  let raw;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch (e) {
    throw new Error(`找不到 sidecar 配置: ${configPath}，请先运行 patch`);
  }
  let config;
  try {
    config = JSON.parse(raw);
  } catch (e) {
    throw new Error(`sidecar 配置不是合法 JSON: ${configPath}`);
  }
  for (const key of ["endpoint", "apiKey", "model", "token"]) {
    if (!config[key] || typeof config[key] !== "string") {
      throw new Error(`sidecar 配置缺少字段: ${key}`);
    }
  }
  config.port = Number(config.port) || 58629;
  config.host = config.host || "0.0.0.0";
  return config;
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Kimi-Renamer-Token");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.setHeader("Access-Control-Max-Age", "600");
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function tokenMatches(expected, actual) {
  if (typeof actual !== "string") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function generateTitle(config, prompt) {
  const authHeader = config.apiKey.startsWith("Bearer ") ? config.apiKey : `Bearer ${config.apiKey}`;
  const response = await fetch(config.endpoint, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: config.systemPrompt || "" },
        { role: "user", content: String(prompt).slice(0, 800) },
      ],
      temperature: typeof config.temperature === "number" ? config.temperature : 0.2,
      max_tokens: typeof config.maxTokens === "number" ? config.maxTokens : 1024,
    }),
  });

  if (!response.ok) {
    const err = new Error(`大模型接口响应异常 (${response.status})`);
    err.status = 502;
    throw err;
  }

  const data = await response.json();
  const message = data && data.choices && data.choices[0] && data.choices[0].message;
  const content = message ? message.content : "";
  const title = stripTitle(Array.isArray(content) ? content.map((p) => p.text || "").join("") : content);
  if (!title) {
    const err = new Error("大模型返回了空标题");
    err.status = 502;
    throw err;
  }
  return title;
}

function createServer(options = {}) {
  const getConfigPath = () => options.configPath || serverConfigPath();
  const logger = options.logger || console;

  return http.createServer(async (req, res) => {
    setCors(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Cache-Control": "no-store" });
      res.end();
      return;
    }

    let config;
    try {
      config = loadServerConfig(getConfigPath());
    } catch (e) {
      sendJson(res, 500, { error: e.message });
      return;
    }

    let url;
    try {
      url = new URL(req.url || "/", "http://localhost");
    } catch (e) {
      sendJson(res, 400, { error: "无效的请求地址" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true, model: config.model, port: config.port });
      return;
    }

    if (req.method !== "POST" || url.pathname !== "/generate") {
      sendJson(res, 404, { error: "not found" });
      return;
    }

    if (!tokenMatches(config.token, req.headers["x-kimi-renamer-token"])) {
      sendJson(res, 403, { error: "无效的访问令牌" });
      return;
    }

    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      sendJson(res, 413, { error: e.message });
      return;
    }

    let prompt;
    try {
      prompt = JSON.parse(body || "{}").prompt;
    } catch (e) {
      sendJson(res, 400, { error: "请求体不是合法 JSON" });
      return;
    }
    if (typeof prompt !== "string" || !prompt.trim()) {
      sendJson(res, 400, { error: "prompt 必须为非空字符串" });
      return;
    }

    try {
      const title = await generateTitle(config, prompt.trim());
      sendJson(res, 200, { title });
    } catch (e) {
      logger.warn(`[kimi-renamer] 生成标题失败: ${e.message}`);
      sendJson(res, e.status || 502, { error: e.message });
    }
  });
}

function startServer(options = {}) {
  const configPath = options.configPath || serverConfigPath();
  const config = loadServerConfig(configPath);
  const host = options.host || config.host;
  const rawPort =
    options.port !== undefined && options.port !== null
      ? options.port
      : process.env.KIMI_RENAMER_PORT || config.port;
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return Promise.reject(new Error(`无效的 sidecar 端口: ${rawPort}`));
  }
  const server = createServer({ configPath, logger: options.logger });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve({ server, host, port, config });
    });
  });
}

function appendSidecarLog(message) {
  const logFile = process.env.KIMI_RENAMER_LOG_FILE;
  if (!logFile) return;
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] [sidecar] ${message}\n`, "utf8");
  } catch (e) {
    // 忽略日志写入失败
  }
}

function writeSidecarPid(pidFile = sidecarPidPath()) {
  try {
    fs.mkdirSync(path.dirname(pidFile), { recursive: true });
    fs.writeFileSync(
      pidFile,
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + "\n",
      "utf8"
    );
  } catch (e) {
    // 忽略 PID 写入失败
  }
}

function removeSidecarPid(pidFile = sidecarPidPath()) {
  try {
    const raw = fs.readFileSync(pidFile, "utf8").trim();
    const parsed = raw.startsWith("{") ? JSON.parse(raw) : { pid: Number(raw) };
    if (parsed && Number(parsed.pid) === process.pid) {
      fs.unlinkSync(pidFile);
    }
  } catch (e) {
    // 忽略 PID 清理失败
  }
}

module.exports = {
  DEFAULT_SERVER_CONFIG,
  loadServerConfig,
  stripTitle,
  generateTitle,
  createServer,
  startServer,
};

if (require.main === module) {
  startServer()
    .then(({ server, host, port, config }) => {
      writeSidecarPid();
      const shownHost = host === "0.0.0.0" ? "127.0.0.1" : host;
      console.log(`[kimi-renamer] sidecar 已启动: http://${shownHost}:${port}/`);
      console.log(`[kimi-renamer] 模型: ${config.model}`);
      const shutdown = () => {
        removeSidecarPid();
        if (typeof server.closeAllConnections === "function") {
          server.closeAllConnections();
        }
        server.close(() => process.exit(0));
      };
      process.on("exit", () => removeSidecarPid());
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    })
    .catch((err) => {
      const msg = err && err.message ? err.message : String(err);
      appendSidecarLog(`启动失败: ${msg}`);
      console.error(`[kimi-renamer] 启动失败: ${msg}`);
      process.exit(1);
    });
}
