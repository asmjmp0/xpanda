/**
 * xpanda-web 通用工具:类名 demangle、文件名清洗、字节格式化、剪贴板 / 下载。
 * 与 cli 的 io.ts 保持同一套 demangle 规则:Lpkg/Name; → pkg/Name(.js)。
 * @Author: jmp0
 */

/** 去掉 `L...;` 外壳,拆出包路径 / 末段类名 / 完整路径 */
export function splitClassName(content: string): { pkg: string; simpleName: string; path: string } {
    let c = content;
    if (c.length >= 2 && c.startsWith("L") && c.endsWith(";")) c = c.slice(1, -1);
    if (c.length === 0) c = "(anonymous)";
    const idx = c.lastIndexOf("/");
    return {
        pkg: idx >= 0 ? c.slice(0, idx) : "(root)",
        simpleName: idx >= 0 ? c.slice(idx + 1) : c,
        path: c,
    };
}

/** 去掉最后一个扩展名 */
export function stripExt(name: string): string {
    const idx = name.lastIndexOf(".");
    return idx > 0 ? name.slice(0, idx) : name;
}

/** 清洗成安全的文件名 / zip 路径段 */
export function sanitizeFileName(name: string): string {
    return name.replace(/[\\/:*?"<>|]/g, "_");
}

export function formatBytes(n: number): string {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / 1024 / 1024).toFixed(2) + " MB";
}

/** 反编译耗时:毫秒级保留 1~2 位小数,超过 1 秒换算成秒 */
export function formatDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) return "—";
    if (ms < 1) return ms.toFixed(2) + " ms";
    if (ms < 10) return ms.toFixed(1) + " ms";
    if (ms < 1000) return Math.round(ms) + " ms";
    return (ms / 1000).toFixed(2) + " s";
}

export function readError(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

/** 复制文本到剪贴板,Clipboard API 不可用时回退 execCommand */
export async function copyText(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (e) {
        try {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand("copy");
            ta.remove();
            return ok;
        } catch (e2) {
            void e2;
            return false;
        }
    }
}

/** 触发浏览器下载一个 Blob */
export function downloadBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
