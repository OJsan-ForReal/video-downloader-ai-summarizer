# AI Video Downloader — RAG功能设计文档（v2）

> 本文档面向实现该功能的AI coding agent。请严格按照本文档的技术选型和边界条件执行，
> 遇到未覆盖的关键决策点，**必须先向项目负责人（用户）确认，不要自行选择替代方案**。
>
> v2相对v1的变化：确认了字幕问答system prompt的具体扩展文案、时间戳接入方式、FAQ内容的
> 多语言组织策略（方案A）、embedding模型改为多语言版本、新增两个实现文件的划分、服务器
> 已升级到3.8GB内存（原1GB内存不足以跑embedding模型的风险已解除）。

---

## 0. 背景与现状（实现前必读）

当前系统架构（已确认，无需再调研）：

- 后端：Python + FastAPI
- 数据库：**SQLite**（不是MySQL），当前有7张表：`user`、`oauth_account`、`visit_log`、
  `stat_counter`、`download_log`、`request_log`、`feedback`
- 服务器：Azure VM，`Standard_B2als_v2`，**2 vCPU / 3.8GB内存**（2026-08-27已从1GiB内存
  的`B2ats_v2`升级，原本1GB内存跑不动embedding模型的风险已解决，不用再顾虑内存问题）
- 网站语言：中（默认）/英/葡三语，`frontend/src/i18n/locales/{zh,en,pt}.json`
- 字幕来源：平台自带字幕（YouTube/B站CC字幕）+ Whisper（Groq API）转录兜底
- **当前字幕安全没有持久化**——提取/转录后存在临时文件夹，处理完即删除，请求结束数据就丢失
- 当前"总结"功能：`subtitle_text[:15000]` 字符截断，直接传给LLM
- 当前"问答"功能：`subtitle_text[:12000]` 字符截断，无检索、无记忆，多轮对话靠前端React
  state重复携带
- **关键事实（v2新确认）**：`SubtitleExtractor.extract()`返回的`segments`字段本来就是
  `[{start, end, text}, ...]`结构，前端字幕列表展示、SRT/VTT导出用的都是这个字段。问题
  出在拼`full_text`这一步——现在所有产出`full_text`的地方都是`" ".join(seg["text"] for
  seg in segments)`，时间戳被扔了。`full_text`只在两处被用：(a) 传给summarize/mindmap/
  chat三个AI prompt构建函数；(b) 前端拿到后原样存起来，下次问问题时传回后端（避免重复
  提取字幕）。**前端从来没有直接渲染过`full_text`**，改它的格式对展示层零影响。

本设计文档要解决的问题：
1. 字幕从"用完即扔"改为持久化存储
2. 避免长视频问答质量差（超出12000字符的内容答不出来）
3. 补上时间戳信息，让AI问答能引用具体时间点
4. 缺少对话历史记忆，多轮问答体验割裂
5. 网站没有FAQ/客服问答功能，用户常见问题需要自己翻文档

---

## 1. 项目零：字幕问答system prompt扩展（改动最小，优先做）

**改动文件**：`backend/summarizer.py`
**改动位置**：`chat_stream`（539-550行）+ `_build_chat_prompt`（599-611行）

### 1.1 新的system prompt（在现有基础上扩展，不是重写）

```python
SUBTITLE_CHAT_SYSTEM_PROMPT = (
    "你是一个视频内容问答助手，专注于回答当前视频内容相关的问题。"
    "根据提供的视频字幕内容来回答用户的问题。"
    "如果问题超出视频内容范围、或者字幕内容中没有相关信息，请诚实告知用户你不知道，不要编造答案。"
    "回答时如果能对应到具体时间点，优先引用（例如"在03:12提到..."）。"
    "请使用用户提问所使用的语言回答，不要固定用某一种语言。"
)
```

原来写死在`chat_stream`里的那句简单system prompt，改成上面这个模块级常量。

`_build_chat_prompt`结尾那句"请基于视频内容给出准确、详细的回答。如果视频内容中没有相关
信息，请诚实说明。"整句删掉——这条约束已经挪到system prompt里了，不再在user prompt里重复。

### 1.2 时间戳接入（"引用时间点"这条指令要真正生效，必须先做这个）

