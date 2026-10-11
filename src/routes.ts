/**
 * Todo HTTP 路由：浏览器经同源 /api/todo/* JSON 端点读写（与 dsh-pet 的
 * /api/pet/* 同模式），另加 /api/todo/events SSE 事件流实时推送状态变化。
 * host 用 ctx.webServer.register 注册这些 exact 路由。
 * @module dsh-todo-reminder/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { existsSync, mkdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TodoService } from './service.js'
import { todoHomeDir } from './store.js'
import { isReminderStyle, type DockSettings, type PushMessage, type ReminderStyle, type SoundSettings, type TodoAddInput, type TodoPatch } from './types.js'

/** webServer 路由描述（局部类型，避免 host 运行时依赖 @deepseek-ai/dsh-host-webserver）。 */
export interface WebRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler(req: IncomingMessage, res: ServerResponse): void | Promise<void>
}

/** Browser-facing base path. */
export const TODO_API_PREFIX = '/api/todo'

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function requireMethod(req: IncomingMessage, res: ServerResponse, method: string): boolean {
  if (req.method === method) return true
  json(res, 405, { ok: false, error: 'method-not-allowed' })
  return false
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 64 * 1024) {
        reject(new Error('body-too-large'))
        queueMicrotask(() => req.destroy())
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        resolve(typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {})
      } catch {
        reject(new Error('invalid-json'))
      }
    })
    req.on('error', reject)
  })
}

/** GET 路由封装。 */
function getRoute(path: string, run: () => unknown): WebRoute {
  return {
    kind: 'exact',
    path,
    handler: (req: IncomingMessage, res: ServerResponse): void => {
      if (!requireMethod(req, res, 'GET')) return
      try {
        json(res, 200, run())
      } catch (error) {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }
}

/** POST 路由封装（body 传入 run）。 */
function postRoute(path: string, run: (body: Record<string, unknown>) => unknown): WebRoute {
  return {
    kind: 'exact',
    path,
    handler: (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (!requireMethod(req, res, 'POST')) return Promise.resolve()
      return readJsonBody(req).then(
        (body) => {
          try {
            json(res, 200, run(body))
          } catch (error) {
            json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
          }
        },
        (error) => {
          json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        },
      )
    },
  }
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** SSE 事件流：连接即推送当前状态，之后状态变化实时推送。 */
function sseRoute(service: TodoService): WebRoute {
  return {
    kind: 'exact',
    path: `${TODO_API_PREFIX}/events`,
    handler: (req: IncomingMessage, res: ServerResponse): void => {
      if (req.method !== 'GET') {
        json(res, 405, { ok: false, error: 'method-not-allowed' })
        return
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        'connection': 'keep-alive',
      })
      res.write(': connected\n\n')
      const send = (message: PushMessage): void => {
        try {
          res.write(`data: ${JSON.stringify(message)}\n\n`)
        } catch {
          // 连接已断，忽略。
        }
      }
      send({ type: 'state', state: service.state() })
      const unsubscribeState = service.subscribe((state) => send({ type: 'state', state }))
      const cleanup = (): void => {
        unsubscribeState()
      }
      req.on('close', cleanup)
      res.on('close', cleanup)
    },
  }
}

/** 自定义音效文件扩展名 → mime，按顺序取第一个存在的。 */
const SOUND_EXTENSIONS: Array<{ ext: string; mime: string }> = [
  { ext: 'mp3', mime: 'audio/mpeg' },
  { ext: 'wav', mime: 'audio/wav' },
  { ext: 'ogg', mime: 'audio/ogg' },
  { ext: 'm4a', mime: 'audio/mp4' },
]

/**
 * 自定义音效路由：读 $DSH_HOME/todo-reminder/<basename>.*，缺失返回 404
 * （客户端会退回内置合成音）。
 * @param path - 路由路径。
 * @param basename - 音效文件基名（不含扩展名）。
 */
function soundRoute(path: string, basename: string): WebRoute {
  const candidates = SOUND_EXTENSIONS.map((e) => ({ file: `${basename}.${e.ext}`, mime: e.mime }))
  return {
    kind: 'exact',
    path,
    handler: (req: IncomingMessage, res: ServerResponse): Promise<void> | void => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405)
        res.end()
        return
      }
      const dir = join(todoHomeDir(), 'todo-reminder')
      for (const candidate of candidates) {
        const file = join(dir, candidate.file)
        if (!existsSync(file)) continue
        return readFile(file).then(
          (body) => {
            res.writeHead(200, {
              'content-type': candidate.mime,
              'content-length': String(body.byteLength),
              'cache-control': 'no-cache',
            })
            if (req.method === 'HEAD') {
              res.end()
              return
            }
            res.end(body)
          },
          () => {
            res.writeHead(404)
            res.end()
          },
        )
      }
      res.writeHead(404)
      res.end()
    },
  }
}


