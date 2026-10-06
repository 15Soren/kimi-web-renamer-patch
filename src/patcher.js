const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const {
  findKimiConfigPath,
  resolveRenameModelInfo,
  listAvailableModels,
  setRenameModelInConfig,
} = require("./kimi-config");

// 标记常量
const SCRIPT_INJECTION = '<script src="/kimi-renamer.js"></script>';
const CSP_SEARCH_PATTERN = 'CONTENT_SECURITY_POLICY = "default-src \'self\';';
const CSP_REPLACE_TARGET = 'CONTENT_SECURITY_POLICY = "default-src \'self\'; connect-src * \'self\' data: blob:;';
const ROUTE_HOOK_TARGET = 'registerConfigRoutes(apiV1, core);';
const BACKEND_ROUTE_MARKER = '/* __KIMI_RENAMER_PROXY_ROUTE__ */';
const BACKEND_ROUTE_END = '/* __KIMI_RENAMER_PROXY_ROUTE_END__ */';
const BACKEND_ROUTE_CODE = `
	/* __KIMI_RENAMER_PROXY_ROUTE__ */
	{
		const renameConfig = __SERVER_CONFIG_PLACEHOLDER__;
		apiV1.post("/custom-renamer/generate", async (req, reply) => {
			try {
				const { prompt } = req.body || {};
				if (typeof prompt !== "string" || !prompt.trim()) {
					return reply.code(400).send({ error: "prompt 必须为非空字符串" });
				}
				const { model, endpoint, apiKey, systemPrompt } = renameConfig;
				const authHeader = apiKey.startsWith("Bearer ") ? apiKey : \`Bearer \${apiKey}\`;
				const fetchRes = await fetch(endpoint, {
					method: "POST",
					redirect: "error",
					signal: AbortSignal.timeout(30000),
				headers: {
					"Content-Type": "application/json",
					...(authHeader ? { "Authorization": authHeader } : {})
				},
				body: JSON.stringify({
					model: model,
					messages: [
						{ role: "system", content: systemPrompt },
						{ role: "user", content: (prompt || "").slice(0, 800) }
					],
					temperature: 0.2,
					max_tokens: 80
				})
			});
			if (!fetchRes.ok) {
					return reply.code(502).send({ error: \`大模型接口响应异常 (\${fetchRes.status})\` });
			}
			const data = await fetchRes.json();
			let rawContent = data?.choices?.[0]?.message?.content || "";
			let title = rawContent.replace(/<think>[\\s\\S]*?<\\/think>/gi, "").trim();
			title = title.replace(/^[\\"'“‘《【\\s]+/, "").replace(/[\\"'”’》】\\s]+$/, "").replace(/[\\r\\n]+/g, "").trim();
			if (!title) return reply.code(500).send({ error: "大模型返回了空标题" });
			reply.send({ code: 0, title });
		} catch (err) {
				reply.code(502).send({ error: "模型请求失败，请检查服务端模型配置与网络" });
			}
		});
	}
	/* __KIMI_RENAMER_PROXY_ROUTE_END__ */`;

function removeBackendRoute(content) {
  const start = content.indexOf(BACKEND_ROUTE_MARKER);
  if (start === -1) return content;
  const endMarker = `\n\t${BACKEND_ROUTE_END}`;
  const end = content.indexOf(endMarker, start);
  if (end === -1) {
    throw new Error("检测到旧版或不完整的代理补丁，请先使用原版备份还原后重新应用");
  }
  return content.slice(0, start) + content.slice(end + endMarker.length);
}

/**
 * 跨平台智能查找 kimi-code 安装路径
 */
