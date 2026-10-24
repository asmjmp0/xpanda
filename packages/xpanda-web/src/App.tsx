import { useEffect, useMemo, useRef, useState } from "react";
import { strToU8, zipSync, type Zippable } from "fflate";
import {
    DEFAULT_DECOMPILE_JOBS,
    DecompileService,
    MAX_DECOMPILE_JOBS,
    buildClassRefs,
    loadImage,
    yieldToUI,
    zipPathFor,
    type BulkState,
    type ClassRef,
    type DecompileMode,
    type LoadedImage,
} from "./decompiler";
import { downloadBlob, readError, sanitizeFileName, stripExt } from "./format";
import { Topbar } from "./components/Topbar";
import { NoticeBar } from "./components/NoticeBar";
import { BulkBar } from "./components/BulkBar";
import { Sidebar } from "./components/Sidebar";
import { CodePane } from "./components/CodePane";

type Phase = "idle" | "parsing" | "decompiling";

const JOBS_STORAGE_KEY = "xpanda-web.worker-jobs";

/** 读取上次选择的 worker 数;无记录 / 非法值 / localStorage 不可用时回退默认 4 */
function loadWorkerJobs(): number {
    try {
        const raw = window.localStorage.getItem(JOBS_STORAGE_KEY);
        const value = raw === null ? NaN : Number(raw);
        if (Number.isInteger(value) && value >= 1 && value <= MAX_DECOMPILE_JOBS) return value;
    } catch {
        // 隐私模式等场景下 localStorage 可能抛异常
    }
    return DEFAULT_DECOMPILE_JOBS;
}

function saveWorkerJobs(jobs: number): void {
    try {
        window.localStorage.setItem(JOBS_STORAGE_KEY, String(jobs));
    } catch {
        // 忽略写入失败:本次会话内仍然生效
    }
}

/** 窄屏(手机)断点:主区从“侧栏 + 代码”并排切换为二选一视图 */
const NARROW_MEDIA_QUERY = "(max-width: 760px)";

/** 跟踪窄屏断点;只在手机宽度下为 true,用于启用列表/代码双视图切换 */
function useIsNarrow(): boolean {
    const [isNarrow, setIsNarrow] = useState(() => window.matchMedia(NARROW_MEDIA_QUERY).matches);
    useEffect(() => {
        const mql = window.matchMedia(NARROW_MEDIA_QUERY);
        const onChange = (e: MediaQueryListEvent): void => setIsNarrow(e.matches);
        mql.addEventListener("change", onChange);
        return () => mql.removeEventListener("change", onChange);
    }, []);
    return isNarrow;
}

/**
 * xpanda web 主界面:
 *  - 拖拽 / 点击加载 .abc / .hap(纯前端解析);
 *  - 左侧类列表(搜索 + 包分组),点击单个类反编译;
 *  - 顶部全量反编译(逐类让出主线程,可取消),完成后可打包 zip 下载。
 * @Author: jmp0
 */
