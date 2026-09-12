# RAG方案实现进度记录：FAQ智能问答（项目一，QA agent）

> 对应任务文档`给subagent的需求文档/任务4-FAQ问答完整实现.md`。依赖`backend/rag.py`
> （共享基础设施，见`RAG实现进度-共享基础设施.md`）和`backend/faq_data/`三语言FAQ
> 内容，两者都是已完成的既有成果，这次只加FAQ问答自己的业务逻辑，没有改它们。

## 改了哪些文件

### 新增 `backend/faq.py`

- `load_faq_into_chroma() -> int`——读三个JSON文件（`faq_data/faq_zh.json`/`faq_en.json`/
  `faq_pt.json`），把每条FAQ的**question文本**embedding后写入Chroma，返回写入总数。
  也是这个文件的`if __name__ == "__main__"`入口，可以单独跑`python faq.py`手动灌一次数据。
- `build_faq_system_prompt(is_first_turn: bool) -> str`——原样照抄任务文档给的实现，
  没有改措辞。
- `_format_context(results: list[dict]) -> str`——把`rag.query()`返回的检索结果拼成
  `Q: ...\nA: ...`格式的纯文本，喂给LLM当上下文。
- `_retrieve_and_build_messages(input_data: dict) -> list`——LCEL链路里`RunnableLambda`
  包的那个函数，见下面"LCEL链路"一节详细讲。
- `_get_llm() -> ChatOpenAI`——懒加载单例，创建LangChain的`ChatOpenAI`客户端。
- `faq_chat_stream(question, language, is_first_turn)`——对外主入口，一个生成器函数，
  流式yield每个回答token字符串，`main.py`的路由直接遍历它。

### 修改 `backend/main.py`

- 新增`import faq`（跟`import quota`放一起）
- 新增`FaqChatRequest`（Pydantic请求体）：`question: str`、`language: str = "zh"`、
  `is_first_turn: bool = True`
- 新增`POST /api/faq/chat`路由（`faq_chat`函数），结构参照现有`/api/chat`：
  `EventSourceResponse`流式返回，事件类型`answer`（每个token）/ `done` / `error`，
  异常用现成的`_friendly_ai_error()`包一层再返回给前端。
  **跟`/api/summarize`、`/api/chat`不同**：这个路由没有接`quota.consume()`——FAQ客服
  问答跟"AI总结/问答"是两类不同的功能配额，任务文档和FAQ内容本身（`faq_011`那条讲的
  就是总结/问答的每日额度）都没提到FAQ问答自己要限流，所以先没加，这属于产品侧决策，
  以后要加的话在这个路由里单独接一个新的限流维度即可。

### 修改 `backend/requirements.txt`

新增两行：`langchain`、`langchain-openai`。安装前用`pip install --dry-run`确认过，
落地版本是`langchain 1.4.0` + `langchain-openai 1.6.0` + `langchain-core 1.6.2`
（连带装了`langgraph`系列依赖，这是langchain 1.x的正常传递依赖，不是我们主动要的），
干跑结果显示**不会改动**已装的`openai`（2.46.0）、`chromadb`（1.5.9）、
`sentence-transformers`（6.0.1）这几个包的版本，没有冲突风险，然后才真正执行安装。

## LCEL链路具体是怎么串起来的

```python
def _retrieve_and_build_messages(input_data: dict) -> list:
    question = input_data["question"]
    language = input_data["language"]
    is_first_turn = input_data["is_first_turn"]

    results = rag.query(
        question, doc_type=FAQ_DOC_TYPE, top_k=FAQ_TOP_K, extra_where={"language": language}
    )
    context = _format_context(results)

    system_prompt = build_faq_system_prompt(is_first_turn)
    user_message = f"以下是从FAQ知识库检索到的相关内容：\n\n{context}\n\n---\n用户问题：{question}"

    return [SystemMessage(content=system_prompt), HumanMessage(content=user_message)]


def faq_chat_stream(question: str, language: str, is_first_turn: bool):
    chain = RunnableLambda(_retrieve_and_build_messages) | _get_llm()
    for chunk in chain.stream({"question": question, "language": language, "is_first_turn": is_first_turn}):
        if chunk.content:
            yield chunk.content
```

大白话解释一下这几行到底在干什么：

