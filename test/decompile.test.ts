import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";
import * as crypto from "crypto";
import { PandaFile, ENTRY_FUNCTION_MAIN } from "../src/file/PandaFile";
import { PandaDecompiler } from "../src/PandaDecompiler";
import { decompileClassesParallel } from "../src/parallel/ParallelDecompiler";
import { NodeFactory } from "../src/ast/NodeFactory";
import { SimplifyExport } from "../src/simplify/SimplifyExport";
import { HapFile } from "../src/hap/HapFile";
import { ResourceIndexFile } from "../src/res/ResourceIndexFile";

/**
 * 集成测试:
 *   1. 反编译 test/resources/*.abc;
 *   2. 与 test/expected/*.js 快照逐字比较;
 *   3. 校验输出可被 Babel 再次解析;
 *   4. 执行样本,确认输出行为符合预期;
 *   5. 校验 HAP 应用包(ZIP 容器)适配与 callruntime.supercallforwardallargs 还原;
 *   6. 校验 ArkTS 13 的 try/finally 还原与空 lexenv 块清理。
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

function runSandbox(code: string): { logs: string[]; sandbox: Record<string, unknown> } {
    const logs: string[] = [];
    const sandbox: Record<string, unknown> = {
        console: {
            log: (...args: unknown[]) => logs.push(args.map((arg) => String(arg)).join(" ")),
        },
    };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(code, sandbox, { timeout: 5000 });
    return { logs, sandbox };
}

function runInSandbox(code: string): string[] {
    return runSandbox(code).logs;
}

function verifyMd5(code: string): void {
    const { logs, sandbox } = runSandbox(code);
    const expected = crypto.createHash("md5").update("admin").digest("hex");
    const output = logs.join("\n");
    if (!output.includes(expected)) {
        throw new Error(`md5 执行结果不正确,期望包含 ${expected},实际输出:\n${output}`);
    }
    // 非 ASCII 输入才会走 UTF-8 转换分支:纯 ASCII 下编码与否结果相同,
    // 抓不到条件极性接反(例如 if 前取反链折叠方向错误)这类问题。
    // 注意源实现的守卫是 [\x80-\xFF],只覆盖 Latin-1,中文不会触发编码分支,
    // 所以这里必须用 Latin-1 范围内的字符。
    const md5 = sandbox.md5;
    if (typeof md5 !== "function") {
        throw new Error("md5 执行结果不正确:输出未暴露全局 md5 函数");
    }
    const latin1 = "café naïve Ünïcödé";
    const latin1Expected = crypto.createHash("md5").update(Buffer.from(latin1, "utf8")).digest("hex");
    const actual = (md5 as (s: string) => string)(latin1);
    if (actual !== latin1Expected) {
        throw new Error(`md5 非 ASCII 输入结果不正确,期望 ${latin1Expected},实际 ${actual}`);
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
 * 回归:闭包只写不读的外层变量必须视为被捕获。
 * 旧实现只从 binding.referencePaths 判断捕获,而赋值写在 constantViolations 里;
 * 一旦闭包里对该变量的读取被优化掉,外层 `local_1_1 = undefined` 就会被当作唯一值
 * 传播到闭包之后的 `return local_1_1`,并连带删掉声明。
 */
