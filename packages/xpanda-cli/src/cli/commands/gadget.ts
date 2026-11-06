/**
 * `xpanda gadget`: inject xpanda-gadget into a .abc / .hap.
 *
 * abc input  -> writes <name>.gadget.abc next to the input (or to stdout).
 * hap input  -> writes <name>.gadget.hap: patched bytecode + embedded gadget .so
 *               (the repack drops the signature; re-sign before installing).
 * @Author: jmp0
 */
import * as path from "path";
import {
    DEFAULT_GADGET_PORT,
    GADGET_SO_NAME,
    InjectHapOptions,
    injectAbcBytes,
    injectHapBytes,
} from "xpanda-gadget";
import { takeValue } from "../args";
import { fail, printUsage } from "../help";
import { isHapInput, readInputBytes, writeBytesEnsured } from "../input";

export function runGadget(rawArgs: string[]): void {
    const args = [...rawArgs];
    // optional subcommand for CLI ergonomics: `xpanda gadget inject <file>`
    if (args[0] === "inject" || args[0] === "i") args.shift();
    if (args.length === 0) fail("gadget: missing <file.abc|file.hap> file argument", "gadget");
    if (args[0] === "-h" || args[0] === "--help") {
        printUsage("gadget");
        return;
    }

    const input = args[0];
    let outDir: string | null = null;
    let stdout = false;
    let quiet = false;
    const options: InjectHapOptions = {};
    for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        if (arg === "-o" || arg === "--output") {
            const parsed = takeValue(args, i, arg, "gadget");
            outDir = parsed.value;
            i = parsed.index;
        } else if (arg === "--stdout") {
            stdout = true;
        } else if (arg === "-q" || arg === "--quiet") {
            quiet = true;
        } else if (arg === "-h" || arg === "--help") {
            printUsage("gadget");
            return;
        } else if (arg === "--port") {
            const parsed = takeValue(args, i, arg, "gadget");
            const value = Number(parsed.value);
            if (!Number.isFinite(value) || value <= 0) fail("option --port requires a positive number", "gadget");
            options.port = value;
            i = parsed.index;
        } else if (arg === "--wait") {
            const parsed = takeValue(args, i, arg, "gadget");
            const value = Number(parsed.value);
            if (!Number.isFinite(value) || value < 0) {
                fail("option --wait requires a non-negative number of milliseconds", "gadget");
            }
            options.waitMs = Math.floor(value);
            i = parsed.index;
        } else if (arg === "--entry") {
            const parsed = takeValue(args, i, arg, "gadget");
            options.entryClass = parsed.value;
            i = parsed.index;
        } else if (arg === "--abc") {
            const parsed = takeValue(args, i, arg, "gadget");
            options.abcEntry = parsed.value;
            i = parsed.index;
        } else if (arg === "--all") {
            options.patchAllAbc = true;
        } else if (arg === "--abi") {
            const parsed = takeValue(args, i, arg, "gadget");
            options.abi = parsed.value;
            i = parsed.index;
        } else if (arg === "--so") {
            const parsed = takeValue(args, i, arg, "gadget");
            options.soPath = parsed.value;
            i = parsed.index;
        } else if (arg === "--so-name") {
            const parsed = takeValue(args, i, arg, "gadget");
            options.soName = parsed.value;
            i = parsed.index;
        } else if (arg === "--no-so") {
            options.noSo = true;
        } else if (arg === "--no-module-load") {
            options.moduleLoad = false;
        } else if (arg === "--keep-temp") {
            options.keepTemp = true;
        } else if (arg.startsWith("-")) {
            fail(`gadget: unknown option: ${arg}`, "gadget");
        } else {
            fail(`gadget: unexpected argument: ${arg}`, "gadget");
        }
    }

    options.es2abc = process.env.XPANDA_ES2ABC;
    const data = readInputBytes(input);
    const hapInput = isHapInput(input, data);

    let outputBytes: Uint8Array;
    let suffix: string;
    let summary: string;
    if (hapInput) {
        const result = injectHapBytes(data, options);
        outputBytes = result.data;
        suffix = ".gadget.hap";
        summary = [
            "HAP gadget injection complete:",
            ...result.patched.map((p) =>
                `  patched ${p.entryName}: entry=${p.entryClass} module=${p.moduleName} modules=${p.userModuleCount} instrumented=${p.moduleLoadCount}`),
            result.soEntryName
                ? `  embedded ${result.soEntryName} (${options.soPath ?? "prebuilt"})`
                : `  .so NOT embedded: ${result.soSkippedReason}`,
            `  wait: ${options.waitMs ?? 0} ms for a client`,
            `  size: ${result.inputSize} -> ${result.outputSize}`,
            "  note: the repacked HAP is unsigned; re-sign before installing.",
        ].join("\n");
    } else {
        const result = injectAbcBytes(data, options);
        outputBytes = result.data;
        suffix = ".gadget.abc";
        summary = [
            "abc gadget injection complete:",
            `  entry=${result.entryClass} module=${result.moduleName} port=${options.port ?? DEFAULT_GADGET_PORT} wait=${options.waitMs ?? 0}ms modules=${result.userModules.length} instrumented=${result.moduleLoad.patched}`,
            `  size: ${data.length} -> ${result.data.length}`,
            `  remember to place ${options.soName ?? GADGET_SO_NAME} in the HAP libs/<abi>/ directory.`,
        ].join("\n");
    }

    if (stdout) {
        process.stdout.write(outputBytes);
        return;
    }
    const parsedInput = path.parse(input);
    const outPath = path.join(outDir ?? parsedInput.dir, parsedInput.name + suffix);
    writeBytesEnsured(outPath, outputBytes);
    if (!quiet) {
        process.stdout.write(summary + "\n");
        process.stdout.write(`written: ${outPath}\n`);
    }
}