修改所有产出`full_text`的地方（`SubtitleExtractor`类里目前有3处这样的拼接逻辑，见
`summarizer.py`第113、198、302行附近），从：

```python
full_text = " ".join(seg["text"] for seg in segments)
```

改成带时间戳前缀、逐行拼接：

```python
full_text = "\n".join(f"[{_format_ts(seg['start'])}] {seg['text']}" for seg in segments)
```

需要新增一个`_format_ts(seconds: float) -> str`辅助函数，输出`mm:ss`格式（超过1小时的视频
输出`hh:mm:ss`），可以参考`downloader.py`里已有的`_format_duration`风格实现。

**影响范围确认**：这一个改动点会自动惠及summary/mindmap/chat三个prompt构建函数（它们都吃
同一个`full_text`）。副作用：加了时间戳前缀后，同样的字符截断上限（15000/12000）里能塞进
去的实际字幕内容会略微变少，影响很小，不用特殊处理。

---

## 2. 项目一：网站FAQ智能问答（"QA agent"）

### 2.1 目标

用户可以直接问网站相关问题（如"支持哪些平台"、"付费的是每天几次总结"、"Stripe订阅怎么
取消"），系统基于FAQ知识库检索并生成自然语言回答，而不是简单返回原始FAQ文字。

助手名称确定为 **QA agent**。

### 2.2 FAQ多语言内容策略（已确认：方案A）

**FAQ内容按语言分开维护**，跟现有`frontend/src/i18n/locales/{zh,en,pt}.json`同一个思路：
用户在哪个语言界面，就只检索对应语言的那一份FAQ内容，不做跨语言检索。

原因：检索逻辑简单、准确率有保障；代价是三份内容要分别维护、保持同步（可接受，FAQ更新频率低）。

数据结构示例（每种语言一份，比如`faq_zh.json`/`faq_en.json`/`faq_pt.json`）：

```json
{
  "id": "faq_001",
  "question": "AI Video Downloader支持哪些平台？",
  "answer": "支持YouTube、Bilibili、Instagram、Twitter/X、TikTok等主流平台...",
  "category": "general"
}
```

**任务**：参考已提供的Y2Mate/YTMP3等同类网站FAQ截图的结构（What is X / Is it free /
supported platforms / max length / where saved / errors 等类目），整理出本项目实际功能
对应的10-20条FAQ问答对，**三种语言各一份**。这部分内容需要用户确认具体的真实性和数字
（比如付费额度次数、最大视频时长等具体数字，AI不要臆造，需用户核定）。

### 2.3 Embedding模型（已确认：换成多语言版本）

v1文档原定的`all-MiniLM-L6-v2`是**以英文为主训练的模型**，对中文/葡语语义理解较弱。既然
FAQ内容三语分开维护（方案A），检索始终发生在"同一种语言内部"，不需要跨语言匹配能力，但
仍然需要模型本身在中文、葡语上有过关的语义理解——所以改用：

**`paraphrase-multilingual-MiniLM-L12-v2`**（sentence-transformers家族，支持50+语言，
体积和速度跟原来那个同量级，服务器内存已经升到3.8GB，跑得动）。

### 2.4 技术选型（其余部分，沿用v1，不要更改）

| 组件 | 选择 | 不要用 |
|---|---|---|
| 向量库 | **Chroma**（本地持久化，存文件） | Pinecone/Qdrant等需要额外付费服务的方案 |
| RAG框架 | **LangChain（LCEL写法）** | LangChain4j（Java）；旧式的`RetrievalQA.from_chain_type()`封装 |
| LLM | 沿用现有OpenRouter调用方式 | 不引入新的AI服务商 |

### 2.5 文件结构（已确认，新增两个文件）

- **`backend/rag.py`**——两个RAG项目（FAQ + 字幕，见项目二）共用的基础设施：Chroma集合
  初始化、embedding模型加载、按`type`字段（`faq` / `subtitle`）区分数据源的通用检索函数
- **`backend/faq.py`**——FAQ功能专属：FAQ多语言数据加载、QA agent的两个system prompt
  变体、LCEL链的组装、FastAPI路由

### 2.6 QA agent的system prompt设计（两个变体）

