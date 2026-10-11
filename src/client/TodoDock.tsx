/**
 * 个人待办 Dock：贴在窗口右侧边缘的常驻小窗，只管你自己的待办事项，与 DSH 会话无关。
 * 收起时是一枚贴边药丸，直接显示下一件要做的事（到期时间 + 标题），逾期变红并脉动；
 * 展开是待办清单，可快速添加、勾完成、稍后提醒。垂直位置可拖动，收起/展开与位置都
 * 记在 localStorage。DSH 活跃会话默认完全不显示，需要时才在设置里打开。
 * @module dsh-todo-reminder/client/TodoDock
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
import { todoStore } from './todo-store.ts'
import { DEFAULT_TODO_SETTINGS, type ReminderEvent, type TodoItem } from '../types.ts'

const Y_KEY = 'dsh.todoReminder.dockY'
const COLLAPSED_KEY = 'dsh.todoReminder.dockCollapsed'
/** 到期文案每 30 秒刷新一次，避免「还有 5 分钟」长期不动。 */
const CLOCK_MS = 30_000
/** 距到期 ≤ 这个时间就自动探出（不用鼠标也知道该动了）。 */
const DUE_SOON_MS = 10 * 60_000
const EDGE = 8

/** 快速添加时可选的提醒时机。 */
const WHEN_OPTIONS: ReadonlyArray<{ value: string, label: string }> = [
  { value: 'none', label: '不提醒' },
  { value: '10', label: '10 分钟后' },
  { value: '30', label: '30 分钟后' },
  { value: '60', label: '1 小时后' },
  { value: '180', label: '3 小时后' },
  { value: 'tomorrow', label: '明天 9:00' },
]

/** 把选项换算成到期时间戳；'none' 表示不提醒。 */
function resolveWhen(value: string, now: number): number | undefined {
  if (value === 'none') return undefined
  if (value === 'tomorrow') {
    const d = new Date(now)
    d.setDate(d.getDate() + 1)
    d.setHours(9, 0, 0, 0)
    return d.getTime()
  }
  const minutes = Number(value)
  return Number.isFinite(minutes) ? now + minutes * 60_000 : undefined
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** 判断两个时间戳是否同一天。 */
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** 收起态药丸上的紧凑时间：今天只给时分，明天/更远带日期前缀。 */
function shortTime(dueAt: number, now: number): string {
  const due = new Date(dueAt)
  const today = new Date(now)
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (sameDay(due, today)) return `${pad(due.getHours())}:${pad(due.getMinutes())}`
  if (sameDay(due, tomorrow)) return `明天 ${pad(due.getHours())}:${pad(due.getMinutes())}`
  return `${due.getMonth() + 1}/${due.getDate()}`
}

/** 清单里的到期文案（逾期给出已过多久）。 */
function dueLabel(dueAt: number, now: number): string {
  const due = new Date(dueAt)
  const clock = `${pad(due.getHours())}:${pad(due.getMinutes())}`
  if (dueAt <= now) {
    const minutes = Math.max(1, Math.round((now - dueAt) / 60_000))
    return minutes < 60 ? `已逾期 ${minutes} 分钟` : `已逾期 ${Math.round(minutes / 60)} 小时`
  }
  const today = new Date(now)
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (sameDay(due, today)) return `今天 ${clock}`
  if (sameDay(due, tomorrow)) return `明天 ${clock}`
  return `${due.getMonth() + 1}月${due.getDate()}日 ${clock}`
}

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) !== 'false'
  } catch {
    return true
  }
}

function loadY(): number {
  try {
    const raw = localStorage.getItem(Y_KEY)
    const value = raw === null ? NaN : Number(raw)
    if (Number.isFinite(value)) return value
  } catch { /* 忽略损坏的本地记录 */ }
  return Math.round(window.innerHeight * 0.45)
}

/** 收起态标题：超长截断（宽度另有 CSS 硬上限兜底）。 */
function clip(title: string, max = 22): string {
  return title.length > max ? `${title.slice(0, max)}…` : title
}

