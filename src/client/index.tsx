/**
 * dsh-todo-reminder 浏览器半：注入样式，挂载侧边栏「待办」入口、**全局**待办面板、
 * 全局提醒层。
 *
 * 面板是**浮在页面上的全局浮层**，不再挂进会话列 —— 待办是个人清单，跟当前会话无关，
 * 任何会话下打开都是同一份内容和同一个位置。
 * 失败策略：DOM 挂载异常只记录、不抛出（外部插件不得拖垮 GUI 启动）。
 * @module dsh-todo-reminder/client
 */

import { createRoot, type Root } from 'react-dom/client'
import { ReminderLayer } from './ReminderLayer.tsx'
import { TodoPanel } from './TodoPanel.tsx'
import { registerPanel, seatsAvailable, syncPanelWithLayout } from './panel-seat.tsx'
import { mountSidebarEntry } from './sidebar-entry.ts'
import { injectStyles } from './styles.ts'
import { todoStore } from './todo-store.ts'

/** 跨插件面板互斥事件（与 task-board / ssh / 会话提醒 同契约）。 */
const ACTIVATE_EVENT = 'dsh-panel-activate'
const PANEL_NAME = 'todo'
const ACTIVE_ATTR = 'data-dsh-todo-active'
const SIBLING_ATTRS = ['data-dsh-attention-active', 'data-dsh-ssh-active', 'data-dsh-taskboard-active']

/**
 * 中心列（对话列）候选，**按优先级逐个试**。
 * 注意：querySelector 的逗号列表是「文档顺序优先」而不是「选择器顺序优先」——别的插件的外层
 * 容器只要类名带 centerCol 就会被选中，而 inset:0 的面板挂上去会盖满整个 UI。
 * 0.1.6 起 data-pane 标记被移除，回退到 centerCol / _centerCol 类名。
 */
const COLUMN_CANDIDATES = ['[data-pane="conversation"]', '[class*="centerCol"]', '[class*="_centerCol"]']

/** 宿主标记：定位与隐藏兄弟都只作用于自己挂载的这个元素，避免误伤其他插件的同名容器。 */
const HOST_ATTR = 'data-dsh-todo-host'

/** 应用外壳判定：含侧边栏（或本插件的侧边栏入口）的容器不是对话列，挂上去必然盖满整个 UI。 */
function looksLikeAppShell(el: HTMLElement): boolean {
  if (el === document.body || el === document.documentElement) return true
  return el.querySelector('[data-pane="sidebar"], [class*="sidebarCol"], [data-dsh-todo-entry], [data-dsh-att-entry]') !== null
}

/** 找对话列：按优先级 + 外壳校验；找不到就返回 undefined（宁可不挂，也不盖满 UI）。 */
function findConversationColumn(): HTMLElement | undefined {
  for (const selector of COLUMN_CANDIDATES) {
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      if (!looksLikeAppShell(el)) return el
    }
  }
  return undefined
}

/**
 * 面板挂载：容器插进中心列，打开时占满它（独立页面式，与任务看板 / SSH 一致），
 * 中心列其余内容暂时隐藏；关闭后立刻回到对话。开合由 store 的 panelOpen 驱动。
 */
