# Kimi Code Web 会话重命名补丁（npm 版）

适用于通过 `npm` 安装的 `@moonshot-ai/kimi-code`（安装目录包含 `dist/main.mjs` 与 `dist-web/index.html`）。

在会话标题栏添加无边框重命名按钮，点击后通过同源服务端路由调用 `config.toml` 中配置的模型生成标题并写回。

## 使用方法

需要本机已安装 **Node.js 18+**（无需 `npm install`），且已配好 Kimi Code 的 `config.toml`。

解压后在终端（Windows 使用 PowerShell 或 CMD）进入目录：

```bash
# 查看可用模型
node bin/cli.js models

# 应用补丁
node bin/cli.js patch
```

> 遇到 `EPERM` / `EACCES` 权限错误时，Windows 请以管理员身份运行终端，Linux/macOS 请在命令前加 `sudo`。

补丁完成后，按 `Ctrl + C` 停止正在运行的 `kimi web` 并重新启动，刷新浏览器即可。

如需手动指定路径：

```bash
node bin/cli.js patch --path "/path/to/node_modules/@moonshot-ai/kimi-code" --config "/path/to/config.toml"
```

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `node bin/cli.js patch` | 解析模型配置并应用补丁（默认命令） |
| `node bin/cli.js models` | 列出 `config.toml` 中已配置的模型 |
| `node bin/cli.js set-model <ID>` | 更新 `rename_model` 并重新应用补丁 |
| `node bin/cli.js status` | 检查前端与同源代理路由状态 |
| `node bin/cli.js unpatch` | 还原原版文件并清理注入资源 |
| `--path <dir>` | 指定 `@moonshot-ai/kimi-code` 安装根目录 |
| `--config <file>` | 指定 `config.toml` 路径 |

## 安全说明

- 网页仅请求同源 `/api/v1/custom-renamer/generate`，模型端点与 API Key 固定在服务端 `dist/main.mjs`，不写入浏览器脚本。
- 支持 `openai`、`openai_legacy`、`kimi` 等 OpenAI Chat Completions 兼容供应商，支持 `api_key` 与 `api_key_env`。
- 修改前会自动备份 `index.html.renamer.bak` 与 `main.mjs.renamer.bak`，升级 Kimi Code 前建议先执行 `unpatch`。

## 协议

代码采用 [MIT](LICENSE) 协议。
