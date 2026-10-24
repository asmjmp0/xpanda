/**
 * xpanda-web 反编译服务:文件加载(.abc / .hap)、类索引、单类 / 全量反编译与结果缓存。
 * 纯前端实现:直接复用浏览器安全的 xpanda-core 单入口(无 Node 依赖、无磁盘 IO)。
 * 单类在主线程同步反编译;全量反编译的 simplify 交给 Web Worker 池(默认 4 线程),
 * 调用方通过 yieldToUI() 在类与类之间让出主线程刷新进度。
 * @Author: jmp0
 */
import { ENTRY_FUNCTION_MAIN, HapFile, PandaDecompiler, PandaFile, ZipFile } from "xpanda-core";
import type { PandaClass } from "xpanda-core";
import { readError, sanitizeFileName, splitClassName, stripExt } from "./format";
import { SimplifyWorker } from "./parallel/SimplifyWorker";

/** 反编译模式:走优化器 / 仅生成原始 AST 输出 */
export type DecompileMode = "simplify" | "raw";

/** 全量反编译的默认 worker 数(与 cli 的默认上限一致) */
export const DEFAULT_DECOMPILE_JOBS = 4;
/** 界面允许选择的最大 worker 数 */
export const MAX_DECOMPILE_JOBS = 8;

let nextId = 1;

export interface ModuleInfo {
    bundle: string;
    module: string;
    version: string;
    vm: string;
}

/** 一个 .abc 字节码来源:hap 内的条目,或用户直接上传的 .abc 文件 */
export interface AbcSource {
    id: string;
    /** 所属的 LodedImage(hap 多条目分组显示用) */
    image: LoadedImage;
    /** 显示名:hap 内条目路径,或上传文件名 */
    name: string;
    /** zip 导出时的路径前缀(hap 内条目名去 .abc);单文件 abc 为 null */
    zipPrefix: string | null;
    pandaFile: PandaFile;
    sizeBytes: number;
}

/** 一次文件加载:.abc 单文件或整个 .hap 包 */
export interface LoadedImage {
    id: string;
    kind: "abc" | "hap";
    fileName: string;
    sizeBytes: number;
    moduleInfo: ModuleInfo | null;
    sources: AbcSource[];
}

/** 可反编译的类引用(列表渲染与缓存键的最小单元) */
export interface ClassRef {
    source: AbcSource;
    clazz: PandaClass;
    /** 全局唯一键:sourceId + 原始类名 */
    key: string;
    /** pkg/Name 形式的展示路径 */
    displayPath: string;
    /** 包路径(列表分组用) */
    pkg: string;
    /** 末段类名 */
    simpleName: string;
    /** 单类导出文件名:Name.js */
    outPath: string;
}

/** 全量反编译进度状态 */
export interface BulkState {
    running: boolean;
    done: number;
    total: number;
    failed: number;
    cancelled: boolean;
    /** 本次全量反编译使用的 worker 数(raw 模式为 1) */
    jobs: number;
}

/**
 * 解析上传的文件字节:ZIP 容器按 HAP 解包全部 .abc 条目,否则按裸 .abc 解析。
 * 校验失败(checksum 不符 / 非 panda 文件)抛 PandaParseException,由调用方展示。
 */
export function loadImage(data: Uint8Array, fileName: string): LoadedImage {
    if (ZipFile.isZip(data)) {
        const hap = new HapFile(data);
        const entries = hap.getAbcEntries();
        if (entries.length === 0) {
            throw new Error("ZIP container loaded, but no .abc entry found inside (not a HAP package?)");
        }
        const image: LoadedImage = {
            id: "img" + nextId++,
            kind: "hap",
            fileName,
            sizeBytes: data.length,
            moduleInfo: null,
            sources: [],
        };
        const moduleJson = hap.getModuleJson();
        if (moduleJson) {
            const app = moduleJson.app ?? {};
            const mod = moduleJson.module ?? {};
            image.moduleInfo = {
                bundle: String(app.bundleName ?? "?"),
                module: String(mod.name ?? "?"),
                version: String(app.versionName ?? "?"),
                vm: String(mod.virtualMachine ?? "?"),
            };
        }
        image.sources = entries.map((entry) => ({
            id: "src" + nextId++,
            image,
            name: entry.name,
            zipPrefix: entry.name.replace(/\.abc$/i, ""),
            pandaFile: new PandaFile(entry.read()),
            sizeBytes: entry.uncompressedSize,
        }));
        return image;
    }
    const pandaFile = new PandaFile(data);
    const image: LoadedImage = {
        id: "img" + nextId++,
        kind: "abc",
        fileName,
        sizeBytes: data.length,
        moduleInfo: null,
        sources: [],
    };
    image.sources = [{
        id: "src" + nextId++,
        image,
        name: fileName,
        zipPrefix: null,
        pandaFile,
        sizeBytes: data.length,
    }];
    return image;
}

