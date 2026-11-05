/**
 * hdc discovery and port-forward helpers for the interactive gadget shell.
 * @Author: jmp0
 */
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export interface HdcResult {
    ok: boolean;
    output: string;
}

/** Locate the hdc binary: explicit option > env > PATH > DevEco command-line-tools / Studio. */
export function findHdc(explicit?: string): string | null {
    const candidates: string[] = [];
    if (explicit) candidates.push(explicit);
    if (process.env.XPANDA_HDC) candidates.push(process.env.XPANDA_HDC);
    if (process.env.HDC) candidates.push(process.env.HDC);
    candidates.push("hdc");
    candidates.push(path.join(os.homedir(), "command-line-tools/sdk/default/openharmony/toolchains/hdc"));
    candidates.push("/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/hdc");

    for (const candidate of candidates) {
        if (candidate.includes("/") || candidate.includes("\\")) {
            if (fs.existsSync(candidate)) return candidate;
            continue;
        }
        const probe = spawnSync(candidate, ["version"], { encoding: "utf8" });
        if (!probe.error) return candidate;
    }
    return null;
}

/** Run hdc with an optional device serial (`-t <serial>`). */
export function runHdc(hdc: string, args: string[], serial?: string): HdcResult {
    const fullArgs = serial ? ["-t", serial, ...args] : args;
    const result = spawnSync(hdc, fullArgs, { encoding: "utf8" });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    const ok = !result.error && result.status === 0 && !/\bfail(ed)?\b/i.test(output);
    return { ok, output };
}

/**
 * Ensure `hdc fport tcp:<port> localabstract:xpanda_gadget_<port>` is active.
 * Removes a stale rule first; returns whether this call created the forward.
 */
export function ensurePortForward(
    hdc: string,
    port: number,
    serial: string | undefined,
): { created: boolean; error?: string } {
    // A stale rule for the same local port makes `fport` fail; remove it first.
    removePortForward(hdc, port, serial);
    // hdcd releases the local listener asynchronously; retry the bind briefly.
    let lastError = "";
    const tryAdd = (attempts: number): boolean => {
        for (let attempt = 0; attempt < attempts; attempt++) {
            const added = runHdc(hdc, ["fport", `tcp:${port}`, `localabstract:xpanda_gadget_${port}`], serial);
            if (added.ok) return true;
            lastError = added.output;
            if (!/port listen failed|address already in use/i.test(added.output)) return false;
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
        }
        return false;
    };
    if (tryAdd(20)) return { created: true };

    // A stale listener can survive rule removal inside the hdc server. When no
    // forward rule is registered at all, restarting the server drops it; the next
    // command reconnects the device.
    const listed = runHdc(hdc, ["fport", "ls"], serial);
    const noRules = /\[Empty\]/.test(listed.output) || listed.output.trim().length === 0;
    if (noRules) {
        runHdc(hdc, ["kill"], serial);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
        runHdc(hdc, ["list", "targets"], serial);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
        if (tryAdd(10)) return { created: true };
    }
    return {
        created: false,
        error: lastError.length > 0 ? lastError : "hdc fport failed (is a device connected?)",
    };
}

/** Remove a forwarding rule (this hdc version matches the full local+remote task string). */
export function removePortForward(hdc: string, port: number, serial?: string): void {
    runHdc(hdc, ["fport", "rm", `tcp:${port}`, `localabstract:xpanda_gadget_${port}`], serial);
}
