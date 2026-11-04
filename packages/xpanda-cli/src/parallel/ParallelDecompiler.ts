import * as os from "os";
import * as path from "path";
import { Worker } from "worker_threads";
import { ENTRY_FUNCTION_MAIN, NodeFactory } from "xpanda-core";
import type { PandaClass } from "xpanda-core";
import type { PandaDecompiler } from "xpanda-core";

/**
 * 按类并行的反编译调度。
 *
 * 分工:
 *   主线程:解析 .abc、反汇编、词法分析、AST 构建(单类 ~0.2s,占比 <1%),
 *           以及按类派发 + 结果排序;
 *   worker:只跑 simplify(单类可占 99% 耗时,内存/CPU 密集)。
 *
 * AST 是纯 Babel 节点树,通过 structured clone 跨线程传递,所以 worker 不需要重新解析 .abc。
 * 单类输出只依赖该类自己(PandaDecompiler.decompileRaw 会按类复位生成名计数器),
 * 因此结果与 jobs 数量、完成顺序无关。
 * @Author: jmp0
 */

export interface ParallelDecompileOptions {
    /** 并发数;<=0 表示自动(CPU 数 - 1,上限 4) */
    jobs?: number;
    /** 单类完成后回调(完成顺序,不保证类序),用于落盘/进度 */
    onClassDone?: (info: { index: number; className: string; content: string }) => void;
    /** 主线程开始把该类降成 AST */
    onDecompileStart?: (className: string) => void;
    /** 主线程结束该类的 AST 构建(成功、失败或空结果) */
    onDecompileEnd?: () => void;
    /**
     * simplify 开始。slot < 0 是主线程串行 simplify;
     * slot >= 0 是对应的 simplify worker。
     */
    onSimplifyStart?: (slot: number, className: string) => void;
    onSimplifyEnd?: (slot: number) => void;
    /** 该类的反编译流程结束(含失败和空输出),进度条据此前进 */
    onClassSettled?: (className: string) => void;
    /** AST 队列深度变化:已构建、等待空闲 worker 的类数量 */
    onQueueChange?: (queued: number) => void;
    /**
     * simplify 超过该毫秒数则终止 worker,并改用 raw 输出。
     * 0 或未设置表示不限制。串行路径也会改走 worker,否则主线程里的 simplify 停不下来。
     */
    simplifyTimeoutMs?: number;
    /** simplify 超时、已保留 raw 的类。调用方在全部结束后再警告。 */
    onSimplifyTimeout?: (className: string) => void;
    /** 非致命告警(worker 崩溃降级、单类失败等) */
    onWarning?: (message: string) => void;
}

/** simplify 被 --timeout 终止。发生在主线程,不是 worker 抛出的。 */
export class SimplifyTimeoutError extends Error {
    constructor() {
        super("simplify timed out");
        this.name = "SimplifyTimeoutError";
    }
}

function isSimplifyTimeout(error: unknown): error is SimplifyTimeoutError {
    return error instanceof SimplifyTimeoutError;
}

/** AST 对象 → 未 simplify 的源码,与 decompileClassRaw 同一条生成路径。 */
function renderRaw(ast: any): string {
    try {
        return NodeFactory.generate(ast);
    } catch {
        return "";
    }
}

/** 自动并发数:留一个核给主线程,上限 4(单类 simplify 峰值内存约 1.4GB) */
export function resolveJobs(jobs?: number): number {
    if (jobs === undefined || Number.isNaN(jobs) || jobs <= 0) {
        const cpus = os.cpus()?.length ?? 1;
        return Math.max(1, Math.min(4, cpus - 1));
    }
    return Math.floor(jobs);
}

/** worker 脚本路径:tsx 直跑为 .ts,编译后为 .js */
const WORKER_FILE = path.join(
    __dirname,
    __filename.endsWith(".ts") ? "simplify-worker.ts" : "simplify-worker.js",
);

/** 单类预估代价:指令字节数。仅用于派发顺序(大先派,减少尾部等待) */
function estimateWeight(clazz: PandaClass): number {
    let bytes = 0;
    for (const method of clazz.pandaMethods.values()) {
        bytes += method.methodCode?.codeSize ?? 0;
    }
    return bytes;
}

/** 主线程已构建、等待空闲 simplify worker 的 AST。 */
interface QueueItem {
    job: { clazz: PandaClass; index: number };
    ast: any;
}

/** 让出事件循环,让 worker 完成回调与进度重绘有机会执行。 */
function yieldTurn(): Promise<void> {
    return new Promise<void>((resolve) => { setImmediate(resolve); });
}

class SimplifyWorker {
    constructor(readonly slot: number) {}

    private worker: Worker | null = null;
    private seq = 0;
    private readonly pending = new Map<number, {
        resolve: (text: string) => void;
        reject: (e: Error) => void;
        timer?: ReturnType<typeof setTimeout>;
    }>();

