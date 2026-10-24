import { useMemo, useState } from "react";
import type { ClassRef, LoadedImage } from "../decompiler";
import { formatBytes } from "../format";

/**
 * 左侧栏:文件(来源)列表 + 可搜索、按包分组的类列表。
 * 每个文件(.abc / .hap)可单独折叠,多次拖入的文件依次排列;
 * 已反编译的类带绿点标记;点击类项触发选中反编译。
 * @Author: jmp0
 */
interface SidebarProps {
    images: LoadedImage[];
    refs: ClassRef[];
    selectedKey: string | null;
    cachedKeys: Set<string>;
    onSelect: (ref: ClassRef) => void;
}

export function Sidebar({ images, refs, selectedKey, cachedKeys, onSelect }: SidebarProps) {
    const [query, setQuery] = useState("");
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    /** 按 image.id 折叠整个文件(不影响包分组各自的折叠状态) */
    const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (q.length === 0) return refs;
        return refs.filter((r) => r.displayPath.toLowerCase().includes(q));
    }, [refs, query]);

    const toggleGroup = (key: string): void => {
        setCollapsed((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const toggleFile = (key: string): void => {
        setCollapsedFiles((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    return (
        <div className="sidebar">
            <div className="sidebar-search">
                <input
                    type="text"
                    placeholder="Filter classes…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    spellCheck={false}
                />
            </div>
            <div className="tree">
                {images.map((img) => {
                    const imgRefs = filtered.filter((r) => r.source.image === img);
                    if (imgRefs.length === 0) return null;
                    // source → pkg → refs,组按文件内出现序排列
                    const bySource = new Map<string, { name: string | null; pkgs: Map<string, ClassRef[]> }>();
                    for (const ref of imgRefs) {
                        let s = bySource.get(ref.source.id);
                        if (s === undefined) {
                            s = { name: img.kind === "hap" ? ref.source.name : null, pkgs: new Map() };
                            bySource.set(ref.source.id, s);
                        }
                        let arr = s.pkgs.get(ref.pkg);
                        if (arr === undefined) {
                            arr = [];
                            s.pkgs.set(ref.pkg, arr);
                        }
                        arr.push(ref);
                    }
                    // 搜索时临时展开文件,保证匹配的类立即可见;清空搜索后恢复用户手动折叠状态
                    const fileCollapsed = collapsedFiles.has(img.id) && query.trim().length === 0;
                    return (
                        <div key={img.id} className={"tree-image-block" + (fileCollapsed ? " collapsed" : "")}>
                            <button
                                className="tree-image"
                                onClick={() => toggleFile(img.id)}
                                aria-expanded={!fileCollapsed}
                                title={(fileCollapsed ? "Expand " : "Collapse ") + img.fileName}
                            >
                                <span className="tw">{fileCollapsed ? "▸" : "▾"}</span>
                                <span className={"badge badge-" + img.kind}>{img.kind}</span>
                                <span className="tree-image-name" title={img.fileName}>{img.fileName}</span>
                                <span className="tree-image-meta">{formatBytes(img.sizeBytes)}</span>
                            </button>
                            {!fileCollapsed && (
                                <>
                                    {img.moduleInfo !== null && (
                                        <div className="tree-module">
                                            {img.moduleInfo.bundle} · v{img.moduleInfo.version} · {img.moduleInfo.vm}
                                        </div>
                                    )}
                                    {[...bySource.entries()].map(([sourceId, s]) => (
                                        <div key={sourceId}>
                                            {s.name !== null && <div className="tree-source" title={s.name}>{s.name}</div>}
                                            {[...s.pkgs.entries()].map(([pkg, list]) => {
                                                const gkey = sourceId + "|" + pkg;
                                                const isCollapsed = collapsed.has(gkey);
                                                return (
                                                    <div key={gkey}>
                                                        <button className="tree-group-head" onClick={() => toggleGroup(gkey)}>
                                                            <span className="tw">{isCollapsed ? "▸" : "▾"}</span>
                                                            <span className="tree-group-name" title={pkg}>{pkg}</span>
                                                            <span className="count">{list.length}</span>
                                                        </button>
                                                        {!isCollapsed && list.map((ref) => (
                                                            <button
                                                                key={ref.key}
                                                                className={
                                                                    "tree-class" +
                                                                    (ref.key === selectedKey ? " active" : "") +
                                                                    (cachedKeys.has(ref.key) ? " cached" : "")
                                                                }
                                                                title={ref.displayPath}
                                                                onClick={() => onSelect(ref)}
                                                            >
                                                                <span className="dot" />
                                                                {ref.simpleName}
                                                            </button>
                                                        ))}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ))}
                                </>
                            )}
                        </div>
                    );
                })}
                {filtered.length === 0 && <div className="tree-empty">no classes match</div>}
            </div>
        </div>
    );
}
