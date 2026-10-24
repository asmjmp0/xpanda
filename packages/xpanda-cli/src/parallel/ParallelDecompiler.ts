import * as os from "os";
import * as path from "path";
import { Worker } from "worker_threads";
import { ENTRY_FUNCTION_MAIN } from "xpanda-core";
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
 * AST JSON 自包含,可跨线程传递,所以 worker 不需要重新解析 .abc。
 * 单类输出只依赖该类自己(PandaDecompiler.decompileRaw 会按类复位生成名计数器),
 * 因此结果与 jobs 数量、完成顺序无关。
 * @Author: jmp0
 */

export interface ParallelDecompileOptions {
    /** 并发数;<=0 表示自动(CPU 数 - 1,上限 4) */
    jobs?: number;
    /** 单类完成后回调(完成顺序,不保证类序),用于落盘/进度 */
    onClassDone?: (info: { index: number; className: string; content: string }) => void;
    /** 非致命告警(worker 崩溃降级、单类失败等) */
    onWarning?: (message: string) => void;
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

class SimplifyWorker {
    private worker: Worker | null = null;
    private seq = 0;
    private readonly pending = new Map<number, { resolve: (text: string) => void; reject: (e: Error) => void }>();

    private ensure(): Worker {
        if (this.worker) return this.worker;
        const worker = new Worker(WORKER_FILE, {
            // 不把 worker 内日志直接混进主线程 stdout(--quiet 依赖主线程静默)
            stdout: true,
            stderr: true,
            resourceLimits: { maxOldGenerationSizeMb: Number(process.env.XPANDA_WORKER_HEAP_MB) || 3072 },
        });
        worker.on("message", (msg: { id: number; text?: string; error?: string }) => {
            const task = this.pending.get(msg.id);
            if (!task) return;
            this.pending.delete(msg.id);
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
        for (const task of this.pending.values()) task.reject(error);
        this.pending.clear();
        // error 事件后 worker 未必已退出,主动回收避免线程泄漏
        void worker.terminate().catch(() => {});
    }

    run(ast: string): Promise<string> {
        const worker = this.ensure();
        const id = ++this.seq;
        return new Promise<string>((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
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

    const todo = classes
        .map((clazz, index) => ({ clazz, index, weight: estimateWeight(clazz) }))
        .filter((job) => job.clazz.pandaMethods.has(ENTRY_FUNCTION_MAIN))
        .sort((a, b) => b.weight - a.weight);

    const runInProcess = (): void => {
        for (const job of todo) {
            if (results[job.index] !== null) continue;
            try {
                const ast = decompiler.decompileClassAst(job.clazz);
                if (ast.length === 0) continue;
                const content = decompiler.simplifyInProcess(ast);
                if (content.length === 0) continue;
                results[job.index] = content;
                options.onClassDone?.({ index: job.index, className: job.clazz.name.content, content });
            } catch (e) {
                warn("decompile failed: " + job.clazz.name.content + " " + e);
            }
        }
    };

    if (jobs <= 1 || todo.length <= 1) {
        runInProcess();
        return results;
    }

    const workers = Array.from({ length: Math.min(jobs, todo.length) }, () => new SimplifyWorker());
    const idle: SimplifyWorker[] = [...workers];
    const running = new Set<Promise<void>>();
    const pending = [...todo];
    /** worker 连续崩溃次数上限:超过后剩余类全部主线程处理,避免崩溃循环 */
    let workerFailures = 0;
    let workersEnabled = true;

    const dispatch = (worker: SimplifyWorker, job: { clazz: PandaClass; index: number }): void => {
        const task = (async () => {
            let ast: string;
            try {
                ast = decompiler.decompileClassAst(job.clazz);
            } catch (e) {
                warn("decompile failed: " + job.clazz.name.content + " " + e);
                return;
            }
            if (ast.length === 0) return;

            let content: string;
            if (workersEnabled) {
                try {
                    content = await worker.run(ast);
                } catch (e) {
                    workerFailures++;
                    warn("simplify worker 失败,主线程降级: " + job.clazz.name.content + " (" + e + ")");
                    if (workerFailures >= 2) {
                        workersEnabled = false;
                        warn("simplify worker 连续失败,剩余类改为主线程串行 simplify");
                    }
                    content = decompiler.simplifyInProcess(ast);
                }
            } else {
                content = decompiler.simplifyInProcess(ast);
            }
            if (content.length === 0) return;
            results[job.index] = content;
            options.onClassDone?.({ index: job.index, className: job.clazz.name.content, content });
        })()
            .catch((e) => {
                warn("decompile failed: " + job.clazz.name.content + " " + e);
            })
            .finally(() => {
                idle.push(worker);
            });
        running.add(task);
        task.finally(() => {
            running.delete(task);
        });
    };

    try {
        while (pending.length > 0 || running.size > 0) {
            while (pending.length > 0 && idle.length > 0) {
                dispatch(idle.pop()!, pending.shift()!);
            }
            if (running.size === 0) break;
            await Promise.race(running);
        }
    } finally {
        await Promise.all(workers.map((worker) => worker.terminate()));
    }

    return results;
}
