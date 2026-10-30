/**
 * xpanda-cli 测试:按类并行反编译(parallel worker 池随 cli 实现,core 不含)。
 *   1. 单类输出与处理顺序/worker 数量无关(生成名计数器按类复位);
 *   2. worker 与主线程简化器结果一致。
 *
 * 运行:yarn tsx test/parallel-consistency.test.ts(core 测试样本经相对路径引用)
 * @Author: jmp0
 */
import * as fs from "fs";
import * as path from "path";
import { ENTRY_FUNCTION_MAIN, HapFile, PandaDecompiler, PandaFile } from "xpanda-core";
import { decompileClassesParallel } from "../src/parallel/ParallelDecompiler";

function firstDifference(expected: string, actual: string): string {
    const expectedLines = expected.split("\n");
    const actualLines = actual.split("\n");
    const length = Math.max(expectedLines.length, actualLines.length);
    for (let i = 0; i < length; i++) {
        if (expectedLines[i] !== actualLines[i]) {
            return [
                `line ${i + 1}:`,
                `  expected: ${expectedLines[i] ?? "<EOF>"}`,
                `  actual:   ${actualLines[i] ?? "<EOF>"}`,
            ].join("\n");
        }
    }
    return "";
}

async function verifyParallelDeterminism(): Promise<void> {
    const hapPath = path.join(__dirname, "..", "..", "xpanda-core", "test", "resources", "zhihupp0.59.hap");
    const hap = new HapFile(new Uint8Array(fs.readFileSync(hapPath)));
    const pandaFile = new PandaFile(hap.readEntry("ets/modules.abc")!);
    const small = pandaFile.getAllClasses()
        .filter((clazz) => clazz.pandaMethods.has(ENTRY_FUNCTION_MAIN))
        .filter((clazz) => {
            let bytes = 0;
            for (const method of clazz.pandaMethods.values()) bytes += method.methodCode?.codeSize ?? 0;
            return bytes > 200 && bytes < 3000;
        })
        .slice(0, 4);
    if (small.length < 2) throw new Error("zhihupp0.59.hap: 小类样本不足,无法验证并行一致性");

    const serial = new PandaDecompiler();
    const expected = small.map((clazz) => serial.decompileClass(clazz));
    const parallel = await decompileClassesParallel(new PandaDecompiler(), small, { jobs: 2 });

    for (let i = 0; i < small.length; i++) {
        const actual = parallel[i] ?? "";
        if (actual !== expected[i]) {
            throw new Error(`并行/串行结果不一致: ${small[i].name.content}\n${firstDifference(expected[i], actual)}`);
        }
    }
}

verifyParallelDeterminism().then(() => {
    console.log("[cli-test] parallel determinism (worker_threads) ok");
}, (e) => {
    console.error(e);
    process.exitCode = 1;
});