1. **`RunnableLambda(_retrieve_and_build_messages)`**——LangChain把一个普通Python函数
   包装成一个"链路节点"（Runnable），这样它就能用`|`（管道符）跟别的Runnable拼起来，
   跟Linux shell里`cmd1 | cmd2`那个"上一个的输出直接变成下一个的输入"是同一个思路。
   这一步本身不调用任何AI，纯粹是"准备材料"：先拿用户问题去`rag.query()`做一次向量
   检索（这一步真正用到了`rag.py`那套embedding+Chroma的基础设施），把检索到的1~2条
   FAQ内容格式化成文本塞进`context`；再看`is_first_turn`是`True`还是`False`，决定
   system prompt要不要带开场白那一段；最后把"人设+规则(system)"和"检索到的内容+
   用户问题(human)"拼成LangChain认识的消息格式（`SystemMessage`/`HumanMessage`），
   这就是要喂给LLM的完整输入了。

   这一步为什么必须写成函数（`RunnableLambda`）而不是用LangChain更"声明式"的
   `ChatPromptTemplate`：`ChatPromptTemplate`是在**定义链路的时候**（也就是程序启动、
   还没收到任何请求的那一刻）就把prompt模板的样子定死了，只能填空替换变量。但这里
   "该不该带开场白"这件事取决于`is_first_turn`——一个只有**运行时收到具体这一次请求**
   才知道的值，静态模板做不到"整段文字加不加"这种条件判断，所以退回到用一个普通函数
   自己写`if`，`RunnableLambda`只是给这个函数套一层"能接入链路"的壳。

2. **`| _get_llm()`**——上一步产出的消息列表，直接作为输入喂给`ChatOpenAI`这个LangChain
   封装的LLM客户端。它底层还是走OpenAI SDK的协议格式去请求OpenRouter的endpoint
   （`base_url="https://openrouter.ai/api/v1"`），只是这次不是像`summarizer.py`那样
   手写`client.chat.completions.create(messages=[...])`，而是LangChain帮忙把
   `SystemMessage`/`HumanMessage`对象自动翻译成OpenAI格式的`messages`数组再发出去。

3. **`chain.stream({...})`**——`RunnableLambda | ChatOpenAI`拼起来的这整条链本身也是
   一个Runnable，调它的`.stream()`方法，输入是一个dict（`{"question":..., "language":...,
   "is_first_turn":...}`），LangChain会自动把这个dict原样传给链路第一个节点（也就是
   `_retrieve_and_build_messages`的`input_data`参数），第一个节点的返回值（消息列表）
   再自动变成第二个节点（`ChatOpenAI`）的输入。`.stream()`比`.invoke()`的区别是不等
   模型把整段话生成完才返回，而是模型每吐出一小段文字（`chunk`）就立刻产出一次，
   `for chunk in chain.stream(...)`这个循环里每转一圈拿到一个`chunk`，`chunk.content`
   就是这一小段文字，`main.py`那边再把每个token包成一个SSE事件发给前端，前端就能看到
   文字一个字一个字往外蹦的效果（跟`/api/summarize`、`/api/chat`用的是同一种SSE机制）。

## 验收标准逐条验证

写了一个独立的验证脚本（`faq.py`跑`load_faq_into_chroma()`灌数据，再依次调
`rag.query()`和`faq.faq_chat_stream()`跑5条验收标准，不是纸面描述），完整终端输出：

```
1. 中文检索：'免费用户每天能问几次问题'，期望第一名 zh_faq_011
  id=zh_faq_011  distance=0.9866  question=AI总结/问答每天能用几次？
  id=zh_faq_002  distance=1.3702  question=需要注册账号才能用吗？
  PASS: True

2. 英文检索：'How many times can I use AI summary per day'，期望第一名 en_faq_011
  id=en_faq_011  distance=0.1440  question=How many times can I use AI summary/chat per day?
  id=en_faq_006  distance=0.7934  question=How does AI summarization work?
  PASS: True

3. 无关问题：'今天天气怎么样'，AI应诚实表示不知道
  回答：抱歉，这个问题超出了我的解答范围。我是这个视频下载网站的客服助手，只负责回答
  关于网站功能、计费、使用方式等问题，关于天气的信息我无法提供，也没有相关的FAQ内容。
  如果您有其他关于视频下载、AI总结、会员服务等问题，欢迎随时向我提问！

4a. is_first_turn=True，回答应包含自我介绍
  回答：你好，我是QA agent，可以帮你解答网站功能、计费、使用方法相关的问题。
  根据FAQ，免费用户每天可以使用AI总结/问答功能**3次**（总结和问答共用同一份额度）...
  PASS: True

4b. is_first_turn=False，回答不应包含自我介绍
  回答：根据FAQ知识库内容，免费账号每天可以使用AI总结/问答功能**3次**。说明中提到，
  总结和问答共用同一份额度，下载功能不需要注册，但AI功能需要登录账号。
  PASS: True

5. upsert幂等性：同一批FAQ数据连续灌入两次，条目数不应翻倍
  灌入前总数(含之前测试数据)=51  第一次灌入后=51  第二次灌入后=51
  PASS: True
```

