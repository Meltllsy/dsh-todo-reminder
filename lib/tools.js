/**
 * Agent 工具：让 assistant 直接增删查改「同一份全局个人待办列表」。
 * 手写工具 descriptor（name/description/parameters JSON Schema/output/execute），
 * 不 import @deepseek-ai/dsh-tools —— 保持 host 半自包含、tsc 直编、免打包。
 * @module dsh-todo-reminder/tools
 */
import { isReminderStyle, REMINDER_STYLES } from './types.js';
/** 字符串输出的通用 render。 */
function textRender(_args, value) {
    return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }];
}
const STRING_SCHEMA = { type: 'string' };
function asArgs(args) {
    return typeof args === 'object' && args !== null ? args : {};
}
/** 按 id（精确）或 title（精确/子串）定位一条待办。 */
function findTodo(service, args) {
    const id = typeof args.id === 'string' ? args.id : '';
    const title = typeof args.title === 'string' ? args.title.trim() : '';
    const todos = service.state().todos;
    if (id !== '') {
        const byId = todos.find((t) => t.id === id);
        if (byId !== undefined)
            return byId;
    }
    if (title !== '') {
        const exact = todos.find((t) => t.title === title);
        if (exact !== undefined)
            return exact;
        const sub = todos.find((t) => t.title.includes(title));
        if (sub !== undefined)
            return sub;
    }
    return undefined;
}
function fmtTime(ms) {
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function renderList(state, status) {
    const todos = state.todos.filter((t) => {
        if (status === 'pending')
            return !t.done;
        if (status === 'done')
            return t.done;
        return true;
    });
    if (todos.length === 0)
        return '（无）';
    return todos.map((t) => {
        const mark = t.done ? '✓' : '·';
        const parts = [`${mark} ${t.title}`];
        if (t.dueAt !== undefined)
            parts.push(`提醒 ${fmtTime(t.dueAt)}`);
        parts.push(`样式 ${t.reminderStyle}`);
        if (t.confirmOnComplete)
            parts.push('完成需确认');
        parts.push(`id=${t.id}`);
        return parts.join('  ');
    }).join('\n');
}
/** 构建全部工具（注册时逐个 ctx.tools.register）。 */
export function makeTodoTools(service) {
    const addTool = {
        name: 'todo_add',
        description: '在用户的「个人待办/提醒」列表（全局，跨所有会话，持久化）中添加一条。用户说"提醒我 X 分钟后做 Y"、"加个待办"、"帮我记一下"等时使用。到期后会在 DSH 里弹提醒（切出到别的窗口也会弹系统通知）。',
        parameters: {
            type: 'object',
            properties: {
                title: { type: 'string', description: '待办标题（要提醒的事，简短）' },
                note: { type: 'string', description: '备注（可选）' },
                dueInMinutes: { type: 'integer', description: '相对提醒：多少分钟后提醒（与 dueAt 二选一，优先用这个，如 30）' },
                dueAt: { type: 'integer', description: '绝对提醒时间（epoch 毫秒），与 dueInMinutes 二选一' },
                reminderStyle: {
                    type: 'string',
                    enum: [...REMINDER_STYLES],
                    description: '提醒样式：info 提醒 / success 纪念 / warning 注意 / danger 紧急，默认 info',
                },
                confirmOnComplete: { type: 'boolean', description: '完成前是否需要用户确认，默认 false' },
            },
            required: ['title'],
        },
        output: { schema: STRING_SCHEMA, render: textRender },
        execute: (args) => {
            const a = asArgs(args);
            const title = typeof a.title === 'string' ? a.title.trim() : '';
            if (title === '')
                throw new Error('title 不能为空');
            const dueInMinutes = typeof a.dueInMinutes === 'number' && Number.isFinite(a.dueInMinutes) ? a.dueInMinutes : undefined;
            const dueAt = typeof a.dueAt === 'number' && Number.isFinite(a.dueAt) ? a.dueAt : undefined;
            const effectiveDueAt = dueAt ?? (dueInMinutes !== undefined && dueInMinutes > 0 ? Date.now() + dueInMinutes * 60_000 : undefined);
            const todo = service.add({
                title,
                note: typeof a.note === 'string' ? a.note : '',
                dueAt: effectiveDueAt,
                reminderStyle: isReminderStyle(a.reminderStyle) ? a.reminderStyle : 'info',
                confirmOnComplete: a.confirmOnComplete === true,
            });
            const tail = todo.dueAt !== undefined ? `，将在 ${fmtTime(todo.dueAt)} 提醒（样式 ${todo.reminderStyle}）` : '（未设提醒时间，仅记入待办）';
            return `已添加待办「${todo.title}」${tail}`;
        },
    };
    const listTool = {
        name: 'todo_list',
        description: '列出用户的「个人待办/提醒」列表（全局，跨会话）。',
        parameters: {
            type: 'object',
            properties: {
                status: { type: 'string', enum: ['pending', 'done', 'all'], description: 'pending 待办 / done 已完成 / all 全部，默认 pending' },
            },
            required: [],
        },
        output: { schema: STRING_SCHEMA, render: textRender },
        execute: (args) => {
            const a = asArgs(args);
            const status = a.status === 'done' || a.status === 'all' ? a.status : 'pending';
            const state = service.state();
            const count = state.todos.filter((t) => (status === 'all' ? true : status === 'done' ? t.done : !t.done)).length;
            return `待办列表（${count} 条）：\n${renderList(state, status)}`;
        },
    };
    const completeTool = {
        name: 'todo_complete',
        description: '完成一条待办（按 id 或标题匹配）。',
        parameters: {
            type: 'object',
            properties: {
                id: { type: 'string', description: '待办 id（todo_list 返回的 id）' },
                title: { type: 'string', description: '或按标题匹配（精确/子串）' },
            },
            required: [],
        },
        output: { schema: STRING_SCHEMA, render: textRender },
        execute: (args) => {
            const todo = findTodo(service, asArgs(args));
            if (todo === undefined)
                throw new Error('找不到该待办（请用 todo_list 查看 id 或标题）');
            service.complete(todo.id);
            return `已完成「${todo.title}」`;
        },
    };
    const snoozeTool = {
        name: 'todo_snooze',
        description: '把一条待办的提醒延后（稍后提醒）。',
        parameters: {
            type: 'object',
            properties: {
                id: { type: 'string', description: '待办 id' },
                title: { type: 'string', description: '或按标题匹配' },
                minutes: { type: 'integer', description: '延后多少分钟，默认 10' },
            },
            required: [],
        },
        output: { schema: STRING_SCHEMA, render: textRender },
        execute: (args) => {
            const a = asArgs(args);
            const todo = findTodo(service, a);
            if (todo === undefined)
                throw new Error('找不到该待办');
            const minutes = typeof a.minutes === 'number' && Number.isFinite(a.minutes) ? a.minutes : 10;
            service.snooze(todo.id, minutes);
            return `已把「${todo.title}」延后 ${minutes} 分钟提醒`;
        },
    };
    const deleteTool = {
        name: 'todo_delete',
        description: '删除一条待办（按 id 或标题匹配）。',
        parameters: {
            type: 'object',
            properties: {
                id: { type: 'string', description: '待办 id' },
                title: { type: 'string', description: '或按标题匹配' },
            },
            required: [],
        },
        output: { schema: STRING_SCHEMA, render: textRender },
        execute: (args) => {
            const todo = findTodo(service, asArgs(args));
            if (todo === undefined)
                throw new Error('找不到该待办');
            service.remove(todo.id);
            return `已删除「${todo.title}」`;
        },
    };
    return [addTool, listTool, completeTool, snoozeTool, deleteTool];
}
//# sourceMappingURL=tools.js.map