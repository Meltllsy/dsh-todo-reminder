/**
 * 提醒层：body 上的全局 React 根，渲染**待办**提醒 toast 栈 + 完成确认弹窗 + 待办 Dock，
 * 并通过 SSE 实时订阅 host 状态变化；标签页在后台时把新提醒转成系统原生通知
 * （切出到别的窗口也能收到）。DSH 会话的完成/审批提醒不在这里 —— 那是
 * dsh-session-attention 的事。
 * @module dsh-todo-reminder/client/ReminderLayer
 */

import { useEffect, useSyncExternalStore, type ReactElement } from 'react'
import { todoStore } from './todo-store.ts'
import { STYLE_META } from './styles.ts'
import { TodoDock } from './TodoDock.tsx'
import { armSoundUnlock, isSoundReady, playSound } from './sound.ts'
import { DEFAULT_TODO_SETTINGS, type ReminderEvent, type ReminderStyle, type TodoState } from '../types.ts'

function formatTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function ReminderToast({ reminder, snoozeMinutes }: { reminder: ReminderEvent; snoozeMinutes: number[] }): ReactElement {
  const meta = STYLE_META[reminder.style]
  return (
    <div className="todo-toast" data-style={reminder.style} key={reminder.id}>
      <div className="todo-toast-head">
        <span className="todo-toast-icon">{meta.icon}</span>
        <span className="todo-toast-title">{reminder.title}</span>
        <span className="todo-toast-sub">{formatTime(reminder.firedAt)}</span>
      </div>
      <div className="todo-toast-actions">
        <button
          type="button"
          className="todo-btn primary"
          onClick={() => {
            const todo = todoStore.getSnapshot().data?.todos.find((t) => t.id === reminder.todoId)
            if (todo !== undefined) void todoStore.completeTodo(todo, reminder.id)
            else void todoStore.dismissReminder(reminder.id)
          }}
        >
          完成
        </button>
        {snoozeMinutes.map((minutes) => (
          <button
            type="button"
            className="todo-btn"
            key={minutes}
            onClick={() => void todoStore.snooze(reminder, minutes)}
          >
            稍后{minutes}分钟
          </button>
        ))}
        <button type="button" className="todo-btn" onClick={() => void todoStore.dismissReminder(reminder.id)}>
          忽略
        </button>
      </div>
    </div>
  )
}

function ConfirmDialog(): ReactElement | null {
  const { confirming } = useSyncExternalStore(todoStore.subscribe, todoStore.getSnapshot)
  if (confirming === null) return null
  return (
    <div className="todo-modal-backdrop">
      <div className="todo-modal">
        <h3 className="todo-modal-title">确认完成</h3>
        <p className="todo-modal-message">
          确定完成「{confirming.todo.title}」吗？
        </p>
        <div className="todo-modal-footer">
          <button type="button" className="todo-btn" onClick={() => todoStore.cancelConfirm()}>
            取消
          </button>
          <button type="button" className="todo-btn primary" onClick={() => void todoStore.confirmComplete()}>
            确认完成
          </button>
        </div>
      </div>
    </div>
  )
}

export function ReminderLayer(): ReactElement {
  const { activeReminders, freshReminders, data } = useSyncExternalStore(todoStore.subscribe, todoStore.getSnapshot)
  const soundByStyle: Record<ReminderStyle, boolean> = data?.settings.soundByStyle ?? DEFAULT_TODO_SETTINGS.soundByStyle
  const snoozeMinutes: number[] = data?.settings.snoozeMinutes ?? DEFAULT_TODO_SETTINGS.snoozeMinutes
  const soundSettings = data?.settings.sound ?? DEFAULT_TODO_SETTINGS.sound

  // 音频解锁：浏览器要求先有用户手势才允许出声，这里在首个手势时自动完成。
  useEffect(() => armSoundUnlock(), [])

  // 新提醒 → 页面内提醒音。与标签页是否在前台无关，因此「开着 DSH 也能听见」。
  useEffect(() => {
    if (freshReminders.length === 0 || !soundSettings.inPage) return
    for (const reminder of freshReminders) {
      if (soundByStyle[reminder.style] === false) continue
      playSound(
        reminder.style,
        soundSettings.volume,
        reminder.style === 'danger' ? soundSettings.dangerRepeat : 1,
      )
    }
  }, [freshReminders, soundByStyle, soundSettings])

  // SSE 实时订阅 + 回到前台时兜底轮询。
  useEffect(() => {
    const es = new EventSource('/api/todo/events')
    es.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as { type?: string; state?: TodoState }
        if (message.type === 'state' && message.state !== undefined) {
          todoStore.applyState(message.state)
        }
      } catch {
        // 解析失败忽略，等待下一条或轮询兜底。
      }
    }
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') void todoStore.refresh()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      es.close()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  // 首次请求系统通知权限（用户点「允许」后，切出也能收到通知）。
  useEffect(() => {
    if (typeof Notification === 'undefined') return
    if (Notification.permission === 'default') {
      Notification.requestPermission().catch(() => { /* 拒绝静默 */ })
    }
  }, [])

  // 后台（切出）时，把新提醒转成系统原生通知（按样式决定是否响铃）。
  useEffect(() => {
    if (freshReminders.length === 0) return
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    if (document.visibilityState !== 'hidden') return
    for (const reminder of freshReminders) {
      const meta = STYLE_META[reminder.style]
      try {
        new Notification(`${meta.icon} ${meta.label}：${reminder.title}`, {
          body: '点击回到 DSH 处理（完成 / 稍后提醒 / 忽略）',
          tag: `dsh-todo-${reminder.id}`,
          // 页面内音效已负责出声时，系统通知静音，避免响两遍；未解锁则交回系统提示音。
          silent: soundSettings.inPage && isSoundReady() ? true : soundByStyle[reminder.style] === false,
        })
      } catch {
        // 个别环境不支持，忽略。
      }
    }
  }, [freshReminders, soundByStyle, soundSettings])

  return (
    <>
      {activeReminders.length > 0 ? (
        <div className="todo-toast-stack">
          {activeReminders.map((reminder) => <ReminderToast key={reminder.id} reminder={reminder} snoozeMinutes={snoozeMinutes} />)}
        </div>
      ) : null}
      <ConfirmDialog />
      <TodoDock />
    </>
  )
}
