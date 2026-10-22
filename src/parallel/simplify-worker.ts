import { parentPort } from "worker_threads";
import { PandaDecompiler } from "../PandaDecompiler";

/**
 * simplify worker:接收单类的 AST JSON,返回生成后的 JS 源码。
 * AST JSON 自包含(不依赖 PandaFile),因此 worker 无需重新解析 .abc;
 * 反汇编/词法分析仍在主线程完成(只占总耗时不到 1%)。
 * @Author: jmp0
 */

const decompiler = new PandaDecompiler();

interface TaskMessage {
    id: number;
    ast: string;
}

parentPort!.on("message", (msg: TaskMessage) => {
    try {
        parentPort!.postMessage({ id: msg.id, text: decompiler.simplifyInProcess(msg.ast) });
    } catch (e) {
        parentPort!.postMessage({ id: msg.id, error: e instanceof Error ? e.message : String(e) });
    }
});