/** 展开一个 abc 来源的全部类为可反编译引用(保持文件内类序) */
export function buildClassRefs(source: AbcSource): ClassRef[] {
    const refs: ClassRef[] = [];
    for (const clazz of source.pandaFile.getAllClasses()) {
        // Skip classes that can never produce output, mirroring the CLI:
        // no func_main_0 entry means compiler metadata (L_ES*Annotation;) or
        // @ohos/@system stubs; empty names are malformed records. Decompiling
        // them would only yield "" ("produced no output" in the UI).
        if (clazz.pandaMethods.get(ENTRY_FUNCTION_MAIN) === undefined) continue;
        if (clazz.name.content.length === 0) continue;
        const { pkg, simpleName, path } = splitClassName(clazz.name.content);
        refs.push({
            source,
            clazz,
            key: source.id + "::" + clazz.name.content,
            displayPath: path,
            pkg,
            simpleName,
            outPath: sanitizeFileName(simpleName) + ".js",
        });
    }
    return refs;
}

/** zip 下载时的条目路径:多来源时按来源目录分段(与 cli 的 hap 落盘结构一致) */
export function zipPathFor(ref: ClassRef, multiSource: boolean): string {
    if (!multiSource) return ref.outPath;
    const dir = ref.source.zipPrefix ?? sanitizeFileName(stripExt(ref.source.name));
    return dir + "/" + ref.outPath;
}

/** 单类预估代价:指令字节数。仅用于派发顺序(大先派,减少尾部等待,与 cli 一致) */
function estimateWeight(clazz: PandaClass): number {
    let bytes = 0;
    for (const method of clazz.pandaMethods.values()) {
        bytes += method.methodCode?.codeSize ?? 0;
    }
    return bytes;
}

/**
 * 反编译服务:缓存键 = sourceId::类名|mode,单类与全量共用同一份缓存。
 * 反编译失败向上抛异常,由调用方决定展示方式(单类不中断全量)。
 */
interface CacheEntry {
    code: string;
    /** 首次反编译耗时(毫秒),缓存命中时保留原值 */
    elapsedMs: number;
}

/** 全量反编译回调 */
export interface BulkDecompileOptions {
    /** worker 数,默认 DEFAULT_DECOMPILE_JOBS;raw 模式或只有 1 个待处理类时退回主线程 */
    jobs?: number;
    /** 返回 true 时不再派发新任务(已在运行的任务会等待完成) */
    shouldStop?: () => boolean;
    onClassDone?: (ref: ClassRef) => void;
    onClassFailed?: (ref: ClassRef, error: unknown) => void;
    /** 非致命告警(worker 崩溃降级等) */
    onWarning?: (message: string) => void;
}

export class DecompileService {
    private readonly decompiler = new PandaDecompiler();
    private readonly cache = new Map<string, CacheEntry>();
    /** 惰性创建的 simplify worker 池,跨多次全量反编译复用 */
    private workers: SimplifyWorker[] = [];

    /** 已缓存则返回代码,否则返回 undefined(空输出缓存为 "") */
    peek(ref: ClassRef, mode: DecompileMode): string | undefined {
        return this.cache.get(ref.key + "|" + mode)?.code;
    }

    /** 最近一次单类反编译耗时(毫秒);尚未反编译时返回 undefined */
    elapsedMs(ref: ClassRef, mode: DecompileMode): number | undefined {
        return this.cache.get(ref.key + "|" + mode)?.elapsedMs;
    }

    invalidate(ref: ClassRef, mode: DecompileMode): void {
        this.cache.delete(ref.key + "|" + mode);
    }

    decompile(ref: ClassRef, mode: DecompileMode): string {
        const cacheKey = ref.key + "|" + mode;
        const hit = this.cache.get(cacheKey);
        if (hit !== undefined) return hit.code;
        const started = performance.now();
        const out = mode === "raw"
            ? this.decompiler.decompileClassRaw(ref.clazz)
            : this.decompiler.decompileClass(ref.clazz);
        this.store(ref, mode, out, performance.now() - started);
        return out;
    }

