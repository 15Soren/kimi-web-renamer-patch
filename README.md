# Kimi Code Web 会话重命名补丁

为 Kimi Code Web 的会话标题栏添加重命名图标，点击后根据会话消息生成标题并写回。复用 `config.toml` 中的模型与供应商配置，默认选择 `default_model`，也可以指定 `rename_model`。

这是第三方补丁工具，与 Moonshot AI 无关联。修改的是本机安装文件，升级 Kimi Code 后需要重新应用。

## 支持范围

- 补丁工具需要 Node.js 18 或以上；被补丁的 Web 服务运行环境也需要内置 `fetch` 和 `AbortSignal.timeout`。
- 自动查找 npm 全局安装目录、可执行文件路径及常见安装位置；支持 `--path` 手动指定目录。
- 默认查找 `~/.kimi-code/config.toml`、`~/.kimi/config.toml` 和 `~/.config/kimi-code/config.toml`，支持 `--config`。
- 仅支持提供 `base_url` 和 `api_key`（或 `api_key_env`）的 OpenAI Chat Completions 兼容供应商。托管 OAuth 登录、Anthropic、Responses 等接口暂不支持。
- 配置解析支持单行字符串、布尔值、数字、表、行尾注释及 Unicode 名称；不是完整 TOML 解析器，多行字符串、内联表等语法不在支持范围内。
- 安装目录必须包含 `dist/main.mjs` 和 `dist-web/index.html`；服务端必须包含 `registerConfigRoutes(apiV1, core);`。不满足时会在写入前报错。
- 前端依赖现有 Kimi Web 的会话路径、页面选择器和 API；没有覆盖所有 Kimi Code 版本。跨平台测试验证的是补丁工具与模拟文件，不代表所有浏览器和上游版本都已实测。

## 快速使用

```bash
git clone https://github.com/zluoshui/kimi-web-renamer-patch.git
cd kimi-web-renamer-patch
node bin/cli.js models
node bin/cli.js patch
```

没有第三方运行依赖，无需 `npm install`。应用后重启 `kimi web`，刷新页面，在会话标题栏点击重命名图标。

手动指定路径：

```bash
node bin/cli.js patch --path "/path/to/node_modules/@moonshot-ai/kimi-code" --config "/path/to/config.toml"
```

## 模型配置

以下模型名和域名仅为示例，请替换为实际可用的服务：

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

运行补丁时，对应环境变量必须已设置。也支持供应商的 `api_key` 字段。密钥在应用补丁时写入本机服务端文件，因此更换密钥、模型或端点后需要重新应用补丁并重启服务。

切换模型：

```bash
node bin/cli.js set-model "Example/title-model"
```

此命令验证模型后更新顶层 `rename_model`，随后应用补丁；应用失败时还原原配置。手动修改配置后执行 `patch` 也可以。

## 命令

| 命令 | 用途 |
| --- | --- |
| `patch`（默认） | 解析模型配置并应用补丁 |
| `models` / `list-models` | 列出配置中的模型，不要求找到安装目录 |
| `set-model <ID>` | 更新重命名模型并应用补丁 |
| `status` | 检查前端与代理路由状态，无需配置文件；传入 `--config` 可查看模型 |
| `unpatch` / `restore` | 还原原文件并删除补丁资源，无需配置文件 |
| `--path <dir>` | 指定 Kimi Code 安装根目录 |
| `--config <file>` | 指定配置文件 |
| `--help` | 显示帮助 |

例如：`node bin/cli.js unpatch --path "/path/to/kimi-code"`。

## 凭证与访问边界

网页仅向同源 `/api/v1/custom-renamer/generate` 发送消息。模型端点和 API Key 固定在服务端，不会写入浏览器脚本；客户端不能修改代理目标。请求不跟随重定向，超时为 30 秒，失败时不会回退为浏览器直连，也不会把 Web 连接凭证作为模型 API Key。

补丁保留原有 CSP。路由注册在 Kimi 原有 `apiV1` 下，依赖宿主的认证与访问控制。请保护安装目录与服务端文件，不要将补丁后的安装文件或真实配置提交到公共仓库。能够访问此 Web 服务的授权用户会使用配置的模型额度，消息内容会发送给该供应商。部署到公网前需要自行验证宿主认证及访问限制。

同源请求解决网页跨端口调用模型网关时的 CORS 预检问题，仍受宿主 CSP、认证和实际网络状态影响。请求不传 `reasoning_effort`、`thinking` 或 `effort`；这表示使用供应商的默认行为，不保证关闭思考或降低延迟。响应会剥离完整的 `<think>...</think>` 标签，标题长度由提示词约束，尚未实施严格的 4–12 字校验。

宽屏按钮挂载在正文 `.chat-header`，排除 `.sa-head`；窄屏使用 `.topbar`。旧按钮清理只依据本补丁专属 ID 与类名，不按“重命名”文本删除其他按钮。

## 备份、升级与还原

修改前创建 `index.html.renamer.bak` 和 `main.mjs.renamer.bak`，重复应用会更新代理配置并保留原文件备份。新版本原文件覆盖安装后，重新应用时会刷新相应备份。

建议升级前先 `unpatch`，升级后再 `patch`，并重启服务。保留备份才能逐字恢复原文件；备份缺失时，新版补丁可以移除自身脚本、路由和资源，但不保证原始排版。旧版无结束标记的路由需要原版备份才能安全还原。

本补丁使用独立的 `kimi-renamer.ico`，不会覆盖或删除安装目录原有的 `Kimi.ico`。如果遇到 `EPERM` / `EACCES`，优先使用当前账户有写权限的安装目录；修改受保护目录时需由你自行处理权限。

## 验证

```bash
npm test
```

测试使用独立临时目录和模拟配置，不读取本机真实模型配置、不调用真实模型服务，也不修改真实 Kimi 安装。覆盖配置解析、补丁与备份还原、重复应用、不兼容版本拒绝、密钥隔离、固定代理目标、超时设置、原图标保护和 CLI 参数处理。

GitHub Actions 在 Windows、macOS、Linux 与 Node.js 18、22、24 上运行这些测试。浏览器页面及真实供应商端到端兼容性需要在目标 Kimi Code 版本中另外验证。

## 鸣谢
https://linux.do

## 协议

代码采用 [MIT](LICENSE) 协议。Kimi 名称与图标涉及其各自权利方，本项目的代码许可不授予第三方商标权。
