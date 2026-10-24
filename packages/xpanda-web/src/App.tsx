import { useEffect, useMemo, useRef, useState } from "react";
import { strToU8, zipSync, type Zippable } from "fflate";
import {
    DecompileService,
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
import { BulkBar } from "./components/BulkBar";
import { Sidebar } from "./components/Sidebar";
import { CodePane } from "./components/CodePane";

type Phase = "idle" | "parsing" | "decompiling";

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

    const bulkCancel = useRef(false);
    const dragDepth = useRef(0);
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

    /** 解析上传的文件(可多选):ZIP 按 HAP 解包,其余按裸 abc */
    const handleFiles = async (files: File[]): Promise<void> => {
        setError(null);
        setPhase("parsing");
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
        }
        if (loaded.length > 0) setImages((prev) => [...prev, ...loaded]);
        setPhase("idle");
        setCacheVersion((v) => v + 1);
        if (failures.length > 0) setError(failures.join("\n"));
    };

    const onInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = "";
        if (files.length > 0) void handleFiles(files);
    };

    /** 全量反编译:逐类执行并在类间让出主线程,进度条实时刷新,可取消 */
    const runBulk = async (): Promise<void> => {
        if ((bulk !== null && bulk.running) || refs.length === 0) return;
        bulkCancel.current = false;
        setBulk({ running: true, done: 0, total: refs.length, failed: 0, cancelled: false });
        await yieldToUI();
        let done = 0;
        let failed = 0;
        for (const ref of refs) {
            if (bulkCancel.current) break;
            if (service.peek(ref, mode) === undefined) {
                try {
                    service.decompile(ref, mode);
                } catch {
                    failed++;
                }
            }
            done++;
            setBulk({ running: true, done, total: refs.length, failed, cancelled: false });
            await yieldToUI();
        }
        setBulk({ running: false, done, total: refs.length, failed, cancelled: bulkCancel.current });
        setCacheVersion((v) => v + 1);
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
                    onRun={() => void runBulk()}
                    onCancel={() => {
                        bulkCancel.current = true;
                    }}
                    onDownloadAll={downloadAll}
                />
            )}
            <div className="main">
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
                            onSelect={setSelected}
                        />
                        <CodePane
                            selected={selected}
                            code={currentCode}
                            decompiling={phase === "decompiling"}
                            mode={mode}
                            onRedecompile={redecompileSelected}
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
