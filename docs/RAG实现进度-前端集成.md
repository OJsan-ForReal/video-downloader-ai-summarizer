# RAG方案实现进度记录：前端集成（任务7）

> 对应《任务7-RAG前端集成.md》。这是纯前端任务，对接的三个后端功能（FAQ问答/任务4、
> 字幕RAG时间戳/任务5、对话记忆/任务6）当时都还没实现完（`backend/`目录下没有
> `faq.py`，`main.py`里也没有`/api/faq/chat`、`/api/chat/history`这两个接口，
> `ChatRequest`也没有`session_id`字段），所以下面标了"⚠️假设接口"的地方，是按
> 《RAG功能设计文档.md》和任务文档里描述的样子先实现的，**没有跟真实后端联调过**。

## 新增了哪些文件

| 文件 | 负责什么 |
|---|---|
| `frontend/src/components/FaqChatWidget.jsx` | 新增组件：全站悬浮的FAQ问答入口（任务4） |
| `frontend/src/api/faq.js` | 新增：`faqChat()`，封装`POST /api/faq/chat`的SSE流式请求 |
| `frontend/src/utils/session.js` | 新增：`getAnonymousSessionId()`，未登录用户的匿名session_id生成与持久化（任务6） |

## 改了哪些现有文件、改了什么

| 文件 | 改动 |
|---|---|
| `frontend/src/App.jsx` | 加一行import + 一行`<FaqChatWidget />`，挂载在`<FeedbackButton />`旁边 |
| `frontend/src/api/summarize.js` | `handleSSEStream`加`export`（给`faq.js`复用，避免重复写一遍SSE解析逻辑）；`chatWithVideo()`加`sessionId`参数、请求体带上`session_id`；新增`getChatHistory()` |
| `frontend/src/components/SummaryPanel.jsx` | 新增`highlightTimestamps()`（任务5，时间戳高亮）；新增一个`useEffect`在面板打开时拉历史对话（任务6）；`sendQuestion()`调用`chatWithVideo`时带上`sessionId` |
| `frontend/src/i18n/locales/{zh,en,pt}.json` | 各加一个`faq`小节（8个key）+ `errors.FAQ_CHAT_REQUEST_FAILED` |

## 任务4：FAQ问答入口

### UI设计思路

做成了悬浮按钮+弹出面板，放在**左下角**（`FeedbackButton`现有的反馈入口在右下角，
两个左右对称，不会互相遮挡）。选悬浮按钮而不是独立页面，是因为：

1. 这个入口需要在全站任何页面都能随手点开（不只是首页），做成路由页面的话每个页面都要
   加跳转链接，改动面更大，也不符合"客服悬浮窗"这个功能本身的使用习惯
2. 直接照抄`FeedbackButton.jsx`的定位方式（`fixed` + `env(safe-area-inset-bottom)`
   处理移动端安全区）和`SummaryPanel.jsx`问答Tab的聊天气泡样式（teal主色、圆角气泡、
   `prose`渲染Markdown回答），没有发明新样式，颜色也还是teal-50到teal-600这个范围

### `is_first_turn`怎么实现的

组件内部`useState(true)`，发送第一条消息时把当前值传给接口、随后置为`false`，没有做
持久化——面板关闭再打开（只要页面没刷新）`isFirstTurn`还是`false`，刷新页面才会重置成
`true`，这个跟需求描述的"这个聊天窗口是不是第一次打开之后发的第一条消息"是一致的。

### ⚠️假设接口

请求：`POST /api/faq/chat`，body `{ question, is_first_turn, language }`（`language`
传的是当前网站UI语言`zh`/`en`/`pt`，对应FAQ内容三语分开维护、检索只在当前语言内进行
这个方案A）。返回：假设跟现有`/api/chat`一样是SSE流，事件名沿用`answer`/`done`/`error`
——设计文档2.7节确认了FAQ链路也是流式输出，但没写具体SSE事件名，这里直接照抄了现有
`/api/chat`的约定，图的是省一套解析逻辑、也是同一个后端作者大概率会延续的写法。如果
实际实现用了别的事件名，改`api/faq.js`里`faqChat()`的回调名对应关系就行，不用动组件。

FAQ这一侧没有做`session_id`/多轮记忆——任务文档明确说`is_first_turn`用组件内
`useState`就够、不需要持久化，设计文档里FAQ链路的输入也只有"检索结果+问题+is_first_turn"，
没有对话历史这个参数，所以FAQ悬浮窗是"每次提问都是独立一轮"，只有开场白这一件事是
特殊的，这跟任务6的"字幕问答历史记忆"是两回事，不要混淆（这点任务文档里也提醒过）。

## 任务5：字幕问答时间戳展示

`SummaryPanel.jsx`里加了一个`highlightTimestamps(text)`函数，用正则
`\b(\d{1,2}:)?\d{1,2}:\d{2}\b`匹配"03:12"/"1:02:03"这种格式的时间点，包一层
`<span class="text-teal-600 font-semibold">`。在`marked.parse()`之前对AI回答的原始
文本做这个替换（marked默认不会转义源文本里已经写好的行内HTML，所以套进去的`<span>`
能正常穿透渲染出来），只用在AI问答Tab的助手消息气泡上，用户自己发的消息不处理。

**点击时间戳跳转播放器这个加分项没有做**——检查了`ResultCard.jsx`和整个`frontend/src`
（搜了`<video`/`react-player`/`videojs`都没有命中），现在网站只有下载功能，页面上没有
任何内嵌视频播放器，这条在当前产品形态下不适用，没有为了这个功能额外引入播放器组件。

