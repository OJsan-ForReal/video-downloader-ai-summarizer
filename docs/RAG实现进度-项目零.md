# RAG方案实现进度记录：项目零（字幕问答system prompt扩展）

> 每完成一个模块就写一份这样的记录，方便你之后回头问细节。这一份对应
> 《RAG功能设计文档.md》v2的"项目零"部分，已经改完代码、跑过烟雾测试、commit到本地仓库。

## 改了哪个文件

只有 `backend/summarizer.py` 一个文件，commit `fb757f2`。

## 具体改了什么

**1. 新增两个模块级辅助函数**（在文件顶部，`_is_bilibili_url`函数下面）：

```python
def _format_ts(seconds: float) -> str:
    """时间戳格式化成 mm:ss，超过1小时用 hh:mm:ss"""
    ...

def _build_full_text(segments: list[dict]) -> str:
    """拼接字幕全文，逐行带时间戳前缀（而不是纯文本 join）"""
    return "\n".join(f"[{_format_ts(seg['start'])}] {seg['text']}" for seg in segments)
```

**2. 三处字幕拼接逻辑统一改用上面这个函数**（原来是`" ".join(seg["text"] for seg in
segments)`，时间戳被扔了）：
- `_download_and_parse`路径（YouTube/其他平台，VTT解析）
- `_transcribe_with_whisper`路径（Whisper转录兜底）
- `_extract_bilibili`路径（B站CC字幕）

现在字幕文本长这样（喂给AI的实际内容）：
```
[00:00] 这是第一句字幕
[00:03] 这是第二句字幕
[01:03] 时间超过一分钟之后长这样
[1:01:01] 超过一小时是这个格式
```

**3. 新增`SUBTITLE_CHAT_SYSTEM_PROMPT`常量**，替换掉原来写死在`chat_stream`里的那句
简单system prompt。新版本包含四层要求：
- 专注回答当前视频内容（原有）
- 不知道就诚实说、不编造（**从原来user prompt结尾那句挪过来的，现在是system层硬性约束**）
- 优先引用具体时间点（新增，靠上面第2点的时间戳前缀实现）
- 跟随用户提问语言回答，不固定某一种语言（新增）

**4. `_build_chat_prompt`（user prompt构建函数）删掉了两处内容**：
- 结尾"请基于视频内容给出准确、详细的回答..."那句——已经在system prompt里了，不重复
- 开头"使用{cfg['name']}回答"这个语言强制指定——**这是我在实现时发现的一个隐藏冲突**：
  system prompt已经要求"跟随用户提问语言"，如果user prompt这边又强制指定另一种语言，
  两条指令会互相打架，模型行为会不可预测。所以把这条也去掉了，`language`参数目前在这个
  函数里暂时没用到（保留参数是因为调用方`chat_stream`还在传，改函数签名要牵动调用点，
  这次没必要一起动）

## 怎么验证的

1. `python -c "import summarizer"`——确认没有语法错误
2. 本地重启后端（`python main.py`），确认能正常启动
3. 直接调用`_format_ts`/`_build_full_text`跑了几个边界case（0秒、1分钟出头、超过1小时），
   输出格式符合预期

**没有做的验证**：没有真的调用一次完整的AI问答（那个需要真实调用OpenRouter，会消耗一点
额度），只验证到"prompt组装出来的内容是对的"这一层。如果你想要我实际拿一个视频测一次
真实问答效果（确认AI真的会引用时间点、真的会诚实说不知道），告诉我，我可以跑一次。

## 跟原方案文档的一致性

对照《RAG功能设计文档.md》v2第1节，这次改动跟方案里写的完全一致，没有临时改动设计。

## 下一步

按文档里的实现顺序，下一步是"字幕持久化"（文档3.4节）——现在字幕还是用完即扔，这是
后面字幕RAG、对话记忆功能的前置依赖。要开始这一步吗？