function findKimiCodePath(customPath) {
  // 1. 如果用户手动指定了路径
  if (customPath) {
    const resolved = path.resolve(customPath);
    if (isValidKimiDir(resolved)) return resolved;
    throw new Error(`指定的路径不是有效的 kimi-code 目录: ${resolved}`);
  }

  // 2. 尝试从 npm 全局根目录查找
  try {
    const npmGlobalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
    if (npmGlobalRoot) {
      const candidate = path.join(npmGlobalRoot, "@moonshot-ai", "kimi-code");
      if (isValidKimiDir(candidate)) return candidate;
    }
  } catch (e) {
    // 忽略并在后续方式中重试
  }

  // 3. 尝试通过 which / where kimi 定位
  try {
    const isWin = process.platform === "win32";
    const lookupCmd = isWin ? "where kimi" : "which kimi";
    const binPath = execSync(lookupCmd, { encoding: "utf8" }).split(/\r?\n/)[0].trim();
    if (binPath && fs.existsSync(binPath)) {
      // 在 Windows 下，可能是 node_global/kimi.cmd，其真实代码在 node_global/node_modules/@moonshot-ai/kimi-code
      const binDir = path.dirname(binPath);
      const candidate1 = path.join(binDir, "node_modules", "@moonshot-ai", "kimi-code");
      if (isValidKimiDir(candidate1)) return candidate1;

      // 如果是符号链接，解析其实际指向
      const realBin = fs.realpathSync(binPath);
      const candidate2 = path.resolve(path.dirname(realBin), "..");
      if (isValidKimiDir(candidate2)) return candidate2;
    }
  } catch (e) {
    // 忽略
  }

  // 4. 常见系统候选路径
  const homedir = require("os").homedir();
  const commonCandidates = [
    // Windows 常见位置
    path.join(process.env.APPDATA || "", "npm", "node_modules", "@moonshot-ai", "kimi-code"),
    "C:\\Program Files\\nodejs\\node_modules\\@moonshot-ai\\kimi-code",
    // macOS / Linux 常见位置
    "/usr/local/lib/node_modules/@moonshot-ai/kimi-code",
    "/usr/lib/node_modules/@moonshot-ai/kimi-code",
    path.join(homedir, ".nvm", "versions", "node", process.version, "lib", "node_modules", "@moonshot-ai", "kimi-code"),
  ];

  for (const candidate of commonCandidates) {
    if (candidate && isValidKimiDir(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * 校验指定目录是否包含 kimi-code 核心文件
 */
function isValidKimiDir(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) return false;
  const mainMjs = path.join(dirPath, "dist", "main.mjs");
  const indexHtml = path.join(dirPath, "dist-web", "index.html");
  return fs.existsSync(mainMjs) && fs.existsSync(indexHtml);
}

/**
 * 检查当前补丁状态
 */
function checkStatus(kimiDir) {
  const mainMjs = path.join(kimiDir, "dist", "main.mjs");
  const indexHtml = path.join(kimiDir, "dist-web", "index.html");
  const renamerJs = path.join(kimiDir, "dist-web", "kimi-renamer.js");
  const htmlBak = path.join(kimiDir, "dist-web", "index.html.renamer.bak");
  const mainBak = path.join(kimiDir, "dist", "main.mjs.renamer.bak");

  const isRenamerJsPresent = fs.existsSync(renamerJs);
  const htmlContent = fs.existsSync(indexHtml) ? fs.readFileSync(indexHtml, "utf8") : "";
  const isHtmlPatched = htmlContent.includes(SCRIPT_INJECTION);

  const mainContent = fs.existsSync(mainMjs) ? fs.readFileSync(mainMjs, "utf8") : "";
  const isCspPatched = mainContent.includes("connect-src * 'self'");
  const isProxyPatched = mainContent.includes(BACKEND_ROUTE_MARKER) && mainContent.includes(BACKEND_ROUTE_END);

  const hasBackup = fs.existsSync(htmlBak) && fs.existsSync(mainBak);

  return {
    isFullyPatched: isRenamerJsPresent && isHtmlPatched && isProxyPatched,
    isRenamerJsPresent,
    isHtmlPatched,
    isCspPatched,
    isProxyPatched,
    hasBackup,
  };
}

/**
 * 应用补丁
 */
function applyPatch(kimiDir, options = {}) {
  const distWebDir = path.join(kimiDir, "dist-web");
  const distDir = path.join(kimiDir, "dist");
  const indexHtml = path.join(distWebDir, "index.html");
  const mainMjs = path.join(distDir, "main.mjs");
  const renamerJs = path.join(distWebDir, "kimi-renamer.js");
  const htmlBak = path.join(distWebDir, "index.html.renamer.bak");
  const mainBak = path.join(distDir, "main.mjs.renamer.bak");

  // 确定模型配置：优先使用直接传入的 config，否则自动从 config.toml 解析
  let modelInfo;
  if (options && options.endpoint) {
    modelInfo = options;
  } else {
    const configPath = (options && options.configPath) || findKimiConfigPath();
    if (!configPath) {
      throw new Error("未能定位到系统的 Kimi Code 配置文件 (config.toml)");
    }
    modelInfo = resolveRenameModelInfo(configPath);
  }

  if (!isValidKimiDir(kimiDir)) throw new Error("目标目录缺少 Kimi Code Web 核心文件");
  const endpoint = new URL(modelInfo.endpoint);
  if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw new Error("模型 Endpoint 必须为不含账户信息的 HTTP(S) 地址");
  }
  if (typeof modelInfo.apiKey !== "string" || !modelInfo.apiKey.trim()) {
    throw new Error("重命名模型需要显式 api_key 或 api_key_env，不能使用 Web 会话凭证调用模型");
  }
  let htmlContent = fs.readFileSync(indexHtml, "utf8");
  let mainContent = fs.readFileSync(mainMjs, "utf8");
  if ((!fs.existsSync(htmlBak) && htmlContent.includes(SCRIPT_INJECTION)) ||
      (!fs.existsSync(mainBak) && mainContent.includes(BACKEND_ROUTE_MARKER))) {
    throw new Error("已安装补丁但缺少原版备份，请先 unpatch 再重新应用");
  }
  if (!htmlContent.includes(SCRIPT_INJECTION) && !htmlContent.includes("</head>")) {
    throw new Error("不兼容的 index.html：缺少脚本注入位置");
  }
  if (!mainContent.includes(ROUTE_HOOK_TARGET)) {
    throw new Error("不兼容的 Kimi Code 版本：未找到后端路由注入位置");
  }
  mainContent = removeBackendRoute(mainContent).replace(CSP_REPLACE_TARGET, CSP_SEARCH_PATTERN);
  const serverConfig = JSON.stringify({
    endpoint: endpoint.href,
    apiKey: modelInfo.apiKey,
    model: modelInfo.actualModel || modelInfo.model,
    systemPrompt: modelInfo.systemPrompt,
  });
  const routeCode = BACKEND_ROUTE_CODE.replace("__SERVER_CONFIG_PLACEHOLDER__", () => serverConfig);
  const patchedMain = mainContent.replace(ROUTE_HOOK_TARGET, () => `${ROUTE_HOOK_TARGET}\n${routeCode}`);

  // 1. 生成并写入 dist-web/kimi-renamer.js
  const templatePath = path.join(__dirname, "template", "kimi-renamer.js");
  const templateContent = fs.readFileSync(templatePath, "utf8");
  const finalScriptContent = templateContent.replace(
    "__CONFIG_PLACEHOLDER__",
    () => JSON.stringify(
      {
        model: modelInfo.actualModel || modelInfo.model,
        systemPrompt: modelInfo.systemPrompt,
        temperature: modelInfo.temperature ?? 0.2,
        maxTokens: modelInfo.maxTokens ?? 80,
      },
      null,
      2
    )
  );
  if (!fs.existsSync(htmlBak) || (!htmlContent.includes(SCRIPT_INJECTION) && fs.readFileSync(htmlBak, "utf8") !== htmlContent)) {
    fs.writeFileSync(htmlBak, htmlContent, "utf8");
  }
  const originalMain = fs.readFileSync(mainMjs, "utf8");
  if (!fs.existsSync(mainBak) || (!originalMain.includes(BACKEND_ROUTE_MARKER) && fs.readFileSync(mainBak, "utf8") !== originalMain)) {
    fs.writeFileSync(mainBak, originalMain, "utf8");
  }
  fs.writeFileSync(renamerJs, finalScriptContent, "utf8");

  // 复制 Kimi.ico 图标到 dist-web
  const iconSource = path.join(__dirname, "assets", "Kimi.ico");
  const iconTarget = path.join(distWebDir, "kimi-renamer.ico");
  if (fs.existsSync(iconSource)) {
    fs.copyFileSync(iconSource, iconTarget);
  }

  // 2. 备份与修改 dist-web/index.html
  if (!htmlContent.includes(SCRIPT_INJECTION)) {
    // 注入在 <script src="/boot.js"></script> 之后
    if (htmlContent.includes('<script src="/boot.js"></script>')) {
      htmlContent = htmlContent.replace(
        '<script src="/boot.js"></script>',
        `<script src="/boot.js"></script>\n    ${SCRIPT_INJECTION}`
      );
    } else {
      // 回退：注入在 </head> 之前
      htmlContent = htmlContent.replace("</head>", `  ${SCRIPT_INJECTION}\n  </head>`);
    }
    fs.writeFileSync(indexHtml, htmlContent, "utf8");
  }

  // 3. 备份与修改 dist/main.mjs (保留 CSP 并注入固定目标代理路由)
  fs.writeFileSync(mainMjs, patchedMain, "utf8");

  return { success: true, modelInfo };
}

/**
 * 还原官方原版
 */
function restorePatch(kimiDir) {
  const distWebDir = path.join(kimiDir, "dist-web");
  const distDir = path.join(kimiDir, "dist");
  const indexHtml = path.join(distWebDir, "index.html");
  const mainMjs = path.join(distDir, "main.mjs");
  const renamerJs = path.join(distWebDir, "kimi-renamer.js");
  const renamerIco = path.join(distWebDir, "kimi-renamer.ico");
  const htmlBak = path.join(distWebDir, "index.html.renamer.bak");
  const mainBak = path.join(distDir, "main.mjs.renamer.bak");

  let restoredAny = false;

  if (!fs.existsSync(mainBak) && fs.existsSync(mainMjs)) {
    removeBackendRoute(fs.readFileSync(mainMjs, "utf8"));
  }

  // 1. 还原 index.html
  if (fs.existsSync(htmlBak)) {
    fs.copyFileSync(htmlBak, indexHtml);
    fs.unlinkSync(htmlBak);
    restoredAny = true;
  } else {
    // 若没有备份，尝试手动移除脚本标签
    if (fs.existsSync(indexHtml)) {
      let content = fs.readFileSync(indexHtml, "utf8");
      if (content.includes(SCRIPT_INJECTION)) {
        content = content.replace(SCRIPT_INJECTION, "");
        fs.writeFileSync(indexHtml, content, "utf8");
        restoredAny = true;
      }
    }
  }

  // 2. 还原 main.mjs
  if (fs.existsSync(mainBak)) {
    fs.copyFileSync(mainBak, mainMjs);
    fs.unlinkSync(mainBak);
    restoredAny = true;
  } else {
    // 若没有备份，尝试手动还原 CSP
    if (fs.existsSync(mainMjs)) {
      let content = fs.readFileSync(mainMjs, "utf8");
      if (content.includes(CSP_REPLACE_TARGET)) {
        content = content.replace(CSP_REPLACE_TARGET, CSP_SEARCH_PATTERN);
        restoredAny = true;
      }
      if (content.includes(BACKEND_ROUTE_MARKER)) {
        content = removeBackendRoute(content);
        restoredAny = true;
      }
      fs.writeFileSync(mainMjs, content, "utf8");
    }
  }

  // 3. 删除注入的静态资源
  if (fs.existsSync(renamerJs)) {
    fs.unlinkSync(renamerJs);
    restoredAny = true;
  }
  if (fs.existsSync(renamerIco)) {
    fs.unlinkSync(renamerIco);
    restoredAny = true;
  }

  return restoredAny;
}

module.exports = {
  findKimiCodePath,
  isValidKimiDir,
  checkStatus,
  applyPatch,
  restorePatch,
  findKimiConfigPath,
  resolveRenameModelInfo,
  listAvailableModels,
  setRenameModelInConfig,
};
