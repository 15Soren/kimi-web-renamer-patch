# Kimi Code Web 会话重命名补丁

为 Kimi Code Web 的会话标题栏添加一个无边框重命名图标，点击后自动根据对话首条消息生成简短标题并写回。工具直接复用你本机 `config.toml` 中的模型与 API Key，无需额外配置账号。

> 这是第三方补丁工具，与 Moonshot AI 无关联。补丁修改的是本机安装或缓存文件，升级 Kimi Code 后按对应方式重新运行一次即可。

---

## 第一步：先确认你用的是哪种 Kimi Code

| 你的安装方式 | 如何快速判断 | 对应发行包 | 生效方式 |
| --- | --- | --- | --- |
| **npm 安装** | `npm list -g @moonshot-ai/kimi-code` 能查到，或 `kimi` 路径含 `node_modules` | `kimi-web-renamer-patch-npm` | 打完补丁重启 `kimi web` 即可，无需常驻进程 |
| **单文件二进制安装** | 路径类似 `~/.kimi-code/bin/kimi` 或 `kimi.exe`，没有 `dist/main.mjs` | `kimi-web-renamer-patch-standalone` | 需要配合本地 sidecar 或守护进程 |

> 如果你直接下载本仓库源码（`git clone`），工具会自动识别你电脑上是哪种安装方式，两种都能用。

---

## 第二步：Windows / Linux 小白安装与使用教程

### 准备工作（Win / Linux 通用）

1. **安装 Node.js 18+**：在终端运行 `node -v` 能看到 `v18.x` 或更高版本即可。本项目**零第三方依赖**，不需要 `npm install`。
2. **先用过一次 Kimi Code**：确保 `config.toml` 里已经配好模型，并且至少运行过一次 `kimi web`（单文件版会在首次启动时释放网页静态资源缓存）。

### 获取补丁工具

- **方式 A（推荐小白）**：前往 GitHub Releases 下载对应压缩包（Windows 下载 `.zip`，Linux 下载 `.tar.gz`）并解压。
- **方式 B（源码）**：`git clone https://github.com/15Soren/kimi-web-renamer-patch.git && cd kimi-web-renamer-patch`

---

### Windows 用户操作步骤

打开 **PowerShell** 或 **CMD**，进入解压后的文件夹：

```powershell
# 1. 查看 config.toml 里可用的模型
node bin/cli.js models

# 2. 一键应用补丁（会自动识别 npm 版或单文件版）
node bin/cli.js patch
```

> 如果提示权限不足（`EPERM` / `EACCES`），请**右键“以管理员身份运行”** PowerShell 或 CMD 后再执行上面命令。

打完补丁后，按你的安装方式继续：

- **如果你是 npm 版**：
  在运行 `kimi web` 的窗口按 `Ctrl + C` 停止，重新运行 `kimi web`，刷新浏览器即可在会话标题栏看到重命名图标。
- **如果你是单文件版**（任选一种）：
  - **推荐（开机静默守护，一劳永逸）**：
    ```cmd
    bin\install-daemon.cmd
    ```
    会在后台静默启动守护进程并加入开机自启，之后平时直接像往常一样运行 `kimi web` 即可（卸载运行 `bin\uninstall-daemon.cmd`）。
  - **临时启动（不想装开机自启）**：
    ```cmd
    bin\kimi-web-renamer.cmd
    ```
    用它代替 `kimi web` 启动，会自动拉起本地代理并在退出时自动清理。

---

### Linux / macOS / WSL 用户操作步骤

打开终端，进入解压或克隆的目录：

```bash
# 1. 查看 config.toml 里可用的模型
node bin/cli.js models

# 2. 一键应用补丁（若全局 npm 目录提示权限不足，在前面加 sudo）
node bin/cli.js patch
```

打完补丁后，按你的安装方式继续：

- **如果你是 npm 版**：
  按 `Ctrl + C` 停止当前 `kimi web`，重新执行 `kimi web`，刷新网页即可使用。
