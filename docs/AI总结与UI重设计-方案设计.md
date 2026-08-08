# AI 视频总结 + UI 重设计 - 方案设计

## 1. 背景

竞品调研对象：[BibiGPT](https://bibigpt.co/)（粉青撞色，个性化强）、[NoteGPT](https://notegpt.io/cn/bilibili-summarizer)（蓝白配色，克制专业，风格更贴近本次目标）。

调研结论见对话记录，核心参考点：
- NoteGPT 的蓝白配色 + 白卡片输入区
- NoteGPT 首页示例缩略图**完整显示封面**（不用 `object-cover` 硬裁）

## 2. UI 重设计

### 2.1 配色
从当前的黑底荧光绿（cobalt 风）改为**白底 + 蓝色强调色**，参考 NoteGPT：
- 背景：白色 / 浅灰
- 强调色：蓝色系（按钮、Tab 高亮、链接）
- 卡片：白底 + 浅描边 + 轻阴影，替代原来的深色卡片

### 2.2 缩略图显示
`ResultCard.jsx` 当前用 `aspect-video object-cover` 会裁掉封面上下（很多中文视频封面是方形或内容顶满四角）。改为：
- 用 `object-contain` 完整显示封面，容器背景填充浅灰/模糊底色，避免非 16:9 封面出现难看的留白硬边

## 3. AI 视频总结功能

### 3.1 整体思路
完全照抄参考仓库 `backend/summarizer.py` + `backend/api_summarize.py` 的实现思路（这套已经过验证，字幕抓取策略、Prompt 设计都很成熟），去掉登录/配额相关逻辑（我们 MVP 没有用户系统）。

### 3.2 后端设计

**新增文件**：
```
backend/
├── summarizer.py         # SubtitleExtractor + VideoSummarizer
├── main.py                # 新增 /api/summarize、/api/chat 两个 SSE 接口
├── .env                   # DEEPSEEK_API_KEY（不进 git）
└── requirements.txt       # 新增 openai、python-dotenv、sse-starlette
```

**SubtitleExtractor**（字幕提取）：
- 优先抓平台自带字幕：yt-dlp 的 `subtitles`（人工）> `automatic_captions`（自动）
- B 站额外走专用 API（`api.bilibili.com/x/v2/dm/view`）获取 CC 字幕，因为 yt-dlp 对 B 站字幕支持较弱
- 没有字幕的视频直接返回"无法总结"，不做语音转文字兜底（MVP 范围内）

**VideoSummarizer**（DeepSeek 调用）：
- `summarize_stream()`：流式生成摘要（概述/大纲/要点/总结四段式 Prompt）
- `generate_mindmap()`：非流式生成思维导图 Markdown（`#`/`##`/`###` 层级结构）
- `chat_stream()`：基于字幕内容的多轮问答

**接口**（SSE，事件类型：`subtitle` / `summary` / `mindmap` / `done` / `error`）：
- `POST /api/summarize {url, language}` — 依次推送 字幕→摘要(流式token)→思维导图→完成
- `POST /api/chat {url, question, subtitle_text}` — 流式推送回答

### 3.3 前端设计

**新增依赖**：`marked`（Markdown 渲染）、`markmap-lib` + `markmap-view`（交互式思维导图，参考项目同款，框架无关可直接用于 React）

**新增文件**：
```
frontend/src/
├── api/summarize.js       # fetch + ReadableStream 手写解析 SSE（POST 带 body，不能用 EventSource）
└── components/
    └── SummaryPanel.jsx   # Tab：摘要/字幕/思维导图/问答
```

**SummaryPanel 功能**（对齐参考项目）：
- 摘要 Tab：Markdown 渲染，流式打字效果
- 字幕 Tab：带时间戳列表，展开/收起，下载 SRT/VTT/TXT
- 思维导图 Tab：markmap 渲染，支持全屏、下载 PNG（4K）/SVG
- 问答 Tab：多轮对话气泡 UI，流式回答

### 3.4 与 MVP 阶段的差异
- 不做登录/配额限制（参考项目要求登录+每日次数限制，我们直接开放使用）
- 不做 Notion/Obsidian 等笔记同步（P2，本次不做）

## 4. 待确认 / 阻塞项

- **DEEPSEEK_API_KEY**：需要用户提供后才能联调测试，在此之前先完成代码编写，key 到位后统一测试

## 5. 开发步骤

1. 后端：`summarizer.py` + 两个 SSE 接口，先用假数据/占位联调 SSE 链路是否打通
2. 前端：`SummaryPanel.jsx` + SSE 消费逻辑 + markmap 渲染
3. UI 重设计：配色 + 缩略图显示方式
4. 拿到 DEEPSEEK_API_KEY 后端到端联调
5. 自主测试验证 + 找用户验收
