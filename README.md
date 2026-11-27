# Kimi Code Web 会话重命名补丁

为 Kimi Code Web 的会话标题栏添加无边框重命名图标，点击后根据会话首条消息生成标题并写回。直接复用 `config.toml` 中的模型与供应商配置，默认选择 `default_model`，也可以指定 `rename_model`。

本项目同时适配 **npm 安装** 与 **单文件二进制安装** 两种 Kimi Code 形态，并支持一键构建两套独立的 Release 发行包：

| 发行版 | 适用安装形态 | 后端代理方式 | 额外常驻进程 |
| --- | --- | --- | --- |
| `kimi-web-renamer-patch-npm` | `npm` 安装（含 `dist/main.mjs` + `dist-web/`） | 注入同源代理路由 `/api/v1/custom-renamer/generate` | 无需（重启 `kimi web` 即生效） |
| `kimi-web-renamer-patch-standalone` | 单文件二进制安装（`~/.kimi-code/bin/kimi`，静态资源缓存在 `~/.cache/kimi-code/web/.../dist-web/`） | 本地 Sidecar (`src/standalone/server.js`) + 随机令牌 | 需要 Sidecar 或守护进程 (`src/standalone/daemon.js`) |

> 这是第三方补丁工具，与 Moonshot AI 无关联。修改的是本机安装/缓存文件，升级 Kimi Code 后需按对应模式重新应用或由守护进程自动重注入。

## 项目结构

```text
├── bin/
│   ├── cli.js                    # 统一 CLI（支持 --mode auto|npm|standalone 与 serve）
│   ├── kimi-web-renamer          # 单文件模式包装脚本：拉起 sidecar 并运行 kimi web
│   ├── install-daemon            # 单文件模式 systemd 用户守护进程安装脚本
│   └── uninstall-daemon          # 单文件模式守护进程卸载脚本
├── src/
│   ├── assets/Kimi.ico           # 共享图标（写入为 kimi-renamer.ico，不覆盖原图标）
│   ├── template/kimi-renamer.js  # 统一前端注入脚本（无边框按钮 + 自动适配 proxy / sidecar）
│   ├── kimi-config.js            # 共享 config.toml 解析与模型配置解析
│   ├── paths.js                  # 共享路径与缓存目录定位
│   ├── release-meta.js           # 发行版模式元数据（开发仓库为 unified/auto，构建时按发行版写入）
│   ├── patcher.js                # 统一门面与模式自动探测
│   ├── modes/
│   │   ├── npm.js                # npm 模式补丁实现（dist/main.mjs + dist-web/）
│   │   └── standalone.js         # 单文件模式补丁实现（dist-web/ + server.json）
│   └── standalone/
│       ├── server.js             # 本地 sidecar HTTP 代理服务
│       └── daemon.js             # 缓存目录监听与 sidecar 保活守护进程
├── release-templates/
│   ├── README.npm.md             # npm 发行版专用 README
│   └── README.standalone.md      # 单文件发行版专用 README
├── scripts/
│   └── build-releases.js         # 双发行版构建与打包脚本
└── test/                         # 覆盖 npm、standalone、sidecar、config、observer 与双发行版冒烟测试
```

## 快速使用（源码仓库双模式）

没有第三方运行依赖，无需 `npm install`（需要 Node.js 18+）：

```bash
node bin/cli.js models
node bin/cli.js patch
```

CLI 默认采用 `--mode auto` 自动识别当前环境的安装形态（优先识别 npm 安装，未找到时自动回退到单文件缓存目录），也可以显式指定：

```bash
# 显式使用 npm 模式
node bin/cli.js patch --mode npm --path "/path/to/node_modules/@moonshot-ai/kimi-code"

# 显式使用单文件模式
node bin/cli.js patch --mode standalone --path "$HOME/.cache/kimi-code/web/<版本>/<平台>/<hash>/dist-web"
```

### 单文件模式运行说明

单文件二进制 `kimi web` **每次启动**都会按内置 manifest 校验缓存中的静态文件，SHA-256 不匹配时会还原 `index.html`（`kimi-renamer.js`、`kimi-renamer.ico` 不在 manifest 中，会被保留）。因此提供两种使用方式：

