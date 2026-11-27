# Kimi Code Web 会话重命名补丁（单文件安装专用版）

本发行版面向单文件二进制安装的 `kimi`（例如 `~/.kimi-code/bin/kimi`，安装目录没有 `dist/main.mjs`，静态资源缓存在 `~/.cache/kimi-code/web/<版本>/<平台>/<hash>/dist-web/`）。

> 如果你使用的是 `npm` 安装的 `@moonshot-ai/kimi-code`，请下载更轻量的 **npm 安装专用版**（直接注入同源代理路由，无需 sidecar 与守护进程）。

## 工作原理

- **前端注入**：将 `kimi-renamer.js`、`kimi-renamer.ico` 写入 `dist-web/`，并在 `index.html` 中注入 `<script src="/kimi-renamer.js"></script>`。
- **本地 Sidecar (`src/standalone/server.js`)**：读取 `~/.kimi-code/kimi-renamer/server.json`（权限 `0660`）代理请求模型；浏览器脚本仅携带随机访问令牌 `X-Kimi-Renamer-Token`，不包含模型端点与 API Key。
- **守护进程 (`src/standalone/daemon.js`)**：`kimi web` 每次启动会按内置 manifest 校验并还原 `index.html`，守护进程常驻监听缓存目录并在被还原时立即重新注入，同时保活 sidecar。

## 快速使用

没有第三方运行依赖，无需 `npm install`（需要 Node.js 18+）：

```bash
node bin/cli.js models
node bin/cli.js patch
node bin/cli.js serve
```

### 方式一：安装常驻守护进程（推荐，Linux / WSL）

```bash
./bin/install-daemon     # 安装并启动 systemd 用户服务（自动重注入 + 保活 sidecar）
./bin/uninstall-daemon   # 停止并移除
```

安装后平时直接运行 `kimi web` 即可，日志位于 `~/.kimi-code/kimi-renamer/daemon.log`。

无 systemd 环境可在 shell 启动脚本中加入：

```bash
pgrep -f src/standalone/daemon.js >/dev/null || \
  nohup node "/path/to/kimi-web-renamer-patch-standalone/src/standalone/daemon.js" >/dev/null 2>&1 &
```

### 方式二：使用包装脚本临时拉起

```bash
ln -s "$PWD/bin/kimi-web-renamer" ~/.local/bin/kimi-web-renamer
kimi-web-renamer
```

会自动启动 sidecar 并运行 `kimi web`，退出时一并清理 sidecar。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `patch`（默认） | 解析模型配置、注入前端并写入 `server.json` |
| `serve` | 前台启动本地 sidecar 模型代理 |
| `models` / `list-models` | 列出 `config.toml` 中已配置的模型 |
| `set-model <ID>` | 更新 `rename_model` 并重新应用补丁 |
| `status` | 检查前端、sidecar 配置与运行状态 |
| `unpatch` / `restore` | 还原 `index.html` 并删除注入脚本与 `server.json` |
| `--path <dir>` | 手动指定 `dist-web` 目录或安装根目录 |
| `--config <file>` | 手动指定 `config.toml` 路径 |
| `--port <port>` | 指定 sidecar 监听端口（默认 `58629`） |

## 凭证与安全边界

- 模型端点和 API Key 只保存在 `~/.kimi-code/kimi-renamer/server.json`，不会写入浏览器脚本。
- sidecar 默认监听 `0.0.0.0:58629`（便于 Windows 浏览器访问 WSL 服务），所有 `/generate` 请求均校验 `X-Kimi-Renamer-Token`。如仅本机访问，可将 `server.json` 中 `host` 改为 `127.0.0.1`。
- 支持 `type = "openai"`、`openai_legacy` 和 `kimi` 的 OpenAI Chat Completions 兼容供应商，默认 `max_tokens = 1024` 以兼容推理模型。

## 协议

代码采用 [MIT](LICENSE) 协议。
