/**
 * 共享类型：host 与 client 都引用的数据结构（纯类型 + 少量纯函数）。
 * 本包只管**个人待办** —— 一份全局清单，与 DSH 会话、与任何具体任务无关。
 * 会话的完成/审批提醒在另一个独立插件 dsh-session-attention 里。
 * @module dsh-todo-reminder/types
 */
export const REMINDER_STYLES = ['info', 'success', 'warning', 'danger'];
export function isReminderStyle(value) {
    return typeof value === 'string' && REMINDER_STYLES.includes(value);
}
/** 夹紧数值到 [min,max]；非有限数回退 fallback。 */
export function clampNumber(value, min, max, fallback) {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n))
        return fallback;
    return Math.min(max, Math.max(min, n));
}
export const DEFAULT_TODO_SETTINGS = {
    soundByStyle: { info: true, success: true, warning: true, danger: true },
    snoozeMinutes: [5, 15, 60],
    sound: { inPage: true, volume: 0.7, dangerRepeat: 3 },
    dock: { enabled: true, showNext: true },
};
/** 清洗分钟数列表：只留 1..1440 的整数、去重、升序、限长 8。空返回空数组。 */
export function sanitizeMinutesList(values) {
    const set = new Set();
    for (const value of values) {
        const n = typeof value === 'number' ? value : Number(value);
        if (Number.isInteger(n) && n >= 1 && n <= 1440)
            set.add(n);
    }
    return [...set].sort((a, b) => a - b).slice(0, 8);
}
//# sourceMappingURL=types.js.map