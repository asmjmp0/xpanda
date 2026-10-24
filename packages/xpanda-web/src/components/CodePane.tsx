import { useMemo, useState } from "react";
import type { ClassRef, DecompileMode } from "../decompiler";
import { highlightLines } from "../highlight";
import { copyText, downloadBlob } from "../format";

/**
 * 右侧代码视图:工具栏(类名 / 模式 / 复制 / 单类下载 / 重反编译)+ 行号 + 高亮代码。
 * @Author: jmp0
 */
interface CodePaneProps {
    selected: ClassRef | null;
    /** undefined = 尚未反编译;"" = 反编译完成但无输出 */
    code: string | undefined;
    decompiling: boolean;
    mode: DecompileMode;
    onRedecompile: () => void;
}

export function CodePane({ selected, code, decompiling, mode, onRedecompile }: CodePaneProps) {
    const [copied, setCopied] = useState(false);
    const lines = useMemo(() => (code !== undefined && code !== "" ? highlightLines(code) : []), [code]);

    if (selected === null) {
        return <div className="codepane-empty">Select a class on the left to decompile it.</div>;
    }

    const handleCopy = (): void => {
        if (code === undefined || code === "") return;
        void copyText(code).then((ok) => {
            if (!ok) return;
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        });
    };

    const handleDownload = (): void => {
        if (code === undefined || code === "") return;
        downloadBlob(new Blob([code], { type: "text/javascript;charset=utf-8" }), selected.simpleName + ".js");
    };

    return (
        <div className="codepane">
            <div className="codepane-toolbar">
                <span className="codepane-path" title={selected.displayPath}>{selected.displayPath}</span>
                <span className="codepane-meta">
                    {mode === "raw" ? "raw" : "optimized"} · {lines.length} lines
                </span>
                <div className="codepane-actions">
                    <button onClick={handleCopy} disabled={code === undefined || code === ""}>
                        {copied ? "Copied ✓" : "Copy"}
                    </button>
                    <button onClick={handleDownload} disabled={code === undefined || code === ""}>
                        Download .js
                    </button>
                    <button onClick={onRedecompile} disabled={decompiling} title="Discard cache and decompile again">
                        Re-decompile
                    </button>
                </div>
            </div>
            <div className="codepane-scroll">
                {decompiling && code === undefined ? (
                    <div className="codepane-loading">Decompiling {selected.displayPath} …</div>
                ) : code === "" ? (
                    <div className="codepane-loading">{"// xpanda produced no output for this class"}</div>
                ) : (
                    <div className="code-body">
                        {lines.map((html, idx) => (
                            <div className="code-line" key={idx}>
                                <span className="code-ln">{idx + 1}</span>
                                <span
                                    className="code-text"
                                    dangerouslySetInnerHTML={{ __html: html === "" ? "&nbsp;" : html }}
                                />
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
