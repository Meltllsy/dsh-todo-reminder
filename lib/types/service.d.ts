/**
 * TodoService：待办 CRUD + 到期提醒调度 + 设置 + 订阅（SSE 推送源）。纯框架无关
 * （不 extend cordis Service、不依赖 @deepseek-ai/* 运行时），只依赖 node: 内置 +
 * 本地 store/types，因此 host 半 tsc 产物自包含、任何装配路径都能加载。
 * @module dsh-todo-reminder/service
 */
import { type DockSettings, type ReminderStyle, type SoundSettings, type TodoAddInput, type TodoItem, type TodoPatch, type TodoSettings, type TodoState } from './types.js';
export interface TodoServiceConfig {
    /** 调度 tick 间隔（ms）。 */
    tickMs?: number;
}
/** 默认调度间隔：5 秒。 */
export declare const DEFAULT_TICK_MS = 5000;
type StateListener = (state: TodoState) => void;
/** 设置补丁（按字段允许部分更新）。 */
export interface TodoSettingsPatch {
    soundByStyle?: Partial<Record<ReminderStyle, boolean>>;
    snoozeMinutes?: number[];
    sound?: Partial<SoundSettings>;
    dock?: Partial<DockSettings>;
}
export declare class TodoService {
    private doc;
    private readonly dataFile;
    private readonly subscribers;
    constructor(dataFile?: string);
    /** 订阅状态变化（SSE 推送用）。返回取消订阅函数。 */
    subscribe(listener: StateListener): () => void;
    /** 完整状态快照。 */
    state(): TodoState;
    /** 新建待办。 */
    add(input: TodoAddInput): TodoItem;
    /** 更新待办字段。 */
    update(id: string, patch: TodoPatch): TodoItem | null;
    /** 删除待办（并清理其提醒）。 */
    remove(id: string): void;
    /** 完成待办（并清理其提醒）。 */
    complete(id: string): TodoItem | null;
    /** 稍后提醒：把已触发的提醒延后 minutes 分钟。 */
    snooze(id: string, minutes: number): TodoItem | null;
    /** 忽略一条提醒（确认已看到，不再提醒）。 */
    dismissReminder(reminderId: string): void;
    /** 更新用户设置。 */
    setSettings(patch: TodoSettingsPatch): TodoSettings;
    /** 当前设置（深拷贝）。 */
    settings(): TodoSettings;
    /**
     * 调度 tick：扫描到期且未触发的待办，生成提醒事件。
     * @param now - 当前 epoch ms。
     */
    tick(now: number): void;
    private clearRemindersFor;
    private flush;
    private notify;
}
export {};
