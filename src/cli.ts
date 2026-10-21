import * as fs from "fs";
import * as path from "path";
import { PandaFile } from "./file/PandaFile";
import { PandaDecompiler } from "./PandaDecompiler";

/**
 * CLI 入口
 *   npx tsx src/cli.ts decompile <file.abc> [-o outDir] [--no-simplify] [--raw] [--stdout] [--quiet]
 * @Author: jmp0
 */
function main(): void {
    const args = process.argv.slice(2);
    if (args.length < 2 || args[0] !== "decompile") {
        console.log("用法: xpanda decompile <file.abc> [-o outDir] [--no-simplify] [--stdout] [--quiet]");
        console.log("  -o outDir        按类名输出 .js 文件(默认 out/)");
        console.log("  --no-simplify    禁用优化器(跳过 simplify 阶段,等价于 --raw)");
        console.log("  --stdout         将结果拼接输出到标准输出");
        console.log("  --quiet          关闭反编译过程日志");
        process.exit(args.length === 0 ? 0 : 1);
        return;
    }
    const input = args[1];
    let outDir = "out";
    let raw = false;
    let stdout = false;
    let quiet = false;
    for (let i = 2; i < args.length; i++) {
        if (args[i] === "-o") outDir = args[++i];
        else if (args[i] === "--raw" || args[i] === "--no-simplify") raw = true;
        else if (args[i] === "--stdout") stdout = true;
        else if (args[i] === "--quiet") quiet = true;
    }

    // --quiet:静默 simplify 内部的过程日志
    const originalLog = console.log;
    if (quiet) console.log = () => {};

    const data = new Uint8Array(fs.readFileSync(path.resolve(input)));
    const pandaFile = new PandaFile(data);
    const decompiler = new PandaDecompiler();

    const results: string[] = [];
    if (!stdout) fs.mkdirSync(outDir, { recursive: true });
    for (const pandaClass of pandaFile.getAllClasses()) {
        const content = raw ? decompiler.decompileClassRaw(pandaClass) : decompiler.decompileClass(pandaClass);
        if (content.length === 0) continue;
        results.push("\n/***************************" + pandaClass.name.content + "*************************************/\n" + content);
        if (!stdout) {
            PandaDecompiler.saveFile(outDir, pandaClass, content);
            console.log("written: " + pandaClass.name.content);
        }
    }

    if (quiet) console.log = originalLog;
    if (stdout) {
        originalLog(results.map((r) => r + "\n").join(""));
    }
}

main();
