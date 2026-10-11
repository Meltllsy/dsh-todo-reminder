/**
 * Todo 面板：新建表单 + 待办/已完成列表 + 完成（含确认）/ 删除。
 * @module dsh-todo-reminder/client/TodoPanel
 */

import { useEffect, useSyncExternalStore, useState, type ReactElement } from 'react'
import { todoStore } from './todo-store.ts'
import { STYLE_META } from './styles.ts'
import { previewSound } from './sound.ts'
import { DEFAULT_TODO_SETTINGS, REMINDER_STYLES, type ReminderStyle, type TodoItem } from '../types.ts'

/** 把 datetime-local 字符串转 epoch ms（无效返回 undefined）。 */
function toEpoch(value: string): number | undefined {
  if (value === '') return undefined
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : undefined
}

/** 把 epoch ms 转 datetime-local 字符串。 */
function fromEpoch(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatDue(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function TodoPanel(): ReactElement {
  const { data } = useSyncExternalStore(todoStore.subscribe, todoStore.getSnapshot)
  const soundByStyle = data?.settings.soundByStyle ?? DEFAULT_TODO_SETTINGS.soundByStyle
  const snoozeMinutes = data?.settings.snoozeMinutes ?? DEFAULT_TODO_SETTINGS.snoozeMinutes
  const sound = data?.settings.sound ?? DEFAULT_TODO_SETTINGS.sound
  const dock = data?.settings.dock ?? DEFAULT_TODO_SETTINGS.dock
  const [volume, setVolume] = useState(sound.volume)
  const [previewStyle, setPreviewStyle] = useState<ReminderStyle>('info')
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [style, setStyle] = useState<ReminderStyle>('info')
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [snoozeText, setSnoozeText] = useState('')
  const [notifPermission, setNotifPermission] = useState<string>(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)

  useEffect(() => {
    if (typeof Notification === 'undefined') return
    setNotifPermission(Notification.permission)
  }, [])

  const requestNotification = async (): Promise<void> => {
    if (typeof Notification === 'undefined') return
    try {
      const permission = await Notification.requestPermission()
      setNotifPermission(permission)
    } catch {
      setNotifPermission(Notification.permission)
    }
  }

  // 音量滑块的编辑态：拖动时只更新本地，松手才落盘（避免每帧打一次接口）。
  useEffect(() => {
    setVolume(sound.volume)
  }, [sound.volume])

  const commitVolume = (): void => {
    if (volume !== sound.volume) void todoStore.setSound({ volume })
  }

  // 稍后提醒分钟数的编辑态：跟随 store 同步，失焦/回车时提交。
  useEffect(() => {
    setSnoozeText(snoozeMinutes.join(','))
  }, [snoozeMinutes])

  const commitSnooze = (): void => {
    const numbers = snoozeText
      .split(/[^0-9]+/)
      .map((s) => Number(s))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 1440)
    const unique = [...new Set(numbers)].sort((a, b) => a - b)
    const next = unique.length > 0 ? unique : DEFAULT_TODO_SETTINGS.snoozeMinutes
    setSnoozeText(next.join(','))
    void todoStore.setSnoozeMinutes(next)
  }

  const todos = data?.todos ?? []
  const pending = todos.filter((t) => !t.done)
  const done = todos.filter((t) => t.done)

  const submit = async (): Promise<void> => {
    const trimmed = title.trim()
    if (trimmed === '' || busy) return
    setBusy(true)
    try {
      await todoStore.addTodo({
        title: trimmed,
        note: note.trim(),
        dueAt: toEpoch(dueAt),
        reminderStyle: style,
        confirmOnComplete: confirm,
      })
      setTitle('')
      setNote('')
      setDueAt('')
      setStyle('info')
      setConfirm(false)
    } finally {
      setBusy(false)
    }
  }

  const renderItem = (todo: TodoItem): ReactElement => {
    const meta = STYLE_META[todo.reminderStyle]
    return (
      <div key={todo.id} className="todo-item" data-done={todo.done ? 'true' : undefined}>
        <div className="todo-item-main">
          <div className="todo-item-title">{todo.title}</div>
          {todo.note !== '' ? <div className="todo-item-note">{todo.note}</div> : null}
          <div className="todo-item-meta">
            {todo.dueAt !== undefined ? (
              <span className="todo-badge" data-style={todo.reminderStyle}>
                {meta.icon} {meta.label} · {formatDue(todo.dueAt)}
              </span>
            ) : (
              <span className="todo-badge" data-style={todo.reminderStyle}>{meta.icon} {meta.label}</span>
            )}
            {todo.confirmOnComplete ? <span>完成需确认</span> : null}
          </div>
        </div>
        <div className="todo-actions">
          {!todo.done ? (
            <button type="button" className="todo-btn primary" onClick={() => void todoStore.completeTodo(todo)}>
              完成
            </button>
          ) : null}
          <button type="button" className="todo-btn danger" title="删除" onClick={() => void todoStore.removeTodo(todo.id)}>
            删除
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="todo-panel">
      <div className="todo-header">
        <h2 className="todo-title">待办提醒</h2>
        <span className="todo-count">{pending.length} 待办 · {done.length} 已完成</span>
        {notifPermission !== 'granted' ? (
          <button
            type="button"
            className="todo-btn"
            onClick={() => void requestNotification()}
            title="开启后，切出到别的窗口也能收到系统通知"
          >
            {notifPermission === 'denied' ? '系统通知已阻止' : '开启系统通知'}
          </button>
        ) : null}
              <button
          type="button"
          className="todo-btn"
          title="关闭面板（Esc 也可以）"
          aria-label="关闭"
          onClick={() => todoStore.setPanel(false)}
        >
          ✕
        </button>
      </div>

      <div className="todo-settings-group">📋 个人待办 —— 你自己的事情</div>

      <div className="todo-settings">
        <span className="todo-settings-label">响铃样式</span>
        {REMINDER_STYLES.map((s) => (
          <label className="todo-check" key={s} title={`${STYLE_META[s].label}：这类待办提醒是否出声`}>
            <input
              type="checkbox"
              checked={soundByStyle[s]}
              onChange={(e) => void todoStore.setSoundByStyle(s, e.target.checked)}
            />
            {STYLE_META[s].icon} {STYLE_META[s].label}
          </label>
        ))}
        <span className="todo-settings-label">稍后提醒</span>
        <input
          className="todo-input"
          style={{ width: 100, flex: 'none' }}
          value={snoozeText}
          onChange={(e) => setSnoozeText(e.target.value)}
          onBlur={commitSnooze}
          onKeyDown={(e) => { if (e.key === 'Enter') commitSnooze() }}
          title="稍后提醒的分钟数（逗号分隔，如 5,15,60）"
        />
        <span className="todo-settings-hint">分钟</span>
      </div>

      <div className="todo-settings">
        <span className="todo-settings-label">待办提醒音</span>
        <label className="todo-check" title="开启后，标签页开着也会出声；关闭则只剩系统通知的默认提示音（且仅在切出时）">
          <input type="checkbox" checked={sound.inPage} onChange={(e) => void todoStore.setSound({ inPage: e.target.checked })} />
          页面内响铃
        </label>
        <span className="todo-settings-hint">音量</span>
        <input
          className="todo-range"
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(volume * 100)}
          onChange={(e) => setVolume(Number(e.target.value) / 100)}
          onPointerUp={commitVolume}
          onKeyUp={commitVolume}
          onBlur={commitVolume}
          title="待办提醒音量（与会话提醒音量互相独立）"
        />
        <span className="todo-settings-hint">{Math.round(volume * 100)}%</span>
        <span className="todo-settings-hint">紧急连响</span>
        <input
          className="todo-input"
          style={{ width: 56, flex: 'none' }}
          type="number"
          min={1}
          max={5}
          value={sound.dangerRepeat}
          onChange={(e) => void todoStore.setSound({ dangerRepeat: Number(e.target.value) })}
          title="danger 样式提醒连响几次"
        />
        <select className="todo-select" value={previewStyle} onChange={(e) => setPreviewStyle(e.target.value as ReminderStyle)}>
          {REMINDER_STYLES.map((s) => (
            <option key={s} value={s}>{STYLE_META[s].icon} {STYLE_META[s].label}</option>
          ))}
        </select>
        <button
          type="button"
          className="todo-btn"
          onClick={() => previewSound(previewStyle, volume, previewStyle === 'danger' ? sound.dangerRepeat : 1)}
          title="试听待办提醒音"
        >
          🔈 试听
        </button>
        <button
          type="button"
          className="todo-btn"
          title="在文件管理器里打开音效文件所在目录"
          onClick={() => void todoStore.openSoundDir()}
        >
          📂 打开文件夹
        </button>
        <span className="todo-settings-hint">音源 ~/.dsh/todo-reminder/sound.mp3（缺省用内置合成音）</span>
      </div>

      <div className="todo-settings">
        <span className="todo-settings-label">右侧待办条</span>
        <label className="todo-check" title="窗口右侧边缘常驻的待办小窗，可收起">
          <input type="checkbox" checked={dock.enabled} onChange={(e) => void todoStore.setDock({ enabled: e.target.checked })} />
          显示
        </label>
        <label className="todo-check" title="收起时直接显示下一件要做的事（到期时间 + 标题）">
          <input type="checkbox" checked={dock.showNext} onChange={(e) => void todoStore.setDock({ showNext: e.target.checked })} />
          收起时显示下一条
        </label>
      </div>



      <div className="todo-form">
        <div className="todo-form-row">
          <input
            className="todo-input"
            placeholder="要提醒自己什么？"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
          />
          <button type="button" className="todo-btn primary" disabled={busy || title.trim() === ''} onClick={() => void submit()}>
            添加
          </button>
        </div>
        <div className="todo-form-row">
          <input
            className="todo-input"
            placeholder="备注（可选）"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <input
            className="todo-input"
            type="datetime-local"
            title="提醒时间"
            value={dueAt}
            style={{ flex: '0 1 auto', minWidth: 190 }}
            onChange={(e) => setDueAt(e.target.value)}
          />
          <select className="todo-select" value={style} onChange={(e) => setStyle(e.target.value as ReminderStyle)}>
            {REMINDER_STYLES.map((s) => (
              <option key={s} value={s}>{STYLE_META[s].icon} {STYLE_META[s].label}</option>
            ))}
          </select>
          <label className="todo-check">
            <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
            完成需确认
          </label>
        </div>
      </div>

      <div className="todo-list">
        {pending.length === 0 && done.length === 0 ? (
          <div className="todo-empty">还没有待办。添加一条，或设置提醒时间，到期后这里会弹出提醒。</div>
        ) : null}

        {pending.length > 0 ? <div className="todo-section-title">待办</div> : null}
        {pending.map(renderItem)}

        {done.length > 0 ? <div className="todo-section-title">已完成</div> : null}
        {done.map(renderItem)}
      </div>
    </div>
  )
}
