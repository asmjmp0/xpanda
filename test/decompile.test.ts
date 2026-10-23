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
import { formatLongLogicalChains } from "../src/ast/FormatCode";
import * as TYPE from "@babel/types";

/**
 * 集成测试:
 *   1. 反编译 test/resources/*.abc;
 *   2. 与 test/expected/*.js 快照逐字比较;
 *   3. 校验输出可被 Babel 再次解析;
 *   4. 执行样本,确认输出行为符合预期;
 *   5. 校验 HAP 应用包(ZIP 容器)适配与 callruntime.supercallforwardallargs 还原;
 *   6. 校验 ArkTS 13 的 try/finally 还原与空 lexenv 块清理;
 *   7. 校验 test 序列里的死赋值清理(Constant/Accumulator 物化);
 *   8. 校验 createobjectwithbuffer 模板对象到对象字面量的还原;
 *   9. 校验 nullish coalescing 的 switch lowering 还原;
 *  10. 校验 DeepLinkResolver 的累加器/重复调用/布尔物化清理与解析语义(沙箱执行);
 *  11. 校验 ShareContracts 的自引用成员链、嵌套布尔物化与临时分享文件校验语义(沙箱执行);
 *  12. 校验 ContentDetailPages 的 try/finally 还原与整体输出快照。
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
 * 回归:累加器链折叠。
 *   v0 = E; v0 = v0 + MID; acc = C ? A : B; acc = v0 + acc; return acc + "}"
 * 应还原成 `return E + MID + (C ? A : B) + "}"`。
 * 之前复制传播因 E 含调用(p0.map/join)不允许克隆/搬移,整条链停留在多步赋值。
 */
function verifyAccumulatorChainFold(): void {
    const program = NodeFactory.parse(`
function buildBatchDelBody(p0, p1) {
  let v0, acc;
  v0 = "{\\"pairs\\":[" + p0.map(function (p0) {
    return "{\\"content_token\\":\\"" + p0.contentToken + "\\"}";
  }).join(",");
  v0 = v0 + "],\\"clear\\":";
  acc = p1 ? "true" : "false";
  acc = v0 + acc;
  return acc + "}";
}
`);
    SimplifyExport.simplify(program);
    const code = NodeFactory.generate(program);
    if (!code.includes('return "{\\"pairs\\":[" + p0.map(')
        || !code.includes('}).join(",") + "],\\"clear\\":" + (p1 ? "true" : "false") + "}"')) {
        throw new Error(`simplify: 累加器链未折叠成单个 return\n${code}`);
    }
    if (code.includes("acc = ") || code.includes("let v0, acc")) {
        throw new Error(`simplify: 累加器链仍残留中间赋值\n${code}`);
    }
}

/**
 * 回归:条件物化 `X = !E; if (X/!X/复合条件)` 折回 test。
 *   acc = !isAllowed(p0); if (acc) throw ... else ...
 *   acc = !p0.isEnd; acc = !acc; if (!acc && ...)
 * 第二例的取反链奇偶性必须作用到 X 的值上,而不是只折掉一层。
 */
function verifyConditionMaterializationIntoTest(): void {
    const program = NodeFactory.parse(`
function reject(p0) {
  let acc;
  acc = !isAllowed(p0);
  if (acc) {
    throw new Error("bad");
  } else {
    return p0;
  }
}
function hasMore(p0) {
  let acc;
  acc = !p0.isEnd;
  acc = !acc;
  if (!acc && p0.items.length > 0) {
    return 1;
  } else {
    return 0;
  }
}
`);
    SimplifyExport.simplify(program);
    const code = NodeFactory.generate(program);
    if (!code.includes("if (!isAllowed(p0))")) {
        throw new Error(`simplify: 条件物化未折回 test\n${code}`);
    }
    if (!code.includes("return !p0.isEnd && p0.items.length > 0 ? 1 : 0")) {
        throw new Error(`simplify: 取反链奇偶性未折回复合 test\n${code}`);
    }
    if (/\bacc\b/.test(code)) {
        throw new Error(`simplify: 条件物化后仍残留 acc\n${code}`);
    }
}


/**
 * 回归:尾部临时变量别名 `X = E; Y = X` -> `Y = E`。
 * HighLevelGrammarSimplify 在定点迭代后才把条件物化合成三元赋值,此时
 * `local_1_0 = acc` 的复制传播已经跑完;X 之后已死时必须能直接搬进 Y。
 * Y 被闭包捕获不影响折叠(写入点和求值顺序不变)。
 */
