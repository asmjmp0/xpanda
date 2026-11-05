/**
 * `xpanda gadget shell`: forward the gadget socket over hdc and open an
 * interactive JS REPL.
 *
 *   xpanda gadget shell [--port N] [-t serial] [--hdc path]
 *                       [--no-forward] [--keep-forward] [--host HOST]
 * @Author: jmp0
 */
import * as readline from "readline";
import { DEFAULT_GADGET_PORT } from "xpanda-gadget";
import { takeValue } from "../args";
import {
    COLOR,
    createGadgetClient,
    formatConsolePush,
    formatValue,
    GadgetConnectionOptions,
    installConsoleFormatting,
    isConsolePush,
    setupGadgetForward,
} from "../gadgetClient";
import { fail, printUsage } from "../help";

/** Split a JS snippet into tokens while skipping strings/comments (for brace balance). */
function isBalanced(code: string): boolean {
    let depth = 0;
    let quote: string | null = null;
    let lineComment = false;
    let blockComment = false;
    for (let i = 0; i < code.length; i++) {
        const ch = code[i];
        const next = code[i + 1];
        if (lineComment) {
            if (ch === "\n") lineComment = false;
            continue;
        }
        if (blockComment) {
            if (ch === "*" && next === "/") {
                blockComment = false;
                i++;
            }
            continue;
        }
        if (quote) {
            if (ch === "\\") {
                i++;
            } else if (ch === quote) {
                quote = null;
            }
            continue;
        }
        if (ch === "/" && next === "/") {
            lineComment = true;
            i++;
            continue;
        }
        if (ch === "/" && next === "*") {
            blockComment = true;
            i++;
            continue;
        }
        if (ch === "'" || ch === "\"" || ch === "`") {
            quote = ch;
            continue;
        }
        if (ch === "{" || ch === "(" || ch === "[") depth++;
        else if (ch === "}" || ch === ")" || ch === "]") depth--;
    }
    return depth <= 0;
}

function parseArgs(args: string[]): GadgetConnectionOptions {
    const options: GadgetConnectionOptions = {
        port: DEFAULT_GADGET_PORT,
        host: "127.0.0.1",
        noForward: false,
        keepForward: false,
    };
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "-h" || arg === "--help") {
            printUsage("gadget-shell");
            process.exit(0);
        } else if (arg === "-p" || arg === "--port") {
            const parsed = takeValue(args, i, arg, "gadget-shell");
            const value = Number(parsed.value);
            if (!Number.isFinite(value) || value <= 0) fail("option --port requires a positive number", "gadget-shell");
            options.port = value;
            i = parsed.index;
        } else if (arg === "--host") {
            const parsed = takeValue(args, i, arg, "gadget-shell");
            options.host = parsed.value;
            i = parsed.index;
        } else if (arg === "-t" || arg === "--serial") {
            const parsed = takeValue(args, i, arg, "gadget-shell");
            options.serial = parsed.value;
            i = parsed.index;
        } else if (arg === "--hdc") {
            const parsed = takeValue(args, i, arg, "gadget-shell");
            options.hdcPath = parsed.value;
            i = parsed.index;
        } else if (arg === "--no-forward") {
            options.noForward = true;
        } else if (arg === "--keep-forward") {
            options.keepForward = true;
        } else {
            fail(`gadget shell: unknown option: ${arg}`, "gadget-shell");
        }
    }
    return options;
}

function printReply(reply: any): void {
    if (reply.type === "result") {
        if (reply.ok) {
            console.log(`${COLOR.green}${formatValue(reply.value)}${COLOR.reset}`);
        } else {
            console.log(`${COLOR.red}error: ${formatValue(reply.error)}${COLOR.reset}`);
        }
        return;
    }
    console.log(JSON.stringify(reply));
}

function printShellHelp(): void {
    console.log([
        "  <js>            evaluate JavaScript in the gadget VM (multi-line blocks are auto-joined)",
        "                  bare `{...}` input is retried as a parenthesized expression (like Node/DevTools)",
        "  console.*       log/info/debug/warn/error/trace/dir/assert output is streamed back here",
        "  .info           gadget info (pid / endpoint / version / uptime)",
        "  .ping           liveness check",
        "  .probe          JSVM health check (may boot the VM on first use)",
        "  .reset          destroy the VM (clears globals/prototypes; fresh VM on next eval)",
        "  .msg <json>     send a message to the ArkTS inbox (parsed as JSON when possible)",
        "  .help           this help",
        "  .exit / .quit   leave the shell (Ctrl+C clears input, Ctrl+D exits)",
        "",
        "  persistent state: globalThis.x = 1   (let/const are per-snippet, like DevTools)",
    ].join("\n"));
}

