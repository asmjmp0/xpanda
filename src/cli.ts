import * as fs from "fs";
import * as path from "path";
import { PandaFile } from "./file/PandaFile";
import { PandaDecompiler } from "./PandaDecompiler";
import { decompileClassesParallel, resolveJobs } from "./parallel/ParallelDecompiler";
import { ResourceIndexFile } from "./res/ResourceIndexFile";
import { HapFile } from "./hap/HapFile";
import { ZipFile } from "./hap/ZipFile";

/**
 * CLI 入口
 *   npx tsx src/cli.ts decompile <file.abc|file.hap> [-o outDir] [--no-simplify] [--raw] [--stdout] [--quiet] [-j N]
 *   npx tsx src/cli.ts unpack-index <resources.index> [-o outDir] [--stdout]
 * @Author: jmp0 */
function usage(): void {
    console.log("用法: xpanda decompile <file.abc|file.hap> [-o outDir] [--no-simplify] [--stdout] [--quiet] [-j N]");
    console.log("  file.hap         鸿蒙应用包:自动解出全部 .abc 反编译,并解包 resources.index 与 resources/ 资源文件");
    console.log("  -o outDir        按类名输出 .js 文件(默认 out/;hap 模式下 abc 条目输出到 outDir/<条目路径>/)");
    console.log("  --no-simplify    禁用优化器(跳过 simplify 阶段,等价于 --raw)");
    console.log("  --stdout         将结果拼接输出到标准输出");
    console.log("  --quiet          关闭反编译过程日志");
    console.log("  -j, --jobs N     按类并行 simplify 的 worker 数;0 = 自动(CPU-1,上限 4)");
    console.log("用法: xpanda unpack-index <resources.index> [-o outDir] [--stdout]");
    console.log("  解包鸿蒙 resources.index(兼容 Restool 与 RestoolV2 格式)");
    console.log("  -o outDir        输出 resources.json(默认 out/)");
    console.log("  --stdout         将 JSON 输出到标准输出");
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
    if (args.length < 1) {
        usage();
        process.exit(1);
        return;
    }
    const input = args[0];
    let outDir = "out";
    let stdout = false;
    for (let i = 1; i < args.length; i++) {
        if (args[i] === "-o") outDir = args[++i];
        else if (args[i] === "--stdout") stdout = true;
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
            PandaDecompiler.saveFile(classOutDir, clazz, content);
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

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    if (args.length >= 1 && args[0] === "unpack-index") {
        unpackIndex(args.slice(1));
        return;
    }
    if (args.length < 2 || args[0] !== "decompile") {
        usage();
        process.exit(args.length === 0 ? 0 : 1);
        return;
    }
    const input = args[1];
    let outDir = "out";
    let raw = false;
    let stdout = false;
    let quiet = false;
    let jobsArg = 1;
    for (let i = 2; i < args.length; i++) {
        if (args[i] === "-o") outDir = args[++i];
        else if (args[i] === "--raw" || args[i] === "--no-simplify") raw = true;
        else if (args[i] === "--stdout") stdout = true;
        else if (args[i] === "--quiet") quiet = true;
        else if (args[i] === "-j" || args[i] === "--jobs") {
            const value = Number(args[++i]);
            jobsArg = Number.isFinite(value) ? value : 1;
        }
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
