import type { BulkState } from "../decompiler";

/**
 * 全量反编译进度条:运行中显示进度与取消,空闲时显示入口按钮与 zip 下载。
 * @Author: jmp0
 */
interface BulkBarProps {
    bulk: BulkState | null;
    total: number;
    cachedCount: number;
    onRun: () => void;
    onCancel: () => void;
    onDownloadAll: () => void;
}

export function BulkBar({ bulk, total, cachedCount, onRun, onCancel, onDownloadAll }: BulkBarProps) {
    const running = bulk !== null && bulk.running;
    const pct = bulk !== null && bulk.total > 0 ? Math.round((bulk.done / bulk.total) * 100) : 0;
    return (
        <div className="bulkbar">
            <button
                className={running ? "btn-danger" : "btn-accent"}
                onClick={running ? onCancel : onRun}
                disabled={total === 0}
            >
                {running ? "Cancel" : `Decompile all (${total} classes)`}
            </button>
            {running && bulk !== null ? (
                <>
                    <div className="progress">
                        <div className="progress-fill" style={{ width: pct + "%" }} />
                    </div>
                    <span className="bulk-text">
                        {bulk.done}/{bulk.total} ({pct}%)
                        {bulk.failed > 0 ? ` · ${bulk.failed} failed` : ""}
                    </span>
                </>
            ) : (
                <span className="bulk-text">{cachedCount}/{total} decompiled</span>
            )}
            <div className="bulk-spacer" />
            {bulk !== null && !bulk.running && bulk.cancelled && (
                <span className="bulk-text bulk-warn">cancelled</span>
            )}
            <button onClick={onDownloadAll} disabled={cachedCount === 0 || running} title="Pack every decompiled class into a .zip">
                Download all (.zip)
            </button>
        </div>
    );
}
