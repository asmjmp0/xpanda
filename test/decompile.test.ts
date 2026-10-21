import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";
import * as crypto from "crypto";
import { PandaFile } from "../src/file/PandaFile";
import { PandaDecompiler } from "../src/PandaDecompiler";
import { NodeFactory } from "../src/ast/NodeFactory";

/**
 * 集成测试:
 *   1. 反编译 test/resources/*.abc;
 *   2. 与 test/expected/*.js 快照逐字比较;
 *   3. 校验输出可被 Babel 再次解析;
 *   4. 执行两个样本,确认输出行为符合预期。
 */

interface Sample {
    abc: string;
    expected: string;
    verify?: (code: string) => void;
}

function decompileSample(abcPath: string): { code: string; classes: number } {
    const data = new Uint8Array(fs.readFileSync(abcPath));
    const pandaFile = new PandaFile(data);
    pandaFile.parseAssembly();

    const decompiler = new PandaDecompiler();
    const parts: string[] = [];
    let classes = 0;
    for (const cls of pandaFile.getAllClasses()) {
        const js = decompiler.decompileClass(cls);
        if (js.length > 0) {
            parts.push(js);
            classes++;
        }
    }
    return { code: parts.join("\n"), classes };
}

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

function runInSandbox(code: string): string[] {
    const logs: string[] = [];
    const sandbox = {
        console: {
            log: (...args: unknown[]) => logs.push(args.map((arg) => String(arg)).join(" ")),
        },
    };
    (sandbox as any).globalThis = sandbox;
    vm.runInNewContext(code, sandbox, { timeout: 5000 });
    return logs;
}

function verifyMd5(code: string): void {
    const logs = runInSandbox(code);
    const expected = crypto.createHash("md5").update("admin").digest("hex");
    const output = logs.join("\n");
    if (!output.includes(expected)) {
        throw new Error(`md5 执行结果不正确,期望包含 ${expected},实际输出:\n${output}`);
    }
}

function verifyClass(code: string): void {
    const logs = runInSandbox(code);
    if (!logs.some((line) => line.includes("123"))) {
        throw new Error(`class 执行结果不正确,期望输出包含 123,实际输出:\n${logs.join("\n")}`);
    }
}

function main(): void {
    const samples: Sample[] = [
        { abc: "md5.abc", expected: "md5.js", verify: verifyMd5 },
        { abc: "class.abc", expected: "class.js", verify: verifyClass },
    ];

    for (const sample of samples) {
        console.log(`[test] ${sample.abc}`);
        const { code, classes } = decompileSample(
            path.join(__dirname, "resources", sample.abc),
        );
        if (classes === 0) throw new Error(`${sample.abc}: 没有反编译出任何类`);

        const expectedPath = path.join(__dirname, "expected", sample.expected);
        const expected = fs.readFileSync(expectedPath, "utf-8");
        if (code !== expected) {
            throw new Error(
                `${sample.abc}: 输出与快照 ${sample.expected} 不一致\n${firstDifference(expected, code)}`,
            );
        }

        // 快照必须能被 Babel 再次解析
        NodeFactory.parse(code);
        sample.verify?.(code);
        console.log(`    ok (${classes} classes, ${code.length} chars)`);
    }

    console.log("ALL TESTS PASSED");
}

main();