function mountPanel(): () => void {
  document.querySelectorAll('[data-dsh-todo-view]').forEach((el) => el.remove())
  document.querySelectorAll('[' + HOST_ATTR + ']').forEach((el) => el.removeAttribute(HOST_ATTR))

  let root: Root | undefined
  let container: HTMLDivElement | undefined

  /** 卸掉容器与宿主标记：宿主被换、面板关闭、插件卸载都会走这里。 */
  const teardown = (): void => {
    try { root?.unmount() } catch { /* 忽略清理异常 */ }
    root = undefined
    container?.remove()
    container = undefined
    document.querySelectorAll('[' + HOST_ATTR + ']').forEach((el) => el.removeAttribute(HOST_ATTR))
  }

  const ensure = (): void => {
    // 只在打开时挂载：关掉后 DOM 里不留残留，插件被停用时也就不会有一块东西盖住界面。
    if (!todoStore.getSnapshot().panelOpen) { if (container !== undefined) teardown(); return }
    // 自愈：外壳/别的插件重渲染会把宿主换掉，此时容器已是游离节点，必须重建。
    if (container !== undefined && container.isConnected) return
    teardown()
    const column = findConversationColumn()
    if (column === undefined) return
    column.setAttribute(HOST_ATTR, '')
    container = document.createElement('div')
    container.dataset.dshTodoView = ''
    column.appendChild(container)
    root = createRoot(container)
    root.render(<TodoPanel />)
  }

  const waitObserver = new MutationObserver(() => { ensure() })
  waitObserver.observe(document.body, { childList: true, subtree: true })

  const applyActive = (): void => {
    if (todoStore.getSnapshot().panelOpen) {
      for (const attr of SIBLING_ATTRS) document.documentElement.removeAttribute(attr)
      document.documentElement.setAttribute(ACTIVE_ATTR, '')
      document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: PANEL_NAME }))
    } else {
      document.documentElement.removeAttribute(ACTIVE_ATTR)
    }
    ensure()
  }
  const close = (): void => { if (todoStore.getSnapshot().panelOpen) todoStore.setPanel(false) }
  const onOtherActivate = (event: Event): void => {
    if ((event as CustomEvent).detail !== PANEL_NAME) close()
  }
  const onKeyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape') close() }
  const SIDEBAR_ROW_SELECTOR = '[class*="sessionRow"], [class*="projectRow"], [class*="searchResultRow"], [class*="searchResultWorkspace"], [class*="newSession"]'
  const onClickSidebarRow = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null
    if (target === null) return
    // 点自己的侧边栏入口不算「点了会话行」：本监听在捕获阶段先跑，若在这里 close()，
    // 紧接着入口自身的 click 又 togglePanel() 开回来 —— 表现就是「点了关不掉」。
    if (target.closest('[data-dsh-todo-entry]') !== null) return
    if (target.closest(SIDEBAR_ROW_SELECTOR) !== null) close()
  }

  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('click', onClickSidebarRow, true)
  document.addEventListener(ACTIVATE_EVENT, onOtherActivate)
  const unsubscribe = todoStore.subscribe(applyActive)
  applyActive()
  ensure()

  return () => {
    document.removeEventListener('keydown', onKeyDown)
    document.removeEventListener('click', onClickSidebarRow, true)
    document.removeEventListener(ACTIVATE_EVENT, onOtherActivate)
    waitObserver.disconnect()
    unsubscribe()
    document.documentElement.removeAttribute(ACTIVE_ATTR)
    teardown()
  }
}
/** 全局提醒层挂载（body 上的 React 根，跨会话常驻；含待办 Dock）。 */
function mountReminderLayer(): () => void {
  document.querySelectorAll('[data-dsh-todo-reminder-root]').forEach((el) => el.remove())

  const container = document.createElement('div')
  container.dataset.dshTodoReminderRoot = ''
  document.body.appendChild(container)
  const root = createRoot(container)
  root.render(<ReminderLayer />)
  return () => {
    root.unmount()
    container.remove()
  }
}

/**
 * 声明依赖 sessions 服务：它保证本插件在客户端会话控制器就绪之后才 apply，
 * 那时 shell（侧边栏、页面骨架）已可被定位。本插件不读写会话数据，只借这条时序。
 */
export const inject = ['sessions']

/** 客户端上下文最小接口（本插件不读会话字段）。 */
export interface TodoClientContext {
  readonly sessions?: unknown
  /** 官方座位服务（0.2 起）；缺席时退回 DOM 注入。 */
  readonly slots?: { inject(key: string, callback: () => () => void): () => void, register(options: Record<string, unknown>, component: unknown): () => void }
  /** cordis 上下文取值（本插件只取 layout）。 */
  readonly get?: (name: string) => unknown
}

export function apply(_ctx: TodoClientContext): () => void {
  injectStyles()

  const disposers: Array<() => void> = []
  try {
    // 0.2 起优先用外壳自己的面板座位：行框/高亮/折叠/切换都由外壳拥有，
    // 页面只在被选中时挂载 —— 既不会盖住别的页面，也不会被别的插件带歪样式。
    if (seatsAvailable(_ctx)) {
      disposers.push(registerPanel(_ctx))
      disposers.push(syncPanelWithLayout(_ctx))
    } else {
      // 旧版外壳没有 sidebar.panellist / main 座位，退回 DOM 注入。
      disposers.push(mountSidebarEntry())
      disposers.push(mountPanel())
    }
    disposers.push(mountReminderLayer())
  } catch (error) {
    console.error('[dsh-todo-reminder] mount failed:', error)
  }

  return () => {
    for (const dispose of disposers.splice(0)) {
      try { dispose() } catch { /* 忽略清理异常 */ }
    }
  }
}
