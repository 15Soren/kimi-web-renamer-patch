# Kimi Code Web 会话重命名补丁（单文件安装专用版）

本发行版面向官方单文件二进制安装的 `kimi`（例如 `~/.kimi-code/bin/kimi` 或 `kimi.exe`，安装目录没有 `dist/main.mjs`，静态资源缓存在 `~/.cache/kimi-code/web/.../dist-web/`）。

> 如果你使用的是 `npm` 安装的 `@moonshot-ai/kimi-code`，请下载更轻量的 **npm 安装专用版**（直接注入同源代理路由，无需 sidecar 与守护进程）。

## 为什么需要 sidecar / 守护进程？

单文件二进制 `kimi web` **每次启动**都会校验缓存目录里的 `index.html`，发现被修改会自动还原。因此需要守护进程在后台即时重注入，并由本地 sidecar 代理模型请求（API Key 不写入网页脚本）。

## 小白快速使用

前提：本机已安装 **Node.js 18+**（无需 `npm install`），且至少运行过一次 `kimi web`。

解压后打开终端进入目录，先打一次补丁：

```bash
node bin/cli.js models
node bin/cli.js patch
```

### Windows 用户

打完补丁后，任选一种方式：

1. **推荐（开机静默守护，一劳永逸）**：
   ```cmd
   bin\install-daemon.cmd
   ```
   会在后台静默启动守护进程并加入开机自启，之后平时直接运行 `kimi web` 即可（卸载用 `bin\uninstall-daemon.cmd`）。
2. **临时启动（不装开机自启）**：
   ```cmd
   bin\kimi-web-renamer.cmd
   ```
   用它代替 `kimi web` 启动，自动拉起 sidecar 并在退出时清理。

### Linux / WSL 用户

打完补丁后，任选一种方式：

1. **推荐（systemd 用户服务，一劳永逸）**：
   ```bash
   ./bin/install-daemon     # 安装并启动（卸载用 ./bin/uninstall-daemon）
   ```
   安装后平时直接运行 `kimi web` 即可，日志位于 `~/.kimi-code/kimi-renamer/daemon.log`。
2. **临时启动（或无 systemd 环境）**：
   ```bash
   ./bin/kimi-web-renamer
   ```
   自动启动 sidecar 并运行 `kimi web`，退出时一并清理 sidecar。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `node bin/cli.js patch` | 解析模型配置、注入前端并写入 `server.json` |
| `node bin/cli.js serve` | 前台手动启动本地 sidecar 模型代理 |
| `node bin/cli.js models` | 列出 `config.toml` 中已配置的模型 |
| `node bin/cli.js set-model <ID>` | 更新 `rename_model` 并重新应用补丁 |
| `node bin/cli.js status` | 检查前端、sidecar 配置与运行状态 |
| `node bin/cli.js unpatch` | 还原 `index.html` 并删除注入脚本与 `server.json` |
| `--path <dir>` | 手动指定 `dist-web` 目录或安装根目录 |
| `--config <file>` | 手动指定 `config.toml` 路径 |
| `--port <port>` | 指定 sidecar 监听端口（默认 `58629`） |

## 凭证与安全边界

- 模型端点和 API Key 只保存在 `~/.kimi-code/kimi-renamer/server.json`，不会写入浏览器脚本。
- sidecar 默认监听 `0.0.0.0:58629`（便于 Windows 浏览器访问 WSL 服务），所有 `/generate` 请求均校验 `X-Kimi-Renamer-Token`。如仅本机访问，可将 `server.json` 中 `host` 改为 `127.0.0.1`。
- 支持 `type = "openai"`、`openai_legacy` 和 `kimi` 的 OpenAI Chat Completions 兼容供应商，默认 `max_tokens = 1024` 以兼容推理模型。

## 协议

代码采用 [MIT](LICENSE) 协议。