逐条解读：

1. **中文检索**：`distance`是余弦距离（`rag.py`里`normalize_embeddings=True`归一化后
   算点积距离），越小越相似。`faq_011`以0.9866排第一，跟第二名（`faq_002`，1.3702）
   拉开了明显差距，检索命中符合预期。
2. **英文检索**：英文那句`distance`只有0.1440——比中文那次的0.9866低很多，因为这次
   问句几乎就是`faq_011`英文版question的近义转述，语义高度重合；证明`extra_where={"language": "en"}`
   这层过滤真的生效了，检索只在英文FAQ内部进行，没有跟中文/葡语FAQ混在一起比对。
3. **无关问题兜底**：AI没有编造一个不存在的答案（比如瞎编一个天气数字），而是直接说
   明这超出自己的职责范围，符合system prompt里"诚实告知不确定，不要猜测"的要求。
4. **开场白开关**：`is_first_turn=True`时回答严格以任务文档给定的那句话开头
   （"你好，我是QA agent..."，一字未改）；`is_first_turn=False`时同一个问题直接进
   正题，没有这句话，两次请求用的是完全相同的问题文本，唯一变量就是`is_first_turn`，
   证明这个参数真的在起作用，而不是模型自己随机决定要不要自我介绍。
5. **upsert幂等性**：Chroma集合里FAQ相关条目总数是51（17条×3语言），连续灌两次
   `load_faq_into_chroma()`，总数始终是51，没有变成102——`rag.add_documents()`内部
   用的`collection.upsert()`按id覆盖而不是追加，id没变（同一份JSON文件重新灌），所以
   内容被原地覆盖更新，不会堆积重复条目。

## 技术决策 / 权衡

- **`top_k=2`**：FAQ跟字幕问答不一样，每条FAQ内容是独立、单一话题的一问一答，不像
  字幕片段需要拼凑多段上下文才能回答完整问题。2条能覆盖"精确命中的那条 + 一个语义
  相近的备选"，给太大（比如5）反而容易把不相关的FAQ也塞进`context`里，可能让LLM
  在生成回答时被无关内容干扰、甚至误把不相关FAQ的答案糅合进回复。如果未来发现漏检
  （用户问题措辞跟FAQ差异较大导致没检索到该有的那条），再考虑调大。
- **复用`VideoSummarizer.FALLBACK_MODELS`而不是自己再定义一份模型列表**：这个故障
  转移列表（`openrouter/free`失败自动降级到手动挑的两个免费模型）已经在`summarizer.py`
  里跑通、验证过，FAQ问答没有理由重新维护一份内容一样的配置，直接`from summarizer
  import VideoSummarizer`引用它的类属性，两边模型列表要更新只需要改一个地方。
- **没有照搬`summarizer.py`里`_create()`那套手写指数退避重试**：`ChatOpenAI`构造时
  传了`max_retries=2`，用的是LangChain/OpenAI SDK自带的重试机制，没有再叠一层自己
  写的`time.sleep(backoff)`循环。这是故意简化：`_create()`那套自定义重试是为了应对
  " OpenRouter故障转移列表里的模型同时不可用"这种极端情况精细调过的退避策略，FAQ
  问答场景先用SDK默认重试跑起来，如果以后观测到确实有重试不够用的问题，再对齐
  `summarizer.py`的写法，不提前做过度设计。
- **`temperature=0.3`**（`summarizer.py`的总结/问答用的是0.7）：FAQ问答要求"严格
  只根据检索内容作答，不编造"，是一个偏"抽取式"而不是"创造式"的任务，调低温度让
  模型的回答更贴合检索到的原文，减少自由发挥导致的编造风险。
- **没有接`quota.consume()`限流**：见上面"改了main.py"一节的说明，这是任务范围内
  没有明确要求的产品侧决策，先不加。
- **没有改`rag.py`**：任务文档要求的4个函数（`get_embedding`/`add_documents`/`query`/
  `delete_by_where`）签名和行为完全够用，FAQ这边没有发现缺失的必要能力。
