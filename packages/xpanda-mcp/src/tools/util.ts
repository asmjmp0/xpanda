import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * MCP 工具公共工具:结果包装与错误处理
 * @Author: jmp0
 */

/** 文本结果 */
export function textResult(text: string): CallToolResult {
    return { content: [{ type: "text", text }] };
}

/** JSON 结果(缩进两格,便于 agent 阅读) */
export function jsonResult(obj: unknown): CallToolResult {
    return textResult(JSON.stringify(obj, null, 2));
}

/** 错误结果:返回 isError 而不是抛异常,保留完整错误链 */
export function errorResult(e: unknown): CallToolResult {
    const message = e instanceof Error ? (e.stack ?? e.message) : String(e);
    return { content: [{ type: "text", text: "ERROR: " + message }], isError: true };
}

/** 单类反编译输出截断上限(字节) */
export const MAX_DECOMPILE_OUTPUT = 50_000;

/** 超长文本截断,附说明 */
export function truncateText(text: string, max: number): { text: string; truncated: boolean } {
    if (text.length <= max) return { text, truncated: false };
    return {
        text: text.substring(0, max)
            + "\n\n/* ...输出已截断(原始长度 " + text.length + " 字符,上限 " + max + ")"
            + "。请使用 abc_export 落盘后读取文件,或缩小查询范围。 */",
        truncated: true,
    };
}
