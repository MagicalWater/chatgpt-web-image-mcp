# ChatGPT Web Image MCP

一个独立的本地 MCP/CLI 工具：复用专用 Chrome profile 中已经登录的 ChatGPT 网页会话，提交生图或改图提示词，等待网页结果，并把图片保存到本机后作为 MCP `image` 内容返回给调用它的 AI。

它不依赖 ComfyUI，不包含 workflow、模型权重、视频链路、OpenAI API key、Gateway、隧道或公网 HTTP 服务。

> [!WARNING]
> 这不是 OpenAI 官方 API 或官方集成。OpenAI 当前个人版 [Terms of Use](https://openai.com/policies/terms-of-use/) 明确限制自动或程序化提取 Output。本项目执行网页 UI 自动化并取回图片，可能不符合你所适用的账户条款，也可能因页面改版失效。使用者必须自行确认授权、条款和账号风险。正式生产、批量或对外服务请使用官方 Image API。

## 调用链

```text
本地 AI / MCP 客户端
        |
        | stdio MCP
        v
generate_chatgpt_web_image
        |
        v
专用 Chrome profile -> chatgpt.com 网页 -> 图片生成结果
        |
        v
本机 outputs 目录 + MCP image content
```

浏览器、页面操作、图片捕获、任务串行化和 MCP 协议分别位于独立模块。运行时不会导出 Cookie，也不会把 Chrome profile 打进 npm 包。

## 环境要求

- Node.js 20+
- Google Chrome
- 有权使用的 ChatGPT 账号
- 本地 MCP 客户端，例如 Codex、Claude Desktop 或其他支持 stdio MCP 的 AI 工具

## 安装

```bash
git clone https://github.com/leixyou/chatgpt-web-image-mcp.git
cd chatgpt-web-image-mcp
npm install
```

可选配置参考 [.env.example](./.env.example)。本项目不会自动加载 `.env`；请在 shell 或 MCP 客户端的 `env` 中设置变量。

## 第一次登录

```bash
npm run login
```

命令会打开专用 profile：

```text
~/.chatgpt-web-image-mcp/chrome-profile
```

在打开的 Chrome 窗口中手动登录 ChatGPT。工具检测到输入框后会退出，登录状态保留在该专用 profile。不要把此目录复制给别人或提交到 Git。

检查状态：

```bash
node bin/chatgpt-web-image.js check
```

## CLI 使用

文字生图：

```bash
node bin/chatgpt-web-image.js generate \
  --prompt "一张雨后江南石桥的电影感照片，无文字，横向构图"
```

输出位于 `~/.chatgpt-web-image-mcp/outputs/<job>/`，CLI 会返回 JSON 文件信息。

图片编辑默认关闭，因为 AI 工具传入本地路径会形成文件外传面。先设置最小输入白名单：

```bash
export CHATGPT_IMAGE_ALLOWED_INPUT_DIRS="$HOME/Pictures/ai-inputs"
node bin/chatgpt-web-image.js generate \
  --prompt "保留主体，把背景改成雪山日出" \
  --source "$HOME/Pictures/ai-inputs/source.png"
```

仅支持真实 PNG、JPEG、WebP 文件；扩展名伪装不会通过校验。

## MCP 接入

先在仓库中执行 `npm install` 和 `npm run login`。然后把 MCP server 配到本地 AI 客户端。

Codex CLI：

```bash
codex mcp add chatgpt-web-image -- \
  node /ABSOLUTE/PATH/chatgpt-web-image-mcp/src/mcp-server.js
```

通用 MCP 配置：

```json
{
  "mcpServers": {
    "chatgpt-web-image": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/chatgpt-web-image-mcp/src/mcp-server.js"
      ],
      "env": {
        "CHATGPT_CHROME_USER_DATA_DIR": "/ABSOLUTE/PATH/TO/DEDICATED/chrome-profile",
        "CHATGPT_IMAGE_OUTPUT_DIR": "/ABSOLUTE/PATH/TO/outputs"
      }
    }
  }
}
```

也可以直接从 GitHub 启动：

```json
{
  "mcpServers": {
    "chatgpt-web-image": {
      "command": "npx",
      "args": [
        "--yes",
        "github:leixyou/chatgpt-web-image-mcp"
      ]
    }
  }
}
```

首次登录仍建议在 clone 后执行 `npm run login`，并让 npx 配置使用同一个 `CHATGPT_CHROME_USER_DATA_DIR`。

## MCP 工具

### `check_chatgpt_image_browser`

检查专用 Chrome profile 是否能打开 ChatGPT 且已出现输入框。无参数。

### `generate_chatgpt_web_image`

参数：

```json
{
  "prompt": "一张白底产品摄影，柔和棚拍光，无文字",
  "source_images": [],
  "chatgpt_url": "https://chatgpt.com/"
}
```

- `prompt`：必填，最多 12000 字符。
- `source_images`：可选，最多 8 个本地图片路径，必须位于输入白名单。
- `chatgpt_url`：可选，只允许无凭据的 HTTPS `chatgpt.com` 页面。

工具按顺序返回：

1. JSON 摘要，包括 `job_id`、文件路径、尺寸、MIME 和捕获方式。
2. 一个或多个 MCP `image` 内容块，AI 客户端可直接查看和继续使用。

同一个 MCP 进程中的调用会严格串行，避免多个请求同时操作一个输入框。

## 使用 CDP 连接现有专用 Chrome

如果你不希望 MCP 自己启动 Chrome，可以手动启动一个专用调试实例：

macOS：

```bash
open -na "Google Chrome" --args \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.chatgpt-web-image-mcp/chrome-profile"
export CHATGPT_CDP_URL=http://127.0.0.1:9222
```

Linux：

```bash
google-chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.chatgpt-web-image-mcp/chrome-profile"
export CHATGPT_CDP_URL=http://127.0.0.1:9222
```

默认只允许 loopback CDP。远程 CDP 等同于远程浏览器控制，不应直接暴露到公网。

## 安全边界

- 只提供本地 stdio MCP，不监听公网端口。
- 只允许导航到 `https://chatgpt.com` 及其子域。
- 不读取或输出 Cookie、Local Storage、账号 token、环境变量或 profile 内容。
- 不复制用户日常 Chrome profile，默认使用独立 profile。
- 图片编辑的本地输入目录默认是空白名单。
- 单图默认最大 20 MiB，超限时尝试可见区域截图，仍超限则失败。
- 错误返回经过清洗，不把 Playwright stack trace 返回给 MCP 调用者。

更多说明见 [SECURITY.md](./SECURITY.md)。

## 测试与打包

```bash
npm run check
npm test
npm pack --dry-run
```

真实网页烟测会消耗 ChatGPT 账号额度且受页面状态影响，因此不会在默认测试中自动执行：

```bash
node bin/chatgpt-web-image.js check
node bin/chatgpt-web-image.js generate --prompt "生成一个简单的红色圆形图标，白色背景"
```

## 已知限制

- ChatGPT 页面 DOM 会变化，输入框、发送按钮或图片结构改版后需要更新 selector。
- 验证码、二次登录、地区限制、账号额度和内容安全拦截需要操作者在可见浏览器中处理。
- 网页端不提供稳定的模型响应元数据，本工具不会声称验证了底层具体模型。
- CDP 模式不会主动关闭操作者的 Chrome；专用 profile 模式在 CLI/MCP 正常退出时会关闭自己启动的窗口。

## License

MIT。此许可证只覆盖本仓库代码，不授予 ChatGPT、OpenAI 服务或生成内容之外的任何权利。
