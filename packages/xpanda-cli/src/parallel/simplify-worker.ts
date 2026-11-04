import { parentPort } from "worker_threads";
import { PandaDecompiler } from "xpanda-core";

/**
 * simplify worker:接收单类的 AST 对象,返回生成后的 JS 源码。
 * AST 是纯 Babel 节点树,通过 structured clone 直接跨线程传递,worker 无需重新解析 .abc;
 * 反汇编/词法分析仍在主线程完成(只占总耗时不到 1%)。
 * @Author: jmp0
 */

const decompiler = new PandaDecompiler();

interface TaskMessage {
    id: number;
    ast: any;
}

parentPort!.on("message", (msg: TaskMessage) => {
    // Test hook only: a busy wait that stands in for a simplify call stuck past --timeout.
    const spinMs = Number(process.env.XPANDA_TEST_SIMPLIFY_SPIN_MS);
    if (Number.isFinite(spinMs) && spinMs > 0) {
        const start = Date.now();
        while (Date.now() - start < spinMs) { /* keep the worker busy until it is terminated */ }
    }
    try {
        parentPort!.postMessage({ id: msg.id, text: decompiler.simplifyAst(msg.ast) });
    } catch (e) {
        parentPort!.postMessage({ id: msg.id, error: e instanceof Error ? e.message : String(e) });
    }
});
