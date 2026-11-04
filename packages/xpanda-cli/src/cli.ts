import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
    ENTRY_FUNCTION_MAIN,
    HapFile,
    PandaClass,
    PandaDecompiler,
    PandaFile,
    ResourceIndexFile,
    ZipFile,
} from "xpanda-core";
import { PandaPatchFile } from "xpanda-asm";
import { saveClassFile } from "./io";
import { decompileClassesParallel, resolveJobs } from "./parallel/ParallelDecompiler";
import { DecompileProgress } from "./progress";

/** Old-space cap for the decompile process, in MiB (8 GiB). */
const CLI_HEAP_MB = 8 * 1024;

/**
 * `--max-old-space-size` is applied only at process start. Re-exec once when
 * the caller did not set it, so `yarn xpanda` and `yarn tsx .../cli.ts` both
 * get an 8 GiB heap. An explicit flag, including one from NODE_OPTIONS, wins.
 */
function hasHeapFlag(args: readonly string[]): boolean {
    return args.some((arg) => arg === "--max-old-space-size" || arg.startsWith("--max-old-space-size="));
}

/** NODE_OPTIONS is applied by Node but is not copied into process.execArgv. */
function nodeOptionsArgs(options: string | undefined): string[] {
    if (!options) return [];
    return options.match(/"[^"]*"|'[^']*'|\S+/g)?.map((arg) => arg.replace(/^['"]|['"]$/g, "")) ?? [];
}

