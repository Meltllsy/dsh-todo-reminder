# dsh-todo-reminder

![npm](https://img.shields.io/npm/v/dsh-todo-reminder)
![license](https://img.shields.io/npm/l/dsh-todo-reminder)
![dsh](https://img.shields.io/badge/dsh-%3E%3D0.2.0--rc.2-blue)
![compat](https://github.com/Meltllsy/dsh-todo-reminder/actions/workflows/compat.yml/badge.svg)

DSH 的**全局个人待办**插件 —— 一份跟你所有会话、所有项目都无关的个人清单。

## 功能

- **全局面板**：侧边栏「待办」入口打开，浮在页面中央（不再挂在会话列里）—— 任何会话下
  打开都是同一份内容、同一个位置。新建（标题 / 备注 / 提醒时间 / 提醒样式 / 完成需确认）、
  完成、删除；待办 / 已完成分区展示。Esc 或点空白处关闭。
- **右侧待办条（Dock）**：窗口右缘常驻、可收起；收起时直接显示下一件要做的事
  （到期时间 + 标题），逾期变红；展开可快速添加 / 勾完成 / 稍后提醒；可上下拖动，可关闭。
- **到期提醒**：host 每 5 秒扫描到期任务，经 SSE 实时推到浏览器弹富 toast，动作有
  「完成 / 稍后提醒（分钟数可自定义）/ 忽略」；**切出到别的窗口时转成系统原生通知**。
- **多种提醒样式**：info（蓝）/ success（绿）/ warning（黄）/ danger（红，呼吸动画）。
- **提醒音**：每种样式可单独开关响铃；音量、音色可调；可试听。
- **完成需确认**：任务可开启，点「完成」先弹确认框。
- **Agent 工具**：todo_add / todo_list / todo_complete / todo_snooze / todo_delete。

> 本插件是原来那个「待办 + 会话提醒」二合一插件拆出来的**待办模块**。DSH 会话的
> 「跑完 / 提问 / 审批」提醒已经独立成 **dsh-session-attention**，两者数据、设置、
> 声效文件、接口全部独立，可单独安装、单独卸载。

## 安装

从 npm 装（推荐）：

```bash
dsh plugin --profile desktop add dsh-todo-reminder    # 桌面端
dsh plugin --profile web     add dsh-todo-reminder    # 浏览器版
```

从源码装（仓库里已带构建产物 `lib/`，克隆后可直接指过去）：

```bash
git clone https://github.com/Meltllsy/dsh-todo-reminder.git
dsh plugin --profile desktop add link:<克隆目录>
```

> 改了源码想重新构建：`npm install && npm run prepack`（host 半 `tsc` → `lib/`，client 半 `tsdown` → `lib/client.js`）。
## 设置与数据

| 项 | 位置 |
|---|---|
| 数据文件 | `$DSH_HOME/todo-reminder/todos.json`（待办 + 提醒事件 + 设置，原子写） |
| 自定义提醒音 | `$DSH_HOME/todo-reminder/sound.{mp3,wav,ogg,m4a}` |
| HTTP 接口 | `/api/todo/state`、`/api/todo/events`（SSE）、`/api/todo/sound`、`/api/todo/{add,update,delete,complete,snooze,dismiss-reminder,set-settings}` |

拆分后 `todos.json` 里遗留的 `settings.attention` / `settings.ball` 由本插件忽略（不删）；
它们会被 dsh-session-attention 首次启动时读走做迁移。

## 提醒音怎么走

1. **自定义音效文件优先**：音频解锁后探测 `/api/todo/sound`，命中则解码使用。
2. **内置合成音兜底**：没有文件 / 解码失败时用 WebAudio 现场合成四种音色。
3. **系统通知兜底**：音频尚未解锁时，由系统通知自己出声。

音频解锁靠 document 上的手势监听自动完成（点 DSH 里任何地方即可）。页面内音效在前台/
后台都会响；**页面完全关闭时不会响**，那时只有系统通知，而浏览器通知只能用系统默认音。

## 构建

```bash
npm install          # 只需一次
npm run prepack      # host 半 tsc → lib/；client 半 tsdown → lib/client.js
```

host 半只依赖 `node:` 内置模块（自包含）；client 半经 tsdown 打包为 ModuleLoader 客户端，React 交给宿主运行时。

## 兼容性

本插件依赖 DSH 的一些**内部点**（服务名、事件名、DOM 类名、客户端包格式）。DSH 演进较快，
这些点在版本之间**会变** —— 插件断掉往往不是插件自己的 bug，而是这里变了。所以仓库里带了一个自检脚本：

```bash
npm run check:compat                        # 检查本机已装的 DSH
node scripts/check-compat.mjs --from <dir>  # 检查指定目录（CI 用）
```

实测结果：

| DSH 版本 | 结果 |
|---|---|
| `0.2.0-rc.2`（当前） | ✅ 15/15 |
| `0.2.1-alpha.2`（下一个） | ✅ 15/15 |

依赖点一览（断哪条、坏哪个功能，脚本输出里都写了）：

| 分类 | 依赖点 |
|---|---|
| 客户端 | `__ModuleLoader__` 加载器格式、`/plugins` 资源路由 |
| 服务 | `uiWorkspace.openSession`、会话列表 `byId` 快照、host 的 `webServer` / `systemPrompt` |
| DOM | 类名含 `sessionRow` / `newSession` / `centerCol` |
| 事件 | `session/event` / `turn/end` / `approval/asked` / `tool/call` |
| 工具 | `ask_user_question` |

**GitHub Actions 每周自动跑一次**（含 alpha 版本），不通过就自动开 issue —— 所以 DSH 更新导致的不兼容
会被提前发现，而不是等用户先撞上。

> 与 [dsh-session-attention](https://github.com/Meltllsy/dsh-session-attention) 是各自独立的插件，互不依赖，可单独安装。


