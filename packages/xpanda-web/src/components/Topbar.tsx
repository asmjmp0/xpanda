import type { DecompileMode } from "../decompiler";

/**
 * 顶栏:标识、模式切换(优化输出 / 原始 AST)、打开文件按钮。
 * @Author: jmp0
 */
interface TopbarProps {
    onOpen: () => void;
    mode: DecompileMode;
    onModeChange: (mode: DecompileMode) => void;
    disabled: boolean;
}

export function Topbar({ onOpen, mode, onModeChange, disabled }: TopbarProps) {
    return (
        <div className="topbar">
            <span className="logo">
                xpanda <em>web</em>
            </span>
            <span className="logo-sub">HarmonyOS .abc / .hap decompiler — runs fully in your browser, nothing is uploaded</span>
            <div className="segmented" title="Output mode applied to new decompilations">
                <button
                    className={mode === "simplify" ? "active" : ""}
                    onClick={() => onModeChange("simplify")}
                >
                    Optimized
                </button>
                <button
                    className={mode === "raw" ? "active" : ""}
                    onClick={() => onModeChange("raw")}
                >
                    Raw AST
                </button>
            </div>
            <button className="btn-accent" onClick={onOpen} disabled={disabled}>
                Open file…
            </button>
        </div>
    );
}
