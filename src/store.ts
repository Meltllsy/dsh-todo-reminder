/**
 * 磁盘持久化：todo + 提醒事件 + 设置写一份 JSON 到 $DSH_HOME/todo-reminder/todos.json。
 * 原子写（tmp + rename）、容错读（损坏 → 空）。只依赖 node: 内置模块。
 * @module dsh-todo-reminder/store
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { clampNumber, DEFAULT_TODO_SETTINGS, isReminderStyle, REMINDER_STYLES, sanitizeMinutesList, type DockSettings, type ReminderEvent, type ReminderStyle, type SoundSettings, type TodoItem, type TodoSettings } from './types.js'

/** 持久化文档形态。 */
export interface PersistedTodoDoc {
  todos: TodoItem[]
  reminders: ReminderEvent[]
  settings: TodoSettings
}

/** 持久化目录：$DSH_HOME（优先）或 ~/.dsh。 */
export function todoHomeDir(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/** 数据文件绝对路径。 */
export function todoDataFile(): string {
  return join(todoHomeDir(), 'todo-reminder', 'todos.json')
}

function finiteNum(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 归一化一条待办（容错读取：字段缺省回退）。 */
function normalizeTodo(raw: Record<string, unknown>): TodoItem | undefined {
  if (typeof raw.id !== 'string' || raw.id === '') return undefined
  if (typeof raw.title !== 'string') return undefined
  const style: ReminderStyle = isReminderStyle(raw.reminderStyle) ? raw.reminderStyle : 'info'
  return {
    id: raw.id,
    title: raw.title,
    note: typeof raw.note === 'string' ? raw.note : '',
    done: raw.done === true,
    createdAt: finiteNum(raw.createdAt) ?? Date.now(),
    completedAt: finiteNum(raw.completedAt),
    dueAt: finiteNum(raw.dueAt),
    reminderStyle: style,
    confirmOnComplete: raw.confirmOnComplete === true,
    reminded: raw.reminded === true,
    snoozedUntil: finiteNum(raw.snoozedUntil),
  }
}

/** 归一化一条提醒事件。 */
function normalizeReminder(raw: Record<string, unknown>): ReminderEvent | undefined {
  if (typeof raw.id !== 'string' || raw.id === '') return undefined
  if (typeof raw.todoId !== 'string') return undefined
  if (typeof raw.title !== 'string') return undefined
  const style: ReminderStyle = isReminderStyle(raw.style) ? raw.style : 'info'
  return {
    id: raw.id,
    todoId: raw.todoId,
    title: raw.title,
    style,
    firedAt: finiteNum(raw.firedAt) ?? Date.now(),
  }
}

/** 归一化设置（缺省回退；兼容旧版单布尔 `sound`）。 */
function normalizeSettings(raw: unknown): TodoSettings {
  const base: TodoSettings = {
    soundByStyle: { ...DEFAULT_TODO_SETTINGS.soundByStyle },
    snoozeMinutes: [...DEFAULT_TODO_SETTINGS.snoozeMinutes],
    sound: { ...DEFAULT_TODO_SETTINGS.sound },
    dock: { ...DEFAULT_TODO_SETTINGS.dock },
  }
  if (typeof raw !== 'object' || raw === null) return base
  const record = raw as Record<string, unknown>

  if (typeof record.soundByStyle === 'object' && record.soundByStyle !== null) {
    const sbs = record.soundByStyle as Record<string, unknown>
    for (const key of REMINDER_STYLES) {
      if (typeof sbs[key] === 'boolean') base.soundByStyle[key] = sbs[key]
    }
  } else if (typeof record.sound === 'boolean') {
    // 旧版单布尔 → 全样式同值。
    for (const key of REMINDER_STYLES) base.soundByStyle[key] = record.sound
  }

  if (Array.isArray(record.snoozeMinutes)) {
    const cleaned = sanitizeMinutesList(record.snoozeMinutes)
    if (cleaned.length > 0) base.snoozeMinutes = cleaned
  }

  if (typeof record.sound === 'object' && record.sound !== null) {
    const snd = record.sound as Partial<Record<keyof SoundSettings, unknown>>
    if (typeof snd.inPage === 'boolean') base.sound.inPage = snd.inPage
    base.sound.volume = clampNumber(snd.volume, 0, 1, base.sound.volume)
    base.sound.dangerRepeat = Math.round(clampNumber(snd.dangerRepeat, 1, 5, base.sound.dangerRepeat))
  }

  if (typeof record.dock === 'object' && record.dock !== null) {
    const dock = record.dock as Partial<Record<keyof DockSettings, unknown>>
    if (typeof dock.enabled === 'boolean') base.dock.enabled = dock.enabled
    if (typeof dock.showNext === 'boolean') base.dock.showNext = dock.showNext
  }

  return base
}

export function emptyDoc(): PersistedTodoDoc {
  // 深拷贝：浅拷贝会让嵌套对象与 DEFAULT_TODO_SETTINGS 共享引用，写设置将污染默认常量。
  return { todos: [], reminders: [], settings: normalizeSettings(undefined) }
}

/** 读取持久化数据；缺失 / 损坏 → 空。 */
export function loadDoc(file: string = todoDataFile()): PersistedTodoDoc {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { todos?: unknown; reminders?: unknown; settings?: unknown }
    const todos: TodoItem[] = Array.isArray(parsed.todos)
      ? (parsed.todos.map((t) => normalizeTodo(t as Record<string, unknown>)).filter((t): t is TodoItem => t !== undefined))
      : []
    const reminders: ReminderEvent[] = Array.isArray(parsed.reminders)
      ? (parsed.reminders.map((r) => normalizeReminder(r as Record<string, unknown>)).filter((r): r is ReminderEvent => r !== undefined))
      : []
    return { todos, reminders, settings: normalizeSettings(parsed.settings) }
  } catch {
    return emptyDoc()
  }
}

/** 原子写持久化数据。 */
export function saveDoc(doc: PersistedTodoDoc, file: string = todoDataFile()): void {
  try {
    mkdirSync(join(file, '..'), { recursive: true })
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf8')
    renameSync(tmp, file)
  } catch {
    // 持久化失败静默：内存态继续可用。
  }
}