export async function runGadgetShell(args: string[]): Promise<void> {
    const options = parseArgs(args);
    const cleanupForward = setupGadgetForward(options);

    const onPush = (message: any) => {
        if (isConsolePush(message)) {
            console.log(formatConsolePush(message));
            return;
        }
        console.log(`${COLOR.dim}[push] ${JSON.stringify(message)}${COLOR.reset}`);
    };
    const client = createGadgetClient(options, onPush, (error) => {
        if (closing) return;
        console.log(`${COLOR.red}${error.message}${COLOR.reset}`);
        finish();
    });

    let closing = false;
    const finish = (): void => {
        if (closing) return;
        closing = true;
        client.close();
        cleanupForward();
        process.exit(0);
    };

    try {
        await client.connected;
    } catch (error: any) {
        cleanupForward();
        const reason = error?.code === "ECONNREFUSED"
            ? `nothing is listening on ${options.host}:${options.port} (is the injected app running, and the port forwarded?)`
            : String(error?.message ?? error);
        fail(`gadget shell: ${reason}`, "gadget-shell");
    }

    if (process.stdout.isTTY) {
        console.log(`xpanda gadget shell — ${options.host}:${options.port}  ${COLOR.dim}(.help for commands)${COLOR.reset}`);
    }

    // Install the console formatter lazily: .info/.ping/.msg do not need the VM.
    let consoleFormattingInstalled = false;
    const ensureConsoleFormatting = async (): Promise<void> => {
        if (consoleFormattingInstalled) return;
        consoleFormattingInstalled = true;
        await installConsoleFormatting(client);
    };

    const isTTY = Boolean(process.stdin.isTTY);
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: isTTY,
    });
    const prompt = (text = "xpanda> "): void => {
        if (!isTTY) return;
        rl.setPrompt(text);
        rl.prompt();
    };

    let queue: Promise<void> = Promise.resolve();
    let buffer: string[] = [];
    let inputClosed = false;

    const handleLine = async (line: string): Promise<void> => {
        // continuation of a multi-line snippet
        if (buffer.length > 0) {
            buffer.push(line);
            const code = buffer.join("\n");
            if (!isBalanced(code)) {
                prompt("   ...> ");
                return;
            }
            buffer = [];
            await ensureConsoleFormatting();
            printReply(await client.request({ type: "js", code }));
            return;
        }

        const trimmed = line.trim();
        if (trimmed.length === 0) return;
        if (trimmed === "exit" || trimmed === "quit" || trimmed === ".exit" || trimmed === ".quit") {
            finish();
            return;
        }
        if (trimmed === ".help" || trimmed === "help") {
            printShellHelp();
            return;
        }
        if (trimmed === ".info" || trimmed === ".ping" || trimmed === ".probe") {
            const type = trimmed.slice(1);
            const reply = await client.request({ type });
            console.log(JSON.stringify(reply));
            return;
        }
        if (trimmed === ".reset") {
            const reply = await client.request({ type: "reset" });
            console.log(JSON.stringify(reply));
            consoleFormattingInstalled = false;
            return;
        }
        if (trimmed.startsWith(".msg")) {
            const raw = trimmed.slice(4).trim();
            if (raw.length === 0) {
                console.log(`${COLOR.red}.msg requires a payload${COLOR.reset}`);
                return;
            }
            let payload: unknown = raw;
            try {
                payload = JSON.parse(raw);
            } catch {
                // keep it as a plain string
            }
            const reply = await client.request({ type: "msg", payload });
            console.log(JSON.stringify(reply));
            return;
        }

        buffer = [line];
        if (!isBalanced(line)) {
            prompt("   ...> ");
            return;
        }
        buffer = [];
        await ensureConsoleFormatting();
        printReply(await client.request({ type: "js", code: line }));
    };

    rl.on("line", (line) => {
        queue = queue.then(() => handleLine(line)).catch((error) => {
            console.log(`${COLOR.red}${String(error?.message ?? error)}${COLOR.reset}`);
        }).then(() => prompt());
    });

    rl.on("SIGINT", () => {
        if (buffer.length > 0) {
            buffer = [];
            process.stdout.write("\n");
            prompt();
        } else {
            process.stdout.write("\n");
            finish();
        }
    });

    rl.on("close", () => {
        // Piped stdin emits `close` right after the last line, while requests are
        // still in flight; let the queue drain before exiting.
        inputClosed = true;
        queue = queue.then(() => {
            if (inputClosed) finish();
        });
    });

    prompt();
}