function verifyClosureWrittenVariable(): void {
    const program = NodeFactory.parse(`
function selectHighest(p0) {
  let acc;
  let local_1_0, local_1_1;
  acc = undefined;
  local_1_1 = acc;
  acc = -1;
  local_1_0 = acc;
  p0.forEach(function (p1) {
    if (p1 > local_1_0) {
      local_1_0 = p1;
      local_1_1 = p1;
    }
  });
  acc = local_1_1;
  return acc;
}
`);
    SimplifyExport.simplify(program);
    const code = NodeFactory.generate(program);
    if (!/let\s+local_1_0,\s*local_1_1/.test(code) || !code.includes("return local_1_1")) {
        throw new Error(`simplify: 闭包写入的外层变量被错误传播/删除\n${code}`);
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

/**
 * 回归:acc 的成员装载链。
 *   `acc = E; v6 = acc; acc = acc.length; if (acc === 0)`
 * 应折成 `v6 = E; if (v6.length === 0)`(E 为调用时先经别名搬运,再传播进 test);
 * 没有别名时 `acc = E; acc = acc.length; obj.x = acc` 也应折成 `obj.x = E.length`。
 * 同时 `acc = acc.prop; acc.call(recv, ...)` 必须留给 AccCallSimplify。
 */
function verifyAccMemberLengthFold(): void {
    const program = NodeFactory.parse(`
function withAlias(p0, v2) {
  let v6, v8, v9, acc;
  v8 = v2.lastIndexOf(":");
  if (v8 >= 0) {
    v9 = v2.slice(0, v8);
    acc = v2.slice(v8);
    v6 = acc;
    acc = acc.length;
    if (acc === 0) {
      return undefined;
    }
    v2 = v9;
  }
  return v2 + v6;
}
function withoutAlias(p0) {
  let v0, acc;
  v0 = {};
  acc = p0.filter(function (p1) {
    return p1;
  });
  acc = acc.length;
  v0.count = acc;
  return v0;
}
`);
    SimplifyExport.simplify(program);
    const code = NodeFactory.generate(program);
    if (code.includes("acc = acc.length")) {
        throw new Error(`simplify: acc 成员装载未折叠\n${code}`);
    }
    if (!code.includes("v6 = v2.slice(v8)") || !code.includes("if (v6.length === 0)")) {
        throw new Error(`simplify: acc 长度判断未还原为别名成员访问\n${code}`);
    }
    if (!code.includes("v0.count = p0.filter(function (p1) {") || !code.includes("}).length;")) {
        throw new Error(`simplify: 无别名时 acc.length 未折进使用处\n${code}`);
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
 * 回归:三元表达式的布尔分支化简。
 *   - HighLevelGrammarSimplify 把 `if (X) return A; else return B;` 合成三元后,
 *     三元的 test 也是布尔上下文,其前的自取反链要能折叠;
 *   - `!T ? A : B` / `T ? false : B` / `T ? true : B` 本质是逻辑运算,应折成 && / ||。
 * 覆盖编译器常见的 `X = E; X = !X; X = !X; return !X ? false : B;` 形态。
 */
function verifyBooleanConditionalFolding(): void {
    const program = NodeFactory.parse(`
function fromTernary(p0) {
  let acc;
  acc = isTrustedZhihuRequestUrl(p0);
  acc = !acc;
  acc = !acc;
  return !acc ? false : checkUrl(p0);
}
function fromIf(p0) {
  let acc;
  acc = isTrustedZhihuRequestUrl(p0);
  acc = !acc;
  acc = !acc;
  if (!acc) {
    return false;
  } else {
    return checkUrl(p0);
  }
}
function oddChain(p0) {
  let acc;
  acc = isTrustedZhihuRequestUrl(p0);
  acc = !acc;
  return acc ? false : checkUrl(p0);
}
function trueBranch(p0) {
  let acc;
  acc = isTrustedZhihuRequestUrl(p0);
  return acc ? true : checkUrl(p0);
}
`);
    SimplifyExport.simplify(program);
    const code = NodeFactory.generate(program);
    const andCount = code.split("return isTrustedZhihuRequestUrl(p0) && checkUrl(p0);").length - 1;
    if (andCount !== 3) {
        throw new Error(`simplify: 三元布尔分支/自取反链未化简(期望 3 处 &&,实际 ${andCount})\n${code}`);
    }
    if (!code.includes("return isTrustedZhihuRequestUrl(p0) || checkUrl(p0);")) {
        throw new Error(`simplify: true 分支三元未折成 ||\n${code}`);
    }
    if (code.includes("!acc") || code.includes("? false") || code.includes("? true")) {
        throw new Error(`simplify: 仍残留取反链或布尔三元\n${code}`);
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

/**
 * 回归:HAP 应用包(ZIP 容器)适配。
 * 完整反编译该 hap 约需一分钟,这里只做轻量校验:
 *   1. 中央目录解析与 .abc 条目定位;
 *   2. hap 内 ets/modules.abc 可被 PandaFile 解析(版本 13.0.1.0);
 *   3. 之前因 callruntime.supercallforwardallargs 未处理而失败的两个类
 *      (EntryAbility / WorkSchedulerProbeExtensionAbility)现在还原为
 *      super(...arguments) 且可被 Babel 再次解析;
 *   4. module.json 摘要与 resources.index 可解析。
 */
function verifyHapPackage(): void {
    const hapPath = path.join(__dirname, "resources", "zhihupp0.59.hap");
    const hap = new HapFile(new Uint8Array(fs.readFileSync(hapPath)));

    const abcEntries = hap.getAbcEntries().map((entry) => entry.name);
    if (!abcEntries.includes("ets/modules.abc")) {
        throw new Error("hap: 未找到 ets/modules.abc 条目,实际: " + abcEntries.join(", "));
    }

    const moduleJson = hap.getModuleJson();
    if (!moduleJson || moduleJson.app?.bundleName !== "com.github.zhuoyi233.zhplus" || moduleJson.module?.virtualMachine !== "ark13.0.1.0") {
        throw new Error("hap: module.json 解析结果不符合预期");
    }

    const resourcesIndex = new ResourceIndexFile(hap.getResourcesIndexData()!);
    if (resourcesIndex.items.length === 0) throw new Error("hap: resources.index 解析为空");

    const data = hap.readEntry("ets/modules.abc")!;
    const pandaFile = new PandaFile(data);
    // 287 为该 abc 的全部类数,其中 276 个可产出有效反编译结果(其余无 func_main_0)
    const classes = pandaFile.getAllClasses();
    if (classes.length !== 287) throw new Error(`hap: 类数量不符合预期(期望 287,实际 ${classes.length})`);

    const decompiler = new PandaDecompiler();
    for (const name of ["EntryAbility", "WorkSchedulerProbeExtensionAbility"]) {
        const clazz = classes.find((c) => c.name.content.includes(name));
        if (!clazz) throw new Error(`hap: 未找到类 ${name}`);
        const code = decompiler.decompileClass(clazz);
        if (!code.includes("super(...arguments)")) {
            throw new Error(`hap: ${name} 的 supercallforwardallargs 未还原为 super(...arguments)\n${code}`);
        }
        NodeFactory.parse(code);
    }
}

/**
 * 回归:ArkTS 13(字节码 13.0.1.0)的 try/finally 还原。
 *
 * 该版本 catch 的 codeSize 恒为 0,区域图会跳过 handler,finally 收尾退化成
 * `X = hole; if (...) cleanup(); if (X != hole) throw X;`。这里验证:
 *   1. ContentFilterRuntimeStore.loadSnapshot 还原成两段 try/finally,
 *      不再出现 `hole` / `undefined == undefined` / 空的 lexenv 块;
 *   2. QrScanFixture 的 finally 里 `fileIo.closeSync(acc)` 使用 try 之前的
 *      文件句柄,不能被 try 体里已失效的 acc 版本污染。
 */
function verifyZhihuTryFinally(): void {
    const hapPath = path.join(__dirname, "resources", "zhihupp0.59.hap");
    const hap = new HapFile(new Uint8Array(fs.readFileSync(hapPath)));
    const pandaFile = new PandaFile(hap.readEntry("ets/modules.abc")!);
    const decompiler = new PandaDecompiler();

    const contentFilter = pandaFile.getAllClasses().find((clazz) => clazz.name.content.includes("ContentFilterRuntimeStore"));
    if (!contentFilter) throw new Error("hap: 未找到 ContentFilterRuntimeStore");

    const code = decompiler.decompileClass(contentFilter);
    NodeFactory.parse(code);
    if (/\bhole\b/.test(code)) {
        throw new Error(`try/finally 还原: 仍残留 hole 哨兵\n${code}`);
    }
    if (/undefined\s*[!=]==\s*undefined/.test(code)) {
        throw new Error(`try/finally 还原: 仍残留 undefined 常量条件\n${code}`);
    }
    if (/\{\s*let local_\d+_\d+;\s*\}/.test(code)) {
        throw new Error(`lexenv 清理: 仍残留空的词法块\n${code}`);
    }
    if (!/finally \{\s*v0\.close\(\);\s*\}/.test(code) || !/finally \{\s*v11\.close\(\);\s*\}/.test(code)) {
        throw new Error(`try/finally 还原: 两个 query 结果没有放进 finally\n${code}`);
    }
    if (!code.includes("} finally {") || code.split("} finally {").length - 1 !== 2) {
        throw new Error("try/finally 还原: finally 数量不符合预期");
    }

    const expectedPath = path.join(__dirname, "expected", "zhihu-content-filter-runtime-store.js");
    const expected = fs.readFileSync(expectedPath, "utf-8");
    if (code !== expected) {
        throw new Error(`ContentFilterRuntimeStore: 输出与快照不一致\n${firstDifference(expected, code)}`);
    }

    const qrScan = pandaFile.getAllClasses().find((clazz) => clazz.name.content.includes("QrScanFixture"));
    if (!qrScan) throw new Error("hap: 未找到 QrScanFixture");
    const qrCode = decompiler.decompileClass(qrScan);
    NodeFactory.parse(qrCode);
    if (/\bhole\b/.test(qrCode)) {
        throw new Error(`QrScanFixture: 仍残留 hole 哨兵\n${qrCode}`);
    }
    if (!qrCode.includes("} finally {") || !qrCode.includes("fileIo.closeSync(acc);")) {
        throw new Error(`QrScanFixture: try/finally 未还原\n${qrCode}`);
    }
    if (qrCode.includes("acc = new Uint8Array(v6)")) {
        throw new Error(`QrScanFixture: try 体内失效的 acc 赋值未清理\n${qrCode}`);
    }
}

async function main(): Promise<void> {
    console.log("[test] simplify return liveness");
    verifyReturnValueLiveness();
    console.log("    ok");

    console.log("[test] simplify closure written variable");
    verifyClosureWrittenVariable();
    console.log("    ok");

    console.log("[test] simplify acc call");
    verifyAccCallSimplification();
    console.log("    ok");

    console.log("[test] simplify duplicate construction");
    verifyNoDuplicateConstruction();
    console.log("    ok");

    console.log("[test] simplify acc member length fold");
    verifyAccMemberLengthFold();
    console.log("    ok");

    console.log("[test] simplify boolean conditional folding");
    verifyBooleanConditionalFolding();
    console.log("    ok");

    console.log("[test] parallel determinism (worker_threads)");
    await verifyParallelDeterminism();
    console.log("    ok");

    console.log("[test] hap package (zhihupp0.59.hap)");
    verifyHapPackage();
    console.log("    ok");

    console.log("[test] hap try/finally (zhihupp0.59.hap)");
    verifyZhihuTryFinally();
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