/**
 * 打开本插件的数据目录（自定义音效就放这里）。
 * 只打开插件自己的固定目录，不接受任何入参，因此没有路径注入面。
 */
function openDirRoute(): WebRoute {
  return {
    kind: 'exact',
    path: `${TODO_API_PREFIX}/open-dir`,
    handler: (req: IncomingMessage, res: ServerResponse): void => {
      if (!requireMethod(req, res, 'POST')) return
      const dir = join(todoHomeDir(), 'todo-reminder')
      try {
        mkdirSync(dir, { recursive: true })
        // 跨平台：Windows 用资源管理器，macOS 用 open，Linux 用 xdg-open。
        const opener = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
        spawn(opener, [dir], { detached: true, stdio: 'ignore' }).unref()
        json(res, 200, { ok: true, dir })
      } catch (error) {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }
}
/** 构建完整路由族。 */
export function makeTodoRoutes(service: TodoService): WebRoute[] {
  return [
    getRoute(`${TODO_API_PREFIX}/state`, () => service.state()),

    sseRoute(service),

    openDirRoute(),

    // 待办自定义音效文件：$DSH_HOME/todo-reminder/sound.*
    soundRoute(`${TODO_API_PREFIX}/sound`, 'sound'),

    postRoute(`${TODO_API_PREFIX}/add`, (body) => {
      const input: TodoAddInput = {
        title: typeof body.title === 'string' ? body.title : '',
        note: typeof body.note === 'string' ? body.note : '',
        dueAt: num(body.dueAt),
        reminderStyle: isReminderStyle(body.reminderStyle) ? body.reminderStyle : 'info',
        confirmOnComplete: body.confirmOnComplete === true,
      }
      return { ok: true, todo: service.add(input) }
    }),

    postRoute(`${TODO_API_PREFIX}/update`, (body) => {
      const id = typeof body.id === 'string' ? body.id : ''
      const raw = (typeof body.patch === 'object' && body.patch !== null ? body.patch : {}) as Record<string, unknown>
      const patch: TodoPatch = {}
      if (typeof raw.title === 'string') patch.title = raw.title
      if (typeof raw.note === 'string') patch.note = raw.note
      if (raw.dueAt === null) patch.dueAt = undefined
      else if (num(raw.dueAt) !== undefined) patch.dueAt = num(raw.dueAt)
      if (isReminderStyle(raw.reminderStyle)) patch.reminderStyle = raw.reminderStyle
      if (typeof raw.confirmOnComplete === 'boolean') patch.confirmOnComplete = raw.confirmOnComplete
      if (typeof raw.done === 'boolean') patch.done = raw.done
      const todo = service.update(id, patch)
      return todo === null ? { ok: false, error: 'not-found' } : { ok: true, todo }
    }),

    postRoute(`${TODO_API_PREFIX}/delete`, (body) => {
      const id = typeof body.id === 'string' ? body.id : ''
      service.remove(id)
      return { ok: true }
    }),

    postRoute(`${TODO_API_PREFIX}/complete`, (body) => {
      const id = typeof body.id === 'string' ? body.id : ''
      const todo = service.complete(id)
      return todo === null ? { ok: false, error: 'not-found' } : { ok: true, todo }
    }),

    postRoute(`${TODO_API_PREFIX}/snooze`, (body) => {
      const id = typeof body.id === 'string' ? body.id : ''
      const minutes = num(body.minutes) ?? 10
      const todo = service.snooze(id, minutes)
      return todo === null ? { ok: false, error: 'not-found' } : { ok: true, todo }
    }),

    postRoute(`${TODO_API_PREFIX}/dismiss-reminder`, (body) => {
      const reminderId = typeof body.reminderId === 'string' ? body.reminderId : ''
      service.dismissReminder(reminderId)
      return { ok: true }
    }),

    postRoute(`${TODO_API_PREFIX}/set-settings`, (body) => {
      const raw = (typeof body.settings === 'object' && body.settings !== null ? body.settings : {}) as Record<string, unknown>
      const settings = service.setSettings({
        ...(typeof raw.soundByStyle === 'object' && raw.soundByStyle !== null
          ? { soundByStyle: raw.soundByStyle as Partial<Record<ReminderStyle, boolean>> }
          : {}),
        ...(Array.isArray(raw.snoozeMinutes) ? { snoozeMinutes: raw.snoozeMinutes } : {}),
        ...(typeof raw.sound === 'object' && raw.sound !== null
          ? { sound: raw.sound as Partial<SoundSettings> }
          : {}),
        ...(typeof raw.dock === 'object' && raw.dock !== null
          ? { dock: raw.dock as Partial<DockSettings> }
          : {}),
      })
      return { ok: true, settings }
    }),
  ]
}