function ensureCliHeap(): void {
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

ensureCliHeap();

/**
 * CLI 入口
 *   yarn tsx src/cli.ts help [decompile|unpack-index|dump-asm]
 *   yarn tsx src/cli.ts decompile <file.abc|file.hap> [-o outDir] [--no-simplify] [--raw] [--stdout] [--quiet] [-j N] [--timeout SEC]
 *   yarn tsx src/cli.ts unpack-index <resources.index> [-o outDir] [--stdout]
 *   yarn tsx src/cli.ts dump-asm <file.abc|file.hap> [-o outDir] [--stdout]
 *   yarn tsx src/cli.ts dump <file.abc|file.hap> -c <class> [-c ...] [-o out.abc|outDir]
 * @Author: jmp0 */
function printDecompileUsage(): void {
    console.log("Usage: xpanda decompile <file.abc|file.hap> [-o outDir] [--no-simplify] [--stdout] [--quiet] [-j N] [--timeout SEC]");
    console.log("  file.hap         HarmonyOS app package: decompiles every .abc entry and unpacks resources.index plus resources/ files");
    console.log("  -o outDir        Writes .js files named by class (default out/; in hap mode abc entries go to outDir/<entry path>/)");
    console.log("  --no-simplify    Disables the optimizer (skips the simplify stage, same as --raw)");
    console.log("  --stdout         Concatenates the result to standard output");
    console.log("  --quiet          Hides the progress view (class total, current class, simplify workers)");
    console.log("  -j, --jobs N     Worker count for per-class parallel simplify; 0 = auto (CPU-1, capped at 4)");
    console.log("  --timeout SEC    Stop simplify after SEC seconds and keep that class's raw output. Warns at the end. 0 disables");
}

function printUnpackIndexUsage(): void {
    console.log("Usage: xpanda unpack-index <resources.index> [-o outDir] [--stdout]");
    console.log("  Unpacks a HarmonyOS resources.index (supports both Restool and RestoolV2 formats)");
    console.log("  -o outDir        Writes resources.json (default out/)");
    console.log("  --stdout         Prints the JSON to standard output");
}

function printDumpAsmUsage(): void {
    console.log("Usage: xpanda dump-asm <file.abc|file.hap> [-o outDir] [--stdout]");
    console.log("  Disassembles every class to bytecode assembly (.asm files, same per-class layout as decompile)");
    console.log("  file.hap         HarmonyOS app package: dumps every .abc entry (to outDir/<entry path>/)");
    console.log("  -o outDir        Writes .asm files named by class (default out/)");
    console.log("  --stdout         Concatenates the result to standard output");
}

function printDumpUsage(): void {
    console.log("Usage: xpanda dump <file.abc|file.hap> -c <class> [-c <class> ...] [-o out.abc|outDir]");
    console.log("  Copies one or more classes (plus the classes/methods they reference) into a new .abc file");
    console.log("  -c, --class NAME  Class to dump: Lpkg/Name;, pkg/Name, or a unique name suffix; repeatable or comma-separated");
    console.log("  -o PATH           .abc input: output file (default dump.abc); .hap input: output directory (default out/)");
    console.log("                    A hap writes one <entry>.dump.abc per .abc entry that contains matching classes");
}

/** Print usage for one command, or all commands when no (known) topic given. */
function help(command?: string): void {
    if (command === "decompile") return printDecompileUsage();
    if (command === "unpack-index") return printUnpackIndexUsage();
    if (command === "dump-asm") return printDumpAsmUsage();
    if (command === "dump") return printDumpUsage();
    if (command !== undefined) console.error(`Unknown help topic: ${command} (available: decompile | unpack-index | dump-asm | dump)`);
    printDecompileUsage();
    printUnpackIndexUsage();
    printDumpAsmUsage();
    printDumpUsage();
}

/** Command parse failure: print the reason plus usage, then exit non-zero. */
function fail(message: string, command?: string): never {
    console.error(message);
    help(command);
    process.exit(1);
}

/** resources.index → 可序列化摘要(unpack-index 与 hap 模式共用) */
function resourcesIndexToJson(data: Uint8Array): { indexFile: ResourceIndexFile; json: any } {
    const indexFile = new ResourceIndexFile(data);
    const json = {
        version: indexFile.version,
        isNewModule: indexFile.isNewModule,
        count: indexFile.items.length,
        items: indexFile.items.map((item) => ({
            id: "0x" + item.id.toString(16).padStart(8, "0"),
            name: item.name,
            type: item.typeName,
            limitKey: item.limitKey,
            value: item.value,
        })),
    };
    return { indexFile, json };
}

function unpackIndex(args: string[]): void {
    if (args.length < 1) fail("unpack-index: missing <resources.index> file argument", "unpack-index");
    const input = args[0];
    let outDir = "out";
    let stdout = false;
    for (let i = 1; i < args.length; i++) {
        if (args[i] === "-o") {
            const value = args[++i];
            if (value === undefined) fail("option -o requires a value", "unpack-index");
            outDir = value;
        }
        else if (args[i] === "--stdout") stdout = true;
        else fail(`unknown argument: ${args[i]}`, "unpack-index");
    }
    const data = new Uint8Array(fs.readFileSync(path.resolve(input)));
    const { indexFile, json } = resourcesIndexToJson(data);
    const text = JSON.stringify(json, null, 2);
    if (stdout) {
        console.log(text);
        return;
    }
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, "resources.json");
    fs.writeFileSync(outPath, text);
    console.error(`version: ${indexFile.version} (${indexFile.isNewModule ? "RestoolV2" : "Restool"} format)`);
    console.error(`items: ${indexFile.items.length}`);
    const byLimit = new Map<string, number>();
    for (const item of indexFile.items) byLimit.set(item.limitKey, (byLimit.get(item.limitKey) ?? 0) + 1);
    for (const [limitKey, count] of byLimit) console.error(`  ${limitKey}: ${count}`);
    console.log("written: " + outPath);
}

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
 * 反编译一个 abc 的全部类,类文件落盘到 classOutDir,返回按类序拼接的输出段(--stdout 用)。
 * abc 模式与 hap 模式共用该流程。
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
    // 只有 --stdout 需要按类序攒全文。落盘后的源码再留在这个数组里,大包会把已写盘的结果一直留到进程结束。
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
        // 交互进度面板占着终端;逐类 written 会把它冲掉
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

/** 反编译 HAP 应用包:解出全部 .abc 条目逐个反编译,并解包 resources.index */
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
        // ets/modules.abc → outDir/ets/modules/<类路径>.js
        const classOutDir = path.join(options.outDir, entry.name.replace(/\.abc$/i, ""));
        console.error(`hap: decompile ${entry.name} (${entry.uncompressedSize} bytes)`);
        const outs = await decompileAbcData(decompiler, entry.read(), options, classOutDir, entry.name);
        allOutputs.push(...outs);
    }
    // resources.index → outDir/resources.json;resources/ 资源文件按包内相对路径落盘(--stdout 模式不落盘)
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
            if (!path.resolve(outPath).startsWith(outRoot)) continue; // 防包内异常条目名路径穿越
            fs.mkdirSync(path.dirname(outPath), { recursive: true });
            fs.writeFileSync(outPath, entry.read());
            console.log("written: " + outPath);
        }
    }
    return allOutputs;
}

