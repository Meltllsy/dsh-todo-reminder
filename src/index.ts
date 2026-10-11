/**
 * dsh-todo-reminder host 半 —— 挂载 TodoService、HTTP 路由（含 SSE 推送）、定时调度、
 * agent 工具与 systemPrompt 公告。
 *
 * 本插件是**全局个人待办**：一份清单、与 DSH 会话无关，不监听任何 session 事件。
 * DSH 会话的完成 / 提问 / 审批提醒是另一个独立插件 dsh-session-attention。
 * host 半只依赖 node: 内置模块（自包含）。
 * @module dsh-todo-reminder
 */

import { DEFAULT_TICK_MS, TodoService, type TodoServiceConfig } from './service.js'
import { makeTodoRoutes } from './routes.js'
import { makeTodoTools } from './tools.js'

/** host 上下文最小接口（webServer / timer / tools / systemPrompt 由 cordis 注入）。 */
export interface TodoHostContext {
  webServer: {
    register(route: { kind: 'exact' | 'prefix'; path: string; handler: unknown }): () => void
  }
  interval(callback: () => void, ms: number): () => void
  effect(fn: () => (() => void) | void, label?: string): () => void
  tools: {
    register(definition: unknown): () => void
  }
  systemPrompt?: {
    section(opts: { name: string; order: number; text: string }): () => void
  }
}

/** 稳定的 cordis 插件名（与 cordis.patch.yml insert id 一致）。 */
export const name = 'todo-reminder'

/** host 半需要的注入服务。 */
export const inject = ['webServer', 'timer', 'tools', 'systemPrompt']

/** 面向模型的公告：插件存在性、能力、限制（只讲待办）。 */
export const TODO_GUIDANCE = '本机已安装 dsh-todo-reminder 插件（个人待办模块）：一份【全局】待办清单，与 DSH 会话、与任何具体任务无关。侧边栏「待办」入口打开待办面板（全局浮层，任何会话下都一样）；窗口右侧边缘常驻一个可收起的待办条（Dock），收起时直接显示下一件要做的事（到期时间 + 标题），逾期变红，展开可快速添加、勾完成、稍后提醒，可上下拖动、可在设置里关闭。任务可设到期时间与提醒样式（info/success/warning/danger），到期弹提醒可「完成 / 稍后提醒 / 忽略」，切出窗口还会弹系统通知；任务可开「完成需确认」。agent 可用 todo_add / todo_list / todo_complete / todo_snooze / todo_delete 管理这份全局列表。提醒音：自定义音效放 ~/.dsh/todo-reminder/sound.mp3（或 .wav/.ogg/.m4a，缺省用内置合成音），音量、音色、每种样式是否响铃都在面板里设置。数据持久化在 ~/.dsh/todo-reminder/todos.json。限制：提醒需要 GUI 标签页打开（后台亦可）才会弹；浏览器完全关闭期间的提醒会暂存，下次打开补弹。用户提到「待办 / todo / 提醒我做事 / 任务清单」时即指本插件。注意：DSH 会话的「跑完 / 提问 / 审批」提醒属于另一个独立插件 dsh-session-attention，与本插件无关。'

/** 公告 section 在工具引导带的顺序。 */
const SECTION_ORDER = 201

/**
 * host 装配：创建服务、注册路由、注册工具、启动调度、注入公告。
 * @param ctx - host 上下文（webServer + timer + tools + systemPrompt 已注入）。
 * @param config - 插件配置（缺省用默认值）。
 */
export function apply(ctx: TodoHostContext, config: TodoServiceConfig = {}): void {
  const service = new TodoService()
  const tickMs = config.tickMs ?? DEFAULT_TICK_MS

  // 路由（含 SSE 事件流）：fiber dispose 自动注销。
  ctx.effect(() => {
    const disposers = makeTodoRoutes(service).map((route) => ctx.webServer.register(route))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'todo-reminder: routes')

  // agent 工具：fiber dispose 自动注销。
  ctx.effect(() => {
    const disposers = makeTodoTools(service).map((tool) => ctx.tools.register(tool))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'todo-reminder: tools')

  // 调度：timer 服务返回的 disposer 随 fiber 自动清理。
  ctx.interval(() => {
    try {
      service.tick(Date.now())
    } catch (error) {
      // 调度异常不得拖垮 host。
      console.error('[dsh-todo-reminder] tick failed:', error)
    }
  }, tickMs)

  // 公告：让 agent 知道插件存在（systemPrompt 可选注入，缺失时静默）。
  ctx.effect(() => {
    if (ctx.systemPrompt === undefined) return
    return ctx.systemPrompt.section({
      name: 'plugin:todo-reminder',
      order: SECTION_ORDER,
      text: TODO_GUIDANCE,
    })
  }, 'todo-reminder: guidance')
}

export { TodoService } from './service.js'
export type { TodoServiceConfig } from './service.js'
export type { ReminderEvent, ReminderStyle, TodoAddInput, TodoItem, TodoPatch, TodoSettings, TodoState } from './types.js'
