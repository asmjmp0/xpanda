/**
 * `xpanda decompile`: decompile .abc / .hap to per-class .js files.
 * @Author: jmp0
 */
import * as fs from "fs";
import * as path from "path";
import {
    ENTRY_FUNCTION_MAIN,
    HapFile,
    PandaDecompiler,
    PandaFile,
} from "xpanda-core";
import { saveClassFile } from "../../io";
import { decompileClassesParallel, resolveJobs } from "../../parallel/ParallelDecompiler";
import { DecompileProgress } from "../../progress";
import { takeValue } from "../args";
import { fail } from "../help";
import { isHapInput, readInputBytes } from "../input";
import { resourcesIndexToJson } from "../resources";

interface SimplifyTimeout {
    label: string;
    className: string;
}

interface DecompileOptions {
    outDir: string;
    raw: boolean;
    stdout: boolean;
    jobs: number;
    /** 0 表示不限制 simplify 时长 */
    simplifyTimeoutSec: number;
    simplifyTimeouts: SimplifyTimeout[];
    progress: DecompileProgress;
}

/**
 * Decompile every class of one abc into classOutDir; returns the ordered output
 * segments for --stdout. Shared by abc mode and hap mode.
 */
async function decompileAbcData(
    decompiler: PandaDecompiler,
    data: Uint8Array,
    options: DecompileOptions,
    classOutDir: string,
    label: string,
): Promise<string[]> {
    const pandaFile = new PandaFile(data);
    const classes = pandaFile.getAllClasses();
    if (!options.stdout) fs.mkdirSync(classOutDir, { recursive: true });

    const targets = classes
        .map((clazz, index) => ({ clazz, index }))
        .filter(({ clazz }) => clazz.pandaMethods.has(ENTRY_FUNCTION_MAIN));
    // Only --stdout needs the full concatenation; keeping written sources alive would
    // pin every class of a large package until exit.
    const outputs: Array<string | undefined> | null = options.stdout ? new Array(classes.length) : null;
    let written = 0;
    const emit = (index: number, content: string): void => {
        if (content.length === 0) return;
        const clazz = classes[index];
        if (outputs) {
            outputs[index] = "\n/***************************" + clazz.name.content + "*************************************\n" + content;
            return;
        }
        saveClassFile(classOutDir, clazz, content);
        written++;
        // A live progress panel owns the terminal; per-class lines would overwrite it.
        if (!options.progress.live) console.log("written: " + clazz.name.content);
    };

    const noun = targets.length === 1 ? "class" : "classes";
    const summary = (): string => options.stdout
        ? `${label}  ${targets.length} ${noun}`
        : `${label}  ${targets.length} ${noun}, ${written} written  →  ${classOutDir}`;
    if (targets.length === 0) {
        options.progress.finish(summary());
        return [];
    }

    const slots = !options.raw && options.jobs > 1 && targets.length > 1
        ? Math.min(options.jobs, targets.length)
        : 0;
    options.progress.begin(label, targets.length, slots, !options.raw);
    try {
        if (options.raw) {
            for (const target of targets) {
                options.progress.setDecompiling(target.clazz.name.content);
                try {
                    emit(target.index, decompiler.decompileClassRaw(target.clazz));
                } catch (e) {
                    options.progress.note("decompile failed: " + target.clazz.name.content + " " + e);
                } finally {
                    options.progress.setDecompiling(null);
                    options.progress.markDone();
                }
            }
        } else {
            await decompileClassesParallel(decompiler, classes, {
                jobs: options.jobs,
                simplifyTimeoutMs: Math.round(options.simplifyTimeoutSec * 1000),
                onDecompileStart: (name) => options.progress.setDecompiling(name),
                onDecompileEnd: () => options.progress.setDecompiling(null),
                onSimplifyStart: (slot, name) => options.progress.setWorker(slot, name),
                onSimplifyEnd: (slot) => options.progress.setWorker(slot, null),
                onClassSettled: () => options.progress.markDone(),
                onQueueChange: (queued) => options.progress.setQueued(queued),
                onClassDone: ({ index, content }) => emit(index, content),
                onSimplifyTimeout: (className) => options.simplifyTimeouts.push({ label, className }),
                onWarning: (message) => options.progress.note(message),
            });
        }
    } finally {
        options.progress.finish(summary());
    }
    return outputs ? outputs.filter((out): out is string => out !== undefined) : [];
}

