# Kimi Code Web 自动重命名补丁工具 (kimi-web-renamer-patch)

[![Node.js Version](https://img.shields.io/badge/Node.js-%3E%3D16.0.0-green.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/)
  
> 一键将 AI 对话自动命名功能直接 Patch（打补丁）注入到原生 Kimi Code Web 界面中。  
> **完全复用 Kimi Code 自身的 `config.toml` 配置文件**，默认使用 `default_model`，并支持指定专属的 `rename_model`。

---

## 🌟 核心特性

- **零独立供应商配置**：完全不需要单独配置 API Key 或 Endpoint，直接读取并复用 Kimi Code 原生的 `config.toml`！
- **开箱即用，默认继承**：Patch 时默认使用你当前在 Kimi 里设置的 `default_model`；
- **专属重命名模型**：支持在 `config.toml` 中添加 `rename_model` 参数（例如换成速度极快、成本极低的轻量 Flash 模型）；
- **全平台多设备生效**：打完补丁后，Chrome、Edge、Safari、Firefox 乃至手机平板局域网访问，页面均自带rename按钮
- **CSP 自动放行**：精准修改服务端 `Content-Security-Policy`，放行 `connect-src`，解决浏览器前端直连模型的跨域拦截；
- **无损备份与一键还原**：修改前自动将官方文件备份为 `.bak`，随时支持一键 `unpatch` 瞬间还原官方纯净版。

---

## 📦 目录结构

```text
kimi-web-renamer-patch/
├── bin/
│   └── cli.js               # CLI 命令行入口
├── src/
│   ├── patcher.js           # 备份、Patch、还原核心逻辑
│   ├── kimi-config.js       # 自动解析 Kimi config.toml 模型与供应商
│   └── template/
│       └── kimi-renamer.js  # 注入到页面的原生重命名脚本模板
├── test/
│   ├── test-mock.js         # Patch 与还原流程自动化测试
│   └── test-config.js       # config.toml 解析测试
├── package.json             # 项目元信息与快捷脚本
├── LICENSE                  # MIT 协议
└── README.md                # 使用说明文档
```

---

## ⚡ 快速上手

### 1. 克隆仓库

```bash
git clone https://github.com/your-username/kimi-web-renamer-patch.git
cd kimi-web-renamer-patch
```

### 2. 检查当前模型与状态

```bash
node bin/cli.js models
```

控制台将自动找到你的 `config.toml`，并列出所有已配置的模型：

```text
📋 当前 Kimi Code 中已配置的模型列表 (共 7 个):
   • kimi-code/kimi-for-coding (K2.7 Coding) - Provider: managed:kimi-code
   • kimi-code/k3 (K3) - Provider: managed:kimi-code
   • Local/gemini-3.8-flash-tiered (Gemini 3.8 Flash) - Provider: Local [当前生效: default_model]
   • Local/gemini-3.5-flash-lite (Gemini 3.5 Flash Lite) - Provider: Local
   ...
```

### 3. 一键应用补丁

```bash
node bin/cli.js
# 或
node bin/cli.js patch
```

> 💡 **提示**：补丁默认会使用你在 Kimi 里设定的 `default_model`。系统将自动解析其所属的 Provider、Endpoint 和认证参数并完成注入。

### 4. 启动与体验

启动 Kimi Code Web 服务：

```bash
kimi web
```

在浏览器打开 Kimi Web 界面，进入任意对话会话，右下角将常驻精致的 **「✨ 重命名」** 悬浮按钮，点击即可秒级提炼并写回精简标题！

---

## ⚙️ 模型自定义配置 (`rename_model`)

如果你希望使用与默认对话不同的模型来执行重命名（例如使用响应极快的轻量模型）：

### 方式 A：命令行一键切换（推荐）

```bash
node bin/cli.js set-model "Local/gemini-3.5-flash-lite"
```

该命令会自动向你的 `config.toml` 写入/更新 `rename_model` 并自动重新编译应用补丁！

### 方式 B：手动编辑 `config.toml`

打开 Kimi Code 的配置文件（通常位于 `~/.kimi-code/config.toml`），在顶层添加 `rename_model`：

```toml
default_permission_mode = "yolo"
default_model = "Local/gemini-3.8-flash-tiered"

# 专属的重命名模型（若不配置则默认等于 default_model）
rename_model = "Local/gemini-3.5-flash-lite"

[models."Local/gemini-3.5-flash-lite"]
provider = "Local"
model = "gemini-3.5-flash-lite"
# ...
```

保存后，只需重新执行一次 `node bin/cli.js patch` 即可生效。

---

## 🛠️ CLI 常用命令

| 命令 | 说明 | 示例 |
| :--- | :--- | :--- |
| `node bin/cli.js patch` | 自动从 `config.toml` 读取模型并应用补丁（默认命令） | `node bin/cli.js` |
| `node bin/cli.js models` | 查看 Kimi 中所有已配置的模型及当前生效模型 | `node bin/cli.js models` |
| `node bin/cli.js set-model <ID>` | 切换指定的重命名模型，更新 `config.toml` 并自动重新打补丁 | `node bin/cli.js set-model "Local/gemini-3.5-flash-lite"` |
| `node bin/cli.js unpatch` | 彻底还原为官方原版，撤销所有修改并清理注入脚本 | `node bin/cli.js unpatch` |
| `node bin/cli.js status` | 检查当前补丁状态与绑定的模型信息 | `node bin/cli.js status` |
| `--path <dir>` | 手动指定 `kimi-code` 安装根目录 | `node bin/cli.js patch --path "/path/to/kimi-code"` |
| `--config <path>` | 手动指定 `config.toml` 路径 | `node bin/cli.js patch --config "/path/to/config.toml"` |

---

## 📌 注意事项与常见问题

### 1. 运行时的权限提示 (EPERM / EACCES)
如果你的 Node.js 或全局 npm 包安装在受系统保护的目录下（例如 Windows 的 `C:\Program Files`）：
- 请在 Windows 下**右键以管理员身份运行**打开 PowerShell / CMD 终端再执行 `node bin/cli.js patch`；
- Linux / macOS 用户请在命令前加上 `sudo`。

### 2. 为什么之前直接请求会报 `failed to fetch`？
许多本地大模型代理（如 GPT-Load、本地网关等）默认未配置 CORS 跨源支持，对浏览器的跨域 `OPTIONS` 预检请求返回了 `405 Method Not Allowed`，导致浏览器直接拦截阻断。  
**本工具的解决方案**：在 Kimi Code 本地 Node.js 服务端注入同源代理路由 `/api/v1/custom-renamer/generate`，网页前端请求同源接口不触发 OPTIONS 预检，后端直连模型服务，彻底绕过 CORS 与网络拦截问题！

### 3. Kimi Code 升级后如何处理？
当你通过 `npm update -g @moonshot-ai/kimi-code` 升级 Kimi Code 时，官方安装包会被覆盖。此时无需惊慌，只需回到该项目重新运行一次：
```bash
node bin/cli.js patch
```
即可瞬间重新激活功能！

---

## 📄 开源协议

本项目基于 [MIT](LICENSE) 协议开源。
