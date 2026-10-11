/**
 * 磁盘持久化：todo + 提醒事件 + 设置写一份 JSON 到 $DSH_HOME/todo-reminder/todos.json。
 * 原子写（tmp + rename）、容错读（损坏 → 空）。只依赖 node: 内置模块。
 * @module dsh-todo-reminder/store
 */
import { type ReminderEvent, type TodoItem, type TodoSettings } from './types.js';
/** 持久化文档形态。 */
export interface PersistedTodoDoc {
    todos: TodoItem[];
    reminders: ReminderEvent[];
    settings: TodoSettings;
}
/** 持久化目录：$DSH_HOME（优先）或 ~/.dsh。 */
export declare function todoHomeDir(): string;
/** 数据文件绝对路径。 */
export declare function todoDataFile(): string;
export declare function emptyDoc(): PersistedTodoDoc;
/** 读取持久化数据；缺失 / 损坏 → 空。 */
export declare function loadDoc(file?: string): PersistedTodoDoc;
/** 原子写持久化数据。 */
export declare function saveDoc(doc: PersistedTodoDoc, file?: string): void;