/** Decompile a HAP: every .abc entry, plus resources.index and resources/ files. */
async function decompileHap(decompiler: PandaDecompiler, data: Uint8Array, options: DecompileOptions): Promise<string[]> {
    const hap = new HapFile(data);
    const moduleJson = hap.getModuleJson();
    if (moduleJson) {
        const app = moduleJson.app ?? {};
        const module = moduleJson.module ?? {};
        console.error(`hap: bundle=${app.bundleName ?? "?"} module=${module.name ?? "?"} version=${app.versionName ?? "?"} bytecode=${module.virtualMachine ?? "?"}`);
    }
    const abcEntries = hap.getAbcEntries();
    if (abcEntries.length === 0) throw new Error("hap: no .abc entry found");
    const allOutputs: string[] = [];
    for (const entry of abcEntries) {
        // ets/modules.abc → outDir/ets/modules/<class path>.js
        const classOutDir = path.join(options.outDir, entry.name.replace(/\.abc$/i, ""));
        console.error(`hap: decompile ${entry.name} (${entry.uncompressedSize} bytes)`);
        const outs = await decompileAbcData(decompiler, entry.read(), options, classOutDir, entry.name);
        allOutputs.push(...outs);
    }
    // resources.index → outDir/resources.json; resources/ files keep their in-package paths.
    if (!options.stdout) {
        const indexData = hap.getResourcesIndexData();
        if (indexData) {
            fs.mkdirSync(options.outDir, { recursive: true });
            const outPath = path.join(options.outDir, "resources.json");
            fs.writeFileSync(outPath, JSON.stringify(resourcesIndexToJson(indexData).json, null, 2));
            console.log("written: " + outPath);
        }
        const outRoot = path.resolve(options.outDir) + path.sep;
        for (const entry of hap.getResourceEntries()) {
            const outPath = path.join(options.outDir, entry.name);
            if (!path.resolve(outPath).startsWith(outRoot)) continue; // guard against path traversal in entry names
            fs.mkdirSync(path.dirname(outPath), { recursive: true });
            fs.writeFileSync(outPath, entry.read());
            console.log("written: " + outPath);
        }
    }
    return allOutputs;
}

export async function runDecompile(args: string[]): Promise<void> {
    if (args.length < 1) fail("decompile: missing <file.abc|file.hap> file argument", "decompile");
    const input = args[0];
    let outDir = "out";
    let raw = false;
    let stdout = false;
    let quiet = false;
    let jobsArg = 1;
    let simplifyTimeoutSec = 0;
    for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        if (arg === "-o") {
            const parsed = takeValue(args, i, arg, "decompile");
            outDir = parsed.value;
            i = parsed.index;
        } else if (arg === "--raw" || arg === "--no-simplify") {
            raw = true;
        } else if (arg === "--stdout") {
            stdout = true;
        } else if (arg === "--quiet") {
            quiet = true;
        } else if (arg === "-j" || arg === "--jobs") {
            const parsed = takeValue(args, i, arg, "decompile");
            const value = Number(parsed.value);
            jobsArg = Number.isFinite(value) ? value : 1;
            i = parsed.index;
        } else if (arg === "--timeout") {
            const parsed = takeValue(args, i, arg, "decompile");
            const value = Number(parsed.value);
            if (!Number.isFinite(value) || value < 0) fail("option --timeout requires a non-negative number of seconds", "decompile");
            simplifyTimeoutSec = value;
            i = parsed.index;
        } else {
            fail(`unknown argument: ${arg}`, "decompile");
        }
    }
    const jobs = raw ? 1 : resolveJobs(jobsArg);
    const options: DecompileOptions = {
        outDir, raw, stdout, jobs,
        simplifyTimeoutSec: raw ? 0 : simplifyTimeoutSec,
        simplifyTimeouts: [],
        progress: new DecompileProgress(!quiet),
    };

    // --quiet: silence the simplify-internal progress logs
    const originalLog = console.log;
    if (quiet) console.log = () => {};

    const data = readInputBytes(input);
    const decompiler = new PandaDecompiler();
    const outputs = isHapInput(input, data)
        ? await decompileHap(decompiler, data, options)
        : await decompileAbcData(decompiler, data, options, outDir, path.basename(input));

    if (options.simplifyTimeouts.length > 0) {
        const seconds = simplifyTimeoutSec;
        console.error(`warn: simplify timed out after ${seconds}s, kept raw (${options.simplifyTimeouts.length}):`);
        for (const item of options.simplifyTimeouts) console.error(`  ${item.label}  ${item.className}`);
    }

    if (quiet) console.log = originalLog;
    if (stdout) {
        originalLog(outputs.map((out) => out + "\n").join(""));
    }
}
