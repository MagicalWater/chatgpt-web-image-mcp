# ChatGPT Web Image MCP

一个独立的本地 MCP/CLI 工具：复用专用 Chrome profile 中已经登录的 ChatGPT 网页会话，通过固定 ChatGPT 项目或 `https://chatgpt.com/images/` 专用输入框提交生图、改图提示词，等待网页结果，并把图片保存到本机后作为 MCP `image` 内容返回给调用它的 AI。它支持可复用的人物档案和画风档案，并能自动创建、配置和记住一个固定项目 URL。

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
专用 Chrome profile -> 固定项目/chat surface 或 images surface -> 图片生成结果
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

先复制 `config.example.json` 为仓库根目录本地 `config.json`，并明确填写 dedicated profile：

```json
{
  "chromeUserDataDir": "D:\\path\\to\\dedicated-chrome-profile",
  "accountSwitchCommand": ""
}
```

本 fork 不提供 dedicated profile fallback；未配置 `chromeUserDataDir`（且未显式提供 `CHATGPT_CHROME_USER_DATA_DIR`）时，非 CDP 模式会直接返回 `INVALID_CONFIG`。

### 固定小型 worker pool（fork 功能）

需要并行生图时，可改用 `config.pool.example.json` 的结构。Pool 支持 1–3 个固定 worker，建议先使用 2 个。每个 worker 必须配置独立 `chromeUserDataDir` 和独立 `accountSwitchCommand`；重复 profile 或重复 switch command 会在启动时被拒绝。不同 worker 可以并行运行，但每个 worker 内部仍保持单操作串行化，并继续使用原本的 dedicated-profile lease、quota retry、terminal-reply、cleanup、source-image allowlist 与 capture 流程。

```json
{
  "workers": [
    {
      "id": "worker-a",
      "chromeUserDataDir": "D:\\path\\to\\chrome-profile-a",
      "accountSwitchCommand": "D:\\path\\to\\switch-worker-a.cmd"
    },
    {
      "id": "worker-b",
      "chromeUserDataDir": "D:\\path\\to\\chrome-profile-b",
      "accountSwitchCommand": "D:\\path\\to\\switch-worker-b.cmd"
    }
  ]
}
```

Generation calls are assigned to an idle worker only for the duration of that job. The worker browser session is closed after the job finishes so its profile lease returns to the shared pool for other MCP processes. The scheduler does not permanently bind a ChatGPT conversation to a worker. When all workers remain busy for `CHATGPT_BROWSER_POOL_WAIT_MS` (default 15000 ms), the call fails with `BROWSER_POOL_BUSY`; it does not enter an unbounded FIFO queue. While scanning candidates, each worker profile acquisition uses `CHATGPT_BROWSER_POOL_WORKER_LEASE_TIMEOUT_MS` (default 1000 ms) so one externally busy profile does not consume the whole pool wait.

Multi-worker generation fails closed with `POOL_AFFINITY_REQUIRED` for account-scoped ChatGPT URLs such as `/c/...` conversations and project URLs. Portable root-chat and Images surface jobs can be scheduled on any worker. This intentionally avoids inventing a permanent conversation-to-profile binding; short-lived affinity remains a separate follow-up only if production evidence proves it necessary.

Pool mode intentionally does not support CDP because each worker must own a distinct dedicated profile. Account sets behind the switch commands must also be disjoint (for example A1/A2 vs B1/B2); this repository validates that workers do not reuse the same switch command but does not inspect browser/session secrets to prove account-ring membership.

Login and per-worker diagnostics are explicit:

```bash
node bin/chatgpt-web-image.js login --worker worker-a
node bin/chatgpt-web-image.js login --worker worker-b
node bin/chatgpt-web-image.js check --worker worker-a
node bin/chatgpt-web-image.js check --worker worker-b
```

`setup-project` also requires `--worker` in multi-worker mode. `generate --worker` is rejected because ordinary generation must remain scheduler-assigned rather than caller-pinned.

```bash
npm run login
```

命令会打开你明确配置的 dedicated profile。在打开的 Chrome 窗口中手动登录 ChatGPT。工具检测到输入框后会退出，登录状态保留在该专用 profile。不要把此目录复制给别人或提交到 Git。

检查状态：

```bash
node bin/chatgpt-web-image.js check
```

## 创建固定生图项目

首次登录后运行：

```bash
node bin/chatgpt-web-image.js setup-project \
  --project-name "ChatGPT Web Image MCP" \
  --character "同一名成年女性，鹅蛋脸，黑色齐肩直发，体型和五官比例保持稳定" \
  --style "电影感东方时尚摄影，克制配色，柔和方向光，真实皮肤质感"
```

命令会通过当前登录的 ChatGPT 页面执行以下操作：

1. 没有固定项目时，自动创建项目；已经配置时，默认复用原项目。
2. 写入人物与画风一致性的项目指令。
3. 把项目 URL、项目名和默认档案保存到本机 `~/.chatgpt-web-image-mcp/settings.json`。
4. 后续 `chat` 模式自动使用该项目 URL，不需要每次传 `chatgpt_url`。

本地设置文件权限会收紧为仅当前用户可读写。它不包含 Cookie、token 或 Chrome profile。需要采用已有项目时：

```bash
node bin/chatgpt-web-image.js setup-project \
  --project-url "https://chatgpt.com/g/g-p-YOUR_PROJECT/project"
```

只有明确使用 `--force-new` 才会另建项目，避免 AI 重复创建项目。

## 选择网页入口

插件提供两个可选 surface：

| surface | 默认地址 | 适用场景 |
|---|---|---|
| `chat` | 固定项目 URL，未配置时为 `https://chatgpt.com/` | 固定人物、画风和连续修改 |
| `images` | `https://chatgpt.com/images/` | Images 2.0 专用输入框；适合独立生图和集中查看图片 |

默认是 `chat`。通过环境变量改变整个 MCP 进程的默认值：

```bash
export CHATGPT_WEB_SURFACE=images
```

也可以在每次 CLI/MCP 调用时传 `surface` 覆盖默认值。单独传入 `/images` URL 时会自动推断 `images`；同时传入两者时，`surface` 决定页面适配器，`chatgpt_url` 决定实际地址。配置固定项目后，从 `images` 切回 `chat` 也会自动回到该项目。

## CLI 使用

文字生图：

```bash
node bin/chatgpt-web-image.js generate \
  --prompt "一张雨后江南石桥的电影感照片，无文字，横向构图"
```

直接使用 `/images` 专用输入框：

```bash
node bin/chatgpt-web-image.js generate \
  --surface images \
  --prompt "白底运动鞋产品摄影，柔和棚拍光，无文字"
```

固定项目/对话上下文：

```bash
node bin/chatgpt-web-image.js generate \
  --surface chat \
  --chatgpt-url "https://chatgpt.com/g/YOUR_PROJECT/project" \
  --prompt "沿用项目里的人物设定，生成下一张场景图"
```

使用默认人物和画风档案：

```bash
node bin/chatgpt-web-image.js generate \
  --prompt "人物撑伞走过雨后的江南石桥，横向构图"
```

为单次任务覆盖档案：

```bash
node bin/chatgpt-web-image.js generate \
  --character "同一名成年男性，短发，圆框眼镜，深灰长风衣" \
  --style "黑白木刻版画，高反差，粗线条" \
  --prompt "站在旧火车站月台"
```

通过 `--character ""` 或 `--style ""` 可只关闭对应默认档案；`--no-consistency` 会为本次调用关闭两项。

输出位于 `~/.chatgpt-web-image-mcp/outputs/<job>/`，CLI 会返回 JSON 文件信息。

图片编辑默认关闭，因为 AI 工具传入本地路径会形成文件外传面。先设置最小输入白名单：

```bash
export CHATGPT_IMAGE_ALLOWED_INPUT_DIRS="$HOME/Pictures/ai-inputs"
node bin/chatgpt-web-image.js generate \
  --prompt "保留主体，把背景改成雪山日出" \
  --source "$HOME/Pictures/ai-inputs/source.png"
```

仅支持真实 PNG、JPEG、WebP 文件；扩展名伪装不会通过校验。

