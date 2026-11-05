/**
 * Shared gadget socket client + hdc forwarding setup used by `gadget shell` and
 * `gadget file`.
 * @Author: jmp0
 */
import * as net from "net";
import { ensurePortForward, findHdc, removePortForward } from "./hdc";
import { fail } from "./help";

export interface GadgetConnectionOptions {
    port: number;
    host: string;
    serial?: string;
    hdcPath?: string;
    hdc?: string;
    noForward: boolean;
    keepForward: boolean;
}

export const COLOR = process.stdout.isTTY
    ? { green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", dim: "\x1b[2m", reset: "\x1b[0m" }
    : { green: "", red: "", yellow: "", dim: "", reset: "" };

export const CONNECT_TIMEOUT_MS = 5000;
export const REQUEST_TIMEOUT_MS = 15000;

/**
 * Render a reply value for the terminal: strings unquoted, short objects as
 * compact JSON, long objects/arrays as indented JSON (a returned object used to
 * be one unreadable line in the shell).
 */
export function formatValue(value: unknown): string {
    if (value === undefined) return "undefined";
    if (typeof value === "string") return value;
    if (value === null || typeof value !== "object") return String(value);
    try {
        const compact = JSON.stringify(value);
        if (compact === undefined) return String(value);
        if (compact.length <= 80) return compact;
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

/**
 * Console wrapper installed into the gadget VM by `gadget shell` / `gadget file`.
 *
 * The native console bridge stringifies object arguments with a compact
 * `JSON.stringify`, so `console.log(bigObject)` arrives as one very long line.
 * This prelude replaces the console methods with wrappers that render long
 * object arguments as indented JSON before they reach the native console.
 * It is idempotent and stays active in the VM between evaluations.
 */
const CONSOLE_FORMAT_PRELUDE = `(function () {
    if (globalThis.__xpandaConsoleFormat) return;
    globalThis.__xpandaConsoleFormat = true;

    function format(value) {
        if (value === null || typeof value !== "object") return value;
        try {
            if (value instanceof Error) return value;
        } catch (e) {
            // ignore proxy prototype failures
        }
        var compact;
        try {
            compact = JSON.stringify(value);
        } catch (e) {
            return value;
        }
        if (typeof compact !== "string") return value;
        if (compact.length <= 80) return compact;
        try {
            return JSON.stringify(value, null, 2);
        } catch (e) {
            return compact;
        }
    }

    var methods = ["log", "info", "debug", "warn", "error", "trace", "dir"];
    for (var i = 0; i < methods.length; i++) {
        var name = methods[i];
        var original = globalThis.console[name];
        if (typeof original !== "function") continue;
        globalThis.console[name] = (function (fn) {
            return function () {
                var args = [];
                for (var j = 0; j < arguments.length; j++) args.push(format(arguments[j]));
                return fn.apply(globalThis.console, args);
            };
        })(original);
    }
})();`;

/** Install the console object-formatting prelude in the connected gadget VM. */
export async function installConsoleFormatting(client: GadgetClient): Promise<void> {
    try {
        await client.request({ type: "js", code: CONSOLE_FORMAT_PRELUDE });
    } catch {
        // Formatting is best-effort: never block the shell/file workflow on it.
    }
}

/** True for a console push emitted by console.* inside the gadget VM. */
export function isConsolePush(message: any): boolean {
    return Boolean(message) && message.type === "console";
}

/** Render a console push for the terminal (warn/error colored, debug dimmed). */
export function formatConsolePush(message: any): string {
    const text = typeof message.text === "string" ? message.text : formatValue(message.text);
    if (message.level === "error") return `${COLOR.red}${text}${COLOR.reset}`;
    if (message.level === "warn") return `${COLOR.yellow}${text}${COLOR.reset}`;
    if (message.level === "debug" || message.level === "trace") return `${COLOR.dim}${text}${COLOR.reset}`;
    return text;
}

interface PendingRequest {
    resolve: (message: any) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
}

export interface GadgetClient {
    request: (payload: Record<string, unknown>) => Promise<any>;
    close: () => void;
    connected: Promise<void>;
}

/** Connect to the forwarded gadget socket; replies are matched by request id. */
export function createGadgetClient(
    options: GadgetConnectionOptions,
    onPush: (message: any) => void,
    onDisconnect: (error: Error) => void,
): GadgetClient {
    const socket = net.connect({ host: options.host, port: options.port });
    socket.setNoDelay(true);
    let buffer = "";
    let nextId = 0;
    let disconnected = false;
    const pending = new Map<number, PendingRequest>();

    const failPending = (error: Error): void => {
        for (const waiter of pending.values()) {
            clearTimeout(waiter.timer);
            waiter.reject(error);
        }
        pending.clear();
    };

    const connected = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.destroy();
            reject(new Error(`connect timed out (${options.host}:${options.port})`));
        }, CONNECT_TIMEOUT_MS);
        socket.once("connect", () => {
            clearTimeout(timer);
            resolve();
        });
        socket.once("error", (error) => {
            clearTimeout(timer);
            reject(error);
        });
    });

    socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        let newline;
        while ((newline = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (!line) continue;
            let message: any;
            try {
                message = JSON.parse(line);
            } catch {
                console.log(`${COLOR.dim}[unparsed] ${line}${COLOR.reset}`);
                continue;
            }
            const waiter = typeof message.id === "number" ? pending.get(message.id) : undefined;
            if (waiter) {
                pending.delete(message.id);
                clearTimeout(waiter.timer);
                waiter.resolve(message);
            } else {
                onPush(message);
            }
        }
    });

    socket.on("close", () => {
        if (disconnected) return;
        disconnected = true;
        const error = new Error("connection closed (is the injected app still running?)");
        failPending(error);
        onDisconnect(error);
    });
    socket.on("error", () => {
        // the close handler reports the failure
    });

    const request = (payload: Record<string, unknown>): Promise<any> => {
        const id = ++nextId;
        return new Promise((resolve, reject) => {
            if (disconnected) {
                reject(new Error("connection closed"));
                return;
            }
            const timer = setTimeout(() => {
                pending.delete(id);
                reject(new Error(`request #${id} timed out after ${REQUEST_TIMEOUT_MS / 1000}s`));
            }, REQUEST_TIMEOUT_MS);
            pending.set(id, { resolve, reject, timer });
            socket.write(JSON.stringify({ id, ...payload }) + "\n");
        });
    };

    const close = () => {
        disconnected = true;
        failPending(new Error("connection closed"));
        socket.end();
    };

    return { request, close, connected };
}

/**
 * Set up the hdc forward (unless --no-forward) and return a cleanup function
 * that removes it on exit (unless --keep-forward).
 */
export function setupGadgetForward(options: GadgetConnectionOptions): () => void {
    if (options.noForward) return () => {};
    const hdc = findHdc(options.hdcPath);
    if (!hdc) {
        fail("gadget: hdc not found (set HDC / XPANDA_HDC, pass --hdc, or use --no-forward)", "gadget-shell");
    }
    options.hdc = hdc;
    const forward = ensurePortForward(hdc, options.port, options.serial);
    if (!forward.created) {
        fail(`gadget: failed to forward tcp:${options.port}\n${forward.error ?? ""}`, "gadget-shell");
    }
    if (process.stdout.isTTY) {
        console.log(`${COLOR.dim}forward: tcp:${options.port} -> localabstract:xpanda_gadget_${options.port}${COLOR.reset}`);
    }
    let cleaned = false;
    return () => {
        if (cleaned || options.keepForward || !options.hdc) return;
        cleaned = true;
        removePortForward(options.hdc, options.port, options.serial);
    };
}
