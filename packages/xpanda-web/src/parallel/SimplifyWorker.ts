import type { SimplifyResultMessage, SimplifyTaskMessage } from "./messages";

interface PendingTask {
    resolve: (text: string) => void;
    reject: (error: Error) => void;
}

/**
 * 单个 simplify Web Worker 的封装:惰性创建、任务编号、崩溃时拒绝在途任务。
 * Vite 会把 `new URL("./simplify-worker.ts", import.meta.url)` 打成独立的 worker 入口。
 * @Author: jmp0
 */
export class SimplifyWorker {
    private worker: Worker | null = null;
    private seq = 0;
    private readonly pending = new Map<number, PendingTask>();

    private ensure(): Worker {
        if (this.worker !== null) return this.worker;
        const worker = new Worker(new URL("./simplify-worker.ts", import.meta.url), {
            type: "module",
            name: "xpanda-simplify",
        });
        worker.onmessage = (event: MessageEvent<SimplifyResultMessage>) => {
            const task = this.pending.get(event.data.id);
            if (task === undefined) return;
            this.pending.delete(event.data.id);
            if (event.data.error !== undefined) task.reject(new Error(event.data.error));
            else task.resolve(event.data.text ?? "");
        };
        worker.onerror = (event) => {
            this.fail(worker, new Error(event.message.length > 0 ? event.message : "simplify worker crashed"));
        };
        worker.onmessageerror = () => {
            this.fail(worker, new Error("simplify worker message could not be deserialized"));
        };
        this.worker = worker;
        return worker;
    }

    /** worker 异常/退出:拒绝在途任务,下次 run 时重建 */
    private fail(worker: Worker, error: Error): void {
        if (this.worker !== worker) return;
        this.worker = null;
        for (const task of this.pending.values()) task.reject(error);
        this.pending.clear();
        worker.terminate();
    }

    run(ast: string): Promise<string> {
        const worker = this.ensure();
        const id = ++this.seq;
        return new Promise<string>((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            try {
                worker.postMessage({ id, ast } satisfies SimplifyTaskMessage);
            } catch (e) {
                this.pending.delete(id);
                reject(e instanceof Error ? e : new Error(String(e)));
            }
        });
    }

    async terminate(): Promise<void> {
        const worker = this.worker;
        this.worker = null;
        for (const task of this.pending.values()) task.reject(new Error("simplify worker terminated"));
        this.pending.clear();
        if (worker !== null) worker.terminate();
    }
}