    private ensure(): Worker {
        if (this.worker) return this.worker;
        const worker = new Worker(WORKER_FILE, {
            // 不把 worker 内日志直接混进主线程 stdout(--quiet 依赖主线程静默)
            stdout: true,
            stderr: true,
            resourceLimits: { maxOldGenerationSizeMb: Number(process.env.XPANDA_WORKER_HEAP_MB) || 8192 },
        });
        worker.on("message", (msg: { id: number; text?: string; error?: string }) => {
            const task = this.pending.get(msg.id);
            if (!task) return;
            this.pending.delete(msg.id);
            if (task.timer) clearTimeout(task.timer);
            if (msg.error) task.reject(new Error(msg.error));
            else task.resolve(msg.text ?? "");
        });
        worker.on("error", (e) => this.fail(worker, e instanceof Error ? e : new Error(String(e))));
        worker.on("exit", (code) => {
            if (code !== 0) this.fail(worker, new Error("simplify worker exited with code " + code));
        });
        this.worker = worker;
        return worker;
    }

    /** worker 异常/退出:拒绝在途任务,下次 run 时重建 */
    private fail(worker: Worker, error: Error): void {
        if (this.worker !== worker) return;
        this.worker = null;
        for (const task of this.pending.values()) {
            if (task.timer) clearTimeout(task.timer);
            task.reject(error);
        }
        this.pending.clear();
        // error 事件后 worker 未必已退出,主动回收避免线程泄漏
        void worker.terminate().catch(() => {});
    }

    run(ast: any, timeoutMs = 0): Promise<string> {
        const worker = this.ensure();
        const id = ++this.seq;
        return new Promise<string>((resolve, reject) => {
            const task: { resolve: (text: string) => void; reject: (e: Error) => void; timer?: ReturnType<typeof setTimeout> } = { resolve, reject };
            if (timeoutMs > 0) {
                task.timer = setTimeout(() => {
                    if (!this.pending.has(id)) return;
                    this.pending.delete(id);
                    // Drop the worker before terminate so its exit does not fail the next one.
                    const current = this.worker;
                    this.worker = null;
                    reject(new SimplifyTimeoutError());
                    if (current) void current.terminate().catch(() => {});
                }, timeoutMs);
                task.timer.unref();
            }
            this.pending.set(id, task);
            worker.postMessage({ id, ast });
        });
    }

    async terminate(): Promise<void> {
        const worker = this.worker;
        this.worker = null;
        if (worker) await worker.terminate();
    }
}

/**
 * 并行反编译一组类,返回与 classes 同序的结果数组(未产出/失败为 null)。
 * jobs <= 1 或只有 1 个可反编译类时自动退回串行。
 */
