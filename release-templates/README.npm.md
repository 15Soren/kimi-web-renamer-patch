# Kimi Code Web 会话重命名补丁（npm 安装专用版）

本发行版面向通过 `npm` 安装的 `@moonshot-ai/kimi-code`（安装目录包含 `dist/main.mjs` 和 `dist-web/index.html`）。

为 Kimi Code Web 的会话标题栏添加无边框重命名图标，点击后直接通过同源服务端路由调用 `config.toml` 中配置的模型生成标题并写回，无需额外启动 sidecar 或守护进程。

> 如果你使用的是官方单文件二进制安装的 `kimi`（没有 `dist/main.mjs`），请下载 **standalone 单文件安装专用版**。

## 小白快速使用（Windows / Linux 通用）

1. 确保本机已安装 **Node.js 18+**（无需 `npm install`），并且已经配置好 Kimi Code 的 `config.toml`。
2. 解压本压缩包，打开终端（Windows 用 PowerShell / CMD）进入解压目录：

```bash
# 查看可用模型
node bin/cli.js models

# 一键应用补丁
node bin/cli.js patch
```

> 权限提示：如果提示 `EPERM` / `EACCES`，Windows 请**右键以管理员身份运行**终端，Linux 请在命令前加 `sudo`。

3. 如果 `kimi web` 正在运行，按 `Ctrl + C` 停止后重新运行 `kimi web`，刷新浏览器即可在会话标题栏看到重命名图标。

手动指定路径示例：

```bash
node bin/cli.js patch --path "/path/to/node_modules/@moonshot-ai/kimi-code" --config "/path/to/config.toml"
```

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `node bin/cli.js patch` | 解析模型配置并应用补丁（默认命令） |
| `node bin/cli.js models` | 列出 `config.toml` 中已配置的模型 |
| `node bin/cli.js set-model <ID>` | 更新 `rename_model` 并重新应用补丁 |
| `node bin/cli.js status` | 检查前端与同源代理路由状态 |
| `node bin/cli.js unpatch` | 还原原版文件并清理注入资源 |
| `--path <dir>` | 指定 `@moonshot-ai/kimi-code` 安装根目录 |
| `--config <file>` | 指定 `config.toml` 路径 |

## 凭证与安全边界

- 网页仅请求同源 `/api/v1/custom-renamer/generate`，模型端点与 API Key 固定在服务端 `dist/main.mjs`，不写入浏览器脚本。
- 支持 `type = "openai"`、`openai_legacy` 和 `kimi` 的 OpenAI Chat Completions 兼容供应商，支持 `api_key` 与 `api_key_env`。
- 修改前自动备份 `index.html.renamer.bak` 与 `main.mjs.renamer.bak`，使用独立 `kimi-renamer.ico`，不覆盖原版 `Kimi.ico`。
- 升级 Kimi Code 前建议先执行 `node bin/cli.js unpatch`，升级后再重新 `patch` 并重启 `kimi web`。

## 协议

代码采用 [MIT](LICENSE) 协议。
