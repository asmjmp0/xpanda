/**
 * Production build with a hard V8 old-space cap.
 *
 * `vite build` parses all of xpanda-core plus the CommonJS @babel packages
 * for two Rollup entries (the UI and the simplify worker). Node's default heap
 * grows with physical RAM (about 4 GiB on a 16 GiB machine), and a leftover
 * NODE_OPTIONS=--max-old-space-size=8192 (the CLI decompile heap) raises that
 * ceiling to 8 GiB. On a 2 GiB Linux box the kernel then direct-reclaims until
 * sshd stops responding. This wrapper starts Vite under an explicit cap and
 * drops any inherited heap flag so a larger NODE_OPTIONS cannot raise it.
 * A 2 GiB machine gets 768 MiB, which still finishes this build (about 900 MiB
 * RSS) and leaves the rest for the OS. Past the cap, Node exits.
 * @Author: jmp0
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

/** Leave this much RAM outside the heap when the machine can spare it, in MiB. */
const RESERVE_MB = 2048;
/**
 * Old-space budget when the machine can spare {@link RESERVE_MB}. A higher cap
 * only gives a stray NODE_OPTIONS more room to fill.
 */
const TARGET_MB = 3072;
/**
 * Old-space budget for a small machine. 384 MiB aborts this build; 512 MiB
 * finishes at about 850 MiB RSS. 768 MiB is the next step up so a 2 GiB server
 * still has a margin, without letting V8 grow into the memory the OS needs.
 */
const SMALL_TARGET_MB = 768;
/** Minimum kept outside the heap on a small machine, in MiB. */
const MIN_OS_MB = 768;

/**
 * Old-space cap for a machine with `totalMb` MiB of physical RAM.
 * Machines that can spare {@link RESERVE_MB} and still reach {@link TARGET_MB}
 * use that. Smaller machines use {@link SMALL_TARGET_MB} when at least
 * {@link MIN_OS_MB} (or half of RAM, whichever is larger) stays outside the
 * heap. Below that the cap shrinks so Node throws instead of exhausting RAM.
 */
export function resolveHeapCapMb(totalMb) {
    if (totalMb - RESERVE_MB >= TARGET_MB) return TARGET_MB;
    const osMb = Math.min(RESERVE_MB, Math.max(MIN_OS_MB, Math.floor(totalMb / 2)));
    const roomMb = totalMb - osMb;
    if (roomMb >= SMALL_TARGET_MB) return SMALL_TARGET_MB;
    return Math.max(256, roomMb);
}

/** Split NODE_OPTIONS the way Node does: quoted strings stay one argument. */
export function nodeOptionsArgs(options) {
    if (!options) return [];
    return options.match(/"[^"]*"|'[^']*'|\S+/g)?.map((arg) => arg.replace(/^['"]|['"]$/g, "")) ?? [];
}

/** Drop `--max-old-space-size` so the child cannot inherit a larger heap. */
export function stripHeapFlags(args) {
    const out = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--max-old-space-size") {
            i += 1;
            continue;
        }
        if (arg.startsWith("--max-old-space-size=")) continue;
        out.push(arg);
    }
    return out;
}

function formatNodeOptions(args) {
    return args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)).join(" ");
}

/** MiB value of the last `--max-old-space-size` flag. Node uses the last one. */
export function heapFlagMb(args) {
    let found;
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--max-old-space-size") {
            const value = Number(args[i + 1]);
            if (Number.isFinite(value)) found = value;
            continue;
        }
        if (arg.startsWith("--max-old-space-size=")) {
            const value = Number(arg.slice("--max-old-space-size=".length));
            if (Number.isFinite(value)) found = value;
        }
    }
    return found;
}

function viteBin() {
    const require = createRequire(import.meta.url);
    return path.join(path.dirname(require.resolve("vite/package.json")), "bin", "vite.js");
}

function main() {
    const totalMb = Math.floor(os.totalmem() / (1024 * 1024));
    const capMb = resolveHeapCapMb(totalMb);
    const inheritedMb = heapFlagMb(nodeOptionsArgs(process.env.NODE_OPTIONS));
    const kept = stripHeapFlags(nodeOptionsArgs(process.env.NODE_OPTIONS));
    const env = { ...process.env };
    if (kept.length === 0) delete env.NODE_OPTIONS;
    else env.NODE_OPTIONS = formatNodeOptions(kept);

    const ignored = inheritedMb !== undefined && inheritedMb !== capMb
        ? ` (ignored NODE_OPTIONS ${inheritedMb} MiB)`
        : "";
    console.error(`xpanda-web build: V8 old space ${capMb} MiB, physical ${totalMb} MiB${ignored}`);

    const child = spawnSync(process.execPath, [
        `--max-old-space-size=${capMb}`,
        viteBin(),
        "build",
        ...process.argv.slice(2),
    ], { stdio: "inherit", env });
    if (child.error) {
        console.error(child.error.message);
        process.exit(1);
    }
    if (child.signal) {
        process.kill(process.pid, child.signal);
        return;
    }
    process.exit(child.status ?? 1);
}

const invokedDirectly = process.argv[1] !== undefined
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
