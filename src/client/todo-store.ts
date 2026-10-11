/**
 * 浏览器端 store：单一实例，持有 host 状态快照 + 面板开合 + 待确认完成 +
 * 当前展示的提醒 + 新提醒（供系统通知消费）。React 组件经 useSyncExternalStore 订阅。
 * @module dsh-todo-reminder/client/todo-store
 */

import { todoApi, type TodoAddPayload } from './api.ts'
import type { DockSettings, ReminderEvent, ReminderStyle, SoundSettings, TodoItem, TodoState } from '../types.ts'

export interface ConfirmRequest {
  todo: TodoItem
  reminderId?: string
}

export interface TodoClientState {
  data: TodoState | null
  error: string | null
  activeReminders: ReminderEvent[]
  /** 本轮 applyState 新出现的提醒（已去重，供系统通知消费一次）。 */
  freshReminders: ReminderEvent[]
  confirming: ConfirmRequest | null
  panelOpen: boolean
}

type Listener = () => void

class TodoStore {
  private state: TodoClientState = {
    data: null,
    error: null,
    activeReminders: [],
    freshReminders: [],
    confirming: null,
    panelOpen: false,
  }

  private readonly listeners = new Set<Listener>()
  /** 已发过系统通知的提醒 id，避免重复弹。 */
  private readonly notifiedReminderIds = new Set<string>()

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): TodoClientState => this.state

  private set(patch: Partial<TodoClientState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }

  /** 用一份 host 状态更新 store，并计算本轮新出现的提醒。 */
  applyState(data: TodoState): void {
    const fresh = data.reminders.filter((r) => !this.notifiedReminderIds.has(r.id))
    for (const r of fresh) this.notifiedReminderIds.add(r.id)
    this.set({ data, error: null, activeReminders: data.reminders, freshReminders: fresh })
  }

  /** 拉取 host 状态（轮询兜底 / 标签页回到前台时调用）。 */
  async refresh(): Promise<void> {
    try {
      this.applyState(await todoApi.state())
    } catch (error) {
      this.set({ error: error instanceof Error ? error.message : String(error) })
    }
  }

  /** 在文件管理器里打开数据目录（音效文件放这里）。失败静默 —— 打不开文件夹不该报错打扰。 */
  async openSoundDir(): Promise<void> {
    try {
      await todoApi.openDir()
    } catch { /* 忽略 */ }
  }

  togglePanel(): void {
    this.set({ panelOpen: !this.state.panelOpen })
  }

  setPanel(open: boolean): void {
    if (this.state.panelOpen !== open) this.set({ panelOpen: open })
  }

  async addTodo(input: TodoAddPayload): Promise<void> {
    await todoApi.add(input)
    await this.refresh()
  }

  async updateTodo(id: string, patch: Record<string, unknown>): Promise<void> {
    await todoApi.update(id, patch)
    await this.refresh()
  }

  async removeTodo(id: string): Promise<void> {
    await todoApi.remove(id)
    await this.refresh()
  }

  async setSoundByStyle(style: ReminderStyle, enabled: boolean): Promise<void> {
    await todoApi.setSettings({ soundByStyle: { [style]: enabled } })
    await this.refresh()
  }

  async setSnoozeMinutes(minutes: number[]): Promise<void> {
    await todoApi.setSettings({ snoozeMinutes: minutes })
    await this.refresh()
  }

  async setSound(patch: Partial<SoundSettings>): Promise<void> {
    await todoApi.setSettings({ sound: patch })
    await this.refresh()
  }

  async setDock(patch: Partial<DockSettings>): Promise<void> {
    await todoApi.setSettings({ dock: patch })
    await this.refresh()
  }

  /** 完成待办；若开启「完成需确认」则先弹确认框。 */
  async completeTodo(todo: TodoItem, reminderId?: string): Promise<void> {
    if (todo.confirmOnComplete) {
      this.set({ confirming: { todo, reminderId } })
      return
    }
    await todoApi.complete(todo.id)
    await this.refresh()
  }

  async confirmComplete(): Promise<void> {
    const request = this.state.confirming
    if (request === null) return
    this.set({ confirming: null })
    await todoApi.complete(request.todo.id)
    if (request.reminderId !== undefined) await todoApi.dismissReminder(request.reminderId)
    await this.refresh()
  }

  cancelConfirm(): void {
    this.set({ confirming: null })
  }

  async snooze(reminder: ReminderEvent, minutes: number): Promise<void> {
    await todoApi.snooze(reminder.todoId, minutes)
    await this.refresh()
  }

  async dismissReminder(reminderId: string): Promise<void> {
    await todoApi.dismissReminder(reminderId)
    await this.refresh()
  }
}

/** 应用级单例（面板 / 提醒 / 确认框共用）。 */
export const todoStore = new TodoStore()

export type { ReminderEvent, ReminderStyle, TodoItem }