    /**
     * 批量反编译所有尚未缓存的类。
     *
     * 与 cli 的 `-j` 分工一致:主线程负责解析/反汇编/AST 构建(占比很低),
     * worker 只跑 simplify。raw 模式没有 simplify 阶段,保持串行。
     * 完成顺序与缓存/结果无关,输出仍按 refs 顺序使用。
     */
    async decompileMany(refs: ClassRef[], mode: DecompileMode, options: BulkDecompileOptions = {}): Promise<void> {
        const todo = refs.filter((ref) => this.peek(ref, mode) === undefined);
        if (todo.length === 0) return;
        const jobs = Math.max(1, Math.floor(options.jobs ?? DEFAULT_DECOMPILE_JOBS));
        if (mode === "raw" || jobs <= 1 || todo.length <= 1) {
            for (const ref of todo) {
                if (options.shouldStop?.()) break;
                try {
                    this.decompile(ref, mode);
                    options.onClassDone?.(ref);
                } catch (e) {
                    options.onClassFailed?.(ref, e);
                }
                await yieldToUI();
            }
            return;
        }
        await this.decompileParallel(todo, mode, Math.min(jobs, todo.length), options);
    }

    private async decompileParallel(
        todo: ClassRef[],
        mode: DecompileMode,
        jobs: number,
        options: BulkDecompileOptions,
    ): Promise<void> {
        if (options.shouldStop?.()) return;
        const warn = options.onWarning ?? ((message: string) => console.warn(message));
        const idle = [...this.ensureWorkers(jobs)];
        const running = new Set<Promise<void>>();
        // 大先派,减少最后一个大类的尾部等待
        const pending = [...todo].sort((a, b) => estimateWeight(b.clazz) - estimateWeight(a.clazz));
        let workerFailures = 0;
        let workersEnabled = true;

        const runJob = async (worker: SimplifyWorker | null, ref: ClassRef): Promise<void> => {
            // 可能有并发的主线程单类反编译刚好把它缓存了
            if (this.peek(ref, mode) !== undefined) {
                options.onClassDone?.(ref);
                return;
            }
            const started = performance.now();
            try {
                const ast = this.decompiler.decompileClassAst(ref.clazz);
                if (ast.length === 0) {
                    this.store(ref, mode, "", performance.now() - started);
                    options.onClassDone?.(ref);
                    return;
                }
                let content: string;
                if (worker !== null && workersEnabled) {
                    try {
                        content = await worker.run(ast);
                    } catch (e) {
                        workerFailures++;
                        warn("simplify worker failed, falling back to main thread: " + ref.displayPath + " (" + readError(e) + ")");
                        if (workerFailures >= 2 && workersEnabled) {
                            workersEnabled = false;
                            idle.length = 0;
                            warn("simplify workers failed repeatedly, remaining classes run on the main thread");
                            void this.disposeWorkers();
                        }
                        content = this.decompiler.simplifyInProcess(ast);
                    }
                } else {
                    content = this.decompiler.simplifyInProcess(ast);
                }
                this.store(ref, mode, content, performance.now() - started);
                options.onClassDone?.(ref);
            } catch (e) {
                options.onClassFailed?.(ref, e);
            }
        };

        const dispatch = (worker: SimplifyWorker | null, ref: ClassRef): void => {
            let task: Promise<void>;
            task = runJob(worker, ref).finally(() => {
                running.delete(task);
                if (worker !== null && workersEnabled) idle.push(worker);
            });
            running.add(task);
        };

        while (true) {
            if (options.shouldStop?.()) break;
            if (workersEnabled && idle.length > 0 && pending.length > 0) {
                dispatch(idle.pop()!, pending.shift()!);
                continue;
            }
            if (!workersEnabled && pending.length > 0) {
                // worker 池全部失败:剩余类回到主线程,逐个让出 UI
                await runJob(null, pending.shift()!);
                await yieldToUI();
                continue;
            }
            if (running.size === 0) break;
            await Promise.race(running);
        }
        // 取消时等待已经在跑的任务结束,避免结果/计时丢失
        await Promise.all([...running]);
    }

    private ensureWorkers(size: number): SimplifyWorker[] {
        while (this.workers.length < size) this.workers.push(new SimplifyWorker());
        return this.workers.slice(0, size);
    }

    private async disposeWorkers(): Promise<void> {
        const workers = this.workers;
        this.workers = [];
        await Promise.all(workers.map((worker) => worker.terminate()));
    }

    private store(ref: ClassRef, mode: DecompileMode, code: string, elapsedMs: number): void {
        this.cache.set(ref.key + "|" + mode, { code, elapsedMs });
    }
}

/** 让出主线程:让 React 提交渲染、进度条刷新,避免长任务期间 UI 冻结 */
export function yieldToUI(): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, 0));
}
