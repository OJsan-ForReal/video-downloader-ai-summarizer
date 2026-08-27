# 这个项目的数据库层：SQLAlchemy（ORM）速查

这个项目的数据库访问全部通过 **SQLAlchemy** 这个库写，不是手写SQL字符串。这份文档是给
"看代码里一堆`Mapped[...]`/`select(...)`看不懂在干嘛"这种情况用的对照表——左边是项目里
实际出现的写法，右边翻译成大白话和等价的原始SQL。以后遇到看不懂的ORM写法，先来这里对照，
对照不到再问。

## 为什么普通全局搜索（grep/Ctrl+F）在这里不太好使

原始SQL是字符串，比如你要找"谁在查`user`表"，直接搜`"user"`或者`SELECT`这几个词就能全部
找到。ORM不一样——`select(User)`这行代码里，`User`是Python类名，不是字符串"user"，跟数据库
里真实的表名`user`是两个东西（表名是`__tablename__ = "user"`这一行定义的），全局搜索表名
字符串搜不到"哪些地方在查这张表"，得搜类名`User`。这是ORM"隔了一层"必然带来的代价，不是
搜索方式用错了。

---

## 定义一张表（对应 `CREATE TABLE`）

**项目里的写法**（来自`db.py`）：
```python
class VisitLog(Base):
    __tablename__ = "visit_log"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    visit_date: Mapped[date] = mapped_column(Date, index=True)
    ip_hash: Mapped[str] = mapped_column(String(64))

    __table_args__ = (UniqueConstraint("visit_date", "ip_hash", name="uq_visit_date_iphash"),)
```

**大白话**：这个Python类描述了一张叫`visit_log`的表，有`id`（主键，自增）、`visit_date`
（日期类型，建了索引）、`ip_hash`（最长64字符的字符串）三列，并且`visit_date`+`ip_hash`
这两列的组合不能重复。

**等价的原始SQL**：
```sql
CREATE TABLE visit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visit_date DATE,
    ip_hash VARCHAR(64),
    UNIQUE (visit_date, ip_hash)
);
CREATE INDEX ix_visit_log_visit_date ON visit_log (visit_date);
```

**几个符号什么意思**：
- `Mapped[int]` / `Mapped[str]` / `Mapped[date]`——这一列在Python里是什么类型（配合IDE
  自动补全、类型检查用）
- `Mapped[str | None]`——这一列可以是空（SQL里的`NULL`），不加`| None`就是不能为空
- `mapped_column(...)`——括号里进一步指定SQL层面的细节：字符串最大长度（`String(500)`）、
  是不是主键（`primary_key=True`）、要不要建索引（`index=True`）、默认值（`default=False`）
- `relationship(...)`——不是一列，是"这张表跟另一张表的关联"（对应SQL里的外键+JOIN），
  比如`User`类里的`oauth_accounts: Mapped[list[OAuthAccount]] = relationship(...)`

---

## 查数据（对应 `SELECT`）

**项目里的写法**（来自`stats.py`）：
```python
result = await session.execute(
    select(func.count(User.id)).where(User.is_pro.is_(True))
)
pro_users = result.scalar_one()
```

**等价的原始SQL**：
```sql
SELECT COUNT(id) FROM user WHERE is_pro = 1;
```

**更复杂一点的例子**（JOIN + GROUP BY + ORDER BY + LIMIT）：
```python
top_rows = await session.execute(
    select(User.email, func.count(DownloadLog.id).label("cnt"))
    .join(DownloadLog, DownloadLog.user_id == User.id)
    .group_by(User.id)
    .order_by(desc("cnt"))
    .limit(10)
)
```
**等价的原始SQL**：
```sql
SELECT user.email, COUNT(download_log.id) AS cnt
FROM user
JOIN download_log ON download_log.user_id = user.id
GROUP BY user.id
ORDER BY cnt DESC
LIMIT 10;
```

**查完之后怎么取结果**（这几个方法名字容易搞混）：
- `.scalar_one()`——只要一个值，而且**必须**存在（查不到会报错），比如`COUNT(*)`这种一定
  有结果的查询
- `.scalar_one_or_none()`——只要一个值，可能不存在（查不到返回`None`，不报错）
- `.scalars().all()`——要一整列的结果，返回一个列表
- `.all()`——要多列的结果（比如上面JOIN那个例子，每行有`email`和`cnt`两个值），返回
  一堆元组

---

## 插入数据（对应 `INSERT`）

**普通插入**：
```python
session.add(VisitLog(visit_date=date.today(), ip_hash=some_hash))
await session.commit()
```
**等价的原始SQL**：
```sql
INSERT INTO visit_log (visit_date, ip_hash) VALUES ('2026-08-27', 'xxx');
COMMIT;
```

**"插入，如果冲突就跳过"（对应 `INSERT OR IGNORE`）**：
```python
stmt = sqlite_insert(VisitLog).values(visit_date=date.today(), ip_hash=ip_hash)
stmt = stmt.on_conflict_do_nothing(index_elements=["visit_date", "ip_hash"])
await session.execute(stmt)
```
**等价的原始SQL**：
```sql
INSERT INTO visit_log (visit_date, ip_hash) VALUES ('2026-08-27', 'xxx')
ON CONFLICT (visit_date, ip_hash) DO NOTHING;
```

**"插入，如果冲突就更新"（UPSERT，对应 `INSERT ... ON DUPLICATE KEY UPDATE`）**：
```python
stmt = sqlite_insert(StatCounter).values(key=key, value=1)
stmt = stmt.on_conflict_do_update(index_elements=["key"], set_={"value": StatCounter.value + 1})
await session.execute(stmt)
```
**等价的原始SQL**：
```sql
INSERT INTO stat_counter (key, value) VALUES ('ai_chat', 1)
ON CONFLICT (key) DO UPDATE SET value = stat_counter.value + 1;
```

注意：`sqlite_insert`这个函数名带"sqlite"三个字——这是**SQLite专属**写法，之前提过的
"换数据库不用改代码"这个说法在这种地方是不成立的，真换成PostgreSQL这几行要改成
`from sqlalchemy.dialects.postgresql import insert as pg_insert`。

---

## 想亲眼看到真实执行的SQL怎么办

上面这些"等价SQL"是我手动翻译给你看的，不是自动生成的。如果想让程序自己把每一条真正
跑的SQL打印出来，两个办法：

1. **改代码**：`db.py`里`create_engine(DATABASE_URL)`这行改成`create_engine(DATABASE_URL,
   echo=True)`，加`echo=True`之后，每次执行SQL都会打到后端日志里（临时调试用，平时别开着，
   日志会很吵）
2. **直接看数据库文件**：`backend/app.db`就是真实的SQLite数据库文件，装一个"DB Browser
   for SQLite"（图形界面工具）打开它，能看到最终生成的表结构和实际存的数据；或者命令行
   `sqlite3 app.db ".schema"`直接打印所有表的建表语句
