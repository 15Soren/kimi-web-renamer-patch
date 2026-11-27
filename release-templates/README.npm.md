# Kimi Code Web 会话重命名补丁（npm 安装专用版）

本发行版面向通过 `npm` 安装的 `@moonshot-ai/kimi-code`（安装目录包含 `dist/main.mjs` 和 `dist-web/index.html`）。

为 Kimi Code Web 的会话标题栏添加无边框重命名图标，点击后通过同源服务端代理路由调用 `config.toml` 中配置的模型生成标题并写回，无需额外启动 sidecar 或守护进程。

> 如果你使用的是官方单文件二进制安装的 `kimi`（例如 `~/.kimi-code/bin/kimi`，没有 `dist/main.mjs`），请下载 **standalone 单文件安装专用版**。

## 快速使用

没有第三方运行依赖，无需 `npm install`（需要 Node.js 18+）：

```bash
node bin/cli.js models
node bin/cli.js patch
```

应用后重启 `kimi web`，刷新页面，在会话标题栏点击重命名图标即可。

手动指定路径：

```bash
node bin/cli.js patch --path "/path/to/node_modules/@moonshot-ai/kimi-code" --config "/path/to/config.toml"
```

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `patch`（默认） | 解析模型配置并应用补丁 |
| `models` / `list-models` | 列出 `config.toml` 中已配置的模型 |
| `set-model <ID>` | 更新 `rename_model` 并重新应用补丁 |
| `status` | 检查前端与同源代理路由状态 |
| `unpatch` / `restore` | 还原原版文件并清理注入资源 |
| `--path <dir>` | 指定 `@moonshot-ai/kimi-code` 安装根目录 |
| `--config <file>` | 指定 `config.toml` 路径 |

## 凭证与安全边界

- 网页仅向同源 `/api/v1/custom-renamer/generate` 发送消息，模型端点与 API Key 固定在服务端 `dist/main.mjs`，不写入浏览器脚本。
- 支持 `type = "openai"`、`openai_legacy` 和 `kimi` 的 OpenAI Chat Completions 兼容供应商，支持 `api_key` 与 `api_key_env`。
- 修改前自动备份 `index.html.renamer.bak` 与 `main.mjs.renamer.bak`，使用独立 `kimi-renamer.ico`，不覆盖原版 `Kimi.ico`。
- 升级 Kimi Code 前建议先执行 `node bin/cli.js unpatch`，升级后再重新 `patch` 并重启 `kimi web`。

## 协议

代码采用 [MIT](LICENSE) 协议。
