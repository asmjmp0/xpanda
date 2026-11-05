/**
 * `xpanda gadget file <script.js>`: execute a JS file in the gadget VM now and
 * on every save (watch mode) — the Frida-gadget-style reload workflow.
 *
 *   xpanda gadget file <script.js> [--once] [--port N] [-t serial]
 *                      [--hdc path] [--host HOST] [--no-forward] [--keep-forward]
 * @Author: jmp0
 */
import * as fs from "fs";
import * as path from "path";
import { DEFAULT_GADGET_PORT } from "xpanda-gadget";
import { takeValue } from "../args";
import {
    COLOR,
    createGadgetClient,
    formatConsolePush,
    formatValue,
    GadgetClient,
    GadgetConnectionOptions,
    installConsoleFormatting,
    isConsolePush,
    setupGadgetForward,
} from "../gadgetClient";
import { fail, printUsage } from "../help";

const WATCH_INTERVAL_MS = 200;
const DEBOUNCE_MS = 150;

interface FileOptions {
    script: string;
    once: boolean;
    connection: GadgetConnectionOptions;
}

function parseArgs(args: string[]): FileOptions {
    if (args.length === 0) fail("gadget file: missing <script.js> argument", "gadget-file");
    if (args[0] === "-h" || args[0] === "--help") {
        printUsage("gadget-file");
        process.exit(0);
    }
    const script = args[0];
    const options: FileOptions = {
        script,
        once: false,
        connection: {
            port: DEFAULT_GADGET_PORT,
            host: "127.0.0.1",
            noForward: false,
            keepForward: false,
        },
    };
    for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        if (arg === "-h" || arg === "--help") {
            printUsage("gadget-file");
            process.exit(0);
        } else if (arg === "--once") {
            options.once = true;
        } else if (arg === "-p" || arg === "--port") {
            const parsed = takeValue(args, i, arg, "gadget-file");
            const value = Number(parsed.value);
            if (!Number.isFinite(value) || value <= 0) fail("option --port requires a positive number", "gadget-file");
            options.connection.port = value;
            i = parsed.index;
        } else if (arg === "--host") {
            const parsed = takeValue(args, i, arg, "gadget-file");
            options.connection.host = parsed.value;
            i = parsed.index;
        } else if (arg === "-t" || arg === "--serial") {
            const parsed = takeValue(args, i, arg, "gadget-file");
            options.connection.serial = parsed.value;
            i = parsed.index;
        } else if (arg === "--hdc") {
            const parsed = takeValue(args, i, arg, "gadget-file");
            options.connection.hdcPath = parsed.value;
            i = parsed.index;
        } else if (arg === "--no-forward") {
            options.connection.noForward = true;
        } else if (arg === "--keep-forward") {
            options.connection.keepForward = true;
        } else {
            fail(`gadget file: unknown option: ${arg}`, "gadget-file");
        }
    }
    return options;
}

/** `[HH:MM:SS]` prefix for watch-mode logs. */
function stamp(): string {
    return new Date().toTimeString().slice(0, 8);
}

export async function runGadgetFile(args: string[]): Promise<void> {
    const options = parseArgs(args);
    // `yarn xpanda` runs the CLI in the workspace directory; resolve the script
    // against the directory the user invoked yarn from (INIT_CWD) instead.
    const baseDir = process.env.INIT_CWD ?? process.cwd();
    const scriptPath = path.resolve(baseDir, options.script);
    if (!fs.existsSync(scriptPath)) fail(`gadget file: script not found: ${scriptPath}`, "gadget-file");

    const cleanupForward = setupGadgetForward(options.connection);
    const log = (color: string, text: string): void => {
        console.log(`[${stamp()}] ${color}${text}${COLOR.reset}`);
    };

    let client: GadgetClient | null = null;
    let closed = false;
    let queue: Promise<void> = Promise.resolve();

    const finish = (): void => {
        if (closed) return;
        closed = true;
        client?.close();
        cleanupForward();
        process.exit(0);
    };
    process.on("SIGINT", finish);
    process.on("SIGTERM", finish);

    const execute = async (reason: "start" | "reload"): Promise<void> => {
        let code: string;
        try {
            code = fs.readFileSync(scriptPath, "utf8");
        } catch (error: any) {
            log(COLOR.red, `read failed: ${error?.message ?? error}`);
            return;
        }
        log(COLOR.dim, `${reason}: ${scriptPath}`);

        if (client === null) {
            const candidate = createGadgetClient(options.connection, (message) => {
                if (isConsolePush(message)) {
                    // keep the timestamp: in watch mode the script runs repeatedly
                    log("", formatConsolePush(message));
                    return;
                }
                log(COLOR.dim, `[push] ${JSON.stringify(message)}`);
            }, (error) => {
                if (closed) return;
                log(COLOR.red, `disconnected: ${error.message} (will reconnect on next save)`);
                client = null;
            });
            try {
                await candidate.connected;
                client = candidate;
                await installConsoleFormatting(client);
            } catch (error: any) {
                candidate.close();
                const reasonText = error?.code === "ECONNREFUSED"
                    ? `nothing is listening on ${options.connection.host}:${options.connection.port} (is the injected app running?)`
                    : String(error?.message ?? error);
                log(COLOR.red, `connect failed: ${reasonText} (will retry on next save)`);
                return;
            }
        }

        try {
            const reply = await client.request({ type: "js", code });
            if (reply.type === "result") {
                if (reply.ok) {
                    // Watch mode is console-driven: do not print the script's return value.
                    if (options.once) log(COLOR.green, formatValue(reply.value));
                } else {
                    log(COLOR.red, `error: ${formatValue(reply.error)}`);
                }
            } else {
                log(COLOR.dim, JSON.stringify(reply));
            }
        } catch (error: any) {
            log(COLOR.red, `execute failed: ${error?.message ?? error}`);
        }
    };

    const enqueue = (reason: "start" | "reload"): void => {
        queue = queue.then(() => execute(reason)).catch((error) => {
            log(COLOR.red, String(error?.message ?? error));
        });
    };

    enqueue("start");
    if (options.once) {
        queue = queue.then(() => finish());
        return;
    }

    let timer: NodeJS.Timeout | null = null;
    let previous = fs.statSync(scriptPath);
    fs.watchFile(scriptPath, { interval: WATCH_INTERVAL_MS }, (current, _old) => {
        if (current.mtimeMs === 0) {
            log(COLOR.dim, "file removed; waiting for it to reappear");
            return;
        }
        if (current.mtimeMs === previous.mtimeMs && current.size === previous.size) return;
        previous = current;
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            enqueue("reload");
        }, DEBOUNCE_MS);
    });

    if (process.stdout.isTTY) {
        console.log(`${COLOR.dim}watching ${scriptPath} (save to re-run, Ctrl+C to stop)${COLOR.reset}`);
    }
}