仅在 `prompt` 文字中写“使用已上传图片 / use the uploaded source images”**不会**自动附加任何文件。调用者必须把实际本地图片路径放进 `source_images`（CLI 对应重复的 `--source`），且这些路径必须通过输入白名单与真实图片签名校验。若调用者没有传 `source_images`，MCP 会按“无 source image 的普通文字请求”提交；ChatGPT 若因此明确要求补传图片，当前 fork 会将该 assistant 回复作为 `IMAGE_GENERATION_INPUT_REQUIRED` fail-fast 返回，而不会伪装成已经完成上传。

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
        "CHATGPT_IMAGE_OUTPUT_DIR": "/ABSOLUTE/PATH/TO/outputs",
        "CHATGPT_WEB_SURFACE": "chat",
        "CHATGPT_SETTINGS_FILE": "/ABSOLUTE/PATH/TO/settings.json"
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

### `setup_chatgpt_image_project`

自动创建或更新固定项目，并保存默认一致性档案。默认复用已保存的 URL：

```json
{
  "project_name": "ChatGPT Web Image MCP",
  "character_profile": "同一名成年女性，黑色齐肩直发，五官和体型保持稳定",
  "style_profile": "电影感东方时尚摄影，柔和方向光，克制配色"
}
```

可传 `project_url` 采用已有项目。仅在确实要创建另一个项目时设置 `force_new: true`。

### `check_chatgpt_image_browser`

检查专用 Chrome profile 是否能打开 ChatGPT 且已出现对应输入框。可选传入 `surface` 和 `chatgpt_url`，用于分别检查普通聊天、项目或 `/images`。

如果 ChatGPT 显示“太多要求 / Too many requests”对话框，但用户确认按下“知道了 / Got it”后仍可继续使用，工具会自动关闭该阻塞对话框并继续原本的就绪检查。只有对话框无法被安全关闭时才会返回 `CHATGPT_RATE_LIMIT_DISMISS_FAILED`。

### `generate_chatgpt_web_image`

参数：

```json
{
  "prompt": "一张白底产品摄影，柔和棚拍光，无文字",
  "surface": "chat",
  "character_profile": "同一名成年女性，黑色齐肩直发，五官和体型保持稳定",
  "style_profile": "电影感东方时尚摄影，柔和方向光，克制配色",
  "use_consistency": true,
  "source_images": [],
  "chatgpt_url": "https://chatgpt.com/g/g-p-YOUR_PROJECT/project"
}
```

- `prompt`：必填，最多 12000 字符。
- `surface`：可选，`chat` 或 `images`；省略时使用 `CHATGPT_WEB_SURFACE`。
- `character_profile`：可选人物身份约束；省略时使用固定项目的默认档案，空字符串只关闭人物档案。
- `style_profile`：可选画风约束；省略时使用固定项目的默认档案，空字符串只关闭画风档案。
- `use_consistency`：可选；设为 `false` 时本次调用关闭人物与画风档案。
- `source_images`：可选，最多 8 个本地图片路径，必须位于输入白名单。
- `chatgpt_url`：可选，只允许无凭据的 HTTPS `chatgpt.com` 页面；显式 URL 优先于 surface 默认地址。

如果 ChatGPT 明确显示图片生成额度已用完（例如“你目前已用完圖片生成次數，請於約 4 小時內再試”或对应英文提示），本次生成会立即作为 terminal failure 返回 `IMAGE_GENERATION_QUOTA_EXHAUSTED`，而不会继续等待到 `IMAGE_GENERATION_TIMEOUT`。若页面同时提供冷却/重试时间，错误消息会保留该非敏感提示供诊断。这个状态与上面的“太多要求 / Too many requests”请求频率对话框不同；后者仍按既有 contract 安全关闭后继续流程。

本 fork 的 dedicated Chrome profile 必须明确配置，不再静默 fallback 到 `~/.chatgpt-web-image-mcp/chrome-profile`。仓库根目录本地 `config.json` 的 `chromeUserDataDir`，或显式 `CHATGPT_CHROME_USER_DATA_DIR`，至少必须提供一个；CDP mode 除外。若两者同时存在，repo-local `config.json` 优先，以避免历史 enrollment 环境变量把 production route 拉回旧 profile。缺少 dedicated-profile 配置时会直接返回 `INVALID_CONFIG`。

Windows / macOS 可选账号切换配置同样位于仓库根目录的本地 `config.json`。复制 `config.example.json` 为 `config.json`，并设置 `accountSwitchCommand` 为本机账号切换 wrapper 路径（Windows `.cmd`，macOS `.command`）。仅当这个字段非空、且首次生成明确返回 `IMAGE_GENERATION_QUOTA_EXHAUSTED` 时，MCP 才会释放 dedicated Chrome session、执行该命令并对同一次生成重试一次。`config.json` 已被 `.gitignore` 排除；`accountSwitchCommand` 不存在或留空时不会自动切换账号，仍直接返回现有 quota 错误；重试失败后也不会再次切换。

