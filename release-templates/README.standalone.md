# Kimi Code Web 会话重命名补丁（单文件版）

适用于官方单文件二进制安装的 `kimi`（安装目录不含 `dist/main.mjs`，网页静态资源缓存在本地 `dist-web` 目录）。

> 如果使用的是 `npm` 安装的 `@moonshot-ai/kimi-code`，请使用更轻量的 **npm 版**（无需 sidecar 与守护进程）。

## 使用方法

需要本机已安装 **Node.js 18+**（无需 `npm install`），且至少运行过一次 `kimi web`。

解压后打开终端进入目录，先应用补丁：

```bash
node bin/cli.js models
node bin/cli.js patch
```

因为单文件版 `kimi web` 每次启动都会校验并还原 `index.html`，需要配合守护进程或启动脚本使用：

### Windows

- **后台守护（推荐）**：运行 `bin\install-daemon.cmd`，会自动加入开机自启并在后台静默运行，之后直接运行 `kimi web` 即可。卸载运行 `bin\uninstall-daemon.cmd`。
- **手动启动**：用 `bin\kimi-web-renamer.cmd` 代替 `kimi web`，退出时自动关闭 sidecar。

### Linux / macOS / WSL

- **systemd 守护（推荐）**：运行 `./bin/install-daemon` 注册用户级后台服务，之后直接运行 `kimi web` 即可（日志位于 `~/.kimi-code/kimi-renamer/daemon.log`）。卸载运行 `./bin/uninstall-daemon`。
- **手动启动（或无 systemd 环境）**：用 `./bin/kimi-web-renamer` 代替 `kimi web`，退出时自动关闭 sidecar。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `node bin/cli.js patch` | 解析模型配置、注入前端并写入 `server.json` |
| `node bin/cli.js serve` | 前台手动启动本地 sidecar 模型代理 |
| `node bin/cli.js models` | 列出 `config.toml` 中已配置的模型 |
| `node bin/cli.js set-model <ID>` | 更新 `rename_model` 并重新应用补丁 |
| `node bin/cli.js status` | 检查前端、sidecar 配置与运行状态 |
| `node bin/cli.js unpatch` | 还原 `index.html` 并删除注入脚本与 `server.json` |
| `--path <dir>` | 手动指定 `dist-web` 目录或其上级缓存目录 |
| `--config <file>` | 手动指定 `config.toml` 路径 |
| `--port <port>` | 指定 sidecar 监听端口（默认 `58629`） |

## 安全说明

- 模型端点和 API Key 只保存在 `~/.kimi-code/kimi-renamer/server.json`，不会写入浏览器脚本。
- sidecar 默认监听 `0.0.0.0:58629`（方便 Windows 浏览器访问 WSL 服务），`/generate` 接口均校验 `X-Kimi-Renamer-Token`。如仅本机访问，可将 `server.json` 中的 `host` 改为 `127.0.0.1`。

## 协议

代码采用 [MIT](LICENSE) 协议。
