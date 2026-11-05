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

/** True when the bundle currently has a running process. */
export function isBundleRunning(hdc: string, bundle: string, serial?: string): boolean {
    const result = runHdc(hdc, ["shell", `pidof ${bundle}`], serial);
    return result.ok && result.output.trim().length > 0;
}

/**
 * Wait until the app's abstract gadget socket exists. Checking
 * `/proc/net/unix` is reliable even when the hdc fport TCP listener already
 * accepts connections before the app has bound its socket.
 */
export function waitForGadgetSocket(
    hdc: string,
    port: number,
    timeoutMs: number,
    serial?: string,
): boolean {
    const deadline = Date.now() + timeoutMs;
    const marker = `@xpanda_gadget_${port}`;
    while (Date.now() < deadline) {
        const result = runHdc(hdc, ["shell", "cat /proc/net/unix"], serial);
        if (result.ok && result.output.includes(marker)) {
            // Give bind() a moment to be followed by listen().
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
            return true;
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    }
    return false;
}

export interface AppStartResult {
    /** The bundle has a process after this call. */
    running: boolean;
    /** This call actually launched the app. */
    started: boolean;
    error?: string;
}

/**
 * Start the bundle's main ability if its process is not running, then wait for
 * the process to appear. Used by `gadget shell` / `gadget file --bundle`.
 */
export function ensureBundleRunning(
    hdc: string,
    bundle: string,
    ability = "EntryAbility",
    waitMs = 20000,
    serial?: string,
): AppStartResult {
    if (isBundleRunning(hdc, bundle, serial)) {
        return { running: true, started: false };
    }
    const launched = runHdc(hdc, ["shell", "aa", "start", "-a", ability, "-b", bundle], serial);
    if (!launched.ok) {
        return {
            running: false,
            started: false,
            error: launched.output || `failed to start ${bundle}/${ability}`,
        };
    }
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
        if (isBundleRunning(hdc, bundle, serial)) {
            return { running: true, started: true };
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    }
    return {
        running: false,
        started: true,
        error: `${bundle} did not start within ${Math.round(waitMs / 1000)}s`,
    };
}
