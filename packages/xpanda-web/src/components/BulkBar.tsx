import { MAX_DECOMPILE_JOBS, type BulkState } from "../decompiler";

/**
 * 全量反编译进度条:运行中显示进度 / worker 数与取消,空闲时显示入口按钮与 zip 下载。
 * worker 数可在 1~MAX_DECOMPILE_JOBS 之间选择(默认 4),运行中不可修改。
 * @Author: jmp0
 */
interface BulkBarProps {
    bulk: BulkState | null;
    total: number;
    cachedCount: number;
    /** 下次全量反编译使用的 worker 数 */
    jobs: number;
    onJobsChange: (jobs: number) => void;
    onRun: () => void;
    onCancel: () => void;
    onDownloadAll: () => void;
}

const JOB_OPTIONS = Array.from({ length: MAX_DECOMPILE_JOBS }, (_, i) => i + 1);

export function BulkBar({ bulk, total, cachedCount, jobs, onJobsChange, onRun, onCancel, onDownloadAll }: BulkBarProps) {
    const running = bulk !== null && bulk.running;
    const pct = bulk !== null && bulk.total > 0 ? Math.round((bulk.done / bulk.total) * 100) : 0;
    // 运行中显示本次实际使用的 worker 数,结束后恢复为“下次使用”的设置值
    const selectedJobs = running && bulk !== null ? bulk.jobs : jobs;
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
                        {bulk.jobs > 1 ? ` · ${bulk.jobs} workers` : ""}
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
            <label className="bulk-jobs" title="Worker threads used by Decompile all (optimized mode; applies to the next run)">
                <span>Workers</span>
                <select
                    value={selectedJobs}
                    onChange={(e) => onJobsChange(Number(e.target.value))}
                    disabled={running}
                >
                    {JOB_OPTIONS.map((n) => (
                        <option key={n} value={n}>{n}</option>
                    ))}
                </select>
            </label>
            <button onClick={onDownloadAll} disabled={cachedCount === 0 || running} title="Pack every decompiled class into a .zip">
                Download all (.zip)
            </button>
        </div>
    );
}
