/**
 * CLI entry bootstrap: re-exec with the 8 GiB old-space cap when the caller did
 * not set one (`--max-old-space-size` is only applied at process start).
 * @Author: jmp0
 */
import { spawnSync } from "child_process";

/** Old-space cap for the decompile process, in MiB (8 GiB). */
const CLI_HEAP_MB = 8 * 1024;

function hasHeapFlag(args: readonly string[]): boolean {
    return args.some((arg) => arg === "--max-old-space-size" || arg.startsWith("--max-old-space-size="));
}

/** NODE_OPTIONS is applied by Node but is not copied into process.execArgv. */
function nodeOptionsArgs(options: string | undefined): string[] {
    if (!options) return [];
    return options.match(/"[^"]*"|'[^']*'|\S+/g)?.map((arg) => arg.replace(/^['"]|['"]$/g, "")) ?? [];
}

/** Re-exec once with the heap cap unless an explicit flag (execArgv / NODE_OPTIONS) wins. */
export function ensureCliHeap(): void {
    if (hasHeapFlag(process.execArgv) || hasHeapFlag(nodeOptionsArgs(process.env.NODE_OPTIONS))) return;
    const child = spawnSync(process.execPath, [
        `--max-old-space-size=${CLI_HEAP_MB}`,
        ...process.execArgv,
        ...process.argv.slice(1),
    ], { stdio: "inherit" });
    if (child.error) {
        console.error(child.error.message);
        process.exit(1);
    }
    if (child.signal) process.kill(process.pid, child.signal);
    process.exit(child.status ?? 1);
}
