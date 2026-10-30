import * as fs from "fs";
import * as path from "path";
import {
    HapFile,
    PandaClass,
    PandaDecompiler,
    PandaFile,
    ResourceIndexFile,
    ZipFile,
} from "xpanda-core";
import { saveClassFile } from "./io";
import { decompileClassesParallel, resolveJobs } from "./parallel/ParallelDecompiler";

/**
 * CLI 入口
 *   yarn tsx src/cli.ts help [decompile|unpack-index|dump-asm]
 *   yarn tsx src/cli.ts decompile <file.abc|file.hap> [-o outDir] [--no-simplify] [--raw] [--stdout] [--quiet] [-j N]
 *   yarn tsx src/cli.ts unpack-index <resources.index> [-o outDir] [--stdout]
 *   yarn tsx src/cli.ts dump-asm <file.abc|file.hap> [-o outDir] [--stdout]
 * @Author: jmp0 */
function printDecompileUsage(): void {
    console.log("Usage: xpanda decompile <file.abc|file.hap> [-o outDir] [--no-simplify] [--stdout] [--quiet] [-j N]");
    console.log("  file.hap         HarmonyOS app package: decompiles every .abc entry and unpacks resources.index plus resources/ files");
    console.log("  -o outDir        Writes .js files named by class (default out/; in hap mode abc entries go to outDir/<entry path>/)");
    console.log("  --no-simplify    Disables the optimizer (skips the simplify stage, same as --raw)");
    console.log("  --stdout         Concatenates the result to standard output");
    console.log("  --quiet          Suppresses decompilation progress logs");
    console.log("  -j, --jobs N     Worker count for per-class parallel simplify; 0 = auto (CPU-1, capped at 4)");
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

/** Print usage for one command, or all commands when no (known) topic given. */
function help(command?: string): void {
    if (command === "decompile") return printDecompileUsage();
    if (command === "unpack-index") return printUnpackIndexUsage();
    if (command === "dump-asm") return printDumpAsmUsage();
    if (command !== undefined) console.error(`Unknown help topic: ${command} (available: decompile | unpack-index | dump-asm)`);
    printDecompileUsage();
    printUnpackIndexUsage();
    printDumpAsmUsage();
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

interface DecompileOptions {
    outDir: string;
    raw: boolean;
    stdout: boolean;
    jobs: number;
}

/**
 * 反编译一个 abc 的全部类,类文件落盘到 classOutDir,返回按类序拼接的输出段(--stdout 用)。
 * abc 模式与 hap 模式共用该流程。
 */
async function decompileAbcData(decompiler: PandaDecompiler, data: Uint8Array, options: DecompileOptions, classOutDir: string): Promise<string[]> {
    const pandaFile = new PandaFile(data);
    const classes = pandaFile.getAllClasses();
    if (!options.stdout) fs.mkdirSync(classOutDir, { recursive: true });
    // 进度/配置信息走 stderr,避免污染 --stdout 的源码输出
    if (options.jobs > 1) console.error("parallel simplify jobs: " + options.jobs);

    // 按类序保存输出,保证 --stdout 与文件内容不受完成顺序影响
    const outputs: Array<string | undefined> = new Array(classes.length);
    const emit = (index: number, content: string): void => {
        if (content.length === 0) return;
        const clazz = classes[index];
        outputs[index] = "\n/***************************" + clazz.name.content + "*************************************\n" + content;
        if (!options.stdout) {
            saveClassFile(classOutDir, clazz, content);
            console.log("written: " + clazz.name.content);
        }
    };

    if (options.jobs > 1) {
        await decompileClassesParallel(decompiler, classes, {
            jobs: options.jobs,
            onClassDone: ({ index, content }) => emit(index, content),
            onWarning: (message) => console.error(message),
        });
    } else {
        for (let i = 0; i < classes.length; i++) {
            try {
                emit(i, options.raw ? decompiler.decompileClassRaw(classes[i]) : decompiler.decompileClass(classes[i]));
            } catch (e) {
                // 单类反编译失败不中断整体
                console.error("decompile failed: " + classes[i].name.content + " " + e);
            }
        }
    }
    return outputs.filter((out): out is string => out !== undefined);
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
        const outs = await decompileAbcData(decompiler, entry.read(), options, classOutDir);
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
    if (args[0] !== "decompile") fail(`unknown command: ${args[0]}`);
    if (args.length < 2) fail("decompile: missing <file.abc|file.hap> file argument", "decompile");
    const input = args[1];
    let outDir = "out";
    let raw = false;
    let stdout = false;
    let quiet = false;
    let jobsArg = 1;
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
        else fail(`unknown argument: ${args[i]}`, "decompile");
    }
    const jobs = raw ? 1 : resolveJobs(jobsArg);
    const options: DecompileOptions = { outDir, raw, stdout, jobs };

    // --quiet:静默 simplify 内部的过程日志
    const originalLog = console.log;
    if (quiet) console.log = () => {};

    const data = new Uint8Array(fs.readFileSync(path.resolve(input)));
    const decompiler = new PandaDecompiler();
    // .hap(或任意 ZIP 容器)走应用包解包流程,否则按裸 abc 处理
    const outputs = path.extname(input).toLowerCase() === ".hap" || ZipFile.isZip(data)
        ? await decompileHap(decompiler, data, options)
        : await decompileAbcData(decompiler, data, options, outDir);

    if (quiet) console.log = originalLog;
    if (stdout) {
        originalLog(outputs.map((out) => out + "\n").join(""));
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
