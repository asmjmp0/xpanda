import type { DecompileMode } from "../decompiler";
import { CORE_VERSION, REPO_URL, WEB_VERSION } from "../version";

/** GitHub 图标(Octicons mark-github,内联以免引入图标依赖) */
const GITHUB_ICON = (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
        <path
            fill="currentColor"
            d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"
        />
    </svg>
);

/**
 * 顶栏:标识、版本号、本项目 GitHub 仓库入口、模式切换(优化输出 / 原始 AST)、打开文件按钮。
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
            <div className="topbar-meta">
                <span className="ver" title="xpanda-core version">xpanda-core v{CORE_VERSION}</span>
                <span className="ver" title="xpanda-web version">xpanda-web v{WEB_VERSION}</span>
                <a
                    className="repo-link"
                    href={REPO_URL}
                    target="_blank"
                    rel="noreferrer"
                    title={`This project's GitHub repository: ${REPO_URL}`}
                >
                    {GITHUB_ICON}
                    <span>GitHub repo</span>
                </a>
            </div>
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