export async function decompileClassesParallel(
    decompiler: PandaDecompiler,
    classes: PandaClass[],
    options: ParallelDecompileOptions = {},
): Promise<Array<string | null>> {
    const jobs = resolveJobs(options.jobs);
    const results: Array<string | null> = new Array(classes.length).fill(null);
    const warn = options.onWarning ?? (() => {});
    const timeoutMs = options.simplifyTimeoutMs ?? 0;

    const simplifyWithTimeout = async (ast: any, run: () => Promise<string>, className: string): Promise<string> => {
        try {
            return await run();
        } catch (e) {
            if (!isSimplifyTimeout(e)) throw e;
            options.onSimplifyTimeout?.(className);
            return renderRaw(ast);
        }
    };

    const todo = classes
        .map((clazz, index) => ({ clazz, index, weight: estimateWeight(clazz) }))
        .filter((job) => job.clazz.pandaMethods.has(ENTRY_FUNCTION_MAIN))
        .sort((a, b) => b.weight - a.weight);

    const processJob = async (
        job: { clazz: PandaClass; index: number },
        slot: number,
        simplify: (ast: any) => Promise<string>,
    ): Promise<void> => {
        const name = job.clazz.name.content;
        let ast: any = null;
        options.onDecompileStart?.(name);
        try {
            ast = decompiler.decompileClassAst(job.clazz);
        } finally {
            options.onDecompileEnd?.();
        }
        if (!ast) return;
        let content = "";
        options.onSimplifyStart?.(slot, name);
        try {
            content = await simplify(ast);
        } finally {
            options.onSimplifyEnd?.(slot);
        }
        if (content.length === 0) return;
        results[job.index] = content;
        options.onClassDone?.({ index: job.index, className: name, content });
    };

    const runInProcess = async (): Promise<void> => {
        // 主线程里的 simplify 停不下来,有超时就改用可 terminate 的 worker。
        const worker = timeoutMs > 0 ? new SimplifyWorker(0) : null;
        try {
            for (const job of todo) {
                if (results[job.index] !== null) continue;
                try {
                    await processJob(job, -1, (ast) => {
                        if (!worker) return Promise.resolve(decompiler.simplifyAst(ast));
                        return simplifyWithTimeout(ast, () => worker.run(ast, timeoutMs), job.clazz.name.content);
                    });
                } catch (e) {
                    warn("decompile failed: " + job.clazz.name.content + " " + e);
                } finally {
                    options.onClassSettled?.(job.clazz.name.content);
                }
            }
        } finally {
            if (worker) await worker.terminate();
        }
    };

    if (jobs <= 1 || todo.length <= 1) {
        await runInProcess();
        return results;
    }

    const workers = Array.from({ length: Math.min(jobs, todo.length) }, (_, slot) => new SimplifyWorker(slot));
    // pop() takes the tail, so reverse once and worker 1 is busy before worker 2.
    const idle: SimplifyWorker[] = [...workers].reverse();
    const running = new Set<Promise<void>>();
    const pending = [...todo];
    /**
     * 有界 AST 队列:主线程持续构建 AST,队列满时暂停(背压),worker 一空就消费。
     * 上限与 worker 数一致:既保证每个 worker 后面始终有待处理 AST,又避免
     * 预构建全部类把主线程堆吃满(单类 simplify 峰值内存约 1.4GB)。
     */
    const queue: QueueItem[] = [];
    const queueLimit = workers.length;
    /** worker 连续崩溃次数上限:超过后剩余类全部主线程处理,避免崩溃循环 */
    let workerFailures = 0;
    let workersEnabled = true;
    let producerDone = false;

    const runJob = async (
        item: QueueItem,
        slot: number,
        simplify: (ast: any) => Promise<string>,
    ): Promise<void> => {
        const name = item.job.clazz.name.content;
        let content = "";
        options.onSimplifyStart?.(slot, name);
        try {
            content = await simplify(item.ast);
        } finally {
            options.onSimplifyEnd?.(slot);
        }
        if (content.length === 0) return;
        results[item.job.index] = content;
        options.onClassDone?.({ index: item.job.index, className: name, content });
    };

    const runOnWorker = (worker: SimplifyWorker, item: QueueItem): Promise<string> => {
        const name = item.job.clazz.name.content;
        if (!workersEnabled) return Promise.resolve(decompiler.simplifyAst(item.ast));
        return simplifyWithTimeout(item.ast, () => worker.run(item.ast, timeoutMs), name).catch((e) => {
            workerFailures++;
            warn("simplify worker failed, falling back to main thread: " + name + " (" + e + ")");
            if (workerFailures >= 2) {
                workersEnabled = false;
                warn("simplify worker failed repeatedly, remaining classes fall back to serial simplify on the main thread");
            }
            return decompiler.simplifyAst(item.ast);
        });
    };

    const dispatch = (worker: SimplifyWorker, item: QueueItem): void => {
        const tracked = (async () => {
            try {
                await runJob(item, worker.slot, (ast) => runOnWorker(worker, item));
            } catch (e) {
                warn("decompile failed: " + item.job.clazz.name.content + " " + e);
            } finally {
                options.onClassSettled?.(item.job.clazz.name.content);
            }
        })();
        running.add(tracked);
        void tracked.finally(() => {
            idle.push(worker);
            running.delete(tracked);
        });
    };

    /** worker 池全部失败后,队列里的 AST 改回主线程串行 simplify。 */
    const drainOnMainThread = async (item: QueueItem): Promise<void> => {
        try {
            await runJob(item, -1, (ast) => Promise.resolve(decompiler.simplifyAst(ast)));
        } catch (e) {
            warn("decompile failed: " + item.job.clazz.name.content + " " + e);
        } finally {
            options.onClassSettled?.(item.job.clazz.name.content);
        }
    };

    /** 构建下一类 AST 入队;构建失败/空输出的类立即 settle,不占队列。 */
    const buildNext = async (): Promise<void> => {
        const job = pending.shift()!;
        const name = job.clazz.name.content;
        let ast: any = null;
        options.onDecompileStart?.(name);
        try {
            ast = decompiler.decompileClassAst(job.clazz);
        } catch (e) {
            warn("decompile failed: " + name + " " + e);
        } finally {
            options.onDecompileEnd?.();
        }
        if (ast) {
            queue.push({ job, ast });
            options.onQueueChange?.(queue.length);
        } else {
            options.onClassSettled?.(name);
        }
        await yieldTurn();
    };

    try {
        while (true) {
            // worker 池已禁用:先把队列里已构建的 AST 在主线程跑完,再继续构建
            if (!workersEnabled && queue.length > 0) {
                const item = queue.shift()!;
                options.onQueueChange?.(queue.length);
                await drainOnMainThread(item);
                continue;
            }
            // 队列里有 AST 且 worker 空闲:立刻派发
            while (workersEnabled && queue.length > 0 && idle.length > 0) {
                const worker = idle.pop()!;
                const item = queue.shift()!;
                options.onQueueChange?.(queue.length);
                dispatch(worker, item);
            }
            // 队列未满:主线程继续构建下一类 AST(与 worker simplify 重叠)
            if (!producerDone && queue.length < queueLimit) {
                await buildNext();
                if (pending.length === 0) producerDone = true;
                continue;
            }
            if (running.size > 0) {
                await Promise.race(running);
                continue;
            }
            if (producerDone && queue.length === 0) break;
            // 理论上不可达(队列空且未构建完时 buildNext 一定会跑);防御性退出避免热循环
            if (running.size === 0) break;
        }
    } finally {
        await Promise.all(workers.map((worker) => worker.terminate()));
    }

    return results;
}