function verifyTailTempAliasFold(): void {
    const program = NodeFactory.parse(`
function collect(p0, items) {
  let acc, local_1_0;
  if (p0 === undefined) {
    acc = new Set();
  } else {
    acc = make(p0);
  }
  local_1_0 = acc;
  items.forEach(function (x) {
    local_1_0.add(x);
  });
}
function setField(p0, obj) {
  let acc;
  if (p0) {
    acc = [1];
  } else {
    acc = [2];
  }
  obj.sbox = acc;
}
`);
    SimplifyExport.simplify(program);
    const code = NodeFactory.generate(program);
    if (!code.includes("local_1_0 = p0 === undefined ? new Set() : make(p0);")) {
        throw new Error(`simplify: 尾部临时变量别名未合并\n${code}`);
    }
    if (!code.includes("obj.sbox = p0 ? [1] : [2];")) {
        throw new Error(`simplify: 成员目标 X = E; obj.k = X 未合并\n${code}`);
    }
    if (/\bacc\b/.test(code)) {
        throw new Error(`simplify: 尾部别名合并后仍残留 acc\n${code}`);
    }
    if (!code.includes("local_1_0.add(x);")) {
        throw new Error(`simplify: 被闭包捕获的目标变量内容被误改\n${code}`);
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

/**
 * 回归:自引用成员链与嵌套布尔物化。
 *   `v0 = v0.length; v0 = p0.substring(v0)` -> `v0 = p0.substring(v0.length)`
 * (`X = X.prop` 的旧值读取不会被复制传播缓存,需要在相邻赋值间整体搬移);
 *   `if (!p2) { if (!isFile) acc = true else acc = false } else if ...`
 * -> `if (p2 ? !isImage : !isFile)`,不残留 acc。
 */
function verifySelfReadChainAndNestedConditional(): void {
    const program = NodeFactory.parse(`
function dir(p0) {
  return p0 + "/";
}
function cut(p0, p1, flag) {
  let v0;
  v0 = dir(p1);
  if (flag) {
    v0 = v0.length;
    v0 = p0.substring(v0);
  }
  return v0;
}
function check(p0, p1, p2, isFileMime, isImageMime) {
  let acc;
  if (!p2) {
    if (!isFileMime(p0)) {
      acc = true;
    } else {
      acc = false;
    }
  } else if (!isImageMime(p0)) {
    acc = true;
  } else {
    acc = false;
  }
  if (acc) {
    throw new Error("bad");
  }
  return p1;
}
`);
    SimplifyExport.simplify(program);
    const code = NodeFactory.generate(program);
    if (code.includes("v0 = v0.length") || !code.includes("v0 = p0.substring(v0.length)")) {
        throw new Error(`simplify: 自引用成员链未折叠\n${code}`);
    }
    if (!code.includes("if (p2 ? !isImageMime(p0) : !isFileMime(p0))")) {
        throw new Error(`simplify: 嵌套布尔物化未合成三目\n${code}`);
    }
    if (code.includes("acc")) {
        throw new Error(`simplify: 布尔物化仍残留 acc\n${code}`);
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
 * 用 zhihupp0.59.hap 里的几个小类(避开分钟级的大类)验证:
 *   1. 单类输出与处理顺序/worker 数量无关(生成名计数器按类复位);
 *   2. worker 与主线程简化器结果一致。
 */
async function verifyParallelDeterminism(): Promise<void> {
    const hapPath = path.join(__dirname, "resources", "zhihupp0.59.hap");
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
    if (!code.includes('content.contentId ?? ""') || !code.includes('contentKind ?? "content"')
        || !code.includes('contentId ?? "unknown"')) {
        throw new Error(`nullish 还原: recordOutcomes 的 ?? 未恢复\n${code}`);
    }
    if (code.includes("switch (local_1_0[v6].content")) {
        throw new Error(`nullish 还原: 仍残留 content 字段 switch\n${code}`);
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

    // 3. try 起点 / cleanup 落在条件 test 求值区,或 finally 被结构化折叠进
    //    最后一个分支尾部(NotificationState.fetchPage / loadMore、AppDatabase.close)。
    const notificationState = pandaFile.getAllClasses().find((clazz) => clazz.name.content.includes("NotificationState"));
    if (!notificationState) throw new Error("hap: 未找到 NotificationState");
    const notificationCode = decompiler.decompileClass(notificationState);
    NodeFactory.parse(notificationCode);
    if (notificationCode.includes("xpanda: try/finally not restored")) {
        throw new Error(`NotificationState: try/finally 未还原\n${notificationCode}`);
    }
    // fetchPage: try 起点在条件 test 序列里,finally 收尾落在尾部 else 分支
    if (!/async fetchPage\(p0, p1\) \{\s*let v0;\s*try \{/.test(notificationCode)) {
        throw new Error(`NotificationState.fetchPage: try 未覆盖整个方法体\n${notificationCode}`);
    }
    if (!/try \{[\s\S]*?\n    \} finally \{\n      if \(this\.isCurrent\(p0\)\) \{\n        this\.emit\(\);\n      \}\n    \}/.test(notificationCode)) {
        throw new Error(`NotificationState.fetchPage: finally 未还原为 isCurrent(p0) 收尾\n${notificationCode}`);
    }
    // loadMore: cleanup 首块是条件比较
    if (!/try \{\s*await this\.fetchPage\(this\.generation, this\.nextCursor\);\s*\} finally \{\s*if \(this\.isCurrent\(this\.generation\)\) \{\s*this\.loadingMore = false;\s*this\.emit\(\);/.test(notificationCode)) {
        throw new Error(`NotificationState.loadMore: finally 未还原\n${notificationCode}`);
    }

    const appDatabase = pandaFile.getAllClasses().find((clazz) => clazz.name.content.includes("AppDatabase"));
    if (!appDatabase) throw new Error("hap: 未找到 AppDatabase");
    const databaseCode = decompiler.decompileClass(appDatabase);
    NodeFactory.parse(databaseCode);
    if (!/try \{\s*await acc;\s*\} finally \{\s*if \(this\.closing === acc\) \{\s*this\.closing = undefined;/.test(databaseCode)) {
        throw new Error(`AppDatabase.close: finally 未还原\n${databaseCode}`);
    }
}

/**
 * 回归:ContentDetailPages(大型页面类)的 try/finally 还原与整体输出快照。
 *
 * `moveAnswer` 是“try 起点落在可选链条件 test 求值区 + finally 被折叠进尾部
 * else 分支”的原始样本:finally 必须重新包住整个方法体,异常路径也要复位
 * `navigatorBusy`;`refreshQuestion` 则是常规布局。
 */
function verifyZhihuContentDetailPages(): void {
    const hapPath = path.join(__dirname, "resources", "zhihupp0.59.hap");
    const hap = new HapFile(new Uint8Array(fs.readFileSync(hapPath)));
    const pandaFile = new PandaFile(hap.readEntry("ets/modules.abc")!);
    const clazz = pandaFile.getAllClasses().find((c) => c.name.content.includes("ContentDetailPages"));
    if (!clazz) throw new Error("hap: 未找到 ContentDetailPages");

    const code = new PandaDecompiler().decompileClass(clazz);
    NodeFactory.parse(code);
    if (/\bhole\b/.test(code)) {
        throw new Error(`ContentDetailPages: 仍残留 hole 哨兵\n${code}`);
    }
    if (code.includes("xpanda: try/finally not restored")) {
        throw new Error(`ContentDetailPages: try/finally 未还原\n${code}`);
    }
    // 原型上的 __defineGetter__/__defineSetter__ 应全部并入类;方法体里写 this.x
    // 不应阻止访问器转换(只有构造器里的 this.x = ... 需要保守处理)。
    if (code.includes("__defineGetter__") || code.includes("__defineSetter__")) {
        throw new Error(`ContentDetailPages: 访问器未并入类\n${code}`);
    }
    if (!code.includes("get activeContentId() {") || !code.includes("set activeContentId(p0) {")) {
        throw new Error(`ContentDetailPages: 缺少 activeContentId 访问器\n${code}`);
    }

    const moveStart = code.indexOf("async moveAnswer(p0) {");
    if (moveStart < 0) throw new Error(`ContentDetailPages: 未找到 moveAnswer\n${code}`);
    const moveBody = code.slice(moveStart, code.indexOf("\n  }\n", moveStart));
    if (!moveBody.includes("try {\n        v6 = this.answerNavigator === null")) {
        throw new Error(`moveAnswer: try 未包住可选链求值\n${moveBody}`);
    }
    if (!moveBody.includes("} finally {\n        this.navigatorBusy = false;\n      }")) {
        throw new Error(`moveAnswer: finally 未还原 navigatorBusy 复位\n${moveBody}`);
    }

    const refreshStart = code.indexOf("async refreshQuestion() {");
    if (refreshStart < 0) throw new Error(`ContentDetailPages: 未找到 refreshQuestion\n${code}`);
    const refreshBody = code.slice(refreshStart, code.indexOf("\n  }\n", refreshStart));
    if (!refreshBody.includes("} finally {\n      this.refreshingAnswers = false;\n    }")) {
        throw new Error(`refreshQuestion: finally 未还原 refreshingAnswers 复位\n${refreshBody}`);
    }

    const expectedPath = path.join(__dirname, "expected", "zhihu-content-detail-pages.js");
    const expected = fs.readFileSync(expectedPath, "utf-8");
    if (code !== expected) {
        throw new Error(`ContentDetailPages: 输出与快照不一致\n${firstDifference(expected, code)}`);
    }
}

/**
 * 回归:循环里的布尔物化。
 *   `X = !E; if (!X) {...}` 和 `do { ...; X = !E2; } while (!X)`
 * 在 X 的旧值已死时应折成 `if (E)` / `while (E2)`,不能留下
 * `X = !E; if (!X)`(会把同一个调用求值两次)或 `while (!X)` 噪声。
 * liveness 需要识别 do-while 的 test 在 body 写入之后读取。
 */
/**
 * 回归:while (true) + `x = it.next(); if (x.done) break; x = x.value` 的
 * 迭代器循环还原成 for...of。
 *
 * 只有迭代器临时量除 body 第一条 `it.next()` 外没有任何读取时才转换:
 * ArkTS 会在提前 return 的分支里内联 `it.return()`,那是 for-of 自己会做的
 * 收尾,保留下来会访问已不再赋值的 it(见 NativeContentDocument 的模式)。
 */
function verifyForOfRestoration(): void {
    const positive = NodeFactory.parse(`
function f(local_2_0, local_3_9) {
  let v0, v3;
  v0 = local_2_0[0][Symbol.iterator]();
  while (true) {
    v3 = v0.next();
    if (v3.done) break;
    v3 = v3.value;
    local_3_9(v3);
  }
}
`);
    SimplifyExport.simplify(positive);
    const positiveCode = NodeFactory.generate(positive);
    if (!positiveCode.includes("for (v3 of local_2_0[0])")) {
        throw new Error(`for...of 还原: 没有生成 for-of\n${positiveCode}`);
    }
    if (positiveCode.includes("while (true)") || positiveCode.includes("v0.next")) {
        throw new Error(`for...of 还原: 迭代器循环残留\n${positiveCode}`);
    }

    const negative = NodeFactory.parse(`
function g(p0) {
  let v0, v3;
  v0 = p0[Symbol.iterator]();
  while (true) {
    v3 = v0.next();
    if (v3.done) break;
    v3 = v3.value;
    if (v3 === undefined) {
      if (v0.return != undefined) {
        v0.return();
      }
      return;
    }
  }
}
`);
    SimplifyExport.simplify(negative);
    const negativeCode = NodeFactory.generate(negative);
    if (negativeCode.includes("for (v3 of p0)")) {
        throw new Error(`for...of 还原: 循环体读取 it.return 时不应转换\n${negativeCode}`);
    }
    if (!negativeCode.includes("while (true)") || !negativeCode.includes("v0.return")) {
        throw new Error(`for...of 还原: 负例输出被破坏\n${negativeCode}`);
    }
}

function verifyLoopConditionFold(): void {
    const program = NodeFactory.parse(`
function f(v0, v5) {
  let acc;
  while (true) {
    acc = !v0.goToFirstRow();
    if (!acc) {
      do {
        v5[v0.getString(0)] = v0.getLong(1);
        acc = !v0.goToNextRow();
      } while (!acc);
    }
  }
}
`);
    SimplifyExport.simplify(program);
    const code = NodeFactory.generate(program);
    if (!code.includes("if (v0.goToFirstRow())") || !code.includes("} while (v0.goToNextRow());")) {
        throw new Error(`simplify: 循环条件物化未折叠\n${code}`);
    }
    if (code.includes("acc = !")) {
        throw new Error(`simplify: 仍残留 acc = !... 物化赋值\n${code}`);
    }
}

/**
 * 回归:`if (A || (v1 = 0, v2 = 2, X = !(cond), cond))` 里的死赋值。
 * `X = !(cond)` 的值没有被序列最后一条使用,X 在 test 后也死了;它只是
 * 第二个条件的布尔物化,应删除,让 `hoistTestPrefixes` 能继续把 `v1/v2`
 * 的常量赋值提到 if 前。短路左侧对 X 的读取发生在赋值之前,不应阻止删除。
 */
function verifyTestSequenceScratchRemoval(): void {
    const program = NodeFactory.parse(`
function f(acc, v0) {
  let v1, v2;
  v0 = acc;
  if (acc === null || (v1 = 0, v2 = 2, acc = !(acc[2].length === 0), v0[2].length === 0)) {
    return undefined;
  }
}
`);
    SimplifyExport.simplify(program);
    const code = NodeFactory.generate(program);
    if (!code.includes("if (acc === null || acc[2].length === 0)")) {
        throw new Error(`simplify: test 序列里的布尔物化未清理\n${code}`);
    }
    if (code.includes("acc = !(") || code.includes("v1 = 0, v2 = 2")) {
        throw new Error(`simplify: 仍残留 test 序列死赋值\n${code}`);
    }
}

/**
 * 回归:三元 test 里的临时保存必须有“版本”意识。
 *   - test 里先保存旧值、随后同一路径上又覆盖的保存可以删:
 *       (v0 = p0.kind, ...) && (v0 = p0.text.trim(), v0.length > 0)
 *     → 只保留真正的 trim 赋值;
 *   - 分支会读取的保存不能被折进比较,否则 `return v0` 拿到的是被删除前的旧值
 *     (ContentDetailPages.contentSpeechText 曾因此 push 布尔值而不是正文)。
 */
function verifyBranchValueKeptInTestFolds(): void {
    const program = NodeFactory.parse(`
function f(p0) {
  let v0;
  if (p0.kind !== "answer" && (v0 = p0.kind, p0.kind !== "article") && (v0 = p0.text.trim(), v0.length > 0)) {
    return v0;
  } else {
    return "fallback";
  }
}
function g(p0) {
  let v0;
  if ((v0 = p0.text.trim()) && v0.length > 0) {
    return v0;
  }
  return "";
}
`);
    SimplifyExport.simplify(program);
    const code = NodeFactory.generate(program);
    if (!code.includes('return p0.kind !== "answer" && p0.kind !== "article" && (v0 = p0.text.trim(), v0.length > 0) ? v0 : "fallback";')) {
        throw new Error(`simplify: 三元 test 的临时保存未按版本清理\n${code}`);
    }
    if (code.includes("v0 = p0.kind")) {
        throw new Error(`simplify: 被后续赋值覆盖的 test 保存未删除\n${code}`);
    }
    if (!code.includes("if ((v0 = p0.text.trim()) && v0.length > 0)") || !code.includes("return v0;")) {
        throw new Error(`simplify: 分支读取的 test 保存被错误折进比较\n${code}`);
    }
}

/**
 * 回归:合并后的子逻辑区域不能再追加 `acc`/`!acc` 后缀。
 *
 * 源码 `return name === A || name === B || ...` 被 lower 成多个 `jeqz` 跳转,
 * `simplifyConditionalSequence` 从尾向前合并成 `||`。旧实现把子逻辑区域当成
 * 普通 region,在它的表达式后再追加一个 `acc` 读取:
 *   name === QUESTION || ((name === ANSWER, acc) || ...)
 * 这一方面把 `acc` 里最后一个比较结果覆盖到条件值上(语义错误),另一方面
 * 留下 `(acc = E, !(E))` 这类死赋值,最终输出不可读。
 * 修复后子逻辑区域直接作为操作数,整体应折成一条 `===` 的 `||` 链。
 */
function verifyZhihuAppDestination(): void {
    const hapPath = path.join(__dirname, "resources", "zhihupp0.59.hap");
    const hap = new HapFile(new Uint8Array(fs.readFileSync(hapPath)));
    const pandaFile = new PandaFile(hap.readEntry("ets/modules.abc")!);
    const clazz = pandaFile.getAllClasses().find((c) => c.name.content.includes("navigation/AppDestination"));
    if (!clazz) throw new Error("hap: 未找到 AppDestination");

    const code = new PandaDecompiler().decompileClass(clazz);
    NodeFactory.parse(code);
    const start = code.indexOf("shouldReloadAfterAuthentication = function");
    if (start < 0) throw new Error(`逻辑条件链: 未找到 shouldReloadAfterAuthentication\n${code}`);
    const body = code.slice(start, code.indexOf("\n};", start));
    if (!body.includes("return p0.name === AppDestinationName.QUESTION\n    || p0.name === AppDestinationName.ANSWER")) {
        throw new Error(`逻辑条件链: 未折成可读的多行 || 链\n${body}`);
    }
    if (!body.includes("p0.name === AppDestinationName.PIN_DRAFTS;")) {
        throw new Error(`逻辑条件链: 链尾条件丢失\n${body}`);
    }
    if (/\bacc\b|!\(/.test(body)) {
        throw new Error(`逻辑条件链: 仍残留 acc 物化/取反\n${body}`);
    }

    // if 的 test 读取是旧值最后用法 + HighLevel 合成的 `v0 = !X` 都要能继续折成短路表达式
    const queryStart = code.indexOf("isSafeSearchDestinationQuery = function");
    const queryBody = queryStart < 0 ? "" : code.slice(queryStart, code.indexOf("\n};", queryStart));
    if (!queryBody.includes('return typeof p0 === "string" && p0.length <= 200 && !new RegExp(')) {
        throw new Error(`逻辑条件链: isSafeSearchDestinationQuery 未折成短路表达式\n${queryBody}`);
    }
    if (queryBody.includes("if (")) {
        throw new Error(`逻辑条件链: isSafeSearchDestinationQuery 仍残留条件物化\n${queryBody}`);
    }

    const expectedPath = path.join(__dirname, "expected", "zhihu-app-destination.js");
    const expected = fs.readFileSync(expectedPath, "utf-8");
    if (code !== expected) {
        throw new Error(`AppDestination: 输出与快照不一致\n${firstDifference(expected, code)}`);
    }
}

/**
 * 回归:成员写入后的“取走并清空”模式,旧值副本不得被复制传播回成员装载。
 * 源码语义(StartupDestinationChannel.subscribe):
 *   const pending = this.pending;
 *   this.pending = undefined;
 *   if (pending !== undefined) { this.activeIdentity = identity(pending); listener(pending); }
 * 旧实现在成员写入(`local_0_1.pending = undefined`)时不失效缓存装载,
 * 把旧值临时变量的读取替换回 `local_0_1.pending`,生成
 *   local_0_1.pending = undefined;
 *   if (local_0_1.pending !== undefined)   ← 恒为 false 的死代码
 * 导致新监听者订阅时永远收不到暂存的目的地。
 */
function verifyZhihuStartupDestinationChannel(): void {
    const hapPath = path.join(__dirname, "resources", "zhihupp0.59.hap");
    const hap = new HapFile(new Uint8Array(fs.readFileSync(hapPath)));
    const pandaFile = new PandaFile(hap.readEntry("ets/modules.abc")!);
    const clazz = pandaFile.getAllClasses().find((c) => c.name.content.includes("StartupDestinationChannel"));
    if (!clazz) throw new Error("hap: 未找到 StartupDestinationChannel");

    const code = new PandaDecompiler().decompileClass(clazz);
    NodeFactory.parse(code);

    const subscribeStart = code.indexOf("subscribe(p0)");
    if (subscribeStart < 0) throw new Error(`StartupDestinationChannel: 未找到 subscribe\n${code}`);
    const subscribeBody = code.slice(subscribeStart, code.indexOf("\n  }", subscribeStart));

    // 旧值先读入临时变量 → 清空字段 → 用临时变量做判断,三者必须针对不同的左值
    const tempMatch = subscribeBody.match(/(\w+) = local_0_1\.pending;\n    local_0_1\.pending = undefined;\n    if \(\1 !== undefined\) \{/);
    if (!tempMatch) {
        throw new Error(`StartupDestinationChannel: subscribe 旧值副本被成员写入错误覆盖\n${subscribeBody}`);
    }
    const temp = tempMatch[1];
    if (!subscribeBody.includes(`local_0_1.activeIdentity = appDestinationIdentity(${temp})`)
        || !subscribeBody.includes(`${temp});\n    }`)) {
        throw new Error(`StartupDestinationChannel: subscribe 分支体未使用旧值 ${temp}\n${subscribeBody}`);
    }
    if (subscribeBody.includes("if (local_0_1.pending !== undefined)")) {
        throw new Error(`StartupDestinationChannel: 清空后仍判断字段本身(恒 false 死代码)\n${subscribeBody}`);
    }

    const expectedPath = path.join(__dirname, "expected", "zhihu-startup-destination-channel.js");
    const expected = fs.readFileSync(expectedPath, "utf-8");
    if (code !== expected) {
        throw new Error(`StartupDestinationChannel: 输出与快照不一致\n${firstDifference(expected, code)}`);
    }
}

/**
 * 回归:DeepLinkResolver 的深链接解析函数。
 *
 * 旧输出有三类可读性/正确性问题:
 *   1. 累加器死赋值未被清理,并把不可复制的调用克隆成两次求值:
 *        acc = v2.protocol.toLowerCase(); v4 = v2.protocol.toLowerCase();
 *   2. test 序列里残留布尔物化死赋值:
 *        v5 === "feed" && (v1 = v6.length, acc = !(v6.length === 0), v6.length === 0)
 *   3. 跨变量布尔物化链未折叠:
 *        acc = A; v1 = A; if (acc) { v1 = B }
 *   另外非块 consequent(`if (A) if (B) ...`)整条分支被条件折叠递归跳过。
 *   修复后:acc 不再出现在输出中,feed 条件折成 `v6.length === 0`,
 *   zhuanlan 条件折成 `v6.length === v1 && v6[0] === "p" && ...` 并直接折进 return。
 * 同时在沙箱里执行解析函数,校验各 URL 形态的还原语义。
 */
function verifyZhihuDeepLinkResolver(): void {
    const hapPath = path.join(__dirname, "resources", "zhihupp0.59.hap");
    const hap = new HapFile(new Uint8Array(fs.readFileSync(hapPath)));
    const pandaFile = new PandaFile(hap.readEntry("ets/modules.abc")!);
    const clazz = pandaFile.getAllClasses().find((c) => c.name.content.includes("navigation/DeepLinkResolver"));
    if (!clazz) throw new Error("hap: 未找到 DeepLinkResolver");

    const code = new PandaDecompiler().decompileClass(clazz);
    NodeFactory.parse(code);

    if (/\bacc\b/.test(code)) {
        throw new Error(`DeepLinkResolver: 输出仍残留累加器 acc\n${code}`);
    }
    if (code.split("v2.protocol.toLowerCase()").length !== 2
        || code.split("v2.hostname.toLowerCase()").length !== 2) {
        throw new Error(`DeepLinkResolver: protocol/hostname 的 toLowerCase 被重复求值\n${code}`);
    }
    if (code.includes(", acc = ") || code.includes("acc = !(")) {
        throw new Error(`DeepLinkResolver: test 序列仍残留布尔物化死赋值\n${code}`);
    }
    if (!code.includes('v6.length === v1 && v6[0] === "p" && isSafeDecimalContentId(v6[1])')) {
        throw new Error(`DeepLinkResolver: zhuanlan 的跨变量布尔物化链未折叠\n${code}`);
    }
    if (!code.includes('v5 === "feed" && v6.length === 0') || !code.includes("v2.hasUserInfo || v2.port.length > 0")) {
        throw new Error(`DeepLinkResolver: test 序列死赋值未清理\n${code}`);
    }

    const expectedPath = path.join(__dirname, "expected", "zhihu-deep-link-resolver.js");
    const expected = fs.readFileSync(expectedPath, "utf-8");
    if (code !== expected) {
        throw new Error(`DeepLinkResolver: 输出与快照不一致\n${firstDifference(expected, code)}`);
    }

    // 行为校验:去掉 import/export 后在沙箱执行,提供三个被引用模块的桩实现。
    // 顶层 let 不会挂到 globalThis 上,末尾显式收集要校验的绑定。
    const body = code
        .replace(/^import\s+.*\n/gm, "")
        .replace(/^export\s+\{[^}]*\};\s*$/gm, "")
        + "\nglobalThis.__exports = { DeepLinkType, MAX_DEEP_LINK_INPUT_LENGTH, describeDeepLink, extractZhihuLinkFromText, resolveZhihuLink };";
    const sandbox: Record<string, unknown> = {
        isSafeDecimalContentId: (id: unknown): boolean => typeof id === "string" && /^\d+$/.test(id) && id.length > 0,
        isSafeSearchDestinationQuery: (q: unknown): boolean => typeof q === "string" && q.length <= 200,
        parseAbsoluteUrl: (url: string): unknown => parseUrlStub(url),
    };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(body, sandbox, { timeout: 5000 });
    const exported = sandbox.__exports as Record<string, unknown>;
    const resolve = exported.resolveZhihuLink as (url: string) => { type: string; id: string; query: string } | undefined;
    const describe = exported.describeDeepLink as (d: { type: string; id: string; query: string }) => string | undefined;
    const extract = exported.extractZhihuLinkFromText as (text: string) => { type: string; id: string; query: string } | undefined;
    const MAX = exported.MAX_DEEP_LINK_INPUT_LENGTH as number;

    const type = exported.DeepLinkType as Record<string, string>;
    const expectDest = (actual: unknown, want: { type: string; id?: string; query?: string }): void => {
        const label = JSON.stringify(want);
        if (typeof actual !== "object" || actual === null) {
            throw new Error(`DeepLinkResolver: 期望 ${label},实际 ${String(actual)}`);
        }
        const dest = actual as { type: string; id: string; query: string };
        if (dest.type !== want.type || dest.id !== (want.id ?? "") || dest.query !== (want.query ?? "")) {
            throw new Error(`DeepLinkResolver: 期望 ${label},实际 ${JSON.stringify(dest)}`);
        }
    };

    // 主站各形态
    expectDest(resolve("https://www.zhihu.com/question/123456/answer/789012"), { type: type.ANSWER, id: "789012" });
    expectDest(resolve("https://zhihu.com/answer/42"), { type: type.ANSWER, id: "42" });
    expectDest(resolve("https://www.zhihu.com/question/42"), { type: type.QUESTION, id: "42" });
    expectDest(resolve("https://zhuanlan.zhihu.com/p/123456"), { type: type.ARTICLE, id: "123456" });
    expectDest(resolve("https://www.zhihu.com/oia/articles/777"), { type: type.ARTICLE, id: "777" });
    expectDest(resolve("https://www.zhihu.com/people/jmp0"), { type: type.PERSON, id: "jmp0" });
    expectDest(resolve("https://www.zhihu.com/video/998877"), { type: type.VIDEO, id: "998877" });
    expectDest(resolve("https://www.zhihu.com/pin/660011"), { type: type.PIN, id: "660011" });
    expectDest(resolve("https://www.zhihu.com/appview/p/554433"), { type: type.ARTICLE, id: "554433" });
    expectDest(resolve("https://www.zhihu.com/appview/answer/112233"), { type: type.ANSWER, id: "112233" });
    expectDest(resolve("https://www.zhihu.com/search?q=%E7%9F%A5%E4%B9%8E"), { type: type.SEARCH, query: "知乎" });

    // scheme 深链
    expectDest(resolve("zhihu://feed"), { type: type.MAIN_TABS });
    expectDest(resolve("zhihu://search?q=abc"), { type: type.SEARCH, query: "abc" });
    expectDest(resolve("zhihu://answers/9527"), { type: type.ANSWER, id: "9527" });
    expectDest(resolve("zhihu://questions/111"), { type: type.QUESTION, id: "111" });
    expectDest(resolve("zhihu://articles/222"), { type: type.ARTICLE, id: "222" });
    expectDest(resolve("zhihu://pin/333"), { type: type.PIN, id: "333" });

    // link.zhihu.com 跳转(带一层 URL 编码)
    const wrapped = "https://link.zhihu.com/?target=" + encodeURIComponent("https://www.zhihu.com/people/inner-user");
    expectDest(resolve(wrapped), { type: type.PERSON, id: "inner-user" });

    // 非法输入:非知乎域名、坏路径、用户信息、非数字 id、超长输入、递归超限
    const shouldFail = (url: string): void => {
        const r = resolve(url);
        if (r !== undefined) throw new Error(`DeepLinkResolver: ${url} 应解析为 undefined,实际 ${JSON.stringify(r)}`);
    };
    shouldFail("https://evil.com/question/1/answer/2");
    shouldFail("https://www.zhihu.com/question/abc/answer/2");
    shouldFail("https://www.zhihu.com/question/1/answer/2/extra");
    shouldFail("https://user:pass@www.zhihu.com/question/1/answer/2");
    shouldFail("https://www.zhihu.com:8080/people/x");
    shouldFail("ftp://www.zhihu.com/people/x");
    shouldFail("zhihu://feed/extra/path");
    shouldFail("zhihu://unknown/123");
    shouldFail(`https://www.zhihu.com/people/${"x".repeat(9000)}`);
    const tripleWrapped = "https://link.zhihu.com/?target="
        + encodeURIComponent("https://link.zhihu.com/?target="
            + encodeURIComponent("https://link.zhihu.com/?target="
                + encodeURIComponent("https://www.zhihu.com/people/deep")));
    shouldFail(tripleWrapped);
    if (MAX !== 8192) throw new Error(`DeepLinkResolver: MAX_DEEP_LINK_INPUT_LENGTH 应为 8192,实际 ${MAX}`);

    // 文本提取与描述
    const found = extract("看看这篇 https://zhuanlan.zhihu.com/p/999888 和 https://evil.com/a");
    expectDest(found, { type: type.ARTICLE, id: "999888" });
    if (extract("没有任何链接") !== undefined) throw new Error("DeepLinkResolver: 无链接文本应返回 undefined");
    const described = describe({ type: type.ANSWER, id: "42", query: "" });
    if (described !== "回答：42") throw new Error(`DeepLinkResolver: describeDeepLink 输出不符合预期:${described}`);
}

/**
 * 回归:ShareContracts 的临时分享文件校验。
 *   1. `v0 = v0.length; v0 = p0.path.substring(v0)` 应折成 `v0 = p0.path.substring(v0.length)`;
 *   2. 嵌套 if / else-if 的 mime 布尔物化应折成
 *      `if (p2 ? !isImageMime(...) : !isFileMime(...))`,不残留 acc;
 *   3. 输出与快照一致,并在沙箱里执行时间戳/目录前缀/mime/lifecycle 语义校验。
 */
function verifyZhihuShareContracts(): void {
    const hapPath = path.join(__dirname, "resources", "zhihupp0.59.hap");
    const hap = new HapFile(new Uint8Array(fs.readFileSync(hapPath)));
    const pandaFile = new PandaFile(hap.readEntry("ets/modules.abc")!);
    const clazz = pandaFile.getAllClasses().find((c) => c.name.content.includes("platform/ShareContracts"));
    if (!clazz) throw new Error("hap: 未找到 ShareContracts");

    const code = new PandaDecompiler().decompileClass(clazz);
    NodeFactory.parse(code);
    if (!code.includes("v0 = p0.path.substring(v0.length)")) {
        throw new Error(`ShareContracts: 自引用成员链未折叠\n${code}`);
    }
    if (!code.includes("if (p2 ? !local_0_11(p0.mimeType) : !local_0_12(p0.mimeType))")) {
        throw new Error(`ShareContracts: 嵌套布尔物化未合成三目\n${code}`);
    }
    if (code.includes("acc = true") || code.includes("acc = false")) {
        throw new Error(`ShareContracts: 布尔物化仍残留 acc\n${code}`);
    }

    const expectedPath = path.join(__dirname, "expected", "zhihu-share-contracts.js");
    const expected = fs.readFileSync(expectedPath, "utf-8");
    if (code !== expected) {
        throw new Error(`ShareContracts: 输出与快照不一致\n${firstDifference(expected, code)}`);
    }

    // 行为校验:去掉 export 后在沙箱执行,直接调用导出的校验函数。
    const body = code.replace(/^export\s+\{[^}]*\};\s*$/gm, "")
        + "\nglobalThis.__exports = {"
        + " createTemporaryShareLifecycle, markSharePanelOpened, prepareSharePayload,"
        + " shouldCleanupTemporaryShareFile, ShareFailureKind,"
        + " SHARE_PANEL_GRACE_MILLIS, SHARE_TEMPORARY_MAX_AGE_MILLIS };";
    const sandbox: Record<string, unknown> = {};
    sandbox.globalThis = sandbox;
    vm.runInNewContext(body, sandbox, { timeout: 5000 });
    const exported = sandbox.__exports as Record<string, any>;
    const kinds = exported.ShareFailureKind as Record<string, string>;
    const prepare = exported.prepareSharePayload as (payload: any, now: any) => any;
    const createLifecycle = exported.createTemporaryShareLifecycle as (file: any) => any;
    const markOpened = exported.markSharePanelOpened as (lifecycle: any, at: number) => any;
    const cleanup = exported.shouldCleanupTemporaryShareFile as (lifecycle: any, now: number) => boolean;
    const grace = exported.SHARE_PANEL_GRACE_MILLIS as number;
    const maxAge = exported.SHARE_TEMPORARY_MAX_AGE_MILLIS as number;

    const now = { nowMillis: 1_000_000, cacheDir: "/data/cache" };
    const makeFile = (over: Record<string, unknown> = {}): any => ({
        path: "/data/cache/share/abc.png",
        createdAtMillis: 999_000,
        mimeType: "image/png",
        ...over,
    });
    const prepareWith = (kind: string, temporaryFile: any, at: any = now): any =>
        prepare({ kind, title: "t", summary: "s", temporaryFile }, at);
    const expectPayload = (kind: string, file: any, mime: string): void => {
        const payload = prepareWith(kind, file);
        if (payload.kind !== kind || payload.mimeType !== mime || payload.source !== file.path) {
            throw new Error(`ShareContracts: ${kind}/${mime} 载荷不符合预期:${JSON.stringify(payload)}`);
        }
    };
    const expectFileFailure = (file: any, kindName: string, at: any = now): void => {
        try {
            prepareWith("file", file, at);
        } catch (e) {
            if ((e as any).kind === kindName) return;
            throw new Error(`ShareContracts: 期望 ${kindName},实际 ${(e as any).kind}`);
        }
        throw new Error(`ShareContracts: 期望抛出 ${kindName},实际未抛出`);
    };

    // 文件载荷允许图片/text/pdf;图片载荷只允许图片 mime。
    expectPayload("file", makeFile(), "image/png");
    expectPayload("file", makeFile({ mimeType: "text/plain" }), "text/plain");
    expectPayload("image", makeFile({ mimeType: "image/webp" }), "image/webp");
    const imageFile = makeFile({ mimeType: "text/plain" });
    try {
        prepareWith("image", imageFile);
        throw new Error("ShareContracts: 图片载荷不应接受 text/plain");
    } catch (e) {
        if ((e as any).kind !== kinds.INVALID_PAYLOAD) throw e;
    }

    // 时间戳:非有限、未来、超过 24h 均不可用。
    expectFileFailure(makeFile({ createdAtMillis: Number.NaN }), kinds.FILE_UNAVAILABLE);
    expectFileFailure(makeFile({ createdAtMillis: 2_000_000 }), kinds.FILE_UNAVAILABLE);
    expectFileFailure(makeFile({ createdAtMillis: 1 }), kinds.FILE_UNAVAILABLE,
        { nowMillis: 1_000_000_000, cacheDir: "/data/cache" });
    // 目录前缀/文件名安全检查。
    expectFileFailure(makeFile({ path: "/data/other/abc.png" }), kinds.INVALID_PAYLOAD);
    expectFileFailure(makeFile({ path: "/data/cache/share/a..b" }), kinds.INVALID_PAYLOAD);

    // lifecycle:创建、打开面板后的清理时间取 min(面板宽限, 临时文件最大存活)。
    const lifecycle = createLifecycle(makeFile());
    if (lifecycle.cleanupAfterMillis !== 999_000 + maxAge) {
        throw new Error(`ShareContracts: lifecycle cleanupAfterMillis 不符合预期:${JSON.stringify(lifecycle)}`);
    }
    let early = false;
    try {
        markOpened(lifecycle, 998_999);
    } catch (e) {
        early = true;
        if ((e as any).kind !== kinds.INVALID_PAYLOAD) throw e;
    }
    if (!early) throw new Error("ShareContracts: 早于 createdAtMillis 的面板时间应被拒绝");
    const opened = markOpened(lifecycle, 1_000_000);
    if (opened.cleanupAfterMillis !== Math.min(1_000_000 + grace, 999_000 + maxAge)) {
        throw new Error(`ShareContracts: markSharePanelOpened cleanupAfterMillis 不符合预期:${JSON.stringify(opened)}`);
    }
    if (!cleanup(lifecycle, lifecycle.cleanupAfterMillis)) throw new Error("ShareContracts: 到期后应清理临时文件");
    if (cleanup(lifecycle, lifecycle.cleanupAfterMillis - 1)) throw new Error("ShareContracts: 未到期不应清理临时文件");
}

/** 行为校验用的最小 URL 解析桩(与 AbsoluteUrlParser 的输出字段对齐)。 */
function parseUrlStub(url: string): unknown {
    const m = /^([a-zA-Z][a-zA-Z0-9+.-]*:)\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/.exec(url);
    if (!m) return undefined;
    let hostPart = m[2];
    let hasUserInfo = false;
    const at = hostPart.lastIndexOf("@");
    if (at >= 0) {
        hasUserInfo = true;
        hostPart = hostPart.slice(at + 1);
    }
    const params = new Map<string, string>();
    if (m[4] && m[4].startsWith("?")) {
        for (const kv of m[4].slice(1).split("&")) {
            if (kv.length === 0) continue;
            const eq = kv.indexOf("=");
            const key = eq < 0 ? kv : kv.slice(0, eq);
            const value = eq < 0 ? "" : kv.slice(eq + 1);
            try {
                params.set(decodeURIComponent(key), decodeURIComponent(value));
            } catch {
                params.set(key, value);
            }
        }
    }
    return {
        protocol: m[1].toLowerCase(),
        hostname: hostPart.toLowerCase(),
        port: "",
        pathname: m[3].length > 0 ? m[3] : "/",
        params,
        hasUserInfo,
    };
}

/**
 * 回归:switch 合成必须保证整个 `||` test 都能拆成 case。
 * 旧实现只收集能识别的比较项,把 `x === "a" || flag` 里的 `flag` 直接丢掉,
 * 生成只比较 `x` 的 switch,改变语义。无法完整拆分时应保持 if 链。
 */
function verifySwitchTransformRequiresAllCases(): void {
    const partial = NodeFactory.parse(`
function f(x, flag) {
  if (x === "a" || flag === true) {
    return 1;
  } else if (x === "b") {
    return 2;
  } else {
    return 3;
  }
}
`);
    SimplifyExport.simplify(partial);
    const partialCode = NodeFactory.generate(partial);
    if (partialCode.includes("switch (")) {
        throw new Error(`switch 合成: 无法完整拆分的 || 条件不应合成 switch\n${partialCode}`);
    }
    if (!partialCode.includes("flag === true")) {
        throw new Error(`switch 合成: 未识别的条件被丢弃\n${partialCode}`);
    }

    const complete = NodeFactory.parse(`
function f(x) {
  if (x === "a" || x === "b") {
    return 1;
  } else if (x === "c") {
    return 2;
  } else {
    return 3;
  }
}
`);
    SimplifyExport.simplify(complete);
    const completeCode = NodeFactory.generate(complete);
    for (const expected of ['case "a":', 'case "b":', 'case "c":', "default:"]) {
        if (!completeCode.includes(expected)) {
            throw new Error(`switch 合成: 缺少 ${expected}\n${completeCode}`);
        }
    }
}

/**
 * 回归:AbsoluteUrlParser 的第二个条件。
 * 源码是 `if (match === null || match[2].length === 0) return undefined;`,
 * 旧输出会把 `v1 = 0, v2 = 2, acc = !(match[2].length === 0)` 留在 test 里。
 * `v1/v2` 是后续代码复用的常量,应提到 if 前;布尔物化 acc 应删除。
 */
function verifyZhihuAbsoluteUrlParser(): void {
    const hapPath = path.join(__dirname, "resources", "zhihupp0.59.hap");
    const hap = new HapFile(new Uint8Array(fs.readFileSync(hapPath)));
    const pandaFile = new PandaFile(hap.readEntry("ets/modules.abc")!);
    const clazz = pandaFile.getAllClasses().find((c) => c.name.content.includes("AbsoluteUrlParser"));
    if (!clazz) throw new Error("hap: 未找到 AbsoluteUrlParser");

    const code = new PandaDecompiler().decompileClass(clazz);
    NodeFactory.parse(code);
    if (!code.includes("if (v0 === null || v0[2].length === 0)")) {
        throw new Error(`AbsoluteUrlParser: 条件未化简\n${code}`);
    }
    if (!code.includes('v0[4] ?? ""')) {
        throw new Error(`AbsoluteUrlParser: nullish 参数未还原\n${code}`);
    }
    if (code.includes("v1 = 0, v2 = 2") || code.includes("acc = !(")) {
        throw new Error(`AbsoluteUrlParser: test 序列仍残留死赋值\n${code}`);
    }

    const expectedPath = path.join(__dirname, "expected", "zhihu-absolute-url-parser.js");
    const expected = fs.readFileSync(expectedPath, "utf-8");
    if (code !== expected) {
        throw new Error(`AbsoluteUrlParser: 输出与快照不一致\n${firstDifference(expected, code)}`);
    }
}

/**
 * 回归:for...of 体内带多重退出路径(continue/return)时的循环词法节点。
 *
 * ArkTS 13 会在每条退出路径上内联一份 iterator.close 序列
 * (`if (it.return != undefined) { it.return(); ... }`),并与回边交织成
 * 一个条件分支密集的子图。旧实现 getLexicalNodes 只把条件的 第一个 后继
 * 加入工作队列,另一支上的 close 节点因此不算词法节点;
 * virtualizeIrregularExits 把它们当成“不规则出口”插入 break/goto 并把区域
 * 改成 Tail,整段子图从入口断开,后续 DFS 再也归约不到,3000 次迭代后抛
 * "can not reduce the graph",方法降级成 SimpleAnalysis(local_0_0 输出成一堆
 * label / decompiler_goto / decompiler_exception_handled_by)。
 *
 * 现在 DefaultOnlineHistoryRepository 的 local_0_0 应还原成真正的循环:
 *   v2 = p0[Symbol.iterator]();
 *   do { v5 = v2.next(); ... } while (v9 !== p1);
 * 并且不再出现降级标记与任何 decompiler_ 伪语句。
 */
function verifyZhihuForOfIteratorClose(): void {
    const hapPath = path.join(__dirname, "resources", "zhihupp0.59.hap");
    const hap = new HapFile(new Uint8Array(fs.readFileSync(hapPath)));
    const pandaFile = new PandaFile(hap.readEntry("ets/modules.abc")!);
    const clazz = pandaFile.getAllClasses().find((c) => c.name.content.includes("repository/DefaultOnlineHistoryRepository"));
    if (!clazz) throw new Error("hap: 未找到 DefaultOnlineHistoryRepository");

    const code = new PandaDecompiler().decompileClass(clazz);
    NodeFactory.parse(code);
    if (code.includes("created by SimpleAnalysis")) {
        throw new Error(`for...of 循环反汇编: local_0_0 仍降级为 SimpleAnalysis\n${code}`);
    }
    const start = code.indexOf("local_0_0 = function");
    if (start < 0) throw new Error(`for...of 循环反汇编: 未找到 local_0_0\n${code}`);
    const body = code.slice(start, code.indexOf("\n};", start));
    if (body.includes("decompiler_") || /\blabel_\d+/.test(body)) {
        throw new Error(`for...of 循环反汇编: 仍残留 goto/label 伪语句\n${body}`);
    }
    if (!body.includes("p0[Symbol.iterator]()") || !/(while \(true\)|\}\s*while \()/.test(body)) {
        throw new Error(`for...of 循环反汇编: 迭代器循环没有还原成 while 结构\n${body}`);
    }
    if (!body.includes("decodeURIComponent(") || !body.includes("Number(")) {
        throw new Error(`for...of 循环反汇编: 循环体语句丢失\n${body}`);
    }
    if (/\bhole\b/.test(code)) {
        throw new Error(`for...of 循环反汇编: iterator.close 收尾仍有 hole 哨兵\n${code}`);
    }

    const expectedPath = path.join(__dirname, "expected", "zhihu-default-online-history-repository.js");
    const expected = fs.readFileSync(expectedPath, "utf-8");
    if (code !== expected) {
        throw new Error(`DefaultOnlineHistoryRepository: 输出与快照不一致\n${firstDifference(expected, code)}`);
    }
}

/**
 * 回归:for...of 体内提前 return 时,头部 done 出口指向一个仍有其它前驱的 Tail。
 *
 * AppUpdateClient.fetchReleaseDetail 的两个 for...of 都是
 *   for (const item of list) { const d = decode(...); if (匹配) return OK; }
 * 编译后 done 分支跳到函数末尾的失败返回。这个 Tail 同时被 bundled 清单的
 * `length > 0` 判定引用,不是循环的 follow;旧实现把该出口虚拟化成
 * `break; //from goto label_2071`,后面又补了一条无条件 break,导致内层循环
 * 第一次 next() 后就直接跳出,decode 完全不执行,最终返回迭代器结果对象。
 *
 * 现在该 Tail 会复制进 done 分支,输出应满足:
 *   - fetchReleaseDetail 内没有 break / label / from goto;
 *   - 两个循环的耗尽路径都 return local_0_6(...)(共 2 处);
 *   - 两个 while test 仍包含 decodeReleaseDetail(循环体没有丢);
 *   - while test 里没有 `acc = ...` / 寄存器恢复(`v7 = v0`、`v8 = false`)这类
 *     结构化归约残留的死保存,累加器链已折成 `v8 = decodeReleaseDetail(JSON.stringify(v8))`。
 * 另用 test/expected/zhihu-app-update-client.js 锁定整个类的输出。
 */
function verifyZhihuAppUpdateClient(): void {
    const hapPath = path.join(__dirname, "resources", "zhihupp0.59.hap");
    const hap = new HapFile(new Uint8Array(fs.readFileSync(hapPath)));
    const pandaFile = new PandaFile(hap.readEntry("ets/modules.abc")!);
    const clazz = pandaFile.getAllClasses().find((c) => c.name.content.includes("update/AppUpdateClient"));
    if (!clazz) throw new Error("hap: 未找到 AppUpdateClient");

    const code = new PandaDecompiler().decompileClass(clazz);
    NodeFactory.parse(code);
    if (code.includes("created by SimpleAnalysis")) {
        throw new Error(`AppUpdateClient: 方法降级为 SimpleAnalysis\n${code}`);
    }
    const start = code.indexOf("async fetchReleaseDetail");
    if (start < 0) throw new Error(`AppUpdateClient: 未找到 fetchReleaseDetail\n${code}`);
    const body = code.slice(start, code.indexOf("\n    destroy(", start));
    if (body.includes("from goto") || /\blabel_\d+/.test(body)) {
        throw new Error(`AppUpdateClient: done 出口仍残留 goto/label 伪语句\n${body}`);
    }
    if (/\bbreak;/.test(body)) {
        throw new Error(`AppUpdateClient: 内层循环被无条件 break 截断\n${body}`);
    }
    const failedReturns = body.match(/return local_0_6\(/g)?.length ?? 0;
    if (failedReturns !== 2) {
        throw new Error(`AppUpdateClient: 两个 for...of 的耗尽路径都应返回失败结果,实际 ${failedReturns} 处\n${body}`);
    }
    const decodes = body.match(/decodeReleaseDetail\(/g)?.length ?? 0;
    if (decodes !== 2) {
        throw new Error(`AppUpdateClient: 两个循环应各保留一次 decodeReleaseDetail,实际 ${decodes} 处\n${body}`);
    }
    if (/while \([^\n]*(?:\bacc = |v7 = v0|v8 = false)/.test(body)) {
        throw new Error(`AppUpdateClient: 循环 test 仍残留 acc/寄存器恢复死保存\n${body}`);
    }

    const expectedPath = path.join(__dirname, "expected", "zhihu-app-update-client.js");
    const expected = fs.readFileSync(expectedPath, "utf-8");
    if (code !== expected) {
        throw new Error(`AppUpdateClient: 输出与快照不一致\n${firstDifference(expected, code)}`);
    }
}

/**
 * 回归:`createobjectwithbuffer` 的“模板对象 + 逐属性赋值”。
 *   acc = { protocol: null, hostname: null };
 *   acc.protocol = P; acc.hostname = H; return acc;
 * 应还原成 `return { protocol: P, hostname: H }`,属性求值顺序保持不变。
 */
function verifyObjectLiteralMaterialization(): void {
    const program = NodeFactory.parse(`
function f(v0, v2) {
  let acc;
  acc = {
    "protocol": null,
    "hostname": null
  };
  acc.protocol = "" + v0[1].toLowerCase() + ":";
  acc.hostname = v2.toLowerCase();
  return acc;
}
`);
    SimplifyExport.simplify(program);
    const code = NodeFactory.generate(program);
    if (!code.includes("return {") || !code.includes('"protocol": "" + v0[1].toLowerCase() + ":"')
        || !code.includes('"hostname": v2.toLowerCase()')) {
        throw new Error(`simplify: 模板对象未还原为对象字面量\n${code}`);
    }
    if (code.includes("acc.protocol =") || code.includes('"protocol": null')) {
        throw new Error(`simplify: 仍残留模板对象/逐属性赋值\n${code}`);
    }
}

/**
 * 回归:nullish coalescing 的 switch lowering。
 *   v8 = item.content.contentId;
 *   switch (item.content.contentId) { case null: case undefined: v8 = ""; }
 * 应还原成 `item.content.contentId ?? ""`;判别式是纯成员表达式，只求值一次。
 */
function verifyNullishSwitchFold(): void {
    const program = NodeFactory.parse(`
function f(item) {
  let v8;
  v8 = item.content.contentId;
  if (item.content.contentId === null || item.content.contentId === undefined) {
    v8 = "";
  }
  return v8;
}
`);
    SimplifyExport.simplify(program);
    const code = NodeFactory.generate(program);
    if (!code.includes('return item.content.contentId ?? "";')) {
        throw new Error(`simplify: nullish switch 未还原成 ??\n${code}`);
    }
    if (code.includes("switch (")) {
        throw new Error(`simplify: 仍残留 nullish switch\n${code}`);
    }

    // 两个 case 各写同一个默认值的形态(编译器把 `??` 展开成 if/else if):
    //   v0 = v0 == null ? undefined : v0.count;
    //   switch (v0) { case null: v0 = 0; case undefined: v0 = 0; }
    // -> return v0?.count ?? 0;
    const twoCase = NodeFactory.parse(`
function g(v0) {
  v0 = v0 == null ? undefined : v0.count;
  switch (v0) {
    case null:
      v0 = 0;
      break;
    case undefined:
      v0 = 0;
      break;
  }
  return v0;
}
`);
    SimplifyExport.simplify(twoCase);
    const twoCaseCode = NodeFactory.generate(twoCase);
    if (!twoCaseCode.includes("return v0?.count ?? 0;")) {
        throw new Error(`simplify: 双 case nullish switch 未还原成 ??\n${twoCaseCode}`);
    }
}

/**
 * 回归:ArkTS 13 的 `hole` 哨兵收尾清理。
 *   - `if (hole == vN) { <正常路径> } else { throw vN; }` → 正常路径;
 *   - `class X extends hole` → `class X`(无 extends);
 *   - 终止语句后的不可达语句(`continue; throw hole;`)删除。
 * 这些形态来自 for...of 的 iterator.close 收尾和 try/finally 收尾,
 * `hole` 是未定义标识符,不清理会让输出既不可读也不可执行。
 */
function verifySentinelGuardCleanup(): void {
    const program = NodeFactory.parse(`
function f(v0) {
  let v1;
  v1 = hole;
  if (hole == v1) {
    return 1;
  } else {
    throw v1;
  }
}
function g(p0) {
  let v0;
  while (p0) {
    v0 = p0;
    if (hole != v0) {
      throw v0;
    }
    continue;
    throw hole;
  }
}
class HoleBase extends hole {
  m() {
    return 1;
  }
}
`);
    SimplifyExport.simplify(program);
    const code = NodeFactory.generate(program);
    if (/\bhole\b/.test(code)) {
        throw new Error(`哨兵清理: 仍残留 hole\n${code}`);
    }
    if (!code.includes("return 1;") || !code.includes("while (p0)")) {
        throw new Error(`哨兵清理: 正常路径丢失\n${code}`);
    }
    if (code.includes("throw v0;") || code.includes("throw hole;")) {
        throw new Error(`哨兵清理: rethrow 守卫未删除\n${code}`);
    }
    if (!code.includes("class HoleBase {") || code.includes("extends")) {
        throw new Error(`哨兵清理: 无父类 class 仍带 extends\n${code}`);
    }

    // 循环归约残留的孤儿 continue/break:构造一个含循环的函数,再把跳转挪到循环外
    const orphanProgram = NodeFactory.parse(`function f(p0) { while (true) { if (p0) break; } }`);
    const fnBody = (orphanProgram.body[0] as TYPE.FunctionDeclaration).body.body as TYPE.Statement[];
    fnBody.push(TYPE.continueStatement(), TYPE.breakStatement());
    SimplifyExport.simplify(orphanProgram);
    const finalBody = (orphanProgram.body[0] as TYPE.FunctionDeclaration).body.body as TYPE.Statement[];
    if (finalBody.some((statement) => TYPE.isContinueStatement(statement) || TYPE.isBreakStatement(statement))) {
        throw new Error(`哨兵清理: 循环外的孤儿跳转未删除\n${NodeFactory.generate(orphanProgram)}`);
    }
    NodeFactory.parse(NodeFactory.generate(orphanProgram));
}

/**
 * 回归:循环体末条语句是 continue/break 时的活跃性(aliasing)。
 *
 * transfer/transferLive 在 Break/Continue 上曾直接返回 liveOut 本身,
 * 而调用方是 `live.clear(); for (name of before) live.add(name)`——
 * 同一个 Set 被清空后活跃集丢失,循环 test 的读取不再算使用:
 *   v0 = p0; while (v0) { v0 = false; continue; }
 * 被错误折叠成 `while (p0) { continue; }`(死循环)。
 */
function verifyLoopLivenessAfterContinue(): void {
    const program = NodeFactory.parse(`
function f(p0) {
  let v0;
  v0 = p0;
  while (v0) {
    v0 = false;
    continue;
  }
}
`);
    SimplifyExport.simplify(program);
    const code = NodeFactory.generate(program);
    if (!code.includes("while (v0)") || !code.includes("v0 = false;")) {
        throw new Error(`活跃性: continue 之前的循环变量赋值被误删\n${code}`);
    }
    if (code.includes("while (p0)")) {
        throw new Error(`活跃性: 循环 test 错误地传播成循环前的值\n${code}`);
    }

    // break 分支跳出循环后仍会读取变量:赋值不能被搬进 test 造成重复求值
    const breakProgram = NodeFactory.parse(`
function poll(p0) {
  let v4;
  while (true) {
    v4 = g();
    if (v4.completed) break;
    v4 = h();
  }
  return v4;
}
`);
    SimplifyExport.simplify(breakProgram);
    const breakCode = NodeFactory.generate(breakProgram);
    if (!breakCode.includes("v4 = g();") || !breakCode.includes("if (v4.completed)")) {
        throw new Error(`活跃性: break 后仍被读取的赋值被搬进 test\n${breakCode}`);
    }
    if (breakCode.includes("if (g().completed)")) {
        throw new Error(`活跃性: 有副作用的调用被复制到 test\n${breakCode}`);
    }
}

/**
 * 回归:超长逻辑链的输出折行。
 *   - 超过 120 字符的行在顶层 `||` / `&&` / `??` 前折行,新行以操作符开头;
 *   - 字符串里的 `||`、顶层三目都不参与折行。
 */
function verifyLogicalChainFormatting(): void {
    const operands = Array.from({ length: 30 }, (_, i) => `value === AppDestinationName.N${i}`);
    const formatted = formatLongLogicalChains(`  return ${operands.join(" || ")};`);
    const lines = formatted.split("\n");
    if (lines.length !== operands.length || !lines[1].startsWith("    || value === AppDestinationName.N1")) {
        throw new Error(`格式化: 逻辑链未按操作符折行\n${formatted}`);
    }
    if (!lines[lines.length - 1].endsWith(";")) {
        throw new Error(`格式化: 语句结尾丢失\n${formatted}`);
    }

    const stringLine = `  return "${"x || ".repeat(40)}";`;
    if (formatLongLogicalChains(stringLine) !== stringLine) {
        throw new Error(`格式化: 字符串内部的 || 不应折行\n${formatLongLogicalChains(stringLine)}`);
    }

    const ternaryLine = `  return ${operands.join(" || ")} ? 1 : 2;`;
    if (formatLongLogicalChains(ternaryLine) !== ternaryLine) {
        throw new Error(`格式化: 顶层三目条件不应折行\n${formatLongLogicalChains(ternaryLine)}`);
    }
}

async function main(): Promise<void> {
    console.log("[test] simplify return liveness");
    verifyReturnValueLiveness();
    console.log("    ok");

    console.log("[test] simplify accumulator chain fold");
    verifyAccumulatorChainFold();
    console.log("    ok");

    console.log("[test] simplify condition materialization into test");
    verifyConditionMaterializationIntoTest();
    console.log("    ok");

    console.log("[test] simplify tail temp alias fold");
    verifyTailTempAliasFold();
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

    console.log("[test] simplify self read chain + nested conditional");
    verifySelfReadChainAndNestedConditional();
    console.log("    ok");

    console.log("[test] simplify boolean conditional folding");
    verifyBooleanConditionalFolding();
    console.log("    ok");

    console.log("[test] simplify loop condition fold");
    verifyLoopConditionFold();
    console.log("    ok");

    console.log("[test] simplify for...of restoration");
    verifyForOfRestoration();
    console.log("    ok");

    console.log("[test] simplify test sequence scratch removal");
    verifyTestSequenceScratchRemoval();
    console.log("    ok");

    console.log("[test] simplify branch value kept in test folds");
    verifyBranchValueKeptInTestFolds();
    console.log("    ok");

    console.log("[test] simplify object literal materialization");
    verifyObjectLiteralMaterialization();
    console.log("    ok");

    console.log("[test] simplify nullish switch fold");
    verifyNullishSwitchFold();
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

    console.log("[test] hap ContentDetailPages (zhihupp0.59.hap)");
    verifyZhihuContentDetailPages();
    console.log("    ok");

    console.log("[test] hap AbsoluteUrlParser (zhihupp0.59.hap)");
    verifyZhihuAbsoluteUrlParser();
    console.log("    ok");

    console.log("[test] hap for...of iterator close (zhihupp0.59.hap)");
    verifyZhihuForOfIteratorClose();
    console.log("    ok");

    console.log("[test] hap AppUpdateClient (zhihupp0.59.hap)");
    verifyZhihuAppUpdateClient();
    console.log("    ok");

    console.log("[test] hap AppDestination (zhihupp0.59.hap)");
    verifyZhihuAppDestination();
    console.log("    ok");

    console.log("[test] hap StartupDestinationChannel (zhihupp0.59.hap)");
    verifyZhihuStartupDestinationChannel();
    console.log("    ok");

    console.log("[test] hap DeepLinkResolver (zhihupp0.59.hap)");
    verifyZhihuDeepLinkResolver();
    console.log("    ok");

    console.log("[test] hap ShareContracts (zhihupp0.59.hap)");
    verifyZhihuShareContracts();
    console.log("    ok");

    console.log("[test] simplify switch transform completeness");
    verifySwitchTransformRequiresAllCases();
    console.log("    ok");

    console.log("[test] simplify hole sentinel cleanup");
    verifySentinelGuardCleanup();
    console.log("    ok");

    console.log("[test] simplify loop liveness after continue");
    verifyLoopLivenessAfterContinue();
    console.log("    ok");

    console.log("[test] output logical chain formatting");
    verifyLogicalChainFormatting();
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
