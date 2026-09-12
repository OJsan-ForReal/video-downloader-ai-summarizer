# 任务6实现进度记录：对话记忆（Conversation Memory）

> 对应任务文档《任务6-对话记忆.md》。这是独立功能，不依赖 `rag.py`，也不依赖任务4/5的
> 检索进度，可以单独验证。

## 改了哪些文件、具体做了什么

1. **`backend/db.py`**：新增 `ChatHistory` 表（`id` / `video_id` / `session_id` / `role` /
   `content` / `created_at`），写法跟 `SubtitleSegment`、`Feedback` 一致（`Mapped[...]` +
   `mapped_column(...)`）。这张表跟 `stats.py` 里那批统计表一样，读写走异步 SQLAlchemy
   session，不是 `summarizer.py` 里字幕缓存用的独立同步 sqlite3 连接。

2. **新建 `backend/chat_history.py`**：跟 `stats.py`（`增量计数器`/`访问日志`那些辅助函数）
   同样的组织方式——表结构定义留在 `db.py`，读写逻辑单独成一个模块。三个函数：
   - `video_id_for_url(url)`：对 URL 做 sha256 哈希，作为 `ChatHistory.video_id`。**这个
     video_id 是独立于 `summarizer.py` 内部字幕缓存用的 video_id（"平台:视频ID"）的一套
     标识**——对话记忆不需要知道字幕那边具体怎么解析ID，自己对URL算一个稳定key更简单，
     也符合任务文档"不依赖任务4/5"的要求。
   - `append_message(session, video_id, session_id, role, content)`：插入一行。
   - `get_recent_history(session, video_id, session_id, limit=10)`：按 `id` 倒序取最近
     `limit` 条再反转（不是按 `created_at` 倒序——同一进程里连续两次写入的时间戳可能落
     在同一毫秒，autoincrement 的 `id` 才是插入顺序的可靠依据），返回
     `[{"role": ..., "content": ...}, ...]`（旧→新），可以直接接到 prompt 的 messages 列表里。

3. **`backend/summarizer.py`**：`VideoSummarizer.chat_stream` 新增 `history` 参数，内部改成
   拼装 messages 数组而不是拼一整段字符串（做法见下一节）。原来的 `_build_chat_prompt`
   拆成 `_build_chat_context_prompt`（只负责把字幕内容包成一条 user 消息，不再把问题也拼
   进去）。

4. **`backend/main.py`**：
   - `ChatRequest` 新增必填字段 `session_id: str`（前端负责生成/传递，见任务文档"具体怎么
     进入设计"一节，后端不管它具体怎么来的）。
   - `/api/chat` 路由：拿到字幕后，先 `get_recent_history()` 查最近10条历史，传给
     `chat_stream()`；流式返回全部 token 给前端的同时用 `answer_parts` 攒下完整回答；等
     回答生成完（`for` 循环走完之后），调用两次 `append_message()`，把这一轮的用户提问和
     AI回答都存进 `ChatHistory` 表。
   - 如果字幕提取失败提前 `return`，或者中途抛异常，这一轮不会写入历史——不完整的对话不
     值得占一条历史记录，也避免"用户提问存了但AI回答没存"这种半吊子状态。

## 历史记录具体是怎么拼进 prompt 里的

不是把历史记录拼成一整段字符串塞进一条 user 消息，而是**每条历史记录变成一条独立的
message**，参考的是 OpenAI/LangChain 多轮对话的常见做法。完整的 messages 数组结构：

```
[
  {"role": "system",  "content": <SUBTITLE_CHAT_SYSTEM_PROMPT，固定角色设定，不含字幕>},
  {"role": "user",    "content": <字幕内容，只在这一条消息里出现一次>},
  {"role": "user",    "content": "第一轮的问题"},        ← 历史，来自 get_recent_history
  {"role": "assistant","content": "第一轮的回答"},        ← 历史
  {"role": "user",    "content": "第二轮的问题"},        ← 历史（如果有）
  {"role": "assistant","content": "第二轮的回答"},        ← 历史
  {"role": "user",    "content": <这一轮用户刚问的新问题>}  ← 当前问题，永远是最后一条
]
```

关键设计取舍：**字幕内容只在第二条消息里出现一次，不会随着每一轮历史重复**。之前的实现
是把字幕原文拼进每次提问的 prompt 里（"以下是视频字幕内容：...\n用户问题：xxx"）；改成
多轮对话后如果继续这么做，历史里的每一轮问题都会带着一份完整字幕文本，字幕内容会被重复
发送好几遍，白白消耗 token（字幕本身最长截断到12000字符，很容易把免费模型的上下文塞满）。
现在字幕只在对话开头的一条 user 消息里出现，后面的历史轮次只存"用户实际问了什么/AI实际
答了什么"这两句话本身，干净很多。