```python
def build_faq_system_prompt(is_first_turn: bool) -> str:
    base = (
        "你是本网站（AI Video Downloader）的客服助手QA agent，基于网站FAQ知识库回答用户"
        "关于产品功能、计费、使用方式等问题。只根据检索到的FAQ内容作答，不要编造网站没有的"
        "功能、政策或数字。如果检索到的内容不足以回答用户问题，诚实告知用户你不确定，不要猜测。"
    )
    if is_first_turn:
        base += (
            "\n\n这是对话的第一条消息，请先用一句话自我介绍："
            "\"你好，我是QA agent，可以帮你解答网站功能、计费、使用方法相关的问题。\""
            "然后再回答用户实际的问题（如果有的话）。"
        )
    return base
```

因为FAQ内容按语言分开维护、检索只在当前语言内进行，回答语言天然跟随用户当前的网站语言，
不需要再让system prompt额外处理"跟随用户提问语言"这条（跟项目零的字幕问答不同，那边是
单一语言字幕但支持任意语言提问，两个场景机制不一样，不要混淆）。

`is_first_turn`具体怎么判断，依赖下面2.7节的`session_id`持久化方案，目前先留空接口。

### 2.7 LCEL链路设计（LangChain怎么接）

1. **LLM这一步**：用LangChain的`ChatOpenAI`类，`base_url`指向OpenRouter的endpoint、
   `api_key`用现有的`OPENROUTER_API_KEY`——本质是同一个OpenRouter账号换一种Python调用
   方式，不是接了新的AI服务商
2. **动态选择system prompt**这个需求（开场白只在第一轮出现），用`RunnableLambda`做一个
   自定义步骤，根据传入的`is_first_turn`标志位选出该用哪个system prompt变体，再往下传
   给LLM。链路大致是：
   ```
   检索FAQ + 用户问题 + is_first_turn标志
     → RunnableLambda（选system prompt + 组装完整消息列表）
     → ChatOpenAI
     → 流式输出
   ```
3. **新增依赖**：`langchain`、`langchain-openai`、`langchain-chroma`（或`chromadb`+薄
   封装），需要加进`requirements.txt`

### 2.8 边界条件 / 需要向用户确认的点

- [ ] FAQ具体内容（10-20条×3语言）——需要用户核对真实数字和政策细节
- [ ] 检索不到相关FAQ时的兜底话术具体文案
- [ ] 是否需要记录用户问过的问题（用于后续分析高频问题）

---

## 3. 项目二：视频字幕问答（带对话记忆 + 自适应检索策略）

### 3.1 目标

解决当前长视频问答质量差的问题，同时补上字幕持久化和多轮对话记忆能力。

### 3.2 核心设计原则（重要，必须遵守）

**不是无脑全部走RAG。** 根据字幕长度动态选择策略：

```python
def get_video_context(video_id, question, chat_history):
    full_text = get_subtitle(video_id)  # 从持久化存储读取，不是重新提取

    if token_count(full_text) <= CONTEXT_LIMIT_THRESHOLD:
        context = full_text  # 短视频：直接全塞注入，不走检索
    else:
        context = rag_retrieve(video_id, question)  # 长视频：走RAG检索

    return build_prompt(context, question, chat_history)
```

理由：短视频场景下，直接全塞注入比RAG更准确（不存在"检索漏掉相关内容"的风险），RAG只
在字幕长度超出上下文承载能力时才是必要的。`CONTEXT_LIMIT_THRESHOLD`具体数值需要测试后
确定，建议以当前使用的LLM模型的实际有效上下文窗口为参考（不是模型宣称的最大窗口），要
留出给prompt模板和对话历史的空间。

### 3.3 数据结构（跟FAQ共用`rag.py`基础设施，靠`type`字段区分）

```python
{
    "content": "...",
    "type": "faq" | "subtitle",
    "video_id": "xxx",  # subtitle类型需要，检索时过滤，避免跨视频内容混淆
    "start_time": 123.4,  # subtitle类型需要，来自Whisper/VTT解析的时间戳
    "end_time": 145.2,
    "embedding": [...]
}
```

**关键要求：检索结果必须带时间戳返回**，前端可以展示"这个回答参考自 08:23"这类信息。

### 3.4 字幕持久化设计（前置依赖，必须先做）

**这是本项目的第一步，其他都依赖这一步先完成。**

新增数据库表（沿用SQLite）：