export function TodoDock(): ReactElement | null {
  const { data } = useSyncExternalStore(todoStore.subscribe, todoStore.getSnapshot)
  const [collapsed, setCollapsed] = useState(loadCollapsed)
  const [y, setY] = useState(loadY)
  const [now, setNow] = useState(() => Date.now())
  const [draft, setDraft] = useState('')
  const [when, setWhen] = useState('none')
  const [busy, setBusy] = useState(false)
  /** 鼠标是否停在收起态药丸上（停住就探出看标题）。 */
  const [hovered, setHovered] = useState(false)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const yRef = useRef(y)
  const drag = useRef<{ startY: number, moved: boolean } | null>(null)

  const dock = data?.settings.dock ?? DEFAULT_TODO_SETTINGS.dock
  const snoozeMinutes = data?.settings.snoozeMinutes ?? DEFAULT_TODO_SETTINGS.snoozeMinutes
  const reminders: ReminderEvent[] = data?.reminders ?? []

  const pending: TodoItem[] = (data?.todos ?? []).filter((t) => !t.done)
  const sorted = [...pending].sort((a, b) => {
    if (a.dueAt !== undefined && b.dueAt !== undefined) return a.dueAt - b.dueAt
    if (a.dueAt !== undefined) return -1
    if (b.dueAt !== undefined) return 1
    return b.createdAt - a.createdAt
  })
  const next = sorted[0]
  const reminderByTodo = new Map(reminders.map((r) => [r.todoId, r]))
  const overdue = reminders.length > 0 || sorted.some((t) => t.dueAt !== undefined && t.dueAt <= now)
  /** 下一件已经快到点（含逾期）：收起态自动探出。 */
  const soon = next !== undefined && next.dueAt !== undefined && next.dueAt - now <= DUE_SOON_MS

  const clampY = useCallback((value: number): number => {
    const height = rootRef.current?.offsetHeight ?? 48
    return Math.max(EDGE, Math.min(value, Math.max(EDGE, window.innerHeight - height - EDGE)))
  }, [])

  const commitY = useCallback((value: number): void => {
    yRef.current = value
    setY(value)
    try {
      localStorage.setItem(Y_KEY, String(value))
    } catch { /* 隐私模式写不进去，忽略 */ }
  }, [])

  // 到期文案随时间走动。
  useEffect(() => {
    const timer = window.setInterval(() => { setNow(Date.now()) }, CLOCK_MS)
    return () => { window.clearInterval(timer) }
  }, [])

  // 窗口缩放 / 展开收起后把 Dock 夹回视口，避免超出屏幕够不着。
  useEffect(() => {
    const fit = (): void => {
      const fitted = clampY(yRef.current)
      if (fitted !== yRef.current) commitY(fitted)
    }
    fit()
    window.addEventListener('resize', fit)
    return () => { window.removeEventListener('resize', fit) }
  }, [clampY, commitY, collapsed])

  const toggleCollapsed = useCallback((value: boolean): void => {
    setCollapsed(value)
    try {
      localStorage.setItem(COLLAPSED_KEY, String(value))
    } catch { /* 忽略 */ }
  }, [])

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    // 落在按钮 / 输入控件上时不启动拖拽：setPointerCapture 会把后续指针事件
    // 全部导向表头，导致 click 的目标退化成表头本身，按钮（如「收起」）就点不动了。
    const target = event.target as HTMLElement | null
    if (target !== null && target.closest('button, input, select, textarea, a') !== null) return
    drag.current = { startY: event.clientY, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>): void => {
    if (drag.current === null) return
    const dy = event.clientY - drag.current.startY
    if (Math.abs(dy) > 4) drag.current.moved = true
    if (drag.current.moved) {
      commitY(clampY(yRef.current + dy))
      drag.current.startY = event.clientY
    }
  }

  const finishDrag = (event: ReactPointerEvent<HTMLElement>): boolean => {
    const state = drag.current
    drag.current = null
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch { /* 指针已释放 */ }
    return state !== null && state.moved
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLElement>): void => {
    const moved = finishDrag(event)
    if (!moved && collapsed) toggleCollapsed(false)
  }

  // 指针被系统手势中断时复位，否则 Dock 会一直黏着指针。
  const onPointerCancel = (event: ReactPointerEvent<HTMLElement>): void => {
    finishDrag(event)
    commitY(clampY(yRef.current))
  }

  const submit = async (): Promise<void> => {
    const title = draft.trim()
    if (title === '' || busy) return
    setBusy(true)
    try {
      await todoStore.addTodo({
        title,
        note: '',
        dueAt: resolveWhen(when, Date.now()),
        reminderStyle: 'info',
        confirmOnComplete: false,
      })
      setDraft('')
      setWhen('none')
    } finally {
      setBusy(false)
    }
  }

  const renderRow = (todo: TodoItem): ReactElement => {
    const isOverdue = todo.dueAt !== undefined && todo.dueAt <= now
    const reminder = reminderByTodo.get(todo.id)
    return (
      <div className="todo-dock-row" key={todo.id} data-overdue={isOverdue ? 'true' : undefined}>
        <button
          type="button"
          className="todo-dock-check"
          title="标记完成"
          aria-label={`完成 ${todo.title}`}
          onClick={() => void todoStore.completeTodo(todo)}
        >
          ✓
        </button>
        <span className="todo-dock-row-main">
          <span className="todo-dock-row-title" title={todo.title}>{todo.title}</span>
          {todo.dueAt !== undefined ? <span className="todo-dock-row-due">{dueLabel(todo.dueAt, now)}</span> : null}
        </span>
        <span className="todo-dock-row-actions">
          {reminder !== undefined ? (
            <button
              type="button"
              className="todo-btn todo-dock-mini"
              title={`稍后 ${snoozeMinutes[0] ?? 10} 分钟再提醒`}
              onClick={() => void todoStore.snooze(reminder, snoozeMinutes[0] ?? 10)}
            >
              稍后
            </button>
          ) : null}
          <button
            type="button"
            className="todo-btn danger todo-dock-mini"
            title="删除这条待办"
            onClick={() => void todoStore.removeTodo(todo.id)}
          >
            ✕
          </button>
        </span>
      </div>
    )
  }

  if (!dock.enabled) return null

  if (collapsed) {
    const label = next === undefined
      ? '暂无待办'
      : `${next.title}${next.dueAt !== undefined ? `（${dueLabel(next.dueAt, now)}）` : ''}`
    // 探出条件：鼠标停上来，或者下一件快到点了（≤10 分钟 / 已逾期）。
    const peek = hovered || soon
    const showTitle = peek && dock.showNext
    return (
      <div
        ref={rootRef}
        className="todo-dock"
        data-collapsed="true"
        data-peek={peek ? 'true' : undefined}
        data-overdue={overdue ? 'true' : undefined}
        /* 关键尺寸走内联：样式表即使没生效，长标题也撑不开它。 */
        style={{
          top: y,
          position: 'fixed',
          right: 0,
          display: 'flex',
          maxWidth: showTitle ? 344 : 132,
          overflow: 'hidden',
        }}
        role="button"
        tabIndex={0}
        aria-label={`待办：${label}`}
        title={`${label}\n点击展开清单 · 上下拖动可移动`}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            toggleCollapsed(false)
          }
        }}
      >
        <span className="todo-dock-icon" style={{ flex: 'none' }}>{overdue ? '⏰' : '📋'}</span>
        {next?.dueAt !== undefined ? (
          <span className="todo-dock-time" style={{ flex: 'none' }} data-overdue={next.dueAt <= now ? 'true' : undefined}>
            {shortTime(next.dueAt, now)}
          </span>
        ) : null}
        {showTitle ? (
          <span className="todo-dock-next" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {next === undefined ? '无待办' : clip(next.title, 48)}
          </span>
        ) : (
          <span className="todo-dock-idle" style={{ flex: 'none' }}>{pending.length}</span>
        )}
      </div>
    )
  }
  return (
    <div
      ref={rootRef}
      className="todo-dock"
      data-collapsed="false"
      data-overdue={overdue ? 'true' : undefined}
      /* 展开态同样内联封顶：样式表缺席也不会被长标题撑开。 */
      style={{ top: y, maxWidth: 340, overflow: 'hidden' }}
    >
      <div
        className="todo-dock-head"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        title="拖动可上下移动"
      >
        <span className="todo-dock-icon">{overdue ? '⏰' : '📋'}</span>
        <h3 className="todo-dock-title">待办 {pending.length > 0 ? `(${pending.length})` : ''}</h3>
        <button type="button" className="todo-btn todo-dock-mini" title="收起到边缘" aria-label="收起" onClick={() => toggleCollapsed(true)}>
          ›
        </button>
      </div>

      <div className="todo-dock-add">
        <input
          className="todo-input"
          placeholder="要做什么？回车添加"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') void submit() }}
        />
        <select className="todo-select todo-dock-when" value={when} onChange={(event) => setWhen(event.target.value)} title="什么时候提醒">
          {WHEN_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>

      <div className="todo-dock-body">
        {sorted.length === 0 ? (
          <div className="todo-dock-empty">没有待办。<br />上面加一条，到点会提醒你。</div>
        ) : (
          sorted.map(renderRow)
        )}
      </div>

      <div className="todo-dock-foot">
        <button type="button" className="todo-btn todo-dock-mini" onClick={() => { todoStore.setPanel(true); toggleCollapsed(true) }}>
          打开完整面板
        </button>
      </div>
    </div>
  )
}