## 任务6：对话历史展示

### `session_id`前端具体怎么实现的

`frontend/src/utils/session.js`里的`getAnonymousSessionId()`：

```js
export function getAnonymousSessionId() {
  let id = localStorage.getItem('anonymous_session_id')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('anonymous_session_id', id)
  }
  return id
}
```

`SummaryPanel.jsx`里无条件调用这个函数拿到`sessionId`，不管用户有没有登录都会把它带在
`/api/chat`请求体的`session_id`字段里——已登录用户不需要前端做任何特殊判断，由后端自己
决定优先用`user.id`还是这个`session_id`（后端当时还没实现这部分判断逻辑，这是按任务
文档"已登录用户不需要前端做任何事"这句话直接推出的设计）。

### 历史记录怎么展示的

面板打开（`started`变`true`）时，新增的`useEffect`调用`getChatHistory(videoUrl, sessionId)`
拉一次这个视频之前的对话记录，返回不为空就填进`chatMessages`（如果这个session已经在
本次打开发过新消息，就不会覆盖，只在`chatMessages`还是空的时候才填历史）。

### ⚠️假设接口

`getChatHistory()`请求的是`GET /api/chat/history?url=...&session_id=...`，返回形状假设
是`{ messages: [{ role, content }, ...] }`——**这个接口目前完全不存在**，设计文档3.6/3.7
节只定义了后端要存的`chat_history`表结构，没有定义前端怎么读取历史这个查询接口，是我
按"总要有个办法把历史吐给前端"这个前提自己拍板的格式。写了防御：请求失败（包括404，
即接口还没部署的情况）会静默返回空数组，不会给用户弹错误提示，也不会让问答Tab本身用不了
——所以现在这一步"接不上"的情况下，问答面板表现跟接入前完全一样（没有历史，能正常单轮
问答），不会因为这个新增功能报错。等任务6真的把接口定下来，只需要改`getChatHistory()`
这一个函数对齐真实的url/参数名/返回形状。

## 验收标准怎么验证的

1. **FAQ聊天窗口能正常发消息、收到流式返回**——`npm run build`过了，`npx oxlint`对新增/
   改动的文件跑了一遍没有报警告；SSE解析逻辑复用的是`api/summarize.js`里`handleSSEStream`
   （`/api/summarize`、`/api/chat`已经在用、验证过的同一套解析代码），没有重新写一份新的
   解析逻辑去承担新的出错风险。**没有跑真实的端到端联调**——`/api/faq/chat`后端还不存在，
   这一步要等任务4部署了才能补
2. **三语言切换后FAQ窗口文字跟着变**——`faq`小节的8个key在`zh.json`/`en.json`/`pt.json`
   三个文件都补齐了（用`node -e "require(...)"`挨个解析确认了三个JSON文件语法都合法），
   组件里所有用户可见文字都走`t('faq.xxx')`，没有硬编码的中/英文字符串
3. **未登录状态下`session_id`刷新页面不变**——逻辑是"读`localStorage`，没有才生成新的
   写回去"，不是"每次都生成"，代码逻辑上保证了这一点；没有用真实浏览器手动点刷新验证
   （这个环境里跑不了浏览器交互），逻辑本身很简单、能读代码确认，如果需要我也可以描述
   手动验证步骤：打开页面→开发者工具查看`localStorage.anonymous_session_id`的值→刷新
   →确认值没变
4. **git diff范围检查**——见下方"没有动过的东西"，已经过了一遍`git diff`确认

## 明确列一下"我没有动过的东西"

- 没有修改`App.jsx`里的导航栏（`<header>`部分）、页脚（`<footer>`部分），只加了一行
  import和一行组件渲染
- 没有修改首页Hero区域、`Hero.jsx`、`Features.jsx`等首页专属组件
- 没有修改颜色配置（没碰`tailwind.config.js`，全程用的是项目里已经在用的`teal-50`到
  `teal-600`这个色阶）
- 没有新增npm依赖，`package.json`没有改动——用到的`lucide-react`（图标）、`marked`
  （Markdown渲染）都是项目里已经在用的库
- 没有碰`backend/`目录下任何文件——纯前端改动
- `App.jsx`里能看到`LanguageSwitcher`那部分有一处"`|| 'zh'` → `|| 'en'`"和
  `stripLangPrefix`参数的改动，**这不是我这次任务改的**——检查过了，这是我开始改动之前
  仓库里就已经存在的未提交改动（`git status`一开始就显示`App.jsx`处于modified状态），
  跟这次FAQ/时间戳/对话历史三个功能完全无关，我只是在这个已经被改过的文件基础上追加了
  自己的两行，没有动那部分逻辑

## 下一步

等任务4（FAQ后端）、任务6（对话历史后端）部署后，各自需要补一次真实联调：

1. FAQ：确认`/api/faq/chat`的SSE事件名是不是真的叫`answer`/`done`/`error`，不是的话
   改`api/faq.js`一处
2. 对话历史：`/api/chat/history`这个接口需要真正定下来（现在完全是我方的假设），确认后
   改`api/summarize.js`里的`getChatHistory()`一处
3. `ChatRequest`需要真的加上`session_id`字段（现在前端已经在传了，但pydantic模型没这个
   字段会被默认忽略，不会报错，但也不会被后端使用）
