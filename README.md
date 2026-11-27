# kimi-web-renamer-patch

[![Node.js >= 18](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-339933.svg)](https://nodejs.org/)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

为 **Kimi Code Web** 注入一键 AI 会话重命名功能的轻量补丁工具。

打完补丁后，会话标题栏会新增一个无边框重命名图标按钮；点击后自动读取对话首条消息，调用本机 `config.toml` 中已配置的模型生成精简标题并写回会话。零第三方依赖，无需 `npm install`，支持一键无损还原。

> **适用范围**：仅适用于通过 `npm` 安装的 `@moonshot-ai/kimi-code`（安装目录包含 `dist/main.mjs` 与 `dist-web/index.html`）。本项目为第三方工具，与 Moonshot AI 无关。

---

## 核心特性

- **开箱复用 `config.toml`**：自动定位并解析本机 Kimi Code 配置，默认沿用 `default_model`，也可指定更快的专属 `rename_model`。
- **同源代理与密钥隔离**：在本地服务端 `dist/main.mjs` 注入同源接口 `/api/v1/custom-renamer/generate`，无需放宽 CSP，模型地址与 API Key 不暴露到浏览器端。
- **自适应界面**：自动挂载到宽屏标题栏与窄屏顶部栏，点击即用，全浏览器与局域网设备访问均生效。
- **无损备份与还原**：修改前自动备份 `index.html.renamer.bak` 与 `main.mjs.renamer.bak`，随时通过 `unpatch` 恢复原版。

---

## 使用前提

1. 已安装 **Node.js 18+**（可执行 `node -v` 确认）。
2. 已通过 `npm` 安装 `@moonshot-ai/kimi-code` 并完成基础配置。
3. `config.toml` 中目标模型对应的供应商为 **OpenAI Chat Completions 兼容接口**（`openai`、`openai_legacy` 或 `kimi`），且配置了 `base_url` 与 `api_key`（或 `api_key_env`）。

> 暂不支持仅使用托管登录认证（无显式 `api_key` / `api_key_env`）的供应商。

---

## 快速开始

### 1. 获取代码

克隆仓库，或在 [Releases](https://github.com/15Soren/kimi-web-renamer-patch/releases) 页面下载压缩包并解压：

```bash
git clone https://github.com/15Soren/kimi-web-renamer-patch.git
cd kimi-web-renamer-patch
```

### 2. 查看模型并应用补丁

```bash
# 查看 config.toml 中已配置的模型
node bin/cli.js models

# 应用补丁（默认使用 rename_model，未配置时回退至 default_model）
node bin/cli.js patch
```

> 遇到 `EPERM` / `EACCES` 权限错误时：Windows 请以管理员身份运行终端，Linux / macOS 请在命令前加 `sudo`（工具会自动识别 `SUDO_USER` 的配置文件）。

### 3. 重启服务生效

如果 `kimi web` 正在运行，请在对应终端按 `Ctrl + C` 停止后重新执行 `kimi web`，然后刷新浏览器页面，即可在会话标题栏看到重命名图标。

---

## 指定专属重命名模型

如果希望使用响应更快的轻量模型生成标题，而不影响日常对话模型：

```bash
# 命令行一键切换（自动校验模型、写入 config.toml 并重新打补丁）
node bin/cli.js set-model "<模型ID>"
```

也可以直接编辑 `config.toml`，在顶层添加 `rename_model` 后重新执行 `node bin/cli.js patch`：

```toml
default_model = "Local/main-model"
rename_model = "Local/fast-flash-model"
```

---

## 命令参考

所有命令均可通过 `node bin/cli.js <命令> [选项]` 执行（仓库内也提供 `npm run patch|status|models|unpatch` 快捷脚本）：

| 命令 / 选项 | 说明 |
| --- | --- |
| `patch` | 应用补丁（默认命令，可省略） |
| `status` | 检查前端脚本、代理路由、原版备份状态及当前绑定模型 |
| `models` / `list-models` | 列出 `config.toml` 中所有已配置模型并标注当前生效项 |
| `set-model <model_id>` | 更新 `config.toml` 中的 `rename_model` 并重新应用补丁（失败自动回滚） |
| `unpatch` / `restore` | 还原官方原版文件并清理注入资源 |
| `--path <dir>` | 手动指定 `@moonshot-ai/kimi-code` 安装根目录 |
| `--config <file>` | 手动指定 `config.toml` 路径 |
| `-h` / `--help` | 查看命令行帮助 |

**手动指定路径示例**（含空格的路径请用双引号包裹，可执行 `npm root -g` 查看全局 npm 目录）：

```bash
node bin/cli.js patch \
  --path "/path/to/node_modules/@moonshot-ai/kimi-code" \
  --config "/path/to/config.toml"
```

---

## 配置文件自动查找顺序

未指定 `--config` 时，按以下顺序查找 `config.toml`：

1. `$KIMI_CODE_HOME/config.toml`（默认 `~/.kimi-code/config.toml`）
2. `~/.kimi/config.toml`
3. `$XDG_CONFIG_HOME/kimi-code/config.toml`（若已设置为绝对路径）
4. `~/.config/kimi-code/config.toml`
5. **Windows**：`%APPDATA%\kimi-code\config.toml`、`%ProgramData%\.kimi-code\config.toml`
6. **Linux / macOS（`sudo` 运行时）**：回退检查原调用用户（`SUDO_USER`）主目录下的上述位置

---

## 工作原理与安全设计

```text
浏览器标题栏按钮 ─▶ POST /api/v1/custom-renamer/generate (同源)
                        │
                        ▼ (dist/main.mjs 本地服务端)
                 调用 config.toml 绑定的模型接口 (30s 超时 / 禁止重定向)
                        │
                        ▼
浏览器写回标题 ◀─ 返回清洗后的精简标题 ─▶ POST /api/v1/sessions/:id/profile
```

- **密钥不落地前端**：前端脚本仅发送首条消息文本，端点与 API Key 固定在本地服务端路由中。
- **保留原始 CSP**：通过同源代理规避浏览器 CORS / `OPTIONS` 预检拦截，无需放宽页面 `Content-Security-Policy`。
- **升级维护**：升级 `@moonshot-ai/kimi-code` 会覆盖官方文件，升级后重新执行一次 `node bin/cli.js patch` 即可重新生效。

---

## 项目结构

```text
├── bin/
│   └── cli.js                  # CLI 命令解析与交互入口
├── src/
│   ├── patcher.js              # 模块统一导出入口
│   ├── npm-patch.js            # 安装目录探测、备份、注入与还原核心逻辑
│   ├── kimi-config.js          # config.toml 解析、模型校验与写入
│   ├── paths.js                # 跨平台路径、PATH 可执行文件与 sudo 用户查找
│   ├── template/
│   │   └── kimi-renamer.js     # 注入网页的标题栏图标按钮脚本
│   └── assets/
│       └── Kimi.ico            # 按钮图标资源
├── scripts/
│   └── build-releases.js       # Release 目录与归档包构建脚本
├── release-templates/
│   └── README.npm.md           # Release 发行包内置说明模板
└── test/                       # 自动化测试套件
```

---

## 开发与测试

```bash
npm test                       # 运行全部自动化测试
npm run build:release          # 构建发行目录至 dist/releases/
npm run build:release:archive  # 同步生成 .tar.gz 与 .zip 归档包
```

---

## 开源协议

本项目代码基于 [MIT](LICENSE) 协议开源。Kimi 名称及图标归其各自权利方所有，本项目的代码许可不授予任何第三方商标权。
