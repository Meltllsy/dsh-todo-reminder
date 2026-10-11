/**
 * Agent 工具：让 assistant 直接增删查改「同一份全局个人待办列表」。
 * 手写工具 descriptor（name/description/parameters JSON Schema/output/execute），
 * 不 import @deepseek-ai/dsh-tools —— 保持 host 半自包含、tsc 直编、免打包。
 * @module dsh-todo-reminder/tools
 */
import type { TodoService } from './service.js';
/** 手写的 registry-ready 工具定义（与 @deepseek-ai/dsh-tools 的 ToolDefinition 对齐）。 */
export interface TodoToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    output: {
        schema: Record<string, unknown>;
        render(args: unknown, value: unknown): Array<{
            type: 'text';
            text: string;
        }>;
    };
    execute(args: Record<string, unknown>): Promise<unknown> | unknown;
}
/** 构建全部工具（注册时逐个 ctx.tools.register）。 */
export declare function makeTodoTools(service: TodoService): TodoToolDefinition[];