```sql
CREATE TABLE subtitle_segments (
    id INTEGER PRIMARY KEY,
    video_id TEXT NOT NULL,
    segment_index INTEGER,
    text TEXT,
    start_time REAL,
    end_time REAL,
    created_at TIMESTAMP
);
```

**任务**：修改现有的`_download_and_parse()`和`_download_audio()`+ Whisper转录流程，在
临时文件被清理**之前**持久化，把segments存入这张表。这样同一个视频第一次被问答后，下次
被问答不需要重新提取/重新调用Whisper（省Groq额度）。

### 3.5 分块策略（RAG部分）

字幕本身已经是segment（句子/短语级别）分好的，**不需要额外按字符数分块**。建议按时间窗口
合并相邻segment成chunk（比如30秒一个chunk，或者N个segment合并为一个chunk），避免单个
chunk太碎导致检索到的内容缺乏上下文。

**需要向用户确认**：具体chunk时间窗口/segment合并数量，建议先用一个默认值（如30秒），
后续根据实际检索效果调整，不要一开始就过度设计成可配置参数。

### 3.6 对话记忆设计（Conversation Memory）

**这部分不是RAG，是独立功能，不要跟检索逻辑混在一起。**

- 采用**滑动窗口**方案，保留最近**10-50条**对话记录，具体数字待用户确认，建议默认10条
- 存储位置：**沿用SQLite**，不需要额外引入Redis等缓存服务
- 新增表：

```sql
CREATE TABLE chat_history (
    id INTEGER PRIMARY KEY,
    video_id TEXT NOT NULL,
    session_id TEXT NOT NULL,  -- 用于区分不同用户/会话，具体持久化策略待用户确认
    role TEXT,  -- "user" | "assistant"
    content TEXT,
    created_at TIMESTAMP
);
```

- 每次问答时，查询该`video_id + session_id`最近N条记录，拼入prompt（与context/RAG检索
  结果无关，一起传给LLM）

### 3.7 边界条件 / 需要向用户确认的点

- [ ] `session_id`具体持久化方案——是否复用现有的用户账号系统（已登录用户）、未登录用户
  怎么处理（浏览器指纹？临时token？）
- [ ] 滑动窗口具体保留几条（10条还是50条，两者对token成本影响较大）
- [ ] `CONTEXT_LIMIT_THRESHOLD`（直接注入 vs RAG检索的分界线）具体数值
- [ ] chunk合并的时间窗口/segment数量具体值
- [ ] 检索到的时间戳信息，前端展示的具体交互方式（点击时间戳能不能跳转到视频对应位置），
  这个如果要做同步前端改动，需要用户确认优先级

---

## 4. 明确不做的事（避免过度设计）

- 不做Graph RAG（知识图谱），当前场景不需要
- 不做query改写、rerank等Advanced RAG优化手段，先跟进Naive RAG，够用不多做额外叠加
- 不引入需要额外部署/付费的向量数据库服务
- 不用Java生态的任何框架（LangChain4j、Spring AI等），本项目技术栈是Python
- 对话记忆不做基于向量检索的长期记忆，滑动窗口足够
- FAQ内容不做跨语言检索（方案B），按方案A分语言维护

---

## 5. 实现顺序建议

1. **项目零**：字幕问答system prompt扩展 + 时间戳接入full_text——改动最小，独立且立即
   见效，优先做
2. **字幕持久化**（3.4）——下一步，后面都依赖这一步先完成
3. **FAQ问答**（项目一）——独立、简单，可以先跑通一个可展示的demo
4. **字幕分块 + embedding + 存Chroma**（3.5）
5. **检索 + 自适应策略**（3.2, 3.3）
6. **对话记忆**（3.6）
7. **前端时间戳展示**（3.7最后一项，视情况决定是否本轮做）

---

## 6. 给AI Agent的执行规则

- 遇到本文档"边界条件"里列出的任何一项，**先查询问用户，不要自行假设默认值继续往下实现**
- 每完成一个模块，**先给出这个模块的设计说明（不超过5句话），等用户确认再写代码**，不要
  一次性把所有代码都写完再展示
- 涉及具体数字（额度、时长限制、价格等产品信息），**不要臆造，必须向用户核实**
- 保持现有代码风格和项目结构，新增表/新增依赖需要在给出设计说明时一并列出，方便用户
  评估改动范围