1. **安装常驻守护进程（推荐，Linux / WSL）**：监听 `~/.cache/kimi-code/web` 并在 `index.html` 被还原时立即重新注入，同时保活 sidecar：
   ```bash
   ./bin/install-daemon     # 安装并启动 systemd 用户服务
   ./bin/uninstall-daemon   # 停止并移除
   ```
   安装后平时直接运行 `kimi web` 即可，日志位于 `~/.kimi-code/kimi-renamer/daemon.log`。

2. **手动/包装脚本运行**：
   ```bash
   node bin/cli.js serve    # 前台启动 sidecar
   # 或使用包装脚本同时拉起 sidecar 与 kimi web，退出时自动清理：
   ./bin/kimi-web-renamer
   ```

## 构建双形态 Release

运行以下命令即可在 `dist/releases/` 下生成两个完全独立、零冗余的发行包：

```bash
npm run build:release          # 生成目录 dist/releases/kimi-web-renamer-patch-{npm,standalone}
npm run build:release:archive  # 额外生成 .tar.gz / .zip 压缩包
```

推送 `v*` 标签时，`.github/workflows/release.yml` 会自动执行完整测试并构建上传两个版本的 Release 压缩包。

## 模型配置

默认查找 `~/.kimi-code/config.toml`、`~/.kimi/config.toml` 和 `~/.config/kimi-code/config.toml`（可用 `--config` 指定）。支持 `type = "openai"`、`openai_legacy` 和 `kimi` 的 OpenAI Chat Completions 兼容供应商：

```toml
default_model = "Example/chat-model"
rename_model = "Example/title-model"

[models."Example/chat-model"]
provider = "Example"
model = "chat-model"

[models."Example/title-model"]
provider = "Example"
model = "title-model"

[providers.Example]
type = "openai"
base_url = "https://model.example/v1"
api_key_env = "EXAMPLE_MODEL_API_KEY"
```

切换重命名模型：

```bash
node bin/cli.js set-model "Example/title-model"
```

## 命令一览

| 命令 | 用途 |
| --- | --- |
| `patch`（默认） | 解析模型配置并应用补丁 |
| `serve` | 前台启动本地 sidecar 模型代理（仅单文件模式） |
| `models` / `list-models` | 列出 `config.toml` 中的模型 |
| `set-model <ID>` | 更新 `rename_model` 并重新应用补丁 |
| `status` | 检查补丁及（单文件模式下）sidecar 状态 |
| `unpatch` / `restore` | 还原原版文件并删除补丁资源 |
| `--mode <auto\|npm\|standalone>` | 指定运行模式（双模式仓库可用） |
| `--path <dir>` | 指定安装根目录或 `dist-web` 目录 |
| `--config <file>` | 指定 `config.toml` 路径 |
| `--port <port>` | 指定 sidecar 端口（默认 `58629`，仅单文件模式） |

## 凭证与安全边界

- **npm 模式**：网页仅请求同源 `/api/v1/custom-renamer/generate`，模型端点与 API Key 固定写入 `dist/main.mjs`，不暴露到前端脚本，保留原有 CSP。
- **单文件模式**：模型端点与 API Key 仅保存在 `~/.kimi-code/kimi-renamer/server.json`（`0660`），前端脚本仅持有随机令牌 `X-Kimi-Renamer-Token`。
- 两种模式均禁止跟随重定向、超时 30 秒、默认 `max_tokens = 1024`（适配推理模型），自动剥离 `<think>...</think>` 与首尾标点。

## 验证

```bash
npm test
```

测试使用独立临时目录和模拟上游服务，覆盖配置解析、npm 模式、单文件模式、sidecar 服务、DOM 监听回归，以及双形态 Release 构建产物的功能冒烟验证。

## 鸣谢

https://linux.do

## 协议

代码采用 [MIT](LICENSE) 协议。Kimi 名称与图标涉及其各自权利方，本项目的代码许可不授予第三方商标权。