export function App() {
    const serviceRef = useRef<DecompileService | null>(null);
    if (serviceRef.current === null) serviceRef.current = new DecompileService();
    const service = serviceRef.current;

    const [images, setImages] = useState<LoadedImage[]>([]);
    const [mode, setMode] = useState<DecompileMode>("simplify");
    const [selected, setSelected] = useState<ClassRef | null>(null);
    const [cacheVersion, setCacheVersion] = useState(0);
    const [phase, setPhase] = useState<Phase>("idle");
    const [error, setError] = useState<string | null>(null);
    const [bulk, setBulk] = useState<BulkState | null>(null);
    const [dragging, setDragging] = useState(false);
    /** Decompile all 使用的 worker 数(默认 4,可在工具栏切换并记住) */
    const [workerJobs, setWorkerJobs] = useState<number>(loadWorkerJobs);
    /** 窄屏下主区显示哪个视图:类列表 / 代码(宽屏下两者并排,该状态不生效) */
    const [mobileView, setMobileView] = useState<"list" | "code">("list");
    const isNarrow = useIsNarrow();

    const bulkCancel = useRef(false);
    const dragDepth = useRef(0);
    /** 并发解析计数:多次拖入时避免先完成的一次把 phase 提前置回 idle */
    const parsingCount = useRef(0);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const refs = useMemo(
        () => images.flatMap((img) => img.sources.flatMap((s) => buildClassRefs(s))),
        [images],
    );

    const cachedKeys = useMemo(() => {
        const set = new Set<string>();
        for (const ref of refs) {
            if (service.peek(ref, mode) !== undefined) set.add(ref.key);
        }
        return set;
        // cacheVersion 驱动缓存重算
    }, [refs, mode, cacheVersion, service]);
    const cachedCount = cachedKeys.size;
    const currentCode = selected !== null ? service.peek(selected, mode) : undefined;
    const currentElapsed = selected !== null ? service.elapsedMs(selected, mode) : undefined;

    // 当前选中的类尚未反编译(新选中或模式切换)时,后台反编译一次
    useEffect(() => {
        if (selected === null || service.peek(selected, mode) !== undefined) return;
        let alive = true;
        void (async () => {
            setPhase("decompiling");
            await yieldToUI();
            if (!alive) return;
            try {
                service.decompile(selected, mode);
            } catch (e) {
                setError(readError(e));
            }
            setPhase("idle");
            setCacheVersion((v) => v + 1);
        })();
        return () => {
            alive = false;
        };
    }, [selected, mode, cacheVersion, service]);

    // 全屏拖拽:dragenter/leave 成对计数,避免经过子元素时闪烁
    useEffect(() => {
        const hasFiles = (e: DragEvent): boolean =>
            e.dataTransfer !== null && Array.from(e.dataTransfer.types).includes("Files");
        const onDragEnter = (e: DragEvent): void => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            dragDepth.current++;
            setDragging(true);
        };
        const onDragOver = (e: DragEvent): void => {
            if (!hasFiles(e)) return;
            e.preventDefault();
        };
        const onDragLeave = (): void => {
            dragDepth.current = Math.max(0, dragDepth.current - 1);
            if (dragDepth.current === 0) setDragging(false);
        };
        const onDrop = (e: DragEvent): void => {
            e.preventDefault();
            dragDepth.current = 0;
            setDragging(false);
            const files = Array.from(e.dataTransfer?.files ?? []);
            if (files.length > 0) void handleFiles(files);
        };
        window.addEventListener("dragenter", onDragEnter);
        window.addEventListener("dragover", onDragOver);
        window.addEventListener("dragleave", onDragLeave);
        window.addEventListener("drop", onDrop);
        return () => {
            window.removeEventListener("dragenter", onDragEnter);
            window.removeEventListener("dragover", onDragOver);
            window.removeEventListener("dragleave", onDragLeave);
            window.removeEventListener("drop", onDrop);
        };
        // handleFiles 仅依赖 setState,首帧闭包即可
    }, []);

    /**
     * 解析上传的文件(可多选 / 可多次拖入):ZIP 按 HAP 解包,其余按裸 abc。
     * 每次调用把新文件追加到已有列表,互不覆盖;多个拖入操作并发时用计数维护 parsing 状态。
     */
    const handleFiles = async (files: File[]): Promise<void> => {
        if (files.length === 0) return;
        setError(null);
        parsingCount.current++;
        setPhase("parsing");
        try {
            await yieldToUI();
            const loaded: LoadedImage[] = [];
            const failures: string[] = [];
            for (const file of files) {
                try {
                    const data = new Uint8Array(await file.arrayBuffer());
                    loaded.push(loadImage(data, file.name));
                } catch (e) {
                    failures.push(file.name + ": " + readError(e));
                }
                // 文件之间让出主线程,多文件/大包时进度提示不会卡住
                await yieldToUI();
            }
            if (loaded.length > 0) setImages((prev) => [...prev, ...loaded]);
            setCacheVersion((v) => v + 1);
            if (failures.length > 0) setError(failures.join("\n"));
        } finally {
            parsingCount.current--;
            if (parsingCount.current === 0) setPhase("idle");
        }
    };

    const onInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = "";
        if (files.length > 0) void handleFiles(files);
    };

    /**
     * 全量反编译:optimize 模式的 simplify 交给 Web Worker 池(默认 4 线程),
     * 主线程只在类间构建 AST 并刷新进度;raw 模式无 simplify 阶段,保持串行。
     */
    const runBulk = async (): Promise<void> => {
        if ((bulk !== null && bulk.running) || refs.length === 0) return;
        bulkCancel.current = false;
        const pendingCount = refs.filter((ref) => service.peek(ref, mode) === undefined).length;
        const runJobs = mode === "simplify" ? Math.min(workerJobs, Math.max(1, pendingCount)) : 1;
        let done = refs.length - pendingCount;
        let failed = 0;
        const publish = (running: boolean, cancelled: boolean): void => {
            setBulk({ running, done, total: refs.length, failed, cancelled, jobs: runJobs });
        };
        publish(true, false);
        await yieldToUI();
        try {
            await service.decompileMany(refs, mode, {
                jobs: runJobs,
                shouldStop: () => bulkCancel.current,
                onClassDone: () => {
                    done++;
                    publish(true, false);
                },
                onClassFailed: (ref, e) => {
                    done++;
                    failed++;
                    console.error("decompile failed: " + ref.displayPath, e);
                    publish(true, false);
                },
                onWarning: (message) => console.warn(message),
            });
        } finally {
            publish(false, bulkCancel.current);
            setCacheVersion((v) => v + 1);
        }
    };

    /** 打包全部已反编译类下载;多来源时按来源目录分段(与 cli 落盘结构一致) */
    const downloadAll = (): void => {
        const multiSource = images.reduce((n, img) => n + img.sources.length, 0) > 1;
        const files: Zippable = {};
        for (const ref of refs) {
            const code = service.peek(ref, mode);
            if (code === undefined || code === "") continue;
            files[zipPathFor(ref, multiSource)] = strToU8(code);
        }
        if (Object.keys(files).length === 0) return;
        const zipped = zipSync(files, { level: 4 });
        const base = images.length === 1 ? sanitizeFileName(stripExt(images[0].fileName)) : "xpanda-output";
        downloadBlob(new Blob([zipped], { type: "application/zip" }), base + "-" + mode + ".zip");
    };

    const redecompileSelected = (): void => {
        if (selected === null) return;
        service.invalidate(selected, mode);
        setCacheVersion((v) => v + 1); // 触发 effect 重新反编译
    };

    return (
        <div className="app">
            <Topbar
                onOpen={() => fileInputRef.current?.click()}
                mode={mode}
                onModeChange={setMode}
                disabled={phase === "parsing"}
            />
            <NoticeBar />
            {error !== null && (
                <div className="errorbar">
                    <pre className="errorbar-text">{error}</pre>
                    <button className="errorbar-close" onClick={() => setError(null)} title="Dismiss">
                        ×
                    </button>
                </div>
            )}
            {images.length > 0 && (
                <BulkBar
                    bulk={bulk}
                    total={refs.length}
                    cachedCount={cachedCount}
                    jobs={workerJobs}
                    onJobsChange={(jobs) => {
                        setWorkerJobs(jobs);
                        saveWorkerJobs(jobs);
                    }}
                    onRun={() => void runBulk()}
                    onCancel={() => {
                        bulkCancel.current = true;
                    }}
                    onDownloadAll={downloadAll}
                />
            )}
            <div className={"main" + (isNarrow ? " mobile-view-" + mobileView : "")}>
                {images.length === 0 ? (
                    <div className="welcome">
                        <div className="welcome-card">
                            <div className="welcome-logo">
                                xpanda <em>web</em>
                            </div>
                            <p className="welcome-text">
                                Decompile HarmonyOS <code>.abc</code> bytecode and <code>.hap</code> app packages
                                entirely in your browser — nothing is uploaded.
                            </p>
                            <button className="btn-accent welcome-btn" onClick={() => fileInputRef.current?.click()}>
                                Choose .abc / .hap file
                            </button>
                            <p className="welcome-drop">…or drag &amp; drop anywhere</p>
                        </div>
                    </div>
                ) : (
                    <>
                        <Sidebar
                            images={images}
                            refs={refs}
                            selectedKey={selected?.key ?? null}
                            cachedKeys={cachedKeys}
                            onSelect={(ref) => {
                                setSelected(ref);
                                setMobileView("code");
                            }}
                        />
                        <CodePane
                            selected={selected}
                            code={currentCode}
                            elapsedMs={currentElapsed}
                            decompiling={phase === "decompiling"}
                            mode={mode}
                            onRedecompile={redecompileSelected}
                            onBack={isNarrow ? () => setMobileView("list") : undefined}
                        />
                    </>
                )}
            </div>
            {dragging && (
                <div className="drop-overlay">
                    <div className="drop-overlay-box">Drop .abc / .hap to decompile</div>
                </div>
            )}
            {phase === "parsing" && (
                <div className="busy-overlay">
                    <div className="spinner" />
                    <span>Parsing file…</span>
                </div>
            )}
            <input
                ref={fileInputRef}
                type="file"
                accept=".abc,.hap"
                multiple
                style={{ display: "none" }}
                onChange={onInputChange}
            />
        </div>
    );
}
