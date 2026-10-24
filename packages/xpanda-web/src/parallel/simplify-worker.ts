// 先注入 process shim,再加载 core / @babel(依赖顺序不能改)
import "./process-shim";
import { PandaDecompiler } from "xpanda-core";
import type { SimplifyResultMessage, SimplifyTaskMessage } from "./messages";

/**
 * simplify worker:接收单类的 AST JSON,返回优化后的 JS 源码。
 *
 * 与 cli 的 worker_threads 版本分工一致:主线程负责解析 .abc、反汇编与 AST 构建
 * (占比很低),worker 只跑最耗时的 simplify。每个 worker 各自持有一个
 * PandaDecompiler,单类输出只依赖该类自己,因此结果与线程数/完成顺序无关。
 * @Author: jmp0
 */

interface WorkerScope {
    onmessage: ((event: MessageEvent<SimplifyTaskMessage>) => void) | null;
    postMessage(message: SimplifyResultMessage): void;
}

// DedicatedWorkerGlobalScope 不在 DOM lib 里,这里用最小结构描述用到的成员
const scope = self as unknown as WorkerScope;
const decompiler = new PandaDecompiler();

scope.onmessage = (event) => {
    const { id, ast } = event.data;
    try {
        scope.postMessage({ id, text: decompiler.simplifyInProcess(ast) });
    } catch (e) {
        scope.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
    }
};
