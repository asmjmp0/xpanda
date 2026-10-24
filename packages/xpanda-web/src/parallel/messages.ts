/**
 * 主线程 ↔ simplify worker 的消息协议。
 * AST JSON 自包含,可直接跨线程传递,worker 不需要重新解析 .abc。
 * @Author: jmp0
 */
export interface SimplifyTaskMessage {
    id: number;
    /** PandaDecompiler.decompileClassAst() 的输出 */
    ast: string;
}

export interface SimplifyResultMessage {
    id: number;
    text?: string;
    error?: string;
}