首次生成与切换后的重试各自拥有完整的 `CHATGPT_IMAGE_TIMEOUT_MS` 时间窗。第一次已经消耗的等待时间不会从第二次扣除；每次 generation attempt 都会在自己的结果轮询开始时建立新的 deadline。

工具按顺序返回：

1. JSON 摘要，包括 `job_id`、`surface`、实际 URL、一致性档案启用状态、文件路径、尺寸、MIME 和捕获方式。
2. 一个或多个 MCP `image` 内容块，AI 客户端可直接查看和继续使用。

同一个 MCP 进程中的调用会严格串行，避免多个请求同时操作一个输入框。

如果生成过程中 ChatGPT 才显示“太多要求 / Too many requests”，工具会自动按下确认按钮并继续等待同一次生成结果，不会仅因为这个可关闭对话框就让当前生成失败。

如果 ChatGPT 明确返回了一则文字回复，表明本次图片生成并未开始（例如要求先补传必要的 source image），当前 fork 会将其视为 terminal generation failure，而不是继续等待到图片生成超时。此类错误对 MCP 调用者只返回与失败直接相关的、经过清洗且有长度上限的可见 assistant 回复或片段；不会返回整页 DOM、完整会话历史、浏览器状态、Cookie、token、环境变量、profile 内容或 stack trace。该行为已通过 Windows production acceptance。

对于 MCP 自己启动的 dedicated Chrome profile，terminal generation failure（包括结果超时）会在错误返回前关闭 MCP-owned persistent context 并释放 profile lease，避免后续独立 MCP process 因 profile lease 仍被占用而阻塞；该行为已通过 Windows production acceptance。CDP 模式连接的是操作者拥有的浏览器，生成失败时不会主动关闭操作者的 Chrome；本轮 production acceptance 不把 CDP transport 主动断连声明为已验证行为。

为避免 profile 已被另一个仍存活的 MCP runtime 占用时，`check` / 新 generation 也跟着等待完整图片生成时限，本 fork 将 profile lease acquisition 使用独立的短时限 `CHATGPT_BROWSER_PROFILE_LEASE_TIMEOUT_MS`（默认 15000 ms）。图片结果轮询的默认 `CHATGPT_IMAGE_TIMEOUT_MS` 为 540000 ms，刻意低于当前 600000 ms production tool-call 上限，以保留浏览器清理与错误传播时间；显式改变外层调用时限时仍应维持“内部 generation deadline < 外层 transport deadline”的关系。

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
- 固定项目 URL 和人物/画风档案只写入本机设置文件，不进入 npm 包；该文件不保存浏览器凭据。
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
node bin/chatgpt-web-image.js generate --surface images --prompt "生成一个简单的蓝色方形图标，白色背景"
```

## 已知限制

- ChatGPT 页面 DOM 会变化，输入框、发送按钮或图片结构改版后需要更新 selector。
- `/images` 页面已有历史图库，插件会在提交前记录现有图片，只捕获提交后出现的新图片。
- 文字档案和项目上下文能提高连续性，但网页生图不提供身份锁定保证；要求高一致性时，应在允许目录中提供同一张人物参考图，并在连续请求中复用。
- ChatGPT Projects 的按钮和字段会随网页版本或语言变化；当前自动创建支持中文和英文界面。
- 验证码、二次登录、地区限制、账号额度和内容安全拦截需要操作者在可见浏览器中处理。
- 如果 ChatGPT 明确只返回要求补充必要输入的文字而没有开始图片生成，工具会 fail-fast 并返回经过清洗的相关 assistant 回复/片段；Windows dedicated-profile production route 已完成该行为与 cleanup 验收。
- 网页端不提供稳定的模型响应元数据，本工具不会声称验证了底层具体模型。
- CDP 模式不会主动关闭操作者的 Chrome；专用 profile 模式在 CLI/MCP 正常退出时会关闭自己启动的窗口。

## License

MIT。此许可证只覆盖本仓库代码，不授予 ChatGPT、OpenAI 服务或生成内容之外的任何权利。
