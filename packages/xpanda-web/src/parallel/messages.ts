/**
 * 主线程 ↔ simplify worker 的消息协议。
 * AST 是纯 Babel 节点树,通过 structured clone 直接跨线程传递,worker 不需要重新解析 .abc。
 * @Author: jmp0
 */
export interface SimplifyTaskMessage {
    id: number;
    /** PandaDecompiler.decompileClassAst() 返回的 AST 对象 */
    ast: any;
}

export interface SimplifyResultMessage {
    id: number;
    text?: string;
    error?: string;
}