interface AsmOptions {
    outDir: string;
    stdout: boolean;
}

/** 反汇编单个类:每个方法一节,输出方法头信息 + CFG 基本块与指令 */
function dumpClassAsm(pandaClass: PandaClass): string {
    const builder: string[] = [];
    builder.push("// class: " + pandaClass.name.content + "\n");
    builder.push("// methods: " + pandaClass.pandaMethods.size + "\n");
    for (const method of pandaClass.pandaMethods.values()) {
        builder.push("\n.function " + method.name.content + "\n");
        if (method.methodExternal || !method.methodCode) {
            builder.push("  (external)\n");
            continue;
        }
        const code = method.methodCode;
        builder.push(`  // vregs: ${code.numVregs}, args: ${code.numArgs}, code: ${code.codeSize} bytes, tries: ${code.triesSize}\n`);
        try {
            const cfg = method.disAssemble();
            if (cfg) builder.push(cfg.toString());
        } catch (e) {
            // 单方法反汇编失败(如未识别的 opcode)不中断整体
            builder.push("  // disassembly failed: " + e + "\n");
        }
    }
    return builder.join("");
}

/** 反汇编一个 abc 的全部类,.asm 文件落盘到 classOutDir,返回按类序拼接的输出段(--stdout 用) */
function dumpAsmAbcData(data: Uint8Array, options: AsmOptions, classOutDir: string): string[] {
    const pandaFile = new PandaFile(data);
    const classes = pandaFile.getAllClasses();
    if (!options.stdout) fs.mkdirSync(classOutDir, { recursive: true });
    console.error(`classes: ${classes.length}`);
    const outputs: string[] = [];
    for (const clazz of classes) {
        const text = dumpClassAsm(clazz);
        if (text.length === 0) continue;
        if (options.stdout) {
            outputs.push("\n/***************************" + clazz.name.content + "*************************************/\n" + text);
        } else {
            saveClassFile(classOutDir, clazz, text, ".asm");
            console.log("written: " + clazz.name.content);
        }
    }
    return outputs;
}

/** 反汇编 HAP 应用包:解出全部 .abc 条目逐个反汇编 */
function dumpAsmHap(data: Uint8Array, options: AsmOptions): string[] {
    const hap = new HapFile(data);
    const abcEntries = hap.getAbcEntries();
    if (abcEntries.length === 0) throw new Error("hap: no .abc entry found");
    const allOutputs: string[] = [];
    for (const entry of abcEntries) {
        // ets/modules.abc → outDir/ets/modules/<类路径>.asm
        const classOutDir = path.join(options.outDir, entry.name.replace(/\.abc$/i, ""));
        console.error(`hap: dump-asm ${entry.name} (${entry.uncompressedSize} bytes)`);
        allOutputs.push(...dumpAsmAbcData(entry.read(), options, classOutDir));
    }
    return allOutputs;
}

function dumpAsm(args: string[]): void {
    if (args.length < 1) fail("dump-asm: missing <file.abc|file.hap> file argument", "dump-asm");
    const input = args[0];
    let outDir = "out";
    let stdout = false;
    for (let i = 1; i < args.length; i++) {
        if (args[i] === "-o") {
            const value = args[++i];
            if (value === undefined) fail("option -o requires a value", "dump-asm");
            outDir = value;
        }
        else if (args[i] === "--stdout") stdout = true;
        else fail(`unknown argument: ${args[i]}`, "dump-asm");
    }
    const data = new Uint8Array(fs.readFileSync(path.resolve(input)));
    const options: AsmOptions = { outDir, stdout };
    // .hap(或任意 ZIP 容器)走应用包解包流程,否则按裸 abc 处理(与 decompile 一致)
    const outputs = path.extname(input).toLowerCase() === ".hap" || ZipFile.isZip(data)
        ? dumpAsmHap(data, options)
        : dumpAsmAbcData(data, options, outDir);
    if (stdout) console.log(outputs.map((out) => out + "\n").join(""));
}

