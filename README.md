# Kimi Code Web 会话重命名补丁

在 Kimi Code Web 的会话标题栏添加一个无边框重命名按钮，点击后根据对话的第一条消息自动生成标题并写回。工具直接读取本机 `config.toml` 中的模型和 API Key，无需额外配置，也无需安装任何第三方依赖。

适用于通过 `npm` 安装的 Kimi Code（安装目录包含 `dist/main.mjs` 与 `dist-web/index.html`）。

> 本项目为第三方补丁，与 Moonshot AI 无关。补丁修改的是本机 npm 安装文件，升级 Kimi Code 后重新执行一次 `patch` 即可。

## 使用前准备

1. 已安装 **Node.js 18+**（在终端执行 `node -v` 可查看版本）。
2. 已通过 npm 安装 Kimi Code，配好了 `config.toml`，并且至少运行过一次 `kimi web`。

## 安装与使用

先下载代码（或在 Releases 页面下载 npm 版压缩包并解压）：

```bash
git clone https://github.com/15Soren/kimi-web-renamer-patch.git
cd kimi-web-renamer-patch
```

### Windows

打开 PowerShell 或 CMD，进入项目目录后执行：

```powershell
# 查看 config.toml 中可用的模型
node bin/cli.js models

# 应用补丁
node bin/cli.js patch
```

如果遇到权限错误（`EPERM` / `EACCES`），请检查目标目录的写入权限及文件是否被占用。

补丁完成后，在运行 `kimi web` 的窗口按 `Ctrl + C` 停止，再重新运行 `kimi web`，刷新浏览器即可。

### Linux / macOS / WSL

打开终端，进入项目目录后执行：

```bash
# 查看 config.toml 中可用的模型
node bin/cli.js models

# 应用补丁
node bin/cli.js patch
```

补丁完成后，按 `Ctrl + C` 停止当前 `kimi web`，重新启动并刷新浏览器即可。

### 自动探测不到安装目录？

使用 `--path` 指向 `@moonshot-ai/kimi-code` 安装根目录（该目录下应有 `dist` 和 `dist-web`）：

```bash
node bin/cli.js patch --path "/path/to/node_modules/@moonshot-ai/kimi-code"
```

含空格的路径请用双引号包住。也可以运行 `npm root -g` 查看全局 npm 安装位置。

## 指定重命名模型

默认使用 `config.toml` 里的 `default_model`。如果想单独指定一个更快的模型来生成标题：

```bash
node bin/cli.js models
node bin/cli.js set-model "模型ID"
```

默认按顺序查找 `~/.kimi-code/config.toml`、`~/.kimi/config.toml`、`~/.config/kimi-code/config.toml`（Linux 也会检查 `$XDG_CONFIG_HOME/kimi-code/config.toml`；Windows 也会检查 `%APPDATA%\kimi-code\config.toml` 与 `%ProgramData%\.kimi-code\config.toml`），也可用 `--config` 手动指定。支持 `openai`、`openai_legacy`、`kimi` 等 OpenAI Chat Completions 兼容供应商。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `node bin/cli.js patch` | 应用补丁（默认命令） |
| `node bin/cli.js status` | 查看补丁状态与当前绑定的模型 |
| `node bin/cli.js models` | 列出 `config.toml` 中所有模型 |
| `node bin/cli.js set-model <ID>` | 修改 `rename_model` 并重新应用补丁 |
| `node bin/cli.js unpatch` | 还原官方原版文件并清理注入内容 |
| `--path <dir>` | 手动指定 `@moonshot-ai/kimi-code` 安装根目录 |
| `--config <file>` | 手动指定 `config.toml` 路径 |

## 项目结构

```text
├── bin/                # CLI 入口
├── src/
│   ├── patcher.js      # npm 安装探测与补丁统一入口
│   ├── kimi-config.js  # 解析 config.toml 中的模型与供应商配置
│   ├── paths.js        # 跨平台路径与可执行文件查找
│   ├── npm-patch.js    # 前端脚本与同源代理路由注入
│   ├── template/       # 注入网页的标题栏按钮脚本
│   └── assets/         # 图标资源
├── scripts/            # Release 构建脚本
└── test/               # 自动化测试
```

## 原理与安全

在 `dist/main.mjs` 中注入同源接口 `/api/v1/custom-renamer/generate`，模型地址和 API Key 只留在服务端，不会写入浏览器脚本。修改前会自动备份 `index.html.renamer.bak` 与 `main.mjs.renamer.bak`，执行 `unpatch` 即可完整还原。

## 测试与构建

```bash
npm test                        # 运行自动化测试
npm run build:release           # 构建发行目录到 dist/releases/
npm run build:release:archive   # 额外生成 .tar.gz 和 .zip 压缩包
```

## 协议

代码采用 [MIT](LICENSE) 协议。Kimi 名称与图标归其各自权利方所有，本项目的代码许可不授予第三方商标权。
