# RAG方案实现进度记录：字幕持久化（文档3.4节）

> 对应《RAG功能设计文档.md》v2第3.4节。commit `01ef26c`。

## 改了哪两个文件

- `backend/db.py`——新增`SubtitleSegment`表
- `backend/summarizer.py`——新增缓存读写逻辑，接入`SubtitleExtractor.extract()`

## 表结构（`db.py`）

```python
class SubtitleSegment(Base):
    __tablename__ = "subtitle_segment"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    video_id: Mapped[str] = mapped_column(String(128), index=True)
    segment_index: Mapped[int] = mapped_column(Integer)
    start_time: Mapped[float] = mapped_column(Float)
    end_time: Mapped[float] = mapped_column(Float)
    text: Mapped[str] = mapped_column(Text)
    language: Mapped[str] = mapped_column(String(20))
    subtitle_type: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime, index=True, default=datetime.utcnow)
```

跟方案文档草稿相比多存了`language`和`subtitle_type`两列——这是实现时发现必须加的：不加
这两列的话，缓存命中时没法拼出跟原来`extract()`同样形状的完整结果字典（前端需要这两个
字段），所以补上了，不是临时改设计。

## `video_id`怎么定的（这是我实现时自己拍板的，之前没跟你确认过具体规则）

用 **`f"{extractor_key}:{yt-dlp原生id}"`** 这个组合：
- B站：`bilibili:BV1xxxxxxxx`（`bvid`是纯正则从URL解析出来的，不用等API返回，免费）
- 其他所有平台（YouTube等1800+个）：`youtube:dQw4w9WgXcQ`这种，`extractor_key`和`id`
  都是yt-dlp自己在解析视频信息时就返回的标准字段，不需要额外网络请求，复用的是
  `_get_video_info()`这个原本就要调用的接口

**为什么不用原始URL当key**：同一个视频URL可能带不同的查询参数（比如`&t=30s`、`&list=xxx`），
直接用URL当key会把同一个视频误判成不同视频，缓存命中不了，白白浪费。用`extractor_key:id`
这个组合是yt-dlp给每个视频生成的规范化标识，同一个视频不管带什么参数结果都一样。

如果你觉得这个规则不对，告诉我，改起来不麻烦（只影响`extract()`里两行`video_id = ...`）。

## 关键实现细节：为什么读写用的是普通sqlite3，不是项目里到处在用的SQLAlchemy异步session

`SubtitleExtractor.extract()`是被`main.py`用`loop.run_in_executor(None, extractor.extract,
...)`扔进线程池跑的**同步函数**（因为yt-dlp/Whisper这些底层调用本身是阻塞的）。项目里其他
地方用的`AsyncSession`是异步的，硬塞进一个同步的线程池函数里会很别扭。所以这里单独开了一个
普通的`sqlite3.connect('app.db')`连接，跟`db.py`那套异步ORM完全独立，指向同一个数据库文件，
两边互不冲突。

`db.py`里加`SubtitleSegment`这个ORM类**只是为了让`create_db_and_tables()`统一建表**，
实际的读写走的是`summarizer.py`里两个独立函数（`_get_cached_segments`/`_save_segments`），
不经过这个ORM类操作数据。如果你想统一成同一套写法（都用异步ORM），需要把
`SubtitleExtractor.extract()`整个改造成异步函数，改动会牵动`main.py`的调用方式，这次
没有一起做（范围会变大很多），先用这个更简单的方案跑起来。

## 缓存逻辑具体怎么工作的

`extract()`现在的流程：
1. 算出`video_id`
2. 先查缓存（`_get_cached_segments`）——**命中就直接返回，完全跳过字幕下载和Whisper转录**
   这两个最耗时/耗Groq额度的步骤
3. 没命中就跟原来一样走提取逻辑，提取成功后顺手存一份（`_save_segments`），下次直接命中

`_save_segments`每次是"先删除这个video_id的旧记录，再整批插入新的"，不是"追加"——避免
同一个视频反复被问、反复触发保存时，表里越攒越多重复行。

## 怎么验证的

1. `python -c "import summarizer"`——确认无语法错误
2. 重启本地后端，确认`subtitle_segment`表被正常建出来（直接查了`sqlite_master`确认
   建表SQL符合预期）
3. **直接调用`_save_segments`/`_get_cached_segments`跑了一次完整round-trip测试**（不
   经过真实的yt-dlp/Whisper调用，纯测缓存读写逻辑本身）：
   - 存进去再读出来，内容、`full_text`里的时间戳格式都对
   - 同一个`video_id`重复save两次，确认表里没有变成4行（还是2行，删旧插新生效了）
   - 查一个不存在的`video_id`，确认正确返回`None`
   - 测试用的假数据（`video_id='test:smoke123'`）测完手动删掉了，没有留在真实数据库里

**没有做的验证**：没有跑一次真实的端到端流程（真的解析一个视频、真的问两次同一个视频、
确认第二次真的没有再调用Whisper）。这个要花真实的Groq额度+ 等一次真实的视频下载时间，
如果你想验证这个真实效果，告诉我，我可以拿一个短视频跑一次。

## 下一步

按文档实现顺序，下一步是"FAQ问答"（文档第2节，项目一）——这个是独立的新功能，需要你先
提供10-20条FAQ内容（三种语言各一份，方案A）才能真正把检索逻辑跑起来；也可以先把`rag.py`/
`faq.py`两个文件的骨架和不依赖具体FAQ内容的部分（Chroma初始化、embedding模型加载、LCEL
链路组装）先搭起来，FAQ具体文案你之后再给。要哪种顺序？