/** Class-name query matching for `dump`: exact raw name, exact demangled name, then suffix/substring. */
function matchDumpClasses(pf: PandaFile, query: string): PandaClass[] {
    const all = pf.getAllClasses().filter((clazz) => !clazz.classExternal && clazz.name.content.length > 0);
    const strip = (name: string): string => name.replace(/^L/, "").replace(/;$/, "");
    const normalized = strip(query);
    const exact = all.filter((clazz) => clazz.name.content === query);
    if (exact.length > 0) return exact;
    const demangled = all.filter((clazz) => strip(clazz.name.content) === normalized);
    if (demangled.length > 0) return demangled;
    const suffix = all.filter((clazz) => {
        const name = strip(clazz.name.content);
        return name.endsWith("/" + normalized) || name === normalized;
    });
    if (suffix.length > 0) return suffix;
    return all.filter((clazz) => clazz.name.content.includes(query) || strip(clazz.name.content).includes(normalized));
}

function resolveDumpClasses(pf: PandaFile, queries: string[], source: string): string[] {
    const names: string[] = [];
    for (const query of queries) {
        const matches = matchDumpClasses(pf, query);
        if (matches.length === 0) fail(`dump: class not found in ${source}: ${query}`, "dump");
        if (matches.length > 1) {
            const candidates = matches.slice(0, 10).map((clazz) => clazz.name.content).join(", ");
            fail(`dump: ambiguous class ${query} in ${source}: ${candidates}`, "dump");
        }
        const name = matches[0].name.content;
        if (!names.includes(name)) names.push(name);
    }
    return names;
}

/** Prefer a repository-relative path for logs, but keep an absolute path when it is outside cwd. */
function displayPath(outPath: string): string {
    const relative = path.relative(process.cwd(), outPath);
    return relative.length > 0 && !relative.startsWith("..") ? relative : outPath;
}

/** Dump selected classes from one abc to a single new abc file. */
function dumpAbcData(data: Uint8Array, queries: string[], output: string, source: string): void {
    const pandaFile = new PandaFile(data);
    const names = resolveDumpClasses(pandaFile, queries, source);
    const result = PandaPatchFile.load(data).dumpClasses(names);
    const outPath = path.resolve(output);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, result.data);
    const extra = result.dependencies.length > 0 ? `, ${result.dependencies.length} referenced classes` : "";
    console.log(`written: ${displayPath(outPath)} (${result.classes.length} classes${extra})`);
}

/** Dump selected classes from a hap: one output abc per .abc entry that contains matches. */
function dumpHapData(data: Uint8Array, queries: string[], output: string): void {
    const hap = new HapFile(data);
    const entries = hap.getAbcEntries();
    if (entries.length === 0) fail("dump: no .abc entry found in hap", "dump");
    const fileOutput = output.toLowerCase().endsWith(".abc");
    const found = new Set<string>();
    const pending: Array<{ entryIndex: number; names: string[] }> = [];
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
        const entry = entries[entryIndex];
        const entryData = entry.read();
        const pandaFile = new PandaFile(entryData);
        const names: string[] = [];
        for (const query of queries) {
            const matches = matchDumpClasses(pandaFile, query);
            if (matches.length === 0) continue;
            if (matches.length > 1) {
                const candidates = matches.slice(0, 10).map((clazz) => clazz.name.content).join(", ");
                fail(`dump: ambiguous class ${query} in ${entry.name}: ${candidates}`, "dump");
            }
            found.add(query);
            if (!names.includes(matches[0].name.content)) names.push(matches[0].name.content);
        }
        if (names.length > 0) pending.push({ entryIndex, names });
    }
    const missing = queries.filter((query) => !found.has(query));
    if (missing.length > 0) fail(`dump: class not found in hap: ${missing.join(", ")}`, "dump");
    if (fileOutput && pending.length > 1) {
        fail("dump: multiple hap .abc entries contain matching classes; pass a directory for -o", "dump");
    }
    for (const item of pending) {
        const entry = entries[item.entryIndex];
        const outPath = fileOutput
            ? path.resolve(output)
            : path.resolve(output, entry.name.replace(/\.abc$/i, "") + ".dump.abc");
        const result = PandaPatchFile.load(entry.read()).dumpClasses(item.names);
        if (!fileOutput) {
            const root = path.resolve(output) + path.sep;
            if (!outPath.startsWith(root)) fail(`dump: unsafe hap entry name: ${entry.name}`, "dump");
        }
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, result.data);
        const extra = result.dependencies.length > 0 ? `, ${result.dependencies.length} referenced classes` : "";
        console.log(`written: ${displayPath(outPath)} (${result.classes.length} classes${extra})`);
    }
}

