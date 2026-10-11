/**
 * 浏览器 → host 的同源 JSON API 封装（与 dsh-pet 的 /api/pet/* 同模式）。
 * @module dsh-todo-reminder/client/api
 */

import type { DockSettings, ReminderStyle, SoundSettings, TodoState } from '../types.ts'

async function todoFetch<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, body === undefined
    ? {}
    : {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
  if (!response.ok) {
    throw new Error(`todo ${path} failed: ${response.status}`)
  }
  return (await response.json()) as T
}

export interface TodoAddPayload {
  title: string
  note: string
  dueAt?: number
  reminderStyle: ReminderStyle
  confirmOnComplete: boolean
}

export const todoApi = {
  /** 在文件管理器里打开数据目录（自定义音效放这里）。 */
  openDir: () => todoFetch<{ ok: boolean, dir?: string }>('/api/todo/open-dir', {}),
  state: () => todoFetch<TodoState>('/api/todo/state'),
  add: (input: TodoAddPayload) => todoFetch<{ ok: boolean }>('/api/todo/add', input),
  update: (id: string, patch: Record<string, unknown>) =>
    todoFetch<{ ok: boolean }>('/api/todo/update', { id, patch }),
  remove: (id: string) => todoFetch<{ ok: boolean }>('/api/todo/delete', { id }),
  complete: (id: string) => todoFetch<{ ok: boolean }>('/api/todo/complete', { id }),
  snooze: (id: string, minutes: number) => todoFetch<{ ok: boolean }>('/api/todo/snooze', { id, minutes }),
  dismissReminder: (reminderId: string) =>
    todoFetch<{ ok: boolean }>('/api/todo/dismiss-reminder', { reminderId }),
  setSettings: (settings: {
    soundByStyle?: Partial<Record<ReminderStyle, boolean>>
    snoozeMinutes?: number[]
    sound?: Partial<SoundSettings>
    dock?: Partial<DockSettings>
  }) => todoFetch<{ ok: boolean }>('/api/todo/set-settings', { settings }),
}