- **如果你是单文件版**（任选一种）：
  - **推荐（systemd 守护进程，一劳永逸）**：
    ```bash
    ./bin/install-daemon
    ```
    自动监听缓存并在 `kimi web` 启动时即时重注入，同时保活本地代理（卸载运行 `./bin/uninstall-daemon`）。之后直接运行 `kimi web` 即可。
  - **临时启动（或无 systemd 环境）**：
    ```bash
    ./bin/kimi-web-renamer
    ```
    自动拉起本地代理并运行 `kimi web`，退出时自动清理。

---

## 切换专门用于重命名的模型

默认使用 `config.toml` 中的 `default_model`。如果你想用更便宜或更快的模型（如轻量 Flash 模型）专门生成标题：

```bash
# 先查看模型 ID
node bin/cli.js models

# 切换并自动重打补丁
node bin/cli.js set-model "你的模型ID"
```

支持的供应商类型：`openai`、`openai_legacy`、`kimi`（OpenAI Chat Completions 兼容接口）。默认查找 `~/.kimi-code/config.toml`、`~/.kimi/config.toml`、`~/.config/kimi-code/config.toml`。

---

## 常用命令速查

| 命令 | 用途 |
| --- | --- |
| `node bin/cli.js patch` | 应用补丁（默认命令） |
| `node bin/cli.js status` | 检查补丁状态与 sidecar 运行状态 |
| `node bin/cli.js models` | 列出 `config.toml` 中所有模型 |
| `node bin/cli.js set-model <ID>` | 指定专属重命名模型并重新打补丁 |
| `node bin/cli.js serve` | 前台手动启动 sidecar（仅单文件版） |
| `node bin/cli.js unpatch` | 还原官方原版文件并清理补丁 |
| `--mode <auto\|npm\|standalone>` | 手动指定运行模式（默认 `auto`） |
| `--path <dir>` | 手动指定 Kimi Code 安装目录或 `dist-web` 目录 |
| `--config <file>` | 手动指定 `config.toml` 路径 |
| `--port <port>` | 指定 sidecar 端口（默认 `58629`，仅单文件版） |

---

## 项目结构

```text
├── bin/                    # 命令行入口（cli.js）、单文件启动器与 Win/Linux 守护进程脚本
├── src/
│   ├── patcher.js          # 自动探测安装形态（npm / standalone）与统一调度
│   ├── kimi-config.js      # 读取与解析 config.toml 中的模型与供应商配置
│   ├── paths.js            # 跨平台定位 Kimi 配置目录与单文件缓存目录
│   ├── modes/              # npm 路由注入实现 & standalone 静态资源注入实现
│   ├── standalone/         # 单文件版所需的本地 sidecar 代理与自动重注入守护进程
│   ├── template/           # 注入到网页端的无边框重命名按钮脚本
│   └── assets/             # 按钮图标资源
├── release-templates/      # 双形态发行版（npm / standalone）专用说明模板
├── scripts/                # 一键打包双形态 Release 的构建脚本
└── test/                   # 自动化测试套件
```

---

## 安全与工作原理简述

- **npm 版**：向 `dist/main.mjs` 注入同源接口 `/api/v1/custom-renamer/generate`，API Key 仅留在服务端，不会暴露给浏览器。
- **单文件版**：因单文件版每次启动会校验还原 `index.html`，通过本地 sidecar（默认 `58629` 端口）代理模型请求；API Key 仅保存在 `~/.kimi-code/kimi-renamer/server.json`，浏览器脚本仅持有随机令牌 `X-Kimi-Renamer-Token`。

## 开发构建与测试

```bash
npm test                        # 运行全部自动化测试
npm run build:release           # 在 dist/releases/ 构建双形态发行目录
npm run build:release:archive   # 额外生成 .tar.gz 与 .zip 压缩包
```

## 协议

代码采用 [MIT](LICENSE) 协议。Kimi 名称与图标涉及其各自权利方，本项目的代码许可不授予第三方商标权。
