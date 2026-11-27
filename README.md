# Kimi Code Web 会话重命名补丁

在 Kimi Code Web 的会话标题栏添加一个无边框重命名按钮，点击后根据对话的第一条消息自动生成标题并写回。工具直接读取本机 `config.toml` 中的模型和 API Key，无需额外配置，也无需安装任何第三方依赖。

同时兼容 **npm 安装** 与 **单文件二进制安装** 两种 Kimi Code，运行时会自动识别。

> 本项目为第三方补丁，与 Moonshot AI 无关。补丁修改的是本机安装或缓存文件，升级 Kimi Code 后重新执行一次 `patch` 即可。

## 使用前准备

1. 已安装 **Node.js 18+**（在终端执行 `node -v` 可查看版本）。
2. 已安装 Kimi Code，配好了 `config.toml`，并且至少运行过一次 `kimi web`。

## 安装与使用

先下载代码（或在 Releases 页面下载压缩包并解压）：

```bash
git clone https://github.com/15Soren/kimi-web-renamer-patch.git
cd kimi-web-renamer-patch
```

### Windows

打开 PowerShell 或 CMD，进入项目目录后执行：

```powershell
# 查看 config.toml 中可用的模型
node bin/cli.js models

# 应用补丁（自动识别 npm 安装或单文件安装）
node bin/cli.js patch
```

> 如果遇到权限错误（`EPERM` / `EACCES`），右键以**管理员身份运行**终端后重新执行即可。

补丁完成后，根据你的 Kimi Code 安装方式选择对应操作：

- **npm 安装的 Kimi Code**：在运行 `kimi web` 的窗口按 `Ctrl + C` 停止，再重新运行 `kimi web`，刷新浏览器即可。
- **单文件安装的 Kimi Code**（官方 `install.ps1` 安装）：由于单文件版每次启动 `kimi web` 都会校验并还原 `index.html`，需要二选一：
  - **后台守护（推荐）**：运行 `bin\install-daemon.cmd`，会自动加入开机自启并在后台静默运行，之后平时直接执行 `kimi web` 即可。卸载运行 `bin\uninstall-daemon.cmd`。
  - **手动启动**：用 `bin\kimi-web-renamer.cmd` 代替 `kimi web`，退出时会自动关闭本地代理。

### Linux / macOS / WSL

打开终端，进入项目目录后执行：

```bash
# 查看 config.toml 中可用的模型
node bin/cli.js models

# 应用补丁（若全局 npm 目录无写权限，可在命令前加 sudo）
node bin/cli.js patch
```

补丁完成后：

- **npm 安装的 Kimi Code**：按 `Ctrl + C` 停止当前 `kimi web`，重新启动并刷新浏览器即可。
- **单文件安装的 Kimi Code**（官方 `install.sh` 安装）：二选一：
  - **systemd 守护（推荐）**：运行 `./bin/install-daemon` 注册用户级后台服务，之后直接运行 `kimi web` 即可。卸载运行 `./bin/uninstall-daemon`。
  - **手动启动（或无 systemd 环境）**：用 `./bin/kimi-web-renamer` 代替 `kimi web`，退出时自动清理本地代理。

### 不确定自己是哪种安装方式？

- 在终端运行 `npm list -g @moonshot-ai/kimi-code`，能查到包信息的就是 **npm 安装**。
- 否则运行 `where kimi`（Windows）或 `which kimi`（Linux/macOS），路径位于 `.kimi-code` 下的就是 **单文件安装**。
- 如果自动探测没有找到目标目录，可以用 `--path` 手动指定（npm 版填 `@moonshot-ai/kimi-code` 目录，单文件版填 `dist-web` 或其上级缓存目录）。

## 指定重命名模型

默认使用 `config.toml` 里的 `default_model`。如果想单独指定一个更快的模型来生成标题：

```bash
node bin/cli.js models
node bin/cli.js set-model "模型ID"
```

默认按顺序查找 `~/.kimi-code/config.toml`、`~/.kimi/config.toml`、`~/.config/kimi-code/config.toml`（Windows 也会回退检查 `%APPDATA%\kimi-code\config.toml`），也可用 `--config` 手动指定。支持 `openai`、`openai_legacy`、`kimi` 等 OpenAI Chat Completions 兼容供应商。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `node bin/cli.js patch` | 应用补丁（默认命令） |
| `node bin/cli.js status` | 查看补丁及 sidecar 状态 |
| `node bin/cli.js models` | 列出 `config.toml` 中所有模型 |
| `node bin/cli.js set-model <ID>` | 修改 `rename_model` 并重新应用补丁 |
| `node bin/cli.js serve` | 前台启动本地 sidecar 代理（仅单文件模式） |
| `node bin/cli.js unpatch` | 还原官方原版文件并清理注入内容 |
| `--mode <auto\|npm\|standalone>` | 指定模式（默认 `auto` 自动探测） |
| `--path <dir>` | 手动指定安装目录或 `dist-web` 路径 |
| `--config <file>` | 手动指定 `config.toml` 路径 |
| `--port <port>` | 指定 sidecar 监听端口（默认 `58629`） |

## 项目结构

```text
├── bin/                # CLI 入口（cli.js）、单文件启动器及 Win/Linux 守护进程脚本
├── src/
│   ├── patcher.js      # 自动探测安装方式与统一入口
│   ├── kimi-config.js  # 解析 config.toml 中的模型与供应商配置
│   ├── paths.js        # 跨平台路径与缓存目录定位
│   ├── modes/          # npm 路由注入（npm.js）与单文件资源注入（standalone.js）
│   ├── standalone/     # 单文件模式本地 sidecar 服务与重注入守护进程
│   ├── template/       # 注入网页的标题栏按钮脚本
│   └── assets/         # 图标资源
├── scripts/            # Release 构建脚本
└── test/               # 自动化测试
```

## 原理与安全

- **npm 模式**：在 `dist/main.mjs` 中注入同源接口 `/api/v1/custom-renamer/generate`，模型地址和 API Key 只留在服务端，不会写入浏览器脚本。
- **单文件模式**：由本地 sidecar（默认监听 `58629` 端口）转发模型请求，密钥保存在 `~/.kimi-code/kimi-renamer/server.json`，浏览器脚本仅携带随机生成的 `X-Kimi-Renamer-Token`。

## 测试与构建

```bash
npm test                        # 运行自动化测试
npm run build:release           # 构建发行目录到 dist/releases/
npm run build:release:archive   # 额外生成 .tar.gz 和 .zip 压缩包
```

## 协议

代码采用 [MIT](LICENSE) 协议。Kimi 名称与图标归其各自权利方所有，本项目的代码许可不授予第三方商标权。