function dump(args: string[]): void {
    if (args.length < 1) fail("dump: missing <file.abc|file.hap> file argument", "dump");
    const input = args[0];
    let output: string | null = null;
    const queries: string[] = [];
    const pushQuery = (value: string): void => {
        for (const part of value.split(",")) {
            const trimmed = part.trim();
            if (trimmed.length > 0) queries.push(trimmed);
        }
    };
    for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        if (arg === "-o" || arg === "--output") {
            const value = args[++i];
            if (value === undefined) fail("option " + arg + " requires a value", "dump");
            output = value;
        } else if (arg.startsWith("--output=")) {
            output = arg.substring("--output=".length);
        } else if (arg === "-c" || arg === "--class") {
            const value = args[++i];
            if (value === undefined) fail("option " + arg + " requires a value", "dump");
            pushQuery(value);
        } else if (arg.startsWith("--class=")) {
            pushQuery(arg.substring("--class=".length));
        } else if (arg.startsWith("-")) {
            fail(`unknown argument: ${arg}`, "dump");
        } else {
            // Positional class names are accepted as a convenience.
            pushQuery(arg);
        }
    }
    if (queries.length === 0) fail("dump: at least one -c/--class is required", "dump");

    const data = new Uint8Array(fs.readFileSync(path.resolve(input)));
    const hapInput = path.extname(input).toLowerCase() === ".hap" || ZipFile.isZip(data);
    const resolvedOutput = output ?? (hapInput ? "out" : "dump.abc");
    if (hapInput) {
        dumpHapData(data, queries, resolvedOutput);
        return;
    }
    let outFile = resolvedOutput;
    try {
        if (fs.statSync(outFile).isDirectory()) outFile = path.join(outFile, "dump.abc");
    } catch {
        // Not an existing path; treat it as a file name.
    }
    if (outFile.endsWith("/") || outFile.endsWith(path.sep)) outFile = path.join(outFile, "dump.abc");
    dumpAbcData(data, queries, outFile, input);
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    // help 命令(无参数时等价于 help):打印用法后正常退出
    if (args.length === 0 || args[0] === "help" || args[0] === "-h" || args[0] === "--help") {
        help(args[1]);
        return;
    }
    if (args[0] === "unpack-index") {
        unpackIndex(args.slice(1));
        return;
    }
    if (args[0] === "dump-asm") {
        dumpAsm(args.slice(1));
        return;
    }
    if (args[0] === "dump") {
        dump(args.slice(1));
        return;
    }
    if (args[0] !== "decompile") fail(`unknown command: ${args[0]}`);
    if (args.length < 2) fail("decompile: missing <file.abc|file.hap> file argument", "decompile");
    const input = args[1];
    let outDir = "out";
    let raw = false;
    let stdout = false;
    let quiet = false;
    let jobsArg = 1;
    let simplifyTimeoutSec = 0;
    for (let i = 2; i < args.length; i++) {
        if (args[i] === "-o") {
            const value = args[++i];
            if (value === undefined) fail("option -o requires a value", "decompile");
            outDir = value;
        }
        else if (args[i] === "--raw" || args[i] === "--no-simplify") raw = true;
        else if (args[i] === "--stdout") stdout = true;
        else if (args[i] === "--quiet") quiet = true;
        else if (args[i] === "-j" || args[i] === "--jobs") {
            const value = Number(args[++i]);
            jobsArg = Number.isFinite(value) ? value : 1;
        }
        else if (args[i] === "--timeout") {
            const value = Number(args[++i]);
            if (!Number.isFinite(value) || value < 0) fail("option --timeout requires a non-negative number of seconds", "decompile");
            simplifyTimeoutSec = value;
        }
        else fail(`unknown argument: ${args[i]}`, "decompile");
    }
    const jobs = raw ? 1 : resolveJobs(jobsArg);
    const options: DecompileOptions = {
        outDir, raw, stdout, jobs,
        simplifyTimeoutSec: raw ? 0 : simplifyTimeoutSec,
        simplifyTimeouts: [],
        progress: new DecompileProgress(!quiet),
    };

    // --quiet:静默 simplify 内部的过程日志
    const originalLog = console.log;
    if (quiet) console.log = () => {};

    const data = new Uint8Array(fs.readFileSync(path.resolve(input)));
    const decompiler = new PandaDecompiler();
    // .hap(或任意 ZIP 容器)走应用包解包流程,否则按裸 abc 处理
    const outputs = path.extname(input).toLowerCase() === ".hap" || ZipFile.isZip(data)
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

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