### 实际跑出来的一段 messages 示例

（用测试脚本构造的例子，字幕内容做了截断展示）

```python
[
  {"role": "system",
   "content": "你是一个视频内容问答助手，专注于回答当前视频内容相关的问题。根据提供的视频字幕内容来回答用户的问题。如果问题超出视频内容范围、或者字幕内容中没有相关信息，请诚实告知用户你不知道，不要编造答案。回答时如果能对应到具体时间点，优先引用（例如\"在03:12提到...\"）。请使用用户提问所使用的语言回答，不要固定用某一种语言。"},
  {"role": "user",
   "content": "以下是一个视频的字幕内容，请根据这些内容回答我接下来的问题。\n\n视频字幕内容：\n[00:00] 大家好，今天讲一下……"},
  {"role": "user", "content": "这个视频讲了什么？"},
  {"role": "assistant", "content": "这个视频主要讲了三个知识点：第一……第二……第三……"},
  {"role": "user", "content": "你刚才说的第二点能展开讲讲吗"}
]
```

第二轮问题里的"第二点"，模型能靠上一条 assistant 消息（历史里存的完整回答）分辨出来，
不需要用户重新描述"第二点"具体是什么，这就是任务要的"多轮对话上下文连贯"。

## 四条验收标准的验证结果

用一个独立测试脚本（临时 sqlite 文件，用完即删，没有留在代码库里）跑了前三条，第四条
用真实的 `_build_chat_context_prompt` + messages 拼装逻辑验证了结构正确性：

1. **滑动窗口**：对同一个 `video_id + session_id` 连续插入15条消息，调用
   `get_recent_history(limit=10)`，实际只返回最后10条（`q10/a10 ... q14/a14`），且顺序是
   旧→新，不是全部15条。✅ 通过。
2. **`session_id` 隔离**：往 `session_1` 写数据后，用 `session_2` 查同一个视频的历史，
   返回空列表——不会串。✅ 通过。
3. **`video_id` 隔离**：同一个 `session_1`，往 `video_b` 写一条消息，查 `video_a` 的历史
   不会看到 `video_b` 那条，查 `video_b` 的历史也不会看到 `video_a` 那15条。✅ 通过。
4. **真实多轮对话（"记得住第一轮说了什么"）**：这一条按任务文档的说明，验证到了"历史被
   正确拼进给 LLM 的 messages 里"这一步——用 `get_recent_history` 取回的历史，加上
   `_build_chat_context_prompt` 生成的字幕上下文消息、当前新问题，拼出的 messages 数组
   结构、顺序、内容都符合预期（见上面的示例）。**没有真的调用一次 OpenRouter 验证模型
   实际回答的语义是否连贯**——避免额外消耗 OpenRouter 免费额度，任务文档里也把这个作为
   备选项列出。如果需要，可以在 backend 起服务后用真实浏览器/前端手动问两轮做最终确认
   （这一步要等任务7前端接入 `session_id` 之后才能完整走通，因为 `session_id` 现在是
   `ChatRequest` 的必填字段）。

## `session_id` 接入设计：有没有发现问题

任务文档定的方案（已登录传 `user.id`、未登录传前端生成存 `localStorage` 的 UUID）在实现
过程中没有发现问题，后端这边只是原样接收 `session_id: str` 字段，不做任何生成/校验逻辑，
设计上是自洽的。唯一值得记一笔的点：

- **`session_id` 现在是必填字段（没有默认值）**。这意味着任务7前端接入之前，如果有测试
  脚本或者前端旧代码调用 `/api/chat` 没带这个字段，请求会直接因为 422 参数校验失败被拒绝，
  而不是"悄悄退化成没有历史记忆"。这是有意的——如果给个空字符串默认值，所有未登录、没走
  完整前端流程的请求会共享同一个 `session_id=""`，历史记录会串到一起，属于比"接口报错"更
  隐蔽也更糟的问题，所以选择让它在接入不完整时直接暴露出来，而不是默默产生脏数据。

## 技术约束遵守情况

- 没有引入 Redis 或其他外部缓存，用的是已有的 SQLite（`ChatHistory` 表）。
- 没有做基于向量检索的"长期记忆"，`get_recent_history` 就是简单的按时间窗口查询。
- 没有修改 `SubtitleSegment`、`User` 等已有表结构。
- 没有依赖 `rag.py`。
