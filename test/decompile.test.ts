import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";
import * as crypto from "crypto";
import { PandaFile, ENTRY_FUNCTION_MAIN } from "../src/file/PandaFile";
import { PandaDecompiler } from "../src/PandaDecompiler";
import { decompileClassesParallel } from "../src/parallel/ParallelDecompiler";
import { NodeFactory } from "../src/ast/NodeFactory";
import { SimplifyExport } from "../src/simplify/SimplifyExport";

/**
 * 集成测试:
 *   1. 反编译 test/resources/*.abc;
 *   2. 与 test/expected/*.js 快照逐字比较;
 *   3. 校验输出可被 Babel 再次解析;
 *   4. 执行样本,确认输出行为符合预期。
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

function verifyAes(code: string): void {
    const logs = runInSandbox(code);
    if (!logs.some((line) => line === "true")) {
        throw new Error(`aes 执行结果不正确,期望输出 true,实际输出:\n${logs.join("\n")}`);
    }
}

/**
 * 回归:活跃性分析必须以根节点就是标识符的读取为准。
 * 旧实现只从子节点收集读取名,`return acc;` 会被当成不读取 acc,
 * 前一条 `acc = new X(...)` 因而被误判为死存储,返回值丢失。
 */
function verifyReturnValueLiveness(): void {
    const program = NodeFactory.parse(`
function stringToUint8Array(p0) {
  let v4, acc;
  v4 = [];
  for (let i = 0; i < p0.length; i += 1) {
    acc = p0.charCodeAt(i);
    v4.push(acc);
  }
  acc = new Uint8Array(v4);
  return acc;
}
`);
    SimplifyExport.simplify(program);
    const code = NodeFactory.generate(program);
    if (!code.includes("return new Uint8Array(v4)")) {
        throw new Error(`simplify: return 的构造结果被丢弃\n${code}`);
    }
}

/**
 * 回归:ArkCompiler 经 acc 装载方法再 `call` 的形态应还原成普通成员调用,
 * 同时 `X = E; return X;` 可直接折叠成 `return E;`(包括 E 直接读取旧 X)。
 */
function verifyAccCallSimplification(): void {
    const program = NodeFactory.parse(`
function md5(str) {
  let acc;
  let local_0_2 = this;
  acc = function (p0, p1) {
    let v8, acc;
    let local_1_0 = cryptoFramework.createMd("MD5");
    let local_1_1 = p0;
    acc = local_1_0.update(str).then(function () {
      return local_1_0.digest();
    });
    v8 = acc;
    acc = acc.then;
    acc.call(v8, function (p0) {
      local_1_1(p0.data.toString());
    });
  };
  acc = new Promise(acc);
  return acc;
}
`);
    SimplifyExport.simplify(program);
    const code = NodeFactory.generate(program);
    if (code.includes(".call(")) {
        throw new Error(`simplify: acc.call 形态未还原\n${code}`);
    }
    if (!code.includes("}).then(function (p0) {") || !code.includes("return new Promise(function")) {
        throw new Error(`simplify: Promise/then 链未正确折叠\n${code}`);
    }
}

/** 回归:源临时变量仍然活跃时,不能把 new 表达式再次搬进另一个变量,否则会重复构造。 */
function verifyNoDuplicateConstruction(): void {
    const program = NodeFactory.parse(`
function f() {
  let v13, acc;
  acc = new ServiceBuilder();
  v13 = acc;
  acc = v13;
  acc = acc.setEndpoint;
  acc = acc.call(v13, ApiConstants.apiBase);
  return acc;
}
`);
    SimplifyExport.simplify(program);
    const code = NodeFactory.generate(program);
    const count = code.split("new ServiceBuilder()").length - 1;
    if (count !== 1 || !code.includes("return new ServiceBuilder().setEndpoint(ApiConstants.apiBase)")) {
        throw new Error(`simplify: 构造表达式被重复生成\n${code}`);
    }
}

/**
 * 回归:按类并行反编译必须与串行逐字一致。
 * 用 bilibili_open.abc 里的几个小类(避开数秒级的大类)验证:
 *   1. 单类输出与处理顺序/worker 数量无关(生成名计数器按类复位);
 *   2. worker 与主线程简化器结果一致。
 */
async function verifyParallelDeterminism(): Promise<void> {
    const abcPath = path.join(__dirname, "resources", "bilibili_open.abc");
    const pandaFile = new PandaFile(new Uint8Array(fs.readFileSync(abcPath)));
    const small = pandaFile.getAllClasses()
        .filter((clazz) => clazz.pandaMethods.has(ENTRY_FUNCTION_MAIN))
        .filter((clazz) => {
            let bytes = 0;
            for (const method of clazz.pandaMethods.values()) bytes += method.methodCode?.codeSize ?? 0;
            return bytes > 0 && bytes < 2000;
        })
        .slice(0, 4);
    if (small.length < 2) throw new Error("bilibili_open.abc: 小类样本不足,无法验证并行一致性");

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

async function main(): Promise<void> {
    console.log("[test] simplify return liveness");
    verifyReturnValueLiveness();
    console.log("    ok");

    console.log("[test] simplify acc call");
    verifyAccCallSimplification();
    console.log("    ok");

    console.log("[test] simplify duplicate construction");
    verifyNoDuplicateConstruction();
    console.log("    ok");

    console.log("[test] parallel determinism (worker_threads)");
    await verifyParallelDeterminism();
    console.log("    ok");

    const samples: Sample[] = [
        { abc: "md5.abc", expected: "md5.js", verify: verifyMd5 },
        { abc: "class.abc", expected: "class.js", verify: verifyClass },
        { abc: "aes.abc", expected: "aes.js", verify: verifyAes },
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

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
