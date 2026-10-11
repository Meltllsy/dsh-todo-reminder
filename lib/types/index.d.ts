/**
 * dsh-todo-reminder host 半 —— 挂载 TodoService、HTTP 路由（含 SSE 推送）、定时调度、
 * agent 工具与 systemPrompt 公告。
 *
 * 本插件是**全局个人待办**：一份清单、与 DSH 会话无关，不监听任何 session 事件。
 * DSH 会话的完成 / 提问 / 审批提醒是另一个独立插件 dsh-session-attention。
 * host 半只依赖 node: 内置模块（自包含）。
 * @module dsh-todo-reminder
 */
import { type TodoServiceConfig } from './service.js';
/** host 上下文最小接口（webServer / timer / tools / systemPrompt 由 cordis 注入）。 */
export interface TodoHostContext {
    webServer: {
        register(route: {
            kind: 'exact' | 'prefix';
            path: string;
            handler: unknown;
        }): () => void;
    };
    interval(callback: () => void, ms: number): () => void;
    effect(fn: () => (() => void) | void, label?: string): () => void;
    tools: {
        register(definition: unknown): () => void;
    };
    systemPrompt?: {
        section(opts: {
            name: string;
            order: number;
            text: string;
        }): () => void;
    };
}
/** 稳定的 cordis 插件名（与 cordis.patch.yml insert id 一致）。 */
export declare const name = "todo-reminder";
/** host 半需要的注入服务。 */
export declare const inject: string[];
/** 面向模型的公告：插件存在性、能力、限制（只讲待办）。 */
export declare const TODO_GUIDANCE = "\u672C\u673A\u5DF2\u5B89\u88C5 dsh-todo-reminder \u63D2\u4EF6\uFF08\u4E2A\u4EBA\u5F85\u529E\u6A21\u5757\uFF09\uFF1A\u4E00\u4EFD\u3010\u5168\u5C40\u3011\u5F85\u529E\u6E05\u5355\uFF0C\u4E0E DSH \u4F1A\u8BDD\u3001\u4E0E\u4EFB\u4F55\u5177\u4F53\u4EFB\u52A1\u65E0\u5173\u3002\u4FA7\u8FB9\u680F\u300C\u5F85\u529E\u300D\u5165\u53E3\u6253\u5F00\u5F85\u529E\u9762\u677F\uFF08\u5168\u5C40\u6D6E\u5C42\uFF0C\u4EFB\u4F55\u4F1A\u8BDD\u4E0B\u90FD\u4E00\u6837\uFF09\uFF1B\u7A97\u53E3\u53F3\u4FA7\u8FB9\u7F18\u5E38\u9A7B\u4E00\u4E2A\u53EF\u6536\u8D77\u7684\u5F85\u529E\u6761\uFF08Dock\uFF09\uFF0C\u6536\u8D77\u65F6\u76F4\u63A5\u663E\u793A\u4E0B\u4E00\u4EF6\u8981\u505A\u7684\u4E8B\uFF08\u5230\u671F\u65F6\u95F4 + \u6807\u9898\uFF09\uFF0C\u903E\u671F\u53D8\u7EA2\uFF0C\u5C55\u5F00\u53EF\u5FEB\u901F\u6DFB\u52A0\u3001\u52FE\u5B8C\u6210\u3001\u7A0D\u540E\u63D0\u9192\uFF0C\u53EF\u4E0A\u4E0B\u62D6\u52A8\u3001\u53EF\u5728\u8BBE\u7F6E\u91CC\u5173\u95ED\u3002\u4EFB\u52A1\u53EF\u8BBE\u5230\u671F\u65F6\u95F4\u4E0E\u63D0\u9192\u6837\u5F0F\uFF08info/success/warning/danger\uFF09\uFF0C\u5230\u671F\u5F39\u63D0\u9192\u53EF\u300C\u5B8C\u6210 / \u7A0D\u540E\u63D0\u9192 / \u5FFD\u7565\u300D\uFF0C\u5207\u51FA\u7A97\u53E3\u8FD8\u4F1A\u5F39\u7CFB\u7EDF\u901A\u77E5\uFF1B\u4EFB\u52A1\u53EF\u5F00\u300C\u5B8C\u6210\u9700\u786E\u8BA4\u300D\u3002agent \u53EF\u7528 todo_add / todo_list / todo_complete / todo_snooze / todo_delete \u7BA1\u7406\u8FD9\u4EFD\u5168\u5C40\u5217\u8868\u3002\u63D0\u9192\u97F3\uFF1A\u81EA\u5B9A\u4E49\u97F3\u6548\u653E ~/.dsh/todo-reminder/sound.mp3\uFF08\u6216 .wav/.ogg/.m4a\uFF0C\u7F3A\u7701\u7528\u5185\u7F6E\u5408\u6210\u97F3\uFF09\uFF0C\u97F3\u91CF\u3001\u97F3\u8272\u3001\u6BCF\u79CD\u6837\u5F0F\u662F\u5426\u54CD\u94C3\u90FD\u5728\u9762\u677F\u91CC\u8BBE\u7F6E\u3002\u6570\u636E\u6301\u4E45\u5316\u5728 ~/.dsh/todo-reminder/todos.json\u3002\u9650\u5236\uFF1A\u63D0\u9192\u9700\u8981 GUI \u6807\u7B7E\u9875\u6253\u5F00\uFF08\u540E\u53F0\u4EA6\u53EF\uFF09\u624D\u4F1A\u5F39\uFF1B\u6D4F\u89C8\u5668\u5B8C\u5168\u5173\u95ED\u671F\u95F4\u7684\u63D0\u9192\u4F1A\u6682\u5B58\uFF0C\u4E0B\u6B21\u6253\u5F00\u8865\u5F39\u3002\u7528\u6237\u63D0\u5230\u300C\u5F85\u529E / todo / \u63D0\u9192\u6211\u505A\u4E8B / \u4EFB\u52A1\u6E05\u5355\u300D\u65F6\u5373\u6307\u672C\u63D2\u4EF6\u3002\u6CE8\u610F\uFF1ADSH \u4F1A\u8BDD\u7684\u300C\u8DD1\u5B8C / \u63D0\u95EE / \u5BA1\u6279\u300D\u63D0\u9192\u5C5E\u4E8E\u53E6\u4E00\u4E2A\u72EC\u7ACB\u63D2\u4EF6 dsh-session-attention\uFF0C\u4E0E\u672C\u63D2\u4EF6\u65E0\u5173\u3002";
/**
 * host 装配：创建服务、注册路由、注册工具、启动调度、注入公告。
 * @param ctx - host 上下文（webServer + timer + tools + systemPrompt 已注入）。
 * @param config - 插件配置（缺省用默认值）。
 */
export declare function apply(ctx: TodoHostContext, config?: TodoServiceConfig): void;
export { TodoService } from './service.js';
export type { TodoServiceConfig } from './service.js';
export type { ReminderEvent, ReminderStyle, TodoAddInput, TodoItem, TodoPatch, TodoSettings, TodoState } from './types.js';
