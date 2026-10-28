import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";
import * as crypto from "crypto";
import { PandaFile, ENTRY_FUNCTION_MAIN } from "../src/file/PandaFile";
import { PandaDecompiler } from "../src/PandaDecompiler";
import { NodeFactory } from "../src/ast/NodeFactory";
import { SimplifyExport } from "../src/simplify/SimplifyExport";
import { NullishCoalescingSimplify } from "../src/simplify/NullishCoalescingSimplify";
import { SyntaxRewriteSimplify } from "../src/simplify/SyntaxRewriteSimplify";
import { restoreGotoLoops } from "../src/simplify/GotoLoopRestore";
import { HapFile } from "../src/hap/HapFile";
import type { PandaClass } from "../src/file/clazz/PandaClass";
import { ResourceIndexFile } from "../src/res/ResourceIndexFile";
import { formatLongLogicalChains } from "../src/ast/FormatCode";
import { KIND_MAP } from "../src/disasm/PandaInstruction";
import * as TYPE from "@babel/types";
import traverse from "@babel/traverse";

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
 *  12. 校验 ContentDetailPages 的 try/finally 还原与整体输出快照;
 *  13. 校验 yourpipe0.7.0.abc 的 SabrResponseDecoder 在含嵌套作用域的 for-of 还原中不崩;
 *  14. 校验 yourpipe0.7.0.abc 的 HttpDownloader 循环体内嵌套 try/catch 的区域归约与条件极性;
 *  15. 校验 yourpipe0.7.0.abc 的 MusicSearchService 的真值守卫三目到可选链、`it.next` 提升形态
 *      的 for-of 还原与累加器死枢纽拷贝折叠;
 *  16. 校验 yourpipe0.7.0.abc 的 AVPlayer 资源对象(LiteralTag.ACCESSOR 字面量)不再生成非法 JS;
 *  17. 校验 yourpipe0.7.0.abc 的 ChannelInfoService 共享返回尾块收敛为一份、
 *      预装载寄存器的死赋值与测试序列物化残渣清零;
 *  18. 校验 yourpipe0.7.0.abc 的 SabrOfflineDownloader 里 findFollowLatch 兜底的
 *      `label + xpanda_goto` 还原成 while (true) 循环,停顿计数器不再被常量传播;
 *  19. 校验 yourpipe0.7.0.abc 的 YoutubePageAttestationBootstrap 里 switch case 体
 *      的不可达 break 被清掉(case 体裁剪同时服务于还原出来的循环);
 *  20. 校验 amcl1.0.6.abc 的 i8 类 do-while 出口扫描不越界(旧实现无限增长 OOM)
 *      与 z12 类的共享后继指数展开在结构分析里收敛成线性结构;
 *  21. 校验 amcl1.0.6.abc 的 commons/h1/w1 类不再因 finally handler 下游的带环孤岛
 *      整方法降级 SimpleAnalysis;
 *  22. 校验 amcl1.0.6.abc 的 r2/l3 类不会因语句图成环(while 里的 if 的 else 指向
 *      被合并进来的 region 自身)无限递归/爆栈,loadLive 正常结构化。
 */

interface Sample {
    abc: string;
    expected: string;
    verify?: (code: string) => void;
}

function decompileSample(abcFileName: string): { code: string; classes: number } {
    const pandaFile = loadPandaFile(abcFileName, { parse: true });
    const parts: string[] = [];
    let classes = 0;
    for (const cls of pandaFile.getAllClasses()) {
        const js = decompileClassOnce(cls);
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

/**
 * 二进制加载/类反编译缓存。
 *
 * 同一个 .abc / .hap 只读一次、只解析一次;同一个类的反编译结果只算一次
 * (AGENTS 规则 6:单类输出是该类的纯函数)。跨类用例通过 BinaryContext 的
 * 索引取类,不再反复遍历 getAllClasses()。
 */
const abcCache = new Map<string, PandaFile>();
const hapFileCache = new Map<string, HapFile>();
const parsedAbc = new Set<string>();
const classCodeCache = new WeakMap<object, string>();
const sharedDecompiler = new PandaDecompiler();

function resourcePath(fileName: string): string {
    return path.join(__dirname, "resources", fileName);
}

function loadHapOnce(fileName: string): HapFile {
    let hap = hapFileCache.get(fileName);
    if (!hap) {
        hap = new HapFile(new Uint8Array(fs.readFileSync(resourcePath(fileName))));
        hapFileCache.set(fileName, hap);
    }
    return hap;
}

function loadPandaFile(fileName: string, options: { parse?: boolean; hapEntry?: string } = {}): PandaFile {
    const { parse = false, hapEntry } = options;
    const key = hapEntry ? `${fileName}#${hapEntry}` : fileName;
    let pandaFile = abcCache.get(key);
    if (!pandaFile) {
        const data = hapEntry
            ? loadHapOnce(fileName).readEntry(hapEntry)!
            : new Uint8Array(fs.readFileSync(resourcePath(fileName)));
        pandaFile = new PandaFile(data);
        abcCache.set(key, pandaFile);
    }
    if (parse && !parsedAbc.has(key)) {
        pandaFile.parseAssembly();
        parsedAbc.add(key);
    }
    return pandaFile;
}

function decompileClassOnce(clazz: PandaClass): string {
    let code = classCodeCache.get(clazz);
    if (code === undefined) {
        code = sharedDecompiler.decompileClass(clazz);
        classCodeCache.set(clazz, code);
    }
    return code;
}

interface BinaryContext {
    pandaFile: PandaFile;
    /** 单次收集的类表与索引,跨类断言直接查表,不再重复遍历 */
    classes: PandaClass[];
    byName: Map<string, PandaClass>;
    decompileNamed: (exactName: string) => string;
    decompileContaining: (needle: string) => { clazz: PandaClass; code: string };
}

interface BinaryClassTest {
    label: string;
    matches: (className: string) => boolean;
    run: (clazz: PandaClass, code: string, ctx: BinaryContext) => void;
}

/**
 * 一个二进制一个 pass:遍历一次类表,把命中的用例当场回调。
 * 同一个类被多个用例命中时共享同一份反编译结果(WeakMap 缓存)。
 */
function runClassSuite(
    fileName: string,
    tests: BinaryClassTest[],
    options: { parse?: boolean; hapEntry?: string } = {},
): void {
    const pandaFile = loadPandaFile(fileName, options);
    const classes = pandaFile.getAllClasses();
    const byName = new Map<string, PandaClass>();
    for (const clazz of classes) byName.set(clazz.name.content, clazz);
    const ctx: BinaryContext = {
        pandaFile,
        classes,
        byName,
        decompileNamed: (exactName: string): string => {
            const clazz = byName.get(exactName);
            if (!clazz) throw new Error(`未找到类 ${exactName}`);
            return decompileClassOnce(clazz);
        },
        decompileContaining: (needle: string) => {
            const clazz = classes.find((candidate) => candidate.name.content.includes(needle));
            if (!clazz) throw new Error(`未找到包含 ${needle} 的类`);
            return { clazz, code: decompileClassOnce(clazz) };
        },
    };
    const pending = tests.slice();
    for (const clazz of classes) {
        const name = clazz.name.content;
        for (let index = pending.length - 1; index >= 0; index--) {
            if (!pending[index].matches(name)) continue;
            const test = pending.splice(index, 1)[0];
            console.log(`[test] ${test.label}`);
            test.run(clazz, decompileClassOnce(clazz), ctx);
            console.log("    ok");
        }
        if (pending.length === 0) break;
    }
    if (pending.length > 0) {
        throw new Error(`未找到测试类: ${pending.map((test) => test.label).join(", ")}`);
    }
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

/**
 * 沙箱执行前剥掉模块导出:`export { X };` 整行删除;
 * `export class/function/const/let/var` 形态只去掉 export 前缀(声明本身要保留)。
 */
function stripModuleExports(code: string): string {
    return code.replace(/^export\s+\{[^}]*\};\s*$/gm, "")
        .replace(/^export\s+(?=(?:async\s+)?(?:class|function|const|let|var)\b)/gm, "");
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
    // 对象方法(函数属性)也要并进对象字面量;方法体内的同名局部变量不能算作
    // 对外层对象的引用(否则 cipher/subBytes 等都会留在 v0.xxx = ... 形式)。
    for (const fragment of ['"cipher": function cipher(', '"subBytes": function subBytes(', '"generateKey": function generateKey(']) {
        if (!code.includes(fragment)) {
            throw new Error(`aes: 对象方法未并进字面量,缺少 ${fragment}\n${code.slice(0, 500)}`);
        }
    }
    if (code.includes("v0.cipher =") || code.includes("v0.generateKey =")) {
        throw new Error(`aes: 对象方法仍以属性赋值形式输出\n${code.slice(0, 500)}`);
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
 * 回归:成员调用链 + Hub 别名(累加器旧值在别名之后仍被读取)。
 *
 *   acc = p0 || ""; acc = acc.trim(); v5 = acc;
 *   if (acc.length === 0) {...}  v6 = exec(acc);  acc = G;
 *
 * `acc = acc.trim()` 是成员调用自读取(不是二元运算),链要先折成 `acc = (p0 || "").trim()`;
 * `v5 = acc` 之后到下一次写 acc 之前的读取都属于旧值,要整体重定向到 v5,
 * 让 `acc = E` 与 `v5 = acc` 合并成 `v5 = (p0 || "").trim()`。
 */
function verifyAccumulatorMemberCallChain(): void {
    const program = NodeFactory.parse(`
function buildChain(p0) {
  let v5, v6, acc;
  acc = p0 || "";
  acc = acc.trim();
  v5 = acc;
  if (acc.length === 0) {
    return [];
  }
  v6 = exec(acc);
  acc = v6 ? v5 : "x";
  return [v5, acc];
}
`);
    SimplifyExport.simplify(program);
    const code = NodeFactory.generate(program);
    if (!code.includes('v5 = (p0 || "").trim();')) {
        throw new Error(`simplify: 成员调用累加器链未折叠\n${code}`);
    }
    if (!code.includes("if (v5.length === 0)") || !code.includes("exec(v5)")) {
        throw new Error(`simplify: Hub 之后的读取未重定向到别名\n${code}`);
    }
    if (!code.includes('? v5 : "x"') || code.includes("acc = acc.trim()") || code.includes("exec(acc)")) {
        throw new Error(`simplify: 第二次写入/旧值残留不正确\n${code}`);
    }
}

/**
 * 回归:可选链/`??` 还原后才出现的累加器枢纽搬进下一条语句的唯一读取。
 *   acc = v0?.client; v1 = asRecord(acc);
 *   acc = flags(p0) ?? ""; v2 = parse(acc);
 *   acc = !v3; v4 = acc ? "content" : "none";
 * 这些形态由 tryRestoreOptionalChain / NullishCoalescing 在流水线尾部才生成,
 * 定点迭代里的复制传播已经跑完,需要 simplifyTail 之后的 foldNextReadAssignments。
 */
function verifyAccumulatorNextReadFold(): void {
    const program = NodeFactory.parse(`
function build(p0) {
  let v0, v1, v2, v3, v4, acc;
  v0 = p0?.client;
  acc = v0?.name;
  v1 = asRecord(acc);
  acc = flags(p0) ?? "";
  v2 = parse(acc);
  v3 = v1 && v2;
  acc = !v3;
  v4 = acc ? "content" : "none";
  return [v1, v2, v4];
}
`);
    SimplifyExport.simplify(program);
    const code = NodeFactory.generate(program);
    if (code.includes("acc")) {
        throw new Error(`simplify: 累加器枢纽未搬进下一条语句的唯一读取\n${code}`);
    }
    if (!code.includes('v2 = parse(flags(p0) ?? "");')) {
        throw new Error(`simplify: 非纯右值(调用/??)未搬进调用参数\n${code}`);
    }
    if (!code.includes('? "none" : "content"')) {
        throw new Error(`simplify: 布尔物化未搬进三目 test\n${code}`);
    }
}

/**
 * 回归:for...of + break 的 do-while lowering 还原。
 *
 *   it = xs[Symbol.iterator]();
 *   do {
 *     vv = it.next();
 *     if (vv.done) { DONE }
 *     ...; acc = !T;
 *   } while (acc);
 *   EXIT;                  // break 路径前缀
 *   close(it);
 *   AFTER
 *
 * → for (vv of xs) { ...; if (T) { EXIT; break; } } AFTER
 * 循环耗尽和 break 都落到 close 之后的续接代码上,DONE 是同一块的副本,必须丢弃,
 * 否则 break 会落到耗尽分支上。
 */
function verifyDoWhileBreakForOf(): void {
    const program = NodeFactory.parse(`
function pick(p0) {
  let v1, v2, v3, v5, acc;
  let it, found;
  found = undefined;
  it = p0[Symbol.iterator]();
  do {
    v1 = it.next();
    if (v1.done) {
      if (found) {
        throw new Error("no item");
      }
      throw new Error("no item");
    }
    v2 = v1.value;
    v3 = check(v1.value);
    acc = !v3;
  } while (acc);
  found = v2;
  v5 = v3;
  if (it.return != undefined) {
    it.return();
  }
  if (found) {
    return [found, v5];
  }
  throw new Error("no item");
}
`);
    SimplifyExport.simplify(program);
    const code = NodeFactory.generate(program);
    if (code.includes("[Symbol.iterator]") || code.includes("do {")) {
        throw new Error(`simplify: break 形态的 for...of 未还原\n${code}`);
    }
    if (!/for \(v1 of p0\) \{\s*v2 = v1;\s*if \(check\(v1\)\) \{\s*found = v2;\s*break;/.test(code)) {
        throw new Error(`simplify: 出口判断未还原成 if (T) { ... break; }\n${code}`);
    }
    if (!/if \(found\) \{\s*return \[found, v3\];/.test(code)) {
        throw new Error(`simplify: close 之后的续接代码被破坏\n${code}`);
    }
}

/**
 * 回归:do-while 迭代器循环位于语句列表末尾、循环体没有提前退出时,编译器不生成
 * iterator close,循环之后只剩 test 为假时的出口 `throw E`。
 *
 *   it = p0[Symbol.iterator]();
 *   do { vv = it.next(); if (vv.done) return; ... } while (acc);
 *   throw E;                 // 循环之后没有 close/续接代码
 *
 * → for (vv of p0) { ...; if (!T) throw E } return;
 *
 * 同时回归出口扫描不能越过语句列表末尾:`getNextSibling()` 在列表末尾返回的是
 * node 为 null 的 NodePath(对象非空),旧实现按对象判空会让出口扫描无限前进、
 * exitPaths 无限增长,单类 simplify 直接 OOM
 * (amcl1.0.6.abc 的 `L&entry/src/main/ets/r5/i8&;` 曾因此崩溃)。
 */
function verifyDoWhileExitScanAtBlockEnd(): void {
    const program = NodeFactory.parse(`
function check(p0) {
  let v1, v2, v3, acc;
  let it;
  it = p0[Symbol.iterator]();
  acc = false;
  do {
    v1 = it.next();
    if (v1.done) {
      return;
    }
    v2 = v1.value;
    v3 = directory(v2);
    acc = !v3;
    if (acc) {
      continue;
    }
    acc = /^[0-9a-f]{64}$/.test(v2);
  } while (!!acc);
  throw new Error("no item");
}
`);
    SimplifyExport.simplify(program);
    const code = NodeFactory.generate(program);
    // 没有 close 的形态也要还原成 for...of:出口 throw 变成循环体内的 if (!T) throw
    if (code.includes("do {") || code.includes("[Symbol.iterator]") || code.includes(".next()")) {
        throw new Error(`simplify: 无 close 的迭代器循环未还原成 for...of\n${code}`);
    }
    if (!/for \(v1 of p0\) \{/.test(code)) {
        throw new Error(`simplify: for...of 头部未还原\n${code}`);
    }
    if (!/if \(!\/\^\[0-9a-f\]\{64\}\$\/\.test\(v1\)\) throw new Error\("no item"\);/.test(code)) {
        throw new Error(`simplify: 循环后的出口语句未折成循环体内的 if (!T) throw\n${code}`);
    }
    if (!/return;/.test(code)) {
        throw new Error(`simplify: 循环耗尽分支被丢弃\n${code}`);
    }
}

/**
 * 回归:迭代器临时量同时被复用为不相关值(`v2 = 65535`),且读取排在循环后面时,
 * 只要循环出口紧接着 return/throw,该读取就不可能执行到,内层 for...of 仍应还原。
 *
 *   v2 = 65535;
 *   do {
 *     ...
 *     if (done) {
 *       v2 = p0.keys()[Symbol.iterator]();
 *       while (true) { v6 = v2.next(); if (v6.done) break; ... }
 *       return;                 // 循环出口直接 leave
 *     }
 *     if (compare(...) > v2) throw ...;   // 语句顺序上在循环之后,实际执行不到
 *   } while (...);
 *
 * 旧 hasNewerValueBefore 只按语句顺序判断,认为读取 v2 需要更新的赋值,放弃还原。
 * 外层循环的 test 是裸条件(`while (again(vv.value))`),同时覆盖“raw test 也要
 * 还原成 for...of”的路径:没有解包语句时循环 test 里的 `vv.value` 与循环体
 * 同一语义(迭代器结果的 value),还原后一起换成循环变量本身。
 */
function verifyReusedIteratorTempForOf(): void {
    const program = NodeFactory.parse(`
function check(p0) {
  let v2, v4, v6, v7;
  v2 = 65535;
  v4 = p0[Symbol.iterator]();
  do {
    v7 = v4.next();
    if (v7.done) {
      v2 = p0.keys()[Symbol.iterator]();
      while (true) {
        v6 = v2.next();
        if (v6.done) break;
        use(v6.value);
      }
      return;
    }
    if (compare(v7.value) > v2) {
      throw new Error("too long");
    }
  } while (again(v7.value));
  throw new Error("exhausted");
}
`);
    SimplifyExport.simplify(program);
    const code = NodeFactory.generate(program);
    if (!code.includes("for (v6 of p0.keys()) {")) {
        throw new Error(`simplify: 复用的迭代器临时量阻断 for...of 还原\n${code}`);
    }
    if (code.includes("while (true)") || code.includes("p0.keys()[Symbol.iterator]")) {
        throw new Error(`simplify: 迭代器 lowering 残留\n${code}`);
    }
    // 另一个 live range 的读取必须保留原值(65535),不能改成迭代器;
    // 外层循环(test 为裸条件)也还原成 for...of,循环变量的 .value 统一换成变量本身。
    if (!code.includes("for (v7 of p0) {")
        || !code.includes("if (compare(v7) > v2) {") || !code.includes("v2 = 65535;")) {
        throw new Error(`simplify: 复用临时量的另一处读取被破坏\n${code}`);
    }
}

/**
 * 回归:`then` 分支一定终止时展开 else(守卫子句)。
 *   if (!p0) { return null; } else { BODY }  ->  if (!p0) { return null; } BODY
 * 两分支都是单条 return 的 if/else 仍由三目合成处理(verifyConditionMaterializationIntoTest)。
 */
function verifyElseAfterExitFlatten(): void {
    const program = NodeFactory.parse(`
function pick(p0, p1) {
  let v0;
  if (!p0) {
    return null;
  } else {
    v0 = p1 + 1;
    return v0;
  }
}
function early(p0) {
  let v0;
  if (p0) {
    throw new Error("bad");
  } else {
    v0 = p0.length;
  }
  return v0;
}
`);
    SimplifyExport.simplify(program);
    const code = NodeFactory.generate(program);
    if (code.includes("else")) {
        throw new Error(`simplify: then 分支终止后 else 未展开\n${code}`);
    }
    // 两分支都能合成三目的仍然合成三目(不因展开而拆散源码里的条件表达式)
    if (!code.includes("return p0 ? p1 + 1 : null;")) {
        throw new Error(`simplify: 三目合成被 else 展开破坏\n${code}`);
    }
    // 另一分支没有单条 return 可合成时,展开成守卫子句
    if (!/if \(p0\) \{\s*throw new Error\("bad"\);\s*\}\s*return p0\.length;/.test(code)) {
        throw new Error(`simplify: 守卫子句未保留\n${code}`);
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
 * 回归:条件物化里的别名拷贝 `X = E; Y = X; X = !X; if (X/!X/复合条件)`。
 *
 * ArkTS 会把源级局部量复用成寄存器拷贝,别名语句夹在累加器物化与取反链之间;
 * 复制传播通常又把它变成 `Y = E`(右值与 E 逐字相同)。以前 `matchConditionPattern`
 * 从 if 往前只认连续的自取反链,撞上别名就放弃,于是 a12 里一直留着
 *   acc = v9.downloads; v9 = v9.downloads; acc = !acc; if (!acc && v9.artifact)
 * 现在别名语句保留在取反链之前(必要时把 `Y = X` 改写成 `Y = E`),test 里对 X 的
 * 读取换成 Y(按取反奇偶性):
 *   v9 = v9.downloads; if (v9 && v9.artifact)
 */
function verifyConditionAliasFold(): void {
    const program = NodeFactory.parse(`
function copyAlias(v9) {
  let acc;
  acc = v9.downloads;
  v9 = acc;
  acc = !acc;
  if (!acc && v9.artifact) {
    v9 = v9.artifact;
    use(v9);
  }
  return v9;
}
function propagatedAlias(v9) {
  let acc;
  acc = v9.downloads;
  v9 = v9.downloads;
  acc = !acc;
  if (!acc && v9.artifact) {
    use(v9);
  }
  return v9;
}
`);

    SimplifyExport.simplify(program);
    const code = NodeFactory.generate(program);
    if (code.includes("acc = !acc")) {
        throw new Error(`simplify: 别名物化链未折叠\n${code}`);
    }
    if ((code.match(/if \(v9 && v9\.artifact\) \{/g) ?? []).length !== 2) {
        throw new Error(`simplify: 两种别名形态都应折叠成 if (v9 && v9.artifact)\n${code}`);
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
    // 声明可能被 mergeDeclarationInitializers 合并成 `let local_1_1 = undefined;` 的
    // 形态,回归只要求两个闭包写入的绑定都仍然被声明、返回值仍读取变量本身。
    if (!(/let\s+local_1_0/.test(code) && /let\s+local_1_1/.test(code)) || !code.includes("return local_1_1")) {
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
 * 回归:已合并的自调用形态。
 *   `acc = E; v8 = E; acc = acc.toLowerCase.call(v8)`
 * 自引用链折叠先把 `acc = acc.toLowerCase; acc = acc.call(v8)` 合成一条语句,
 * AccCallSimplify 需要按接收者别名(`v8 = acc` / 紧邻克隆 `acc = E; v8 = E`)
 * 还原成 `v8.toLowerCase()`,不能留下重复求值的 `acc = E` 与 `.call(v8)`。
 * 方法量存放在无关变量里(`v1 = acc.substring; v1.call(v2, ...)`)不属于该形态,保持原样。
 */
function verifyMergedSelfCallFold(): void {
    const program = NodeFactory.parse(`
function foldText(v8) {
  let v9, acc;
  v9 = v8.filePath;
  acc = v8.filename + "\\n" + v8.displayName;
  v8 = v8.filename + "\\n" + v8.displayName;
  acc = acc.toLowerCase.call(v8);
  return [v9, acc];
}
function foldMember(obj, v0, row) {
  let acc;
  acc = row.targets;
  v0 = row.targets;
  obj.preview = acc.slice.call(v0);
  return obj;
}
function keepUnrelated(acc, v2) {
  let v1;
  v1 = acc.substring;
  acc = v1.call(v2, 0, 8);
  return acc;
}
function sameReceiver(acc) {
  if (!acc && (acc = list(), acc = acc.some.call(acc, function (p0) {
    return p0.ok;
  }))) {
    return acc;
  }
  return undefined;
}
`);
    SimplifyExport.simplify(program);
    const code = NodeFactory.generate(program);
    if (!code.includes('return [v8.filePath, (v8.filename + "\\n" + v8.displayName).toLowerCase()];')) {
        throw new Error(`simplify: 合并后的自调用未按接收者别名还原\n${code}`);
    }
    if (!code.includes("obj.preview = row.targets.slice();")) {
        throw new Error(`simplify: 成员目标的自调用未还原\n${code}`);
    }
    if (!code.includes("return acc.substring.call(v2, 0, 8);")) {
        throw new Error(`simplify: 无关方法量被误改写\n${code}`);
    }
    if (code.includes("some.call(")) {
        throw new Error(`simplify: 接收者与对象同名的方法量未还原\n${code}`);
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
 * 回归:短路链链头的取反 test 自赋值 `if (!A) { X = A }`。
 *
 * 编译器把 `X = A && B`(此时 X 已经保存 B)降级成"A 为假时把 A 写回结果变量,
 * 否则保持 B",即 `if (!A) { X = A }`。它后面紧跟 `if (X) { X = C }` 短路链,
 * 链头不是赋值语句时 matchShortCircuitFold 无法匹配,整条链都会留在 if 形态
 * (NgaQrLoginUtils 的登录参数校验)。折叠成 `X = A && X` 后原有链式折叠才能继续。
 * 分支赋的不是 test 取反的那个值时不能套用该变形。
 */
function verifyNegatedTestSelfAssignmentChain(): void {
    const program = NodeFactory.parse(`
function check(v4, v5, v6, v7, v8, v3) {
  if (!v4) {
    v6 = v4;
  }
  if (v6) {
    v6 = v5;
  }
  if (v6) {
    v6 = v7 === "login";
  }
  if (v6) {
    v6 = v3 === "qrlogin_ui";
  }
  if (v6) {
    v6 = v8.length > 0;
  }
  return v6;
}
`);
    SimplifyExport.simplify(program);
    const code = NodeFactory.generate(program);
    NodeFactory.parse(code);
    if (!code.includes('return v4 && v6 && v5 && v7 === "login" && v3 === "qrlogin_ui" && v8.length > 0;')) {
        throw new Error(`simplify: 取反 test 自赋值链头未折叠进短路链\n${code}`);
    }
    if (/if \((?:!)?v6\)/.test(code)) {
        throw new Error(`simplify: 短路链仍残留 if\n${code}`);
    }

    // 分支赋固定值时不能套用 `X = A && X`(A 与分支值不同,语义不等价)
    const notSelf = NodeFactory.parse(`
function guard(v4, v6) {
  if (!v4) {
    v6 = true;
  }
  if (v6) {
    v6 = false;
  }
  return v6;
}
`);
    SimplifyExport.simplify(notSelf);
    const notSelfCode = NodeFactory.generate(notSelf);
    if (notSelfCode.includes("v4 && v6") || !notSelfCode.includes("if (!v4)")) {
        throw new Error(`simplify: 非自赋值的取反 test 被误折叠\n${notSelfCode}`);
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
    const hap = loadHapOnce("zhihupp0.59.hap");

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

    const pandaFile = loadPandaFile("zhihupp0.59.hap", { hapEntry: "ets/modules.abc" });
    // 287 为该 abc 的全部类数,其中 276 个可产出有效反编译结果(其余无 func_main_0)
    const classes = pandaFile.getAllClasses();
    if (classes.length !== 287) throw new Error(`hap: 类数量不符合预期(期望 287,实际 ${classes.length})`);

    for (const name of ["EntryAbility", "WorkSchedulerProbeExtensionAbility"]) {
        const clazz = classes.find((c) => c.name.content.includes(name));
        if (!clazz) throw new Error(`hap: 未找到类 ${name}`);
        const code = decompileClassOnce(clazz);
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
function verifyZhihuTryFinally(clazz: PandaClass, code: string, ctx: BinaryContext): void {
    NodeFactory.parse(code);
    if (/\bhole\b/.test(code)) {
        throw new Error(`try/finally 还原: 仍残留 hole 哨兵\n${code}`);
    }
    if (/undefined\s*[!=]==\s*undefined/.test(code)) {
        throw new Error(`try/finally 还原: 仍残留 undefined 常量条件\n${code}`);
    }
    if (/\{\s*let local_\d+_\d+(_\d+)?;\s*\}/.test(code)) {
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

    const qrCode = ctx.decompileContaining("QrScanFixture").code;
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
    const notificationCode = ctx.decompileContaining("NotificationState").code;
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
    // loadMore: 源码是 try/catch/finally — catch 与 finally 共用同一个 try 起点,
    // 用户 catch(catchAcc) 现在会正常接进区域图(以前整段被当成 classicFinally 丢掉),
    // finally 仍然是 cleanup 首块的条件比较。
    if (!/try \{\s*await this\.fetchPage\(this\.generation, this\.nextCursor\);\s*\} catch \(catchAcc\) \{[\s\S]*?\n    \} finally \{\n      if \(this\.isCurrent\(this\.generation\)\) \{\n        this\.loadingMore = false;\n        this\.emit\(\);/.test(notificationCode)) {
        throw new Error(`NotificationState.loadMore: finally 未还原\n${notificationCode}`);
    }

    const databaseCode = ctx.decompileContaining("AppDatabase").code;
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
function verifyZhihuContentDetailPages(clazz: PandaClass, code: string): void {
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
    // `if (navigatorBusy) return; else { 整个方法体 }` 已展开成守卫子句:
    // 守卫之后的代码不再整体多缩进一层。
    if (!/if \(this\.navigatorBusy\) \{\s*return undefined;\s*\}\s*this\.navigatorBusy = true;/.test(moveBody)) {
        throw new Error(`moveAnswer: 早返回守卫的 else 未展开\n${moveBody}`);
    }
    if (!/try \{\s*v6 = this\.answerNavigator === null/.test(moveBody)) {
        throw new Error(`moveAnswer: try 未包住可选链求值\n${moveBody}`);
    }
    if (!/\} finally \{\s*this\.navigatorBusy = false;\s*\}/.test(moveBody)) {
        throw new Error(`moveAnswer: finally 未还原 navigatorBusy 复位\n${moveBody}`);
    }

    const refreshStart = code.indexOf("async refreshQuestion() {");
    if (refreshStart < 0) throw new Error(`ContentDetailPages: 未找到 refreshQuestion\n${code}`);
    const refreshBody = code.slice(refreshStart, code.indexOf("\n  }\n", refreshStart));
    if (!/\} finally \{\s*this\.refreshingAnswers = false;\s*\}/.test(refreshBody)) {
        throw new Error(`refreshQuestion: finally 未还原 refreshingAnswers 复位\n${refreshBody}`);
    }
    // 对象字段的 `v0 = 0; if (!immersive) v0 = OFFSET` 先折成三目,再并进对象字面量
    if (!code.includes('"topInsetVp": local_1_1.immersiveReading ? 0 : FLOATING_TITLE_BAR_OFFSET,')) {
        throw new Error(`ContentDetailPages: topInsetVp 未并进对象字面量\n${code}`);
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

    // 提前 return 分支里内联的 iterator close 也是 lowering 残留:
    //   if (v3 === undefined) { if (v0.return != undefined) v0.return(); return; }
    // 源码的 for...of 在 return 退出时由运行时自己 close,删掉内联 close 后照常还原。
    const inlinedClose = NodeFactory.parse(`
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
    SimplifyExport.simplify(inlinedClose);
    const inlinedCloseCode = NodeFactory.generate(inlinedClose);
    if (!inlinedCloseCode.includes("for (v3 of p0)")) {
        throw new Error(`for...of 还原: 内联 close 分支阻止了还原\n${inlinedCloseCode}`);
    }
    if (inlinedCloseCode.includes("while (true)") || inlinedCloseCode.includes("v0.return")) {
        throw new Error(`for...of 还原: 内联 close 残留\n${inlinedCloseCode}`);
    }
    if (!/if \(v3 === undefined\) \{\s*return;/.test(inlinedCloseCode)) {
        throw new Error(`for...of 还原: 提前 return 分支被破坏\n${inlinedCloseCode}`);
    }

    // 循环体读取的 `vv.value` 有两种含义:解包语句存在时,后面的 `vv` 已经是元素,
    // `vv.value` 是元素自身的属性,必须保留;没有解包语句时 `vv.value` 才是元素本身。
    const valueMeaning = NodeFactory.parse(`
function m(items) {
  let v6, acc;
  acc = items[Symbol.iterator]();
  while (true) {
    v6 = acc.next();
    if (v6.done) break;
    v6 = v6.value;
    if (typeof v6.value === "string") {
      use(v6.value);
    }
  }
  acc = items[Symbol.iterator]();
  while (true) {
    v6 = acc.next();
    if (v6.done) break;
    use(v6.value);
  }
}
`);
    SimplifyExport.simplify(valueMeaning);
    const valueMeaningCode = NodeFactory.generate(valueMeaning);
    if (valueMeaningCode.includes("while (true)")) {
        throw new Error(`for...of 还原: 未还原\n${valueMeaningCode}`);
    }
    if (!valueMeaningCode.includes('if (typeof v6.value === "string") {\n      use(v6.value);')) {
        throw new Error(`for...of 还原: 解包后的元素属性被改写\n${valueMeaningCode}`);
    }
    if (!valueMeaningCode.includes("use(v6);")) {
        throw new Error(`for...of 还原: 直接读取的迭代结果未改写\n${valueMeaningCode}`);
    }

    // 提前 return 的 for...of 的另一形态是 do-while:done 分支是循环耗尽后的代码,
    // 循环后的 return 是 test 为假的提前退出路径,test 在 body 末尾物化。
    // 需要:done 分支搬到 for-of 之后、`acc = false` 初值清掉、continue 守卫
    // (`acc = !x; if (!x) continue`)保证 continue 时 test 为真。
    const earlyReturn = NodeFactory.parse(`
function k(p0) {
  let it, vv, src, acc;
  it = p0[Symbol.iterator]();
  acc = false;
  do {
    vv = it.next();
    if (vv.done) {
      return "";
    }
    src = vv.value;
    acc = !vv.value.flag;
    if (!vv.value.flag) {
      continue;
    }
    acc = !vv.value.name;
    acc = !acc;
  } while (!!acc);
  if (it.return != undefined) {
    it.return();
  }
  return src.name;
}
`);
    SimplifyExport.simplify(earlyReturn);
    const earlyCode = NodeFactory.generate(earlyReturn);
    if (!earlyCode.includes("for (vv of p0)")) {
        throw new Error(`for...of 还原: do-while 形态没有生成 for-of\n${earlyCode}`);
    }
    if (earlyCode.includes("[Symbol.iterator]") || earlyCode.includes("do {") || earlyCode.includes("acc = false")) {
        throw new Error(`for...of 还原: do-while 形态残留迭代器/test 初值\n${earlyCode}`);
    }
    if (!earlyCode.includes("return \"\";") || !earlyCode.includes("if (!vv.name) return src.name;")) {
        throw new Error(`for...of 还原: done 分支或提前退出路径位置不对\n${earlyCode}`);
    }

    // 嵌套形态:done 分支里还有内层迭代器循环。外层先还原,内层随 done 分支
    // 搬到循环之后,需要重新扫描才能一并还原。
    const nested = NodeFactory.parse(`
function n(p0) {
  let a, b, c, d, acc;
  a = p0[Symbol.iterator]();
  acc = false;
  do {
    b = a.next();
    if (b.done) {
      c = p0[Symbol.iterator]();
      acc = false;
      do {
        d = c.next();
        if (d.done) {
          return "";
        }
        d = d.value;
        acc = !d.flag;
        acc = !acc;
      } while (!!acc);
      if (c.return != undefined) {
        c.return();
      }
      return d.name;
    }
    d = b.value;
    acc = !b.value.flag;
    acc = !acc;
  } while (!!acc);
  if (a.return != undefined) {
    a.return();
  }
  return d.name;
}
`);
    SimplifyExport.simplify(nested);
    const nestedCode = NodeFactory.generate(nested);
    const nestedForOf = nestedCode.match(/for \(\w+ of p0\)/g)?.length ?? 0;
    if (nestedForOf !== 2) {
        throw new Error(`for...of 还原: 嵌套 do-while 形态只还原了 ${nestedForOf} 层\n${nestedCode}`);
    }
    if (nestedCode.includes("[Symbol.iterator]") || nestedCode.includes("do {")) {
        throw new Error(`for...of 还原: 嵌套 do-while 形态残留迭代器\n${nestedCode}`);
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
 * 回归:test 序列里的死保存不能把仍被后续元素读取的赋值删掉。
 *
 * 字节码把 `p0.toLowerCase().indexOf(...)` 物化成一串 acc 中转:
 *   (acc = p0.toLowerCase(), v0 = acc, acc = acc, acc = acc.indexOf,
 *    acc = acc.call(v0, ...), acc < 0)
 * 删除 `acc = p0.toLowerCase()` 时,`v0 = acc` 会读到未初始化的 acc,
 * 最终输出成 `if (!p0 || v0.indexOf.call(v0, ...))`(v0 只有声明)。
 * anchor 与 skip 是同一节点时必须先标记“已越过 anchor”,再检查后续读取。
 */
function verifyTestSequenceKeepsReadValue(): void {
    const program = NodeFactory.parse(`
function f(p0) {
  let v0, acc;
  if (!p0 || (acc = p0.toLowerCase(), v0 = acc, acc = acc, acc = acc.indexOf, acc = acc.call(v0, "application/vnd.yt-ump"), acc < 0)) {
    return;
  }
}
`);
    SimplifyExport.simplify(program);
    const code = NodeFactory.generate(program);
    // 允许后续进一步折成 p0.toLowerCase().indexOf(...),但不能只剩未赋值的 v0
    if (!code.includes("v0 = p0.toLowerCase()") && !code.includes("p0.toLowerCase().indexOf")) {
        throw new Error(`simplify: test 序列删掉了仍被读取的赋值,留下未初始化的临时变量\n${code}`);
    }
    if (code.includes("if (!p0 || v0.indexOf.call(v0")) {
        throw new Error(`simplify: v0 在赋值前被读取\n${code}`);
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
function verifyZhihuAppDestination(clazz: PandaClass, code: string): void {
    NodeFactory.parse(code);
    const start = code.indexOf("export function shouldReloadAfterAuthentication(");
    if (start < 0) throw new Error(`逻辑条件链: 未找到 shouldReloadAfterAuthentication\n${code}`);
    const body = code.slice(start, code.indexOf("\n}", start));
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
    const queryStart = code.indexOf("export function isSafeSearchDestinationQuery(");
    const queryBody = queryStart < 0 ? "" : code.slice(queryStart, code.indexOf("\n}", queryStart));
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
function verifyZhihuStartupDestinationChannel(clazz: PandaClass, code: string): void {
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
function verifyZhihuDeepLinkResolver(clazz: PandaClass, code: string): void {
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
    const body = stripModuleExports(code.replace(/^import\s+.*\n/gm, ""))
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
function verifyZhihuShareContracts(clazz: PandaClass, code: string): void {
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
    const body = stripModuleExports(code)
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

    // 源码 switch 的最后一个 case 常被降级成默认分支守卫提前:
    //   else { if (x !== "c") EXIT; BODY }
    // 等价于 `else if (x === "c") { BODY } else { EXIT }`,补成尾 case
    // 后整条链才有 3 个 case;不还原就只剩 if/else-if。
    const trailingGuard = NodeFactory.parse(`
function f(x, y) {
  if (x === "a") {
    y = 1;
  } else if (x === "b") {
    y = 2;
  } else {
    if (x !== "c") {
      return y;
    }
    y = 3;
  }
  return y;
}
function g(x, y) {
  if (x === "a") {
    y = 1;
  } else {
    if (x !== "b") {
      return y;
    }
    y = 2;
  }
  return y;
}
`);
    SimplifyExport.simplify(trailingGuard);
    const trailingCode = NodeFactory.generate(trailingGuard);
    const fBody = trailingCode.slice(0, trailingCode.indexOf("function g"));
    for (const expected of ['switch (x)', 'case "a":', 'case "b":', 'case "c":', "default:", "return y;"]) {
        if (!fBody.includes(expected)) {
            throw new Error(`switch 合成: 尾 case 守卫未还原(缺 ${expected})\n${trailingCode}`);
        }
    }
    if (fBody.includes('if (x !== "c")')) {
        throw new Error(`switch 合成: 尾 case 守卫条件残留\n${trailingCode}`);
    }
    // 只有 2 个 case 标签的链(1 个普通 case + 尾 case)仍保持 if 形式
    const gBody = trailingCode.slice(trailingCode.indexOf("function g"));
    if (gBody.includes("switch (")) {
        throw new Error(`switch 合成: 2 个 case 的链不应合成 switch\n${trailingCode}`);
    }
}

/**
 * 回归:AbsoluteUrlParser 的第二个条件。
 * 源码是 `if (match === null || match[2].length === 0) return undefined;`,
 * 旧输出会把 `v1 = 0, v2 = 2, acc = !(match[2].length === 0)` 留在 test 里。
 * `v1/v2` 是后续代码复用的常量,应提到 if 前;布尔物化 acc 应删除。
 */
function verifyZhihuAbsoluteUrlParser(clazz: PandaClass, code: string): void {
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
function verifyZhihuForOfIteratorClose(clazz: PandaClass, code: string): void {
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
function verifyZhihuAppUpdateClient(clazz: PandaClass, code: string): void {
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
 * 回归:while 迭代器还原 for-of 时,循环体里含嵌套作用域(函数/块)不能打断 scope 链。
 *
 * 旧实现先构造脱离 AST 的 blockStatement,再 `traverse(blockStatement, visitor, value.scope)`。
 * Babel 对脱离树的节点缺少 parentPath,嵌套作用域的 scope.parent 链断在非 Program 节点,
 * Scope.crawl() 里 programParent 为 undefined,抛
 * `Cannot read properties of undefined (reading 'addGlobal')`,整个类 simplify 失败。
 * SabrResponseDecoder 的 `for (v11 of sabrReadFields(p0))` 体内正好有 switch/嵌套循环,
 * 是触发该路径的样本。
 */
function verifyYourpipeSabrResponseDecoder(clazz: PandaClass, code: string): void {
    NodeFactory.parse(code);
    if (code.includes("created by SimpleAnalysis") || code.includes("decompiler_") || /\bhole\b/.test(code)) {
        throw new Error(`SabrResponseDecoder: 反编译降级或残留伪语句\n${code}`);
    }
    // 外层迭代器循环(体内含 switch + 内层 for-of)必须还原成 for...of;
    // 旧实现会在这里崩在 addGlobal,导致整个类没有输出。
    const forOfCount = code.match(/for \(\w+ of sabrReadFields\(p0\)\)/g)?.length ?? 0;
    if (forOfCount < 7) {
        throw new Error(`SabrResponseDecoder: sabrReadFields(p0) 的 for...of 还原数量不足(${forOfCount})\n${code}`);
    }
    if (!code.includes("of sabrReadFields(v11.getBytes())")) {
        throw new Error(`SabrResponseDecoder: 内层 for...of 未还原\n${code}`);
    }
    // 编译器复用同一个临时迭代器/循环变量连续写多个 while,
    // 后续赋值覆盖了前一轮的值,三处都应还原成 for...of。
    for (const iterable of ["p0", "p1.keys()", "p2"]) {
        if (!code.includes(`for (v14 of ${iterable})`)) {
            throw new Error(`SabrResponseDecoder: 复用迭代器的 for...of 未还原(${iterable})\n${code}`);
        }
    }
    // isRecoverableIntegrityIssues 的 for...of 体内有提前 return,被 lower 成
    // `do { v = it.next(); if (v.done) return true; ... } while (cond)` + iterator.close。
    // 应还原成 for...of,并把 `acc = !... ? ...` 布尔物化链折成已知类型判断的 || 链;
    // 曾经因为把 `acc = !acc` 折进 `if (acc) continue` 而没有同步 do-while test 的值,
    // 导致已知问题类型被误判成不可恢复。
    const recStart = code.indexOf("export function isRecoverableIntegrityIssues(");
    if (recStart < 0) throw new Error(`SabrResponseDecoder: 未找到 isRecoverableIntegrityIssues\n${code}`);
    const recBody = code.slice(recStart, code.indexOf("\n}", recStart));
    if (!recBody.includes("for (v10 of p0)") || recBody.includes("[Symbol.iterator]()")) {
        throw new Error(`SabrResponseDecoder: isRecoverableIntegrityIssues 的 for...of 未还原\n${recBody}`);
    }
    if (!/if \(v10\.startsWith\("length-mismatch:"\) \|\|/.test(recBody)) {
        throw new Error(`SabrResponseDecoder: 已知问题类型的布尔链未折算\n${recBody}`);
    }
    if (!recBody.includes('if (!v10.startsWith("truncated-ump-response:")) return false;')) {
        throw new Error(`SabrResponseDecoder: 循环出口判断未还原\n${recBody}`);
    }

    const expectedPath = path.join(__dirname, "expected", "yourpipe-sabr-response-decoder.js");
    const expected = fs.readFileSync(expectedPath, "utf-8");
    if (code !== expected) {
        throw new Error(`SabrResponseDecoder: 输出与快照不一致\n${firstDifference(expected, code)}`);
    }
}

/**
 * 回归:单跳转区域把 Condition 的一个分支折到同一目标后,区域只剩一条出边。
 * `fitScale` 的 `if (videoFit === Contain) goto 252; else goto 220; 220: goto 252`
 * 经 removeSingleJumpRegion 合并后,label_205 仍是 Condition 但 outDegree=1,
 * getDestNextPair 返回 null;simplifyConditionalSequence 旧实现直接解引用抛 NPE,
 * 整个方法降级 SimpleAnalysis(输出 decompiler_goto)。
 */
function verifyYourpipeMpvPlayerView(clazz: PandaClass, code: string): void {
    NodeFactory.parse(code);
    if (code.includes("created by SimpleAnalysis") || code.includes("decompiler_")) {
        throw new Error(`MpvPlayerView: 反编译降级或残留伪语句\n${code}`);
    }
    const start = code.indexOf("fitScale()");
    const end = code.indexOf("fitScaleX()", start);
    if (start < 0 || end < 0) throw new Error(`MpvPlayerView: 未找到 fitScale\n${code}`);
    const body = code.slice(start, end);
    if (!body.includes("return 1;") || !body.includes("Math.max(") || !body.includes("Math.min(")) {
        throw new Error(`MpvPlayerView.fitScale: 返回值/分支未还原\n${body}`);
    }
    if (!body.includes("this.videoW") || !body.includes("this.videoH")
        || !body.includes("this.areaW") || !body.includes("this.areaH")) {
        throw new Error(`MpvPlayerView.fitScale: 尺寸条件丢失\n${body}`);
    }

    // tryFixVideoSize 的连续 isfalse 物化链不应残留 `acc = !acc`,条件里的多步赋值
    // 也应还原成嵌套 if,而不是逗号表达式。
    const tryFixStart = code.indexOf("tryFixVideoSize()");
    const tryFixEnd = code.indexOf("startSizePolling()", tryFixStart);
    if (tryFixStart < 0 || tryFixEnd < 0) throw new Error(`MpvPlayerView: 未找到 tryFixVideoSize\n${code}`);
    const tryFix = code.slice(tryFixStart, tryFixEnd);
    if (tryFix.includes("acc = !acc")) {
        throw new Error(`MpvPlayerView.tryFixVideoSize: 仍残留自取反赋值\n${tryFix}`);
    }
    if (!tryFix.includes("if (v6 > 0 && v3 > 0) {")
        || !tryFix.includes("if (this.sizeTimer !== -1) {")) {
        throw new Error(`MpvPlayerView.tryFixVideoSize: 嵌套 if 未还原\n${tryFix}`);
    }

    // 导出内联:VideoFit 枚举对象直接输出 `export const VideoFit = {...}`,
    // 不再保留前置的 `let VideoFit = undefined;` 与文件尾部的 `export { VideoFit };`
    if (!code.includes("export const VideoFit = {") || /\blet VideoFit\b|export \{ VideoFit \}/.test(code)) {
        throw new Error(`MpvPlayerView: VideoFit 枚举未直接导出\n${code}`);
    }

    const expectedPath = path.join(__dirname, "expected", "yourpipe-mpv-player-view.js");
    const expected = fs.readFileSync(expectedPath, "utf-8");
    if (code !== expected) {
        throw new Error(`MpvPlayerView: 输出与快照不一致\n${firstDifference(expected, code)}`);
    }
}

/**
 * 回归:导出语句内联(foldExportDeclarations 的 default 形态)。
 *
 * 字节码里 `export default <匿名值>` 会落在一个保留槽位模块变量上
 * (panda_jmp0_reserved_export_default),旧输出是
 *   let panda_jmp0_reserved_export_default = EnhancedLogger.getInstance(...);
 *   export default panda_jmp0_reserved_export_default;
 * 现在槽位除定义与导出语句外没有任何引用,直接内联成
 *   export default EnhancedLogger.getInstance(...);
 */
function verifyYourpipeAnonymousDefaultExport(clazz: PandaClass, code: string): void {
    NodeFactory.parse(code);
    if (!code.includes('export default EnhancedLogger.getInstance("[Mediaservice]");')) {
        throw new Error(`Logger: 匿名 default 导出未内联\n${code}`);
    }
    if (code.includes("panda_jmp0_reserved_export_default")) {
        throw new Error(`Logger: 仍残留匿名导出槽位变量\n${code}`);
    }
}

/**
 * 回归:导出语句内联(foldExportDeclarations 的 default 类声明形态)。
 * `export default EntryAbility;` + 顶层类声明要合并成
 * `export default class EntryAbility extends UIAbility {}`。
 */
function verifyAmclDefaultClassExport(clazz: PandaClass, code: string): void {
    NodeFactory.parse(code);
    if (!code.includes("export default class EntryAbility extends UIAbility {")) {
        throw new Error(`EntryAbility: default 导出未合并进类声明\n${code}`);
    }
    if (/\bexport default\s+EntryAbility\b/.test(code)) {
        throw new Error(`EntryAbility: 仍残留独立的 export default 语句\n${code}`);
    }
}

/**
 * 回归:findFollowLatch 兜底(goto)产生的 `label_x: ;` + `xpanda_goto(label_x)`。
 *
 * SabrOfflineDownloader.dumpDualTrack 是 `while (true)` 循环:循环头(`if (!videoDone)`)
 * 的两条出边都在循环体内,回边也只回到循环头,所有退出路径都是 return/throw。
 * determineFollowLatch 找不到 follow/latch,只能给回边插 goto,而 goto 落在深层
 * if 分支里,生成 AST 时的 tryFixGoto 只会在同一语句块里找 label,于是输出
 * `xpanda_goto(...)`(不可执行)。GotoLoopRestore 在 simplify 开头把它还原成
 * `while (true)` + `continue`;循环被看见后,停顿计数器也能正好还原
 * (`v11 += 1; if (v11 >= 6)`,否则被常量传播成 `0 + 1 >= 6`)。整类输出有快照。
 */
function verifyYourpipeSabrOfflineDownloader(clazz: PandaClass, code: string): void {
    NodeFactory.parse(code);
    if (code.includes("created by SimpleAnalysis") || code.includes("decompiler_")) {
        throw new Error(`SabrOfflineDownloader: 反编译降级或残留伪语句\n${code}`);
    }
    if (code.includes("xpanda_goto") || /\blabel_\d+\b/.test(code)) {
        throw new Error(`SabrOfflineDownloader: 仍残留 goto/label 兜底\n${code}`);
    }
    const start = code.indexOf("static async dumpDualTrack");
    const end = code.indexOf("static async tryWriteNext", start);
    if (start < 0 || end < 0) throw new Error(`SabrOfflineDownloader: 未找到 dumpDualTrack\n${code}`);
    const body = code.slice(start, end);
    if (!body.includes("while (true) {") || !body.includes("continue;")) {
        throw new Error(`SabrOfflineDownloader.dumpDualTrack: while(true) 循环未还原\n${body}`);
    }
    if (!body.includes("v11 += 1;") || !body.includes("if (v11 >= 6) {")) {
        throw new Error(`SabrOfflineDownloader.dumpDualTrack: 停顿计数器未还原\n${body}`);
    }
    if (body.includes("0 + 1 >= 6")) {
        throw new Error(`SabrOfflineDownloader.dumpDualTrack: 计数器仍被常量传播\n${body}`);
    }

    const expectedPath = path.join(__dirname, "expected", "yourpipe-sabr-offline-downloader.js");
    const expected = fs.readFileSync(expectedPath, "utf-8");
    if (code !== expected) {
        throw new Error(`SabrOfflineDownloader: 输出与快照不一致\n${firstDifference(expected, code)}`);
    }
}

/**
 * 回归:`removeUnreachableStatements` 也要裁剪 switch 的 case 体。
 *
 * `SwitchCase.consequent` 不是 BlockStatement,旧实现只扫 BlockStatement,于是
 * simplifyTail 把守卫链合成 switch 之后、每个分支末尾 `continue;` 后面那条不可达的
 * `break;` 一直留在输出里(YoutubePageAttestationBootstrap 的 parseJsString 有 8 处)。
 * 这条 case 体裁剪同时服务于 GotoLoopRestore 还原出来的循环(continue 后面的 break)。
 * 整类输出有快照。
 */
function verifyYourpipeYoutubePageAttestationBootstrap(clazz: PandaClass, code: string): void {
    NodeFactory.parse(code);
    if (code.includes("created by SimpleAnalysis") || code.includes("decompiler_")) {
        throw new Error(`YoutubePageAttestationBootstrap: 反编译降级或残留伪语句\n${code}`);
    }
    if (code.includes("xpanda_goto") || /\blabel_\d+\b/.test(code)) {
        throw new Error(`YoutubePageAttestationBootstrap: 仍残留 goto/label 兜底\n${code}`);
    }
    // switch 的 case 体里 `continue;` 之后的 break 不可达,必须清掉
    if (/continue;\n\s*break;/.test(code)) {
        throw new Error(`YoutubePageAttestationBootstrap: case 体里仍有不可达的 break\n${code}`);
    }
    const start = code.indexOf("local_0_8 = function");
    const end = code.indexOf("local_0_0 = function", start);
    if (start < 0 || end < 0) throw new Error(`YoutubePageAttestationBootstrap: 未找到 parseJsString\n${code}`);
    const body = code.slice(start, end);
    // 转义解析:for 循环的累加更新 + 8 个 case 的 switch(每支 continue 跳出 switch 继续 for)
    if (!body.includes("for (v6 = p1; v6 < p0.length; v7 += v9) {")
        || !body.includes('case "x":') || !body.includes('case "u":')) {
        throw new Error(`YoutubePageAttestationBootstrap.parseJsString: for/switch 未还原\n${body}`);
    }
    if ((body.match(/continue;/g) ?? []).length < 8) {
        throw new Error(`YoutubePageAttestationBootstrap.parseJsString: case 分支的 continue 缺失\n${body}`);
    }

    // for...of + break 的 do-while lowering(第 2 个循环)要还原成 for-of,
    // `it.return()` 收尾由 for-of 的 break 隐式完成,耗尽分支的 DONE 副本丢弃。
    const parseStart = code.indexOf("export function parseYoutubePageAttestationBootstrap(");
    const parseEnd = code.indexOf("local_0_11 = function", parseStart);
    if (parseStart < 0 || parseEnd < 0) {
        throw new Error(`YoutubePageAttestationBootstrap: 未找到 parseYoutubePageAttestationBootstrap\n${code}`);
    }
    const parseBody = code.slice(parseStart, parseEnd);
    if (parseBody.includes("acc") || parseBody.includes("do {") || parseBody.includes("[Symbol.iterator]")) {
        throw new Error(`YoutubePageAttestationBootstrap: 累加器/迭代器 lowering 残留\n${parseBody}`);
    }
    if (!/for \(v24 of local_0_0\(p0, local_0_3 \/\*INITIAL_ATTESTATION_CALLEE\*\/\)\) \{[\s\S]*?\n      break;/.test(parseBody)) {
        throw new Error(`YoutubePageAttestationBootstrap: break 形态的 for...of 未还原\n${parseBody}`);
    }
    // 可选链枢纽(`acc = E; Y = f(acc)`)要在流水线尾部搬进唯一读取。
    if (!code.includes("v4 = local_0_2(local_0_2(JSON.parse(p0))?.bgChallenge);")) {
        throw new Error(`YoutubePageAttestationBootstrap.parseSabrAttChallengeData: 累加器枢纽未合并\n${code}`);
    }

    const expectedPath = path.join(__dirname, "expected", "yourpipe-youtube-page-attestation-bootstrap.js");
    const expected = fs.readFileSync(expectedPath, "utf-8");
    if (code !== expected) {
        throw new Error(`YoutubePageAttestationBootstrap: 输出与快照不一致\n${firstDifference(expected, code)}`);
    }
}

/**
 * 回归:ArkTS 对 `?.` 的真值 lowering(`v14 ? v14.tabs : undefined`)与把 `it.next`
 * 提升成临时方法量的 for-of lowering(`v21 = it; v20 = it.next; while (true)
 * { v22 = v20.call(v21); ... }`)都要在流水线末尾的 simplifyTail() 还原:
 * 前者依赖尾部条件折叠把 `!acc` 物化链折回标识符守卫,后者在主遍历阶段
 * 与标准 `it.next()` 形状对不上。MusicSearchService.parseInitialMusicSearchResponse
 * 的 YouTube 响应导航链正好覆盖这两条路径,可选链还原后累加器枢纽拷贝
 * (`acc = E; v14 = acc`)也应被折叠成 `v14 = E`。
 */
function verifyYourpipeMusicSearchService(clazz: PandaClass, code: string): void {
    NodeFactory.parse(code);
    if (code.includes("created by SimpleAnalysis") || code.includes("decompiler_")) {
        throw new Error(`MusicSearchService: 反编译降级或残留伪语句\n${code}`);
    }
    const start = code.indexOf("static parseInitialMusicSearchResponse");
    const end = code.indexOf("static parseMusicSearchContinuationResponse", start);
    if (start < 0 || end < 0) throw new Error(`MusicSearchService: 未找到 parseInitialMusicSearchResponse\n${code}`);
    const body = code.slice(start, end);
    // 可选链还原 + 枢纽搬移:守卫三目不允许残留,整条导航链折叠成两条可选链赋值。
    const expectedChains = [
        "v15 = p0.contents?.tabbedSearchResultsRenderer?.tabs;",
        "v9 = (v15 && v15.length > 0 ? v15[0] : undefined)?.tabRenderer?.content?.sectionListRenderer;",
    ];
    for (const chain of expectedChains) {
        if (!body.includes(chain)) {
            throw new Error(`MusicSearchService: 可选链未还原(缺 ${chain})\n${body}`);
        }
    }
    if (/v1[45] = v1[45] \? | \? v1[45]\./.test(body)) {
        throw new Error(`MusicSearchService: 守卫三目残留\n${body}`);
    }
    // `it.next` 提升的 for-of lowering 要还原成 for...of,且只供迭代器使用的
    // 累加器枢纽要内联进 for-of 头部,迭代器残留清零。
    if (!body.includes("for (v22 of v9 ? v9.contents : []) {")) {
        throw new Error(`MusicSearchService: 提升方法量的 for...of 未还原(或迭代器枢纽未内联)\n${body}`);
    }
    if (body.includes("[Symbol.iterator]") || body.includes(".next") || /\.call\(v2[12]\)/.test(body)) {
        throw new Error(`MusicSearchService: 迭代器 lowering 残留\n${body}`);
    }
    // 失去使用者的临时变量(被搬移的枢纽/迭代器)要从声明列表里清掉。
    const decl = code.slice(start, end).match(/let ([^\n]*);/)?.[0] ?? "";
    if (!decl) throw new Error(`MusicSearchService: 未找到声明列表\n${code.slice(start, start + 200)}`);
    for (const dead of ["v11", "v12", "v13", "v14", "v20", "v21", "acc"]) {
        if (new RegExp(`\\b${dead}\\b`).test(decl)) {
            throw new Error(`MusicSearchService: 未用临时变量 ${dead} 残留在声明 ${decl.trim()}\n${code}`);
        }
    }
    // 另一个方法里的成员守卫(`p0.continuationContents ? p0.continuationContents.x : undefined`)。
    if (!code.includes("acc = p0.continuationContents?.musicShelfContinuation;")) {
        throw new Error(`MusicSearchService: 成员守卫可选链未还原\n${code}`);
    }
    // 提前 return 的 for...of 还有 do-while lowering 形态:
    //   it = x[Symbol.iterator](); acc = false;
    //   do { v = it.next(); if (v.done) { DONE } ...; acc = ... } while (acc);
    //   close(it); return E;
    // getMusicPlaylistId 必须还原成 for...of;test 物化的常量初值(`acc = false`)
    // 要清掉,它会在 for-of 头部之前执行并覆盖头部仍要读取的迭代器表达式。
    if (!code.includes("for (v19 of acc) {")) {
        throw new Error(`MusicSearchService: do-while 形态的 for...of 未还原\n${code}`);
    }
    if (code.includes("[Symbol.iterator]") || /\bdo \{/.test(code)) {
        throw new Error(`MusicSearchService: 迭代器/do-while lowering 残留\n${code}`);
    }

    const expectedPath = path.join(__dirname, "expected", "yourpipe-music-search-service.js");
    const expected = fs.readFileSync(expectedPath, "utf-8");
    if (code !== expected) {
        throw new Error(`MusicSearchService: 输出与快照不一致\n${firstDifference(expected, code)}`);
    }
}

/**
 * 回归:MediaThumb(@Component 结构体)的访问器与原型/静态方法还原。
 *
 * 该类记录里 es2abc 用 `definegettersetterbyvalue v7(prototype), v8(名), v10(fn), v9(undefined)`
 * 定义访问器(getter/setter 各一条,空的一半是 undefined),且 v7(类)与 v7(prototype)
 * 复用同一寄存器,复制传播会把 `v7.__defineGetter__(...)` 内联成
 * `acc.prototype.__defineGetter__(...)`(callee.object 是成员表达式),
 * 旧版 ClassSyntaxSimplify 只接受裸标识符对象,访问器与
 * `acc.prototype.M = fn` / `acc.M = fn`(静态)全部留在类外。
 */
function verifyYourpipeMediaThumb(clazz: PandaClass, code: string): void {
    NodeFactory.parse(code);
    // 访问器定义(含 undefined 半边)必须全部并入类,不允许残留
    if (code.includes("__defineGetter__") || code.includes("__defineSetter__")) {
        throw new Error(`MediaThumb: 访问器未并入类\n${code}`);
    }
    // get/set 成对还原成类访问器
    for (const prop of ["imageUrl", "displayUrl", "fallbackIndex"]) {
        if (!code.includes(`get ${prop}() {`) || !code.includes(`set ${prop}(p0) {`)) {
            throw new Error(`MediaThumb: 缺少 ${prop} 访问器\n${code}`);
        }
    }
    // 原型方法并入类、静态方法还原 static
    for (const method of ["aboutToAppear() {", "onImageError() {", "initialRender() {", "rerender() {"]) {
        if (!code.includes(method)) {
            throw new Error(`MediaThumb: 原型方法未并入类(缺 ${method})\n${code}`);
        }
    }
    if (!code.includes("static buildFallbackChain(p0) {") || !code.includes("static firstChoiceUrl(p0) {")) {
        throw new Error(`MediaThumb: 静态方法未还原\n${code}`);
    }
    // buildFallbackChain 的累加器链/别名/Hub 读取都要还原成源码形态
    if (!code.includes('v5 = (p0 || "").trim();')) {
        throw new Error(`MediaThumb: 取反/成员调用累加器链未折叠\n${code}`);
    }
    if (code.includes("v5 = acc;") || code.includes("acc = acc.trim();") || code.includes("exec(acc)")) {
        throw new Error(`MediaThumb: 累加器 Hub 或旧值读取残留\n${code}`);
    }
    // then 分支只有 return 时 else 展开成守卫子句
    if (!/if \(v5\.length === 0\) \{\s*return \[\];\s*\}/.test(code)) {
        throw new Error(`MediaThumb: 守卫子句未还原\n${code}`);
    }

    const expectedPath = path.join(__dirname, "expected", "yourpipe-media-thumb.js");
    const expected = fs.readFileSync(expectedPath, "utf-8");
    if (code !== expected) {
        throw new Error(`MediaThumb: 输出与快照不一致\n${firstDifference(expected, code)}`);
    }
}

/**
 * 回归:常量 test + 守卫形态的 while(true) 循环(VttSubtitleParser)。
 *
 * ArkTS 把 `while (COND)` 折成 `while (true) { if (!COND) break; ... }`。守卫留在
 * body 里时,条件中的累加器物化(`acc = line.trim(), acc = acc.length`)既不在语句
 * 列表、也不是循环 test,cleanupStatements/foldTestSequences 都扫不到;
 * `acc = !(i < len)` 这类死保存也会因为循环回边处的名字级活跃性残留。
 * TempVariableSimplify 现在把守卫(连同前面纯表达式死保存)提成 while test,
 * 同时跳过 for / for-of / for-in 的 lowering 形态(for 还原依赖 `if (...) break` 开头)。
 * findActiveSubtitleText 同时覆盖二分查找与回看循环,parseVttSubtitles 覆盖
 * 嵌套的"行非空"循环与 `!!` 条件物化。
 */
function verifyYourpipeVttSubtitleParser(clazz: PandaClass, code: string): void {
    NodeFactory.parse(code);

    // 守卫全部提成循环 test:不再有 while(true) + if (...) break
    if (code.includes("while (true)")) {
        throw new Error(`VttSubtitleParser: 仍残留 while (true) 守卫\n${code}`);
    }
    if (!code.includes("while (v8 <= v5)")
        || !code.includes("while (v7 >= 0 && p0[v7].startMs > p1 - local_0_3 /*MAX_CUE_LOOKBACK_MS*/)")
        || !code.includes("while (v5 < v6.length)")
        || !code.includes("while (v5 < v6.length && v6[v5].trim().length > 0)")) {
        throw new Error(`VttSubtitleParser: 循环条件未还原\n${code}`);
    }
    // 条件里的累加器物化与 `!!` 物化都要折掉
    if (code.includes("acc = acc") || code.includes("v6[v5].trim(), acc")
        || code.includes("acc = !!") || !code.includes("if (!v11)")) {
        throw new Error(`VttSubtitleParser: 仍残留 acc 物化\n${code}`);
    }
    // 守卫折叠不能破坏已经还原的 for 循环
    if (!code.includes("for (v14 = v12.length - 1; v14 >= 0; v14 -= 1)")) {
        throw new Error(`VttSubtitleParser: for 循环被守卫折叠破坏\n${code}`);
    }

    const expectedPath = path.join(__dirname, "expected", "yourpipe-vtt-subtitle-parser.js");
    const expected = fs.readFileSync(expectedPath, "utf-8");
    if (code !== expected) {
        throw new Error(`VttSubtitleParser: 输出与快照不一致\n${firstDifference(expected, code)}`);
    }

    // 行为校验:去掉 export 后在沙箱跑真实解析(含 BOM / CRLF / 实体 / 标签 / 多行字幕)
    const sandboxCode = stripModuleExports(code)
        + "\nglobalThis.__exports = { parseVttSubtitles, findActiveSubtitleText };";
    const { sandbox } = runSandbox(sandboxCode);
    const exported = sandbox.__exports as {
        parseVttSubtitles: (text: string) => Array<{ startMs: number; endMs: number; text: string }>;
        findActiveSubtitleText: (cues: Array<{ startMs: number; endMs: number; text: string }>, timeMs: number) => string;
    };
    const vtt = [
        "\uFEFFWEBVTT",
        "",
        "00:00:01.000 --> 00:00:03.000",
        "Hello <b>world</b>",
        "",
        "00:00:04.500 --> 00:00:06.500",
        "Second &amp; line",
        "wrapped line",
        "",
    ].join("\r\n");
    const cues = exported.parseVttSubtitles(vtt);
    const expectedCues = [
        { startMs: 1000, endMs: 3000, text: "Hello world" },
        { startMs: 4500, endMs: 6500, text: "Second & line\nwrapped line" },
    ];
    if (JSON.stringify(cues) !== JSON.stringify(expectedCues)) {
        throw new Error(`VttSubtitleParser: 解析结果不正确\n${JSON.stringify(cues)}`);
    }
    if (exported.findActiveSubtitleText(cues, 2000) !== "Hello world") {
        throw new Error("VttSubtitleParser: findActiveSubtitleText 未命中第一条字幕");
    }
    if (exported.findActiveSubtitleText(cues, 5000) !== "Second & line\nwrapped line") {
        throw new Error("VttSubtitleParser: findActiveSubtitleText 未命中多行字幕");
    }
    if (exported.findActiveSubtitleText(cues, 7000) !== "") {
        throw new Error("VttSubtitleParser: 超出字幕范围时应返回空串");
    }
}

/**
 * 回归:空 then + else 赋值的短路物化(`if (acc) {} else acc = !p0.items`)。
 *
 * ArkTS 把 `if (!a || !b) return;` 折成
 *   acc = !a; if (acc) {} else acc = !b; if (acc || ...) return;
 * `matchShortCircuitFold` 原来只认 `if (X) { X = B }` / `if (!X) { X = B }`,
 * 空 then 形态留在输出里(`if (acc) {}` 加一条 else 内赋值)。
 * 现在空 then 按 `if (!X) { X = B }` 处理(极性翻转,`X = E || B`),
 * 后续条件折叠再把 acc 并进 if test;restoreSnapshot 还原成
 * `if (!p0 || !p0.items || p0.items.length === 0) return;`。
 */
function verifyYourpipePlayQueueManager(clazz: PandaClass, code: string): void {
    NodeFactory.parse(code);

    if (!code.includes("if (!p0 || !p0.items || p0.items.length === 0) {")) {
        throw new Error(`PlayQueueManager: restoreSnapshot 守卫未还原\n${code}`);
    }
    if (/if \(acc\) \{\}\s*else|else acc =/.test(code)) {
        throw new Error(`PlayQueueManager: 仍残留空 then 短路物化\n${code}`);
    }

    const expectedPath = path.join(__dirname, "expected", "yourpipe-play-queue-manager.js");
    const expected = fs.readFileSync(expectedPath, "utf-8");
    if (code !== expected) {
        throw new Error(`PlayQueueManager: 输出与快照不一致\n${firstDifference(expected, code)}`);
    }

    // 行为校验:去掉 import/export 后在沙箱执行,stub 掉 AppLog / FeedServiceProvider
    const prelude = `
const AppLog = {
  getInstance: function () {
    return { info: function () {}, debug: function () {}, warn: function () {}, error: function () {} };
  }
};
const FeedServiceProvider = {};
`;
    const sandboxCode = prelude
        + stripModuleExports(code.replace(/^import[^\n]*\n/gm, ""))
        + "\nglobalThis.__exports = { PlayQueueManager, QueueSourceType };";
    const { sandbox } = runSandbox(sandboxCode);
    const exported = sandbox.__exports as {
        PlayQueueManager: new () => {
            queue: Array<{ id: number }>;
            currentIndex: number;
            sourceType: string;
            sourceId: string;
            sourceName: string;
            restoreSnapshot: (snapshot: unknown) => void;
        };
        QueueSourceType: Record<string, string>;
    };
    if (exported.QueueSourceType.LOCAL !== "local") {
        throw new Error("PlayQueueManager: QueueSourceType 未还原");
    }
    const manager = new exported.PlayQueueManager();
    manager.restoreSnapshot(undefined);
    manager.restoreSnapshot({});
    manager.restoreSnapshot({ items: [] });
    // 显式标注 number,避免 TS 按前面的空队列检查把 length 收窄成字面量类型
    const emptyLength: number = manager.queue.length;
    const emptyIndex: number = manager.currentIndex;
    if (emptyLength !== 0 || emptyIndex !== -1) {
        throw new Error("PlayQueueManager: 非法快照不应改变队列");
    }
    manager.restoreSnapshot({
        items: [{ id: 1 }, { id: 2 }],
        currentIndex: 1,
        sourceType: "remote",
        sourceId: "sid",
        sourceName: "name",
    });
    const restoredLength: number = manager.queue.length;
    const restoredIndex: number = manager.currentIndex;
    if (restoredLength !== 2 || restoredIndex !== 1
        || manager.sourceType !== "remote" || manager.sourceId !== "sid" || manager.sourceName !== "name") {
        throw new Error("PlayQueueManager: 合法快照未正确恢复");
    }
}

/**
 * 回归:鸿蒙资源对象($r)的模板缓冲里,id 字段是 LiteralTag.ACCESSOR 编译器
 * 标记(toString() 为 "accessor:0"),由紧随其后的 __defineGetter__("id", ...)
 * 配合 __getResourceId__ 在运行时解析。createObject/createArray 的兜底分支曾把
 * 它直接当标识符输出,生成 `"id": accessor:0` 这类非法 JS,整个类无法解析。
 * 现在兜底只输出能按原样构成表达式的名字,其余标记用 undefined 占位。
 * 整类快照同时覆盖该类的播放器状态机/模式切换逻辑不被后续改动破坏。
 */
function verifyYourpipeAVPlayerResourceObject(clazz: PandaClass, code: string): void {
    NodeFactory.parse(code);
    if (code.includes("accessor")) {
        throw new Error(`AVPlayer: ACCESSOR 标记残留(非法标识符)\n${code.slice(Math.max(0, code.indexOf("accessor") - 200), code.indexOf("accessor") + 200)}`);
    }
    // 资源对象模板 + 运行时 id getter 的形态要保留
    if (!code.includes('"id": undefined,') || !code.includes('__defineGetter__("id"')) {
        throw new Error(`AVPlayer: 资源对象 id 字段形态未还原\n${code.slice(Math.max(0, code.indexOf('__defineGetter__') - 300), code.indexOf('__defineGetter__') + 200)}`);
    }
    if (!code.includes('"bundleName": "com.talon.yourpipe"')) {
        throw new Error(`AVPlayer: 资源对象字段丢失\n${code}`);
    }

    const expectedPath = path.join(__dirname, "expected", "yourpipe-av-player.js");
    const expected = fs.readFileSync(expectedPath, "utf-8");
    if (code !== expected) {
        throw new Error(`AVPlayer: 输出与快照不一致\n${firstDifference(expected, code)}`);
    }
}

/**
 * 校验输出里所有 `local_X_Y[_Z]` / `sendable_X_Y[_Z]` 引用都能在作用域链上找到声明。
 * 词法环境槽位是按层级命名的,同层级多个环境实例撞名时会生成未声明变量。
 */
function assertNoUndeclaredLexvars(code: string): void {
    let program: TYPE.Program;
    try {
        program = NodeFactory.parse(code);
    } catch {
        return;
    }
    const missing: string[] = [];
    try {
        traverse(TYPE.file(program), {
            ReferencedIdentifier: (path: any) => {
                const name: string = path.node.name;
                if (!/^(local|sendable)_\d+_\d+(_\d+)?$/.test(name)) return;
                if (!path.scope.getBinding(name)) missing.push(name);
            },
        });
    } catch {
        return;
    }
    if (missing.length > 0) {
        throw new Error(`存在未声明的词法环境变量: ${[...new Set(missing)].join(", ")}`);
    }
}

/**
 * 回归:循环体内的嵌套 try/catch 无法归约导致整个方法降级 SimpleAnalysis。
 *
 * `HttpDownloader.request` / `postBinaryWithRetry` 的循环体里每条分支都有一层
 * try/catch:try 分支或 catch 分支归约后成为 out-degree 0 的 Tail(全部路径都
 * return/throw/continue),另一条分支则是回到循环头的回边。这种形态既不满足
 * reduceIfRegion 的 case 3(两条分支汇合到同一后继),也不满足 case 4(两条都是
 * Tail),区域图会卡在 6 个节点反复重试 3000 次后抛 "can not reduce the graph"。
 *
 * 同一类回归:
 *  1. try/catch 已经生成语句后 helper 标志没有清掉,区域继续吸收后续代码时会被
 *     误判成新的 try/catch,把普通 `if (!code || code < 400) return` 输出成
 *     `try { ... } catch { return ... }`;
 *  2. `&&` 合并出的逻辑区域表达式本身就是 fallthrough 条件,true 边上的 Tail
 *     若不取反分支就会得到反向条件(`if (code && code >= 400) return`);
 *  3. ArkTS 13 另一个编译器版本把 finally handler 写成 `sta vX`(codeSize 非 0),
 *     `request` 的 finally 要还原成 `try/finally`,不能残留 sentinel 重抛;
 *  4. 词法层级按 pc 线性扫描会把成功分支里的 logger 命名成 `local_-1_3`;
 *  5. 匿名 Promise 执行器的入口自引用被折进 if test 后,ReservedIdentifierSimplifier
 *     删语句会把整个函数体删掉(postBinaryStreamOnce 曾输出空函数)。
 *
 * 最后与 test/expected/yourpipe-http-downloader.js 整类输出快照比对。
 */
function verifyYourpipeHttpDownloaderRetryTryCatch(clazz: PandaClass, code: string): void {
    NodeFactory.parse(code);
    if (code.includes("created by SimpleAnalysis") || code.includes("decompiler_")) {
        throw new Error(`HttpDownloader: 反编译降级或残留伪语句\n${code}`);
    }

    // 方法切片按“下一个方法头”定位,不写死缩进:纯 rethrow 的 try 被拆掉后,
    // 模块级 class 定义少了一层 try,方法缩进也跟着变。
    const sliceFrom = (header: string, next: RegExp): string => {
        const start = code.indexOf(header);
        if (start < 0) return "";
        const rest = code.slice(start);
        const end = rest.search(next);
        return end < 0 ? "" : rest.slice(0, end);
    };
    const request = sliceFrom("async request(p0", /\n\s*sleep\(p0\) \{/);
    const retry = sliceFrom("async postBinaryWithRetry(p0", /\n\s*postBinaryStreamOnce\(p0/);
    if (request.length === 0) throw new Error(`HttpDownloader: 未找到 request\n${code}`);
    if (retry.length === 0) throw new Error(`HttpDownloader: 未找到 postBinaryWithRetry\n${code}`);

    // request 的常量 test + 守卫已提成 `while (v10 < v12)`(守卫前是纯表达式,
    // 不会挡住 for/for-of 还原);postBinaryWithRetry 的守卫前还有三元物化的 if/else,
    // 不是纯表达式前缀,保持 while (true) + break。两者都必须保留 try。
    if (!request.includes("while (v10 < v12)") || !retry.includes("while (true)")
        || !request.includes("try {") || !retry.includes("try {")) {
        throw new Error(`HttpDownloader: 重试循环/try 未还原\n${request}\n----\n${retry}`);
    }

    // `if (!responseCode || responseCode < 400) return response;`
    if (!retry.includes("if (!v14.responseCode || v14.responseCode < 400) {")) {
        throw new Error(`HttpDownloader.postBinaryWithRetry: 响应码判断极性错误\n${retry}`);
    }
    // `if (!isRecoverable || attempt >= MAX_RETRIES) throw err;`
    // (静态初始化还原后类名是 HttpDownloader;还原前是 lexenv 槽 local_*/*HttpDownloader*)
    if (!/if \(!v17\.isRecoverable \|\| v12 >= (?:local_\S+ \/\*HttpDownloader\*\/|HttpDownloader)\.MAX_RETRIES\) \{/.test(retry)) {
        throw new Error(`HttpDownloader.postBinaryWithRetry: 重试上限判断丢失\n${retry}`);
    }

    // 成功路径必须是错误码分支的兄弟语句(分支以 continue/throw 结束后 else 已展开),
    // 不能被误当成 try/catch 的 catch 体:同一缩进层级 + 位于错误分支之后。
    const errorBranch = request.indexOf("if (v13.responseCode && v13.responseCode >= 400) {");
    if (errorBranch < 0) {
        throw new Error(`HttpDownloader.request: 错误码分支未还原\n${request}`);
    }
    const successAt = request.indexOf('debug("Success: ');
    if (successAt < errorBranch) {
        throw new Error(`HttpDownloader.request: 成功路径位置错误\n${request}`);
    }
    const indentOf = (text: string, index: number): string => {
        const lineStart = text.lastIndexOf("\n", index) + 1;
        return /^\s*/.exec(text.slice(lineStart))![0];
    };
    if (indentOf(request, successAt) !== indentOf(request, errorBranch)) {
        throw new Error(`HttpDownloader.request: 成功路径被误放进 catch 分支\n${request.slice(errorBranch)}`);
    }
    if (!/local_\S+ \/\*logger\*\/\.debug\("Success: /.test(request.slice(successAt - 40))) {
        throw new Error(`HttpDownloader.request: 成功路径未还原\n${request.slice(errorBranch)}`);
    }

    // ArkTS 13 的 finally handler(带 sta 保存异常、codeSize 非 0)要还原成 finally,
    // 不能残留 `catch (acc) { if (acc != hole) throw acc }` 哨兵收尾。
    if (!request.includes("} finally {") || !request.includes("v14.destroy();")) {
        throw new Error(`HttpDownloader.request: try/finally 未还原\n${request}`);
    }
    if (code.includes("hole") || code.includes("local_-")) {
        throw new Error(`HttpDownloader: 残留 hole 哨兵/非法词法层级变量\n${code}`);
    }
    // 同一层级连续定义的多个 class 会各自开一个 self-reference lexenv;命名不能撞车,
    // 否则后声明的 `let local_1_0` 会遮蔽 HttpError 自己的引用,优化器还会把外层
    // 声明删掉。这里按 Babel 作用域校验所有 local_X_Y[_Z] 引用都能解析到声明。
    assertNoUndeclaredLexvars(code);

    // 匿名 Promise 执行器曾在 ReservedIdentifierSimplifier 里被整条删掉函数体
    // (入口自引用被折进 if 的 test 序列,删除语句把整个函数体一起删了)。
    const streamOnceStart = code.indexOf("postBinaryStreamOnce(p0");
    const streamOnceEnd = code.indexOf("processBinaryHeaders(p0", streamOnceStart);
    if (streamOnceStart < 0 || streamOnceEnd < 0) {
        throw new Error(`HttpDownloader: 未找到 postBinaryStreamOnce\n${code}`);
    }
    const streamOnce = code.slice(streamOnceStart, streamOnceEnd);
    if (streamOnce.includes("new Promise(function (p0, p1) {})") || !streamOnce.includes("requestInStream(")) {
        throw new Error(`HttpDownloader.postBinaryStreamOnce: Promise 执行器函数体丢失\n${streamOnce}`);
    }

    // 整个类的输出快照:锁住 request / postBinaryWithRetry / postBinaryStreamOnce
    // 的还原结果以及其余方法的现状。
    const expectedPath = path.join(__dirname, "expected", "yourpipe-http-downloader.js");
    const expected = fs.readFileSync(expectedPath, "utf-8");
    if (code !== expected) {
        throw new Error(`HttpDownloader: 输出与快照不一致\n${firstDifference(expected, code)}`);
    }
}

/**
 * 回归:共享返回尾块被区域归约复制到每条路径,以及预装载寄存器的死赋值残留。
 *
 * `extractAvatarUrl` 的分派链(c4 / interactive / carousel / pageHeader)每个分支
 * 失败后都落到同一个"从 metadata 兜底"的返回尾块。区域图里这个尾块有几十个前驱,
 * 没有 goto 只能按前驱复制;而 reduceSequence/归约缓存还会让同一段语句在多条
 * 嵌套路径上重复输出,最终整类输出 1029 行(尾块被展开 49 次)。
 *
 * 修复覆盖三层:
 *   1. TailMergeSimplify:分支末尾与"紧接着会执行到的语句"逐字相同且以
 *      return/throw/break/continue 结尾时删除分支内副本,逐层收敛后尾块只剩一份;
 *   2. 活跃性按求值顺序只看"确定写入之前"的读取(`v7 = this.asRecord` 这类为调用
 *      序列预装载寄存器的赋值在 test 里先被重写,不再算作活跃读取);
 *   3. ConditionSimplify 清理布尔位置的序列尾部自取反物化对
 *      `..., acc = !acc, !acc`,以及 test 尾部冗余读取。
 *
 * 断言尾块唯一、死预装载/物化残渣清零,并与整类输出快照比对。
 */
function verifyYourpipeChannelInfoService(clazz: PandaClass, code: string): void {
    NodeFactory.parse(code);
    if (code.includes("created by SimpleAnalysis") || code.includes("decompiler_")) {
        throw new Error(`ChannelInfoService: 反编译降级或残留伪语句\n${code}`);
    }

    // 提前 return 的 for...of 还有 do-while lowering 形态:
    //   it = x[Symbol.iterator](); acc = false;
    //   do { v = it.next(); if (v.done) { DONE } ...; acc = ... } while (acc);
    //   close(it); return E;
    // extractSubscriberText(两层循环)与 extractVideoCountText 都要还原成 for...of:
    // done 分支的代码落在 for-of 之后,`it.next` 提升的临时方法量先归一化,
    // test 的常量初值(`acc = false`)与迭代器/收尾残留清零。
    if (!code.includes("for (v14 of v8) {") || !code.includes("for (v16 of v9) {")) {
        throw new Error(`ChannelInfoService: do-while 形态的 for...of 未还原\n${code}`);
    }
    if (code.includes("[Symbol.iterator]") || /\bdo \{/.test(code) || code.includes(".next")) {
        throw new Error(`ChannelInfoService: 迭代器/do-while lowering 残留\n${code}`);
    }

    const start = code.indexOf("extractAvatarUrl(p0) {");
    const end = code.indexOf("extractSubscriberText(p0) {", start);
    if (start < 0 || end < 0) throw new Error(`ChannelInfoService: 未找到 extractAvatarUrl\n${code}`);
    const avatar = code.slice(start, end);

    // 元数据兜底尾块只允许出现一次(修复前被展开 49 次)
    const tail = "return v5 && (v7 = this.asRecord(v5.channelMetadataRenderer))";
    if (avatar.split(tail).length - 1 !== 1) {
        throw new Error(`ChannelInfoService.extractAvatarUrl: 元数据兜底尾块被重复展开\n${avatar}`);
    }
    // 四条分派链的守卫子句与唯一的尾部返回
    for (const fragment of [
        "v7 = this.asRecord(v4.c4TabbedHeaderRenderer);",
        "v9 = this.asRecord(v4.interactiveTabbedHeaderRenderer);",
        "v8 = this.asRecord(v4.carouselHeaderRenderer);",
        "v10 = this.asRecord(v4.pageHeaderRenderer);",
        "v10 = \"metadata\";",
        "v5 = this.asRecord(p0.metadata);",
    ]) {
        if (!avatar.includes(fragment)) {
            throw new Error(`ChannelInfoService.extractAvatarUrl: 缺少 ${fragment}\n${avatar}`);
        }
    }
    // 为调用序列预装载寄存器的死赋值必须被清掉(`v11 = this.asRecord;` 这类
    // 在 test 里先被重写再读取的赋值)
    for (const dead of ["v12 = this;", "v11 = this.asRecord;", "v7 = this.asRecord;", "v8 = this;"]) {
        if (avatar.includes(dead)) {
            throw new Error(`ChannelInfoService.extractAvatarUrl: 死预装载残留 ${JSON.stringify(dead)}\n${avatar}`);
        }
    }
    // 元数据兜底入口只执行一次
    if (avatar.split('v10 = "metadata";').length - 1 !== 1) {
        throw new Error(`ChannelInfoService.extractAvatarUrl: metadata 兜底语句重复\n${avatar}`);
    }
    // 测试序列里的自取反/自拷贝物化残渣必须清零
    if (/acc = acc\b|\bacc = !acc\b/.test(avatar)) {
        throw new Error(`ChannelInfoService.extractAvatarUrl: acc 物化残渣残留\n${avatar}`);
    }
    // 条件链保持 && 形态,不再被物化序列打散
    if (!avatar.includes("if (v8 && (v11 = this.asArray(v8.contents)) && v11.length > 0 &&")) {
        throw new Error(`ChannelInfoService.extractAvatarUrl: carousel 条件未还原\n${avatar}`);
    }
    // pageHeader 分派链:可选链枢纽(acc)要搬进 pickLargestImageUrl 的参数
    if (!avatar.includes("if (v10) {")
        || !avatar.includes("v17 = this.pickLargestImageUrl(this.asArray(this.asRecord(v13.image)?.sources));")) {
        throw new Error(`ChannelInfoService.extractAvatarUrl: pageHeader 分派链缺失\n${avatar}`);
    }

    const expectedPath = path.join(__dirname, "expected", "yourpipe-channel-info-service.js");
    const expected = fs.readFileSync(expectedPath, "utf-8");
    if (code !== expected) {
        throw new Error(`ChannelInfoService: 输出与快照不一致\n${firstDifference(expected, code)}`);
    }
}

/**
 * 回归:amcl1.0.6.abc 的两个结构化/简化内存问题。
 *
 * 1) `L&entry/src/main/ets/r5/i8&;` 的 local_0_5 是 do-while lowering 的
 *    for...of:循环体没有提前退出,迭代器循环后面没有 close/续接代码,只剩
 *    test 为假时的出口 `throw`。
 *    `checkAndTransformDoWhileToForOfStatement` 的出口扫描按对象判空
 *    (`while (cursor && ...)`),而 babel 的 getNextSibling() 在列表末尾返回
 *    node 为 null 的 NodePath(对象非空),扫描永远前进不了、exitPaths 无限
 *    增长,单类 simplify 直接 OOM。修复后仍要还原成 for...of(出口 throw 折成
 *    循环体内的 `if (!T) throw`)。
 *
 * 2) `L&gamecontrol/src/main/ets/z12&1.0.0;` 的 #*#w1359 / #*#t1359 在区域归约
 *    里把共享后继按引用指数展开(39.3 万 / 7.5 万条语句,283MB / 63MB AST,
 *    simplify 需要 10GB+ 内存且跑几分钟)。结构分析在按展开规模判定超限时会先做
 *    区域级共享尾块消除(把 `if (C) { ...; if (D) { X } else { NEXT } } else { NEXT }`
 *    收敛成 `if (C) { ...; if (D) { X } } NEXT`),两个方法现在正常结构化输出;
 *    超过 MAX_STRUCTURED_STATEMENTS 的方法仍按设计降级到 SimpleAnalysis。
 *
 * 两个类的完整输出分别锁定在 expected/amcl-i8.js / expected/amcl-z12.js。
 */
function verifyAmclStructureMemory(clazz: PandaClass, forOfCode: string, ctx: BinaryContext): void {
    NodeFactory.parse(forOfCode);
    if (forOfCode.includes("created by SimpleAnalysis") || forOfCode.includes("decompiler_")) {
        throw new Error(`amcl i8: 反编译降级或残留伪语句\n${forOfCode.slice(0, 500)}`);
    }
    // 没有 close 的迭代器循环也要还原成 for...of(local_0_5),出口 throw 折进循环体
    for (const fragment of [
        "for (v7 of p0) {",
        'if (!new RegExp("^[0-9a-f]{64}$").test(v7.sha256)) throw new Error("归档快照缺少可信SHA256");',
        "for (v6 of v1.keys()) {",
    ]) {
        if (!forOfCode.includes(fragment)) {
            throw new Error(`amcl i8: 缺少 ${JSON.stringify(fragment)}\n${forOfCode}`);
        }
    }
    for (const leftover of [
        "p0[Symbol.iterator]()",
        "v4.next()",
        "if (v7.done) {",
        "} while (acc);",
    ]) {
        if (forOfCode.includes(leftover)) {
            throw new Error(`amcl i8: 迭代器 lowering 残留 ${JSON.stringify(leftover)}\n${forOfCode}`);
        }
    }

    const forOfExpected = fs.readFileSync(path.join(__dirname, "expected", "amcl-i8.js"), "utf-8");
    if (forOfCode !== forOfExpected) {
        throw new Error(`amcl i8: 输出与快照不一致\n${firstDifference(forOfExpected, forOfCode)}`);
    }

    const expandedCode = ctx.decompileNamed("L&gamecontrol/src/main/ets/z12&1.0.0;");
    NodeFactory.parse(expandedCode);
    // 共享后继的指数展开由结构分析里的区域级共享尾块消除收敛成线性结构
    // (StructureAnalysis.pruneRedundantTailBranches):w1359 / t1359 不再降级。
    if (expandedCode.includes("created by SimpleAnalysis") || expandedCode.includes("decompiler_goto")) {
        throw new Error(`amcl z12: 仍有方法降级或残留伪语句\n${expandedCode.slice(0, 500)}`);
    }
    for (const fragment of [
        "local_0_18 = function (p0, p1, p2, p3) {",
        'return local_0_10(p2, p3, "depth");',
        "v3 = local_0_18(p0.children[v1], p1 + 1, p2, p3 + \".children[\" + v1.toString() + \"]\");",
        "export function w1359(p0) {",
        "if (p0.profileId !== undefined) {",
        'return local_0_19("profile.identity");',
        // while(true)+break 的 for-of lowering:`hole` 哨兵守卫清理后才露出标准 close 形态,
        // 由 SimplifyExport 末尾补跑的 restoreIteratorLoops 还原,提前 return 分支里内联的
        // iterator close(`if (v2.return != undefined) v2.return();`)一并删除。
        "for (v5 of p0.requiredCapabilities) {",
        'return "groups.capability";',
    ]) {
        if (!expandedCode.includes(fragment)) {
            throw new Error(`amcl z12: 缺少 ${JSON.stringify(fragment)}\n${expandedCode}`);
        }
    }
    for (const leftover of [
        "v2 = p0.requiredCapabilities[Symbol.iterator]();",
        "if (v2.return != undefined)",
        "local_0_18 = function (p0, p1, p2, p3) //The function was created by SimpleAnalysis",
    ]) {
        if (expandedCode.includes(leftover)) {
            throw new Error(`amcl z12: 迭代器 lowering 残留 ${JSON.stringify(leftover)}\n${expandedCode}`);
        }
    }
    if (expandedCode.length > 500_000) {
        throw new Error(`amcl z12: 输出仍异常膨胀 (${expandedCode.length} chars)`);
    }

    const expandedExpected = fs.readFileSync(path.join(__dirname, "expected", "amcl-z12.js"), "utf-8");
    if (expandedCode !== expandedExpected) {
        throw new Error(`amcl z12: 输出与快照不一致\n${firstDifference(expandedExpected, expandedCode)}`);
    }

    // 条件折叠把 `v4 = v4.inheritsFrom.length` 并进外层 if 的 test 后,这次读取与
    // for-of 循环的最近公共祖先是 if 语句本身;hasNewerValueBefore 必须认得
    // “条件在分支(含循环体)之前求值”,否则 for-of 退化成手动迭代器循环。
    const forOfGuardCode = ctx.decompileNamed("L&entry/src/main/ets/e4/s6&;");
    NodeFactory.parse(forOfGuardCode);
    for (const fragment of [
        'if (v4 !== null && v4.inheritsFrom.length === 0) {',
        'for (v12 of ["mobilegl", "minecraft-vulkan"]) {',
    ]) {
        if (!forOfGuardCode.includes(fragment)) {
            throw new Error(`amcl s6: 缺少 ${JSON.stringify(fragment)}\n${forOfGuardCode}`);
        }
    }
    if (/v12 = [A-Za-z_$][\w$]*\.next\(\)/.test(forOfGuardCode)) {
        throw new Error(`amcl s6: 条件折叠后的 for-of 退化成手动迭代器循环\n${forOfGuardCode}`);
    }
}

/**
 * 回归:amcl1.0.6.abc 的 `L&commons/src/main/ets/h1/w1&1.0.0;` 里 #*#w91 曾整方法降级
 * SimpleAnalysis。
 *
 * w91 覆盖整个函数体的大 try 的 finally handler 在 ArkTS 13 里带 codeSize === 0,
 * RegionGraphBuilder 按设计跳过它;但 handler 下游的清理代码里有一个 for-of 关闭循环
 * (`for (const f of openFiles) g50.closeSync(f)`),它只能经由这个被跳过的 handler
 * 到达,在区域图里形成带环的孤岛(inDegree > 0,躲过上一步的 inDegree 死代码删除);
 * analysis 只从 entryRegion 出发归约,永远遍历不到孤岛,3000 轮后抛
 * "can not reduce the graph" 降级。
 *
 * 修复:helper 区域接好后按 entryRegion 可达性再清一遍死代码;不可达集合里出现真正的
 * 异常 landing pad 时仍然降级(删掉会丢 catch 语义)。同一方法还暴露出 popLexEnv 落在
 * 条件 test 的 SequenceExpression 里时按块切分会读 node.body 抛 TypeError。
 *
 * 整个类的输出锁定在 expected/amcl-commons-w1.js。
 */
function verifyAmclUnreachableHandlerIsland(clazz: PandaClass, code: string): void {
    NodeFactory.parse(code);
    if (code.includes("created by SimpleAnalysis") || code.includes("decompiler_")) {
        throw new Error(`amcl commons/w1: 仍在降级或残留伪语句\n${code.slice(0, 800)}`);
    }
    for (const fragment of [
        // 最外层的文件校验与 for-of 主循环(后面是正常的 for 循环,不是线性输出)
        "if (b92(v22, v3).length === new Set(v3).size) {",
        "if (v6.length === 0) {",
        // 既有 try/finally 还原能力不能被这次结构分析改动破坏
        "        } finally {\n          await g50.close(v34);\n        }",
        // 正常路径上的 openFiles 关闭循环(结构分析里被剪掉的是异常路径的同一段副本)
        "g50.closeSync(v23.file);",
        "local_0_2(v5, m92, v4);",
    ]) {
        if (!code.includes(fragment)) {
            throw new Error(`amcl commons/w1: 缺少 ${JSON.stringify(fragment)}\n${code}`);
        }
    }
    const expected = fs.readFileSync(path.join(__dirname, "expected", "amcl-commons-w1.js"), "utf-8");
    if (code !== expected) {
        throw new Error(`amcl commons/w1: 输出与快照不一致\n${firstDifference(expected, code)}`);
    }
}

/**
 * 回归:amcl1.0.6.abc 的 `L&entry/src/main/ets/r2/l3&;` 里 `#~@2>#loadLive` 曾整方法降级。
 *
 * 该方法的 CFG 里 2902 同时是内层循环头(6056 → 2902 的回边)和外层循环体的一部分
 * (2902 → 1017 的回边)。归约在 `reduceIfRegion` case 3 把两个分支汇合到 2902 自身
 * (语句里 else 分支按引用嵌入 1017 这个 region),随后 `reduceCyclic` 把 2902 包成
 * while,`reduceSequence` 又把 1017 这个 region 合并进来 —— 而 while 里的 if 的 else
 * 仍指向它自己,语句图成环。`Region.decompile()` 按引用展开,递归深度没有上界:
 * 浅时抛 RangeError 降级 SimpleAnalysis,深时直接爆栈/OOM(在 debug 遍历里见过整进程
 * 4GB 堆耗尽)。
 *
 * 修复:两条防线。
 *   1) `reduceSequence` 合并前用 `statementsReferenceRegion` 检查:合并后会不会让
 *      region 的语句子树引用回自己,会就不合并,交给循环归约处理;
 *   2) `analysis` 末尾用迭代 DFS 兜底检测语句图环,发现环抛 PandaDecompileException
 *      走 SimpleAnalysis 降级,绝不让它无限递归。
 *
 * 这是 amcl 里唯一受影响的类;loadLive 现在正常结构化,它的事件裁剪循环里
 * determineFollowLatch 兜底留下的 `label_4078` + `xpanda_goto(label_4078)` 也由
 * GotoLoopRestore 还原成 `while (true) { ...; break; }`(见 verifyGotoLoopFallthrough)。
 * 整个类的输出锁定在 expected/amcl-r2-l3.js。
 */
function verifyAmclStructuredCycleGuard(clazz: PandaClass, code: string): void {
    NodeFactory.parse(code);
    if (code.includes("created by SimpleAnalysis") || code.includes("decompiler_")) {
        throw new Error(`amcl r2/l3: 仍在降级或残留伪语句\n${code.slice(0, 800)}`);
    }
    if (!code.includes("  async loadLive(p0, p1, p2) {")) {
        throw new Error(`amcl r2/l3: loadLive 没有结构化输出\n${code.slice(0, 800)}`);
    }
    // determineFollowLatch 兜底的 label/goto 必须还原成 while (true) + continue/break
    for (const leftover of ["xpanda_goto", "label_4078"]) {
        if (code.includes(leftover)) {
            throw new Error(`amcl r2/l3: 残留伪语句 ${JSON.stringify(leftover)}\n${code}`);
        }
    }
    for (const fragment of [
        'if (this.live === undefined || this.live.path !== p0.path) {',
        "await this.live.cursor.refreshLive();",
        'v24 = this.live.pending.indexOf("\\n");',
        "v24 = this.live.parser.feed(v25, v27);",
        "this.live.events.push(v24);",
        // 分支里的索引自更新(v7 += 1)要折进唯一一次读取,三目才能合成
        'p0.pending = v7 >= 0 ? p0.pending.substring(v7 + 1) : "";',
    ]) {
        if (!code.includes(fragment)) {
            throw new Error(`amcl r2/l3: 缺少 ${JSON.stringify(fragment)}\n${code}`);
        }
    }
    const expected = fs.readFileSync(path.join(__dirname, "expected", "amcl-r2-l3.js"), "utf-8");
    if (code !== expected) {
        throw new Error(`amcl r2/l3: 输出与快照不一致\n${firstDifference(expected, code)}`);
    }
}

/**
 * 回归:break 退出 for...of 时内联的 iterator close 块与伪 goto break。
 *
 * `L&feature_core/src/main/ets/t11/a12&1.0.0;` 的 `#*#c1268` 结构化输出:
 *
 *   v30 = "";
 *   it = JSON.parse(...).versions[Symbol.iterator]();
 *   do {
 *     vv = it.next();
 *     if (vv.done) { break; //from goto label_5439 }  // goto 出口输出成伪 break
 *     vv = vv.value;
 *   } while (vv.id !== p1);       // foldDoWhileTestAssignments 折平的裸条件 test
 *   v30 = vv.url || "";           // break 路径前缀(EXIT)
 *   { v = hole; if (it.return != undefined) it.return(); }  // close + hole 哨兵残留
 *   label_5439: ;                 // goto 目标(续接代码)
 *   acc = v30.length === 0;
 *
 * 旧实现只认“物化标识符 test + 裸 close if”的 break 形态,于是整块 close/哨兵/
 * 标签都留在输出里;并且伪 goto break 被当成真正的 break 计算活跃性,`v30 = ""`
 * (只在标签之后才被读取)会被误删。现在应还原成:
 *
 *   v30 = "";
 *   for (v33 of JSON.parse(...).versions) {
 *     if (v33.id === p1) { v30 = v33.url || ""; break; }
 *   }
 *   acc = v30.length === 0;
 *
 * close 由 for...of 的 break 隐式完成;`v30 = ""` 必须保留(耗尽路径会读
 * `v30.length`)。整类输出锁定在 expected/amcl-t11-a12.js。
 */
function verifyAmclForOfCloseBlock(clazz: PandaClass, code: string): void {
    NodeFactory.parse(code);
    if (code.includes("created by SimpleAnalysis") || code.includes("decompiler_")) {
        throw new Error(`amcl a12: 仍在降级或残留伪语句\n${code.slice(0, 800)}`);
    }
    const start = code.indexOf("export async function c1268(");
    if (start < 0) throw new Error(`amcl a12: 未找到 c1268\n${code.slice(0, 800)}`);
    const body = code.slice(start, code.indexOf("\n}", start));
    // close 块、hole 哨兵与 goto 标签都随 for...of 还原消失
    for (const leftover of ["versions[Symbol.iterator]()", "label_5439", "v29.return", "v33 = hole"]) {
        if (body.includes(leftover)) {
            throw new Error(`amcl a12: iterator 收尾残留 ${JSON.stringify(leftover)}\n${body}`);
        }
    }
    for (const fragment of [
        // 耗尽路径的初始化必须保留(伪 goto break 的活跃性按标签处计算)
        'v30 = "";',
        "for (v33 of JSON.parse(await local_1_3.fetchText(v12)).versions) {",
        "if (v33.id === p1) {",
        'v30 = v33.url || "";',
        "break;",
    ]) {
        if (!body.includes(fragment)) {
            throw new Error(`amcl a12: 缺少 ${JSON.stringify(fragment)}\n${body}`);
        }
    }
    const expected = fs.readFileSync(path.join(__dirname, "expected", "amcl-t11-a12.js"), "utf-8");
    if (code !== expected) {
        throw new Error(`amcl a12: 输出与快照不一致\n${firstDifference(expected, code)}`);
    }
}

/**
 * 回归:amcl t11/d12 的 readJarMainClass 曾整方法降级 SimpleAnalysis。
 *
 * mkdir 的空 catch 是一条 nop jmp,落点已经是后面 decompress 的 try 体。
 * 成功边若直接落到 try 体,就会绕过 catch,jmp 再把 helper 吸进空 catch,
 * 区域图收不成一个节点(`can not reduce the graph`)。读 manifest 的 catch
 * 以若干 mov 开头再 `return ""`,也要当成忽略异常的 catch,不能剪掉。
 */
function verifyAmclReadJarMainClass(clazz: PandaClass, code: string): void {
    NodeFactory.parse(code);
    if (code.includes("created by SimpleAnalysis") || code.includes("decompiler_")) {
        throw new Error(`amcl d12: 仍在降级或残留伪语句\n${code.slice(0, 800)}`);
    }
    const start = code.indexOf("static async readJarMainClass(");
    if (start < 0) throw new Error(`amcl d12: 未找到 readJarMainClass\n${code.slice(0, 800)}`);
    const body = code.slice(start, code.indexOf("\n  static ", start));
    for (const fragment of [
        "try {\n        g50.mkdirSync(v4, true);\n      } catch (catchAcc) {}",
        "await v1267(p0, v4);",
        'y.warn(local_0_0, "decompress for manifest failed " + p0 + ": " + catchAcc.message + "", null, a32);',
        'g50.readTextSync(v4 + "/META-INF/MANIFEST.MF")',
        'return "";',
        "return g771.parseManifestMainClass(v3);",
    ]) {
        if (!body.includes(fragment)) {
            throw new Error(`amcl d12: 缺少 ${JSON.stringify(fragment)}\n${body}`);
        }
    }
    const expected = fs.readFileSync(path.join(__dirname, "expected", "amcl-t11-d12.js"), "utf-8");
    if (code !== expected) {
        throw new Error(`amcl d12: 输出与快照不一致\n${firstDifference(expected, code)}`);
    }
}

/**
 * 回归:amcl n4/o8 的 clearDisplayListeners 曾整方法降级 SimpleAnalysis。
 *
 * 循环体里 `if (enhancedDisplays) { try { off } catch {} }` 的空 catch 处理器
 * 就是循环自增块(handlerPC 指向闩),旧分类把它当成“常量日志后 return”的
 * 忽略异常 catch(洪泛扫描沿回边走进整个循环体),于是同一个 try 被接了两个
 * helper,归约成 try { try { off } catch {}; i++ } catch { i++ }。
 * 另外 `if (增强显示)` 条件与 try/catch helper 相邻时,逻辑条件合并曾把没有
 * 语句的 helper 当成 `A && B` 的操作数,decompile 时抛 TypeError 降级。
 */
function verifyAmclDisplayListenersLoop(clazz: PandaClass, code: string): void {
    NodeFactory.parse(code);
    if (code.includes("created by SimpleAnalysis") || code.includes("decompiler_")
        || code.includes("xpanda_goto")) {
        throw new Error(`amcl o8: 仍在降级或残留伪语句\n${code.slice(0, 800)}`);
    }
    const start = code.indexOf("  clearDisplayListeners() {");
    if (start < 0) throw new Error(`amcl o8: 未找到 clearDisplayListeners\n${code.slice(0, 800)}`);
    const body = code.slice(start, code.indexOf("\n  refresh()", start));
    for (const leftover of ["[Symbol.iterator]", "label_", "//from goto"]) {
        if (body.includes(leftover)) {
            throw new Error(`amcl o8: 循环/标签残留 ${JSON.stringify(leftover)}\n${body}`);
        }
    }
    if ((body.match(/try \{/g) ?? []).length !== 1) {
        throw new Error(`amcl o8: 空的 catch 被重复包了一层 try\n${body}`);
    }
    for (const fragment of [
        "for (v0 = 0; v0 < this.displays.length; v0 += 1) {",
        "if (this.enhancedDisplays) {",
        'this.displays[v0].off("availableAreaChange", this.areaListener);',
        "} catch (catchAcc) {}",
        "this.displays = [];",
    ]) {
        if (!body.includes(fragment)) {
            throw new Error(`amcl o8: 缺少 ${JSON.stringify(fragment)}\n${body}`);
        }
    }
}

/**
 * 回归:amcl launch r16 的回边 goto 落在已带 label 的循环里。
 *
 * `determineFollowLatch` 兜底给回边插了 `xpanda_goto(label_43)`,结构化归约
 * 又把 label 挂到了循环头上(`label_43: while (true) { … }`)。原来的
 * GotoLoopRestore 只认 `label_x: ;` + 同层 goto,这里 label 体已经是循环,
 * goto 又埋在 `if (v1.has(v5))` 分支里,于是原样输出成不可执行调用。
 * 现在应还原成 `continue`(label 无其它引用时一并去掉)。
 * 整类输出锁定在 expected/amcl-launch-r16.js。
 */
function verifyAmclLaunchGotoLoop(clazz: PandaClass, code: string): void {
    NodeFactory.parse(code);
    if (code.includes("created by SimpleAnalysis") || code.includes("decompiler_")) {
        throw new Error(`amcl r16: 反编译降级或残留伪语句\n${code}`);
    }
    for (const leftover of ["xpanda_goto", "label_"]) {
        if (code.includes(leftover)) {
            throw new Error(`amcl r16: 仍残留 ${JSON.stringify(leftover)}\n${code}`);
        }
    }
    // 模块导出表里的本地名就是真实绑定:`let v1511 = function …; export { v1511 }`
    // 要折成 `export function v1511(…)`(vN 虽然是临时命名风格,但这里是导出名)
    if (code.includes("export { v1511 }") || !code.includes("export function v1511(p0) {")) {
        throw new Error(`amcl r16: v1511 没有折成 export function\n${code}`);
    }
    for (const fragment of [
        "while (true) {",
        "if (v3 < 0) {",
        "return v2.reverse();",
        "if (v1.has(v5)) {",
        "v3 -= 1;\n        continue;",
    ]) {
        if (!code.includes(fragment)) {
            throw new Error(`amcl r16: 缺少 ${JSON.stringify(fragment)}\n${code}`);
        }
    }
    const expected = fs.readFileSync(path.join(__dirname, "expected", "amcl-launch-r16.js"), "utf-8");
    if (code !== expected) {
        throw new Error(`amcl r16: 输出与快照不一致\n${firstDifference(expected, code)}`);
    }
}

/**
 * 回归:catch 与 try 体共用的汇合点不能展开进 catch 分针(amcl l8,源码 ExportJarVerifier)。
 *
 * 源码 `try { await fs.lstat(targetDir); exists = true } catch (e) { if (e.code !== ENOENT) throw e }`
 * 之后是整段校验流程;handler 末尾的 `if (代码 !== ENOENT) throw` 与 try 体都落到同一个
 * 汇合点。旧实现把汇合点当成“两条终止分支”按引用展开进 catch 的 else,Try 归约再吸收
 * 一份,于是 try 体和 catch 体各带一整份续接代码(catch 里多出一份 runJarVerification、
 * 一份 finally 尾块),`exists` 也被折叠成两个常量检查:
 *
 *   try {
 *     await g50.lstat(p1);
 *     local_0_0(false, "解压目标已存在，拒绝接管");   // !exists,exists 恒为 true
 *     await local_0_17(...);
 *     return undefined;
 *   } catch (catchAcc) {
 *     if (catchAcc.code === 13900002) { local_0_0(true, …); await local_0_17(...); return; }
 *     throw catchAcc;
 *   }
 *
 * 现在必须是源码结构:try 只包住 lstat,续接代码只出现一次。被 for-of 的 done
 * 分支吞掉的 finally(`q776` 的 `await jarRemove(owner)`)由"循环耗尽分支里的
 * finally"布局还原成 `if (vv.done) { …; break }` + 真实 `try { … } finally { … }`。
 * 整类输出锁定在 expected/amcl-r5-l8.js。
 */
function verifyAmclSharedTryCatchJoin(clazz: PandaClass, code: string): void {
    if (clazz.name.content !== "L&entry/src/main/ets/r5/l8&;") {
        throw new Error(`amcl l8: 类名不符 (${clazz.name.content})`);
    }
    NodeFactory.parse(code);
    for (const leftover of ["created by SimpleAnalysis", "xpanda_goto", "decompiler_"]) {
        if (code.includes(leftover)) {
            throw new Error(`amcl l8: 反编译降级或残留伪语句 ${JSON.stringify(leftover)}\n${code}`);
        }
    }
    if (code.includes("try/finally not restored")) {
        throw new Error(`amcl l8: 仍有未还原的 finally\n${code}`);
    }
    const start = code.indexOf("export async function t771(");
    if (start < 0) throw new Error(`amcl l8: 未找到 extractVerifiedExportJar(t771)\n${code}`);
    const body = code.slice(start, code.indexOf("\n}\n", start));
    for (const fragment of [
        "v3 = false;\n  try {",
        "await g50.lstat(p1);\n    v3 = true;",
        "if (catchAcc.code !== 13900002) {",
        'v3 = !v3;\n  local_0_0(v3, "解压目标已存在，拒绝接管");',
    ]) {
        if (!body.includes(fragment)) {
            throw new Error(`amcl l8 t771: 缺少 ${JSON.stringify(fragment)}\n${body}`);
        }
    }
    // 续接代码不能在 catch 里再复制一份
    if (body.indexOf("await local_0_17(p0,") !== body.lastIndexOf("await local_0_17(p0,")) {
        throw new Error(`amcl l8 t771: 续接代码被复制进 catch\n${body}`);
    }
    const calls = code.split("await local_0_17(p0,").length - 1;
    if (calls !== 2) {
        throw new Error(`amcl l8: runJarVerification 调用应为 2 次(仅校验 + 已验证解包),实际 ${calls}\n${code}`);
    }
    // `exists` 不能再折叠成 jarRequire 的常量实参
    if (body.includes("local_0_0(false,") || body.includes("local_0_0(true,")) {
        throw new Error(`amcl l8 t771: exists 被折叠成常量检查\n${body}`);
    }
    // jarInspect:编译器把 cleanup 内联在 return 之前,还原成 try/finally 后
    // return 在 finally 之后(此前 close(file) 只走正常路径,异常时文件不关)
    if (!code.includes("  } finally {\n    await g50.close(v4);\n  }\n  return v16;\n};")) {
        throw new Error(`amcl l8 jarInspect: 内联 cleanup 的 finally 未还原\n${code}`);
    }
    // jarFreeze:嵌套 finally(外层 finally 体是内层的 try/finally)
    if (!code.includes("  } finally {\n    try {\n      if (v7 !== undefined) {\n        await g50.close(v7);\n      }\n    } finally {\n      await g50.close(v4);\n    }\n  }")) {
        throw new Error(`amcl l8 jarFreeze: 嵌套 finally 未还原\n${code}`);
    }
    // runJarVerification:条目校验循环里还有一层 try/finally(close(opened)),
    // cleanup 被并进了 do-while 的 test,还原成循环体尾部的 try/finally
    if (!code.includes("      try {\n        v0 = await g50.stat(v0.fd);")) {
        throw new Error(`amcl l8 runJarVerification: 条目校验的 try 体丢失\n${code}`);
    }
    if (!code.includes("} finally {\n        v37 = hole;\n        await g50.close(v25);\n      }")) {
        throw new Error(`amcl l8 runJarVerification: close(opened) 不在 finally 里\n${code}`);
    }
    // runJarVerification:for-of 的 done 分支只跳出循环,cleanup 是真实 finally
    for (const fragment of [
        "if (v18.done) {\n        local_0_1(p4);\n        break;\n      }",
        "} finally {\n    await local_0_13(v3);\n  }",
    ]) {
        if (!code.includes(fragment)) {
            throw new Error(`amcl l8: 缺少 ${JSON.stringify(fragment)}\n${code}`);
        }
    }
    const expected = fs.readFileSync(path.join(__dirname, "expected", "amcl-r5-l8.js"), "utf-8");
    if (code !== expected) {
        throw new Error(`amcl l8: 输出与快照不一致\n${firstDifference(expected, code)}`);
    }
}

/**
 * 回归:用户 catch 与 finally 共用起点时 catch 体不能整段消失(amcl i15,JdkInstaller)。
 *
 * 源码 `try { …for (const source of candidates) { try { … } catch (e) { alog().warn(…);
 * …unlink… } finally { purgeNativeOwners(); for (path of paths) unlink } } … }`。
 * catch 条目的保护范围比 finally 短,13.0.1.0 上又因为 try 范围里有 hole 哨兵被当成
 * finally 落点(handler 不离开 try)整段丢掉:catch 体(告警 + waitForNativeOwners +
 * 清理)从输出里消失,连带 for-of 后面的"下一个候选源"回边与 finally 尾块也不可达,
 * 方法只剩第一个候选源的一次执行。
 *
 * 现在:catch 条目按"与 finally 共用起点的用户 catch"接进图,finally 由 TryFinally
 * 挂到同一个 try 上(cleanup 落在 catch 体尾部时截断 catch、把 cleanup 段变成
 * finally,守卫之后的续接搬回 try/catch/finally 之后)。
 *
 * 同一个类里的 `concatParts` 覆盖 finally 的另一种布局(循环体尾部守卫):
 * `for (const p of parts) { let inp = null; try { inp = open(p); while (…) read/write }
 * finally { if (inp) try { close(inp) } catch {} } }` 被编译成
 * `do { …; try 体; CLEANUP; if (pending != hole) throw pending } while (!guard)`,
 * 守卫的非抛出分支是一条只有 `jmp` 的回边(跳回循环头)、哨兵比较被物化成 do-while
 * 的 test。守卫后面既没有 if 也没有 end 标记,旧布局只能报
 * `no usable end marker`,于是内层 finally 没还原、循环 test 把重抛吞掉
 * (异常时静默结束循环)。现在由 FinallyPlan.loopTailGuard 布局还原。
 */
/**
 * 回归:无代码但有非空 export 表的空模块(amcl)。
 * `n5` 是纯 re-export 的 barrel 文件:func_main_0 仅 returnundefined,模块元数据
 * 只有一条改名间接导出。输出必须带 empty module 标记,且 export 表语句要原样保留
 * (防止把空模块当成"没有输出"丢弃时连带丢掉 export 表)。
 */
function verifyAmclEmptyModuleBarrelExport(clazz: PandaClass, code: string): void {
    if (clazz.name.content !== "L&entry/src/main/n5&;") {
        throw new Error(`amcl n5: 类名不符 (${clazz.name.content})`);
    }
    NodeFactory.parse(code);
    if (!code.includes("* empty module: no runtime code in this class record")) {
        throw new Error(`amcl n5: 缺少 empty module 标记\n${code}`);
    }
    const body = code.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (body !== 'export { f1061 as t302 } from "@normalized:N&&&entry/src/main/ets/d8/j9&";') {
        throw new Error(`amcl n5: 空模块应只保留 export 表语句\n${code}`);
    }
}

function verifyAmclSharedCatchFinally(clazz: PandaClass, code: string): void {
    if (clazz.name.content !== "L&launch/src/main/ets/i15&1.0.0;") {
        throw new Error(`amcl i15: 类名不符 (${clazz.name.content})`);
    }
    NodeFactory.parse(code);
    if (code.includes("created by SimpleAnalysis")) {
        throw new Error(`amcl i15: 反编译降级\n${code}`);
    }
    const start = code.indexOf("async downloadCatalogArchive(p0, p1, p2) {");
    if (start < 0) throw new Error(`amcl i15: 未找到 downloadCatalogArchive\n${code}`);
    const body = code.slice(start, code.indexOf("\n  bridgeProgress(", start));
    for (const fragment of [
        // 用户 catch 体(此前整段丢失)
        '"目录下载来源失败："',
        // catch 与 finally 必须都在同一个 try 上
        "} catch (catchAcc) {",
        "} finally {",
        // 循环之后的兜底(此前不可达)
        '所选来源不可用，旧安装已保留',
    ]) {
        if (!body.includes(fragment)) {
            throw new Error(`amcl i15 downloadCatalogArchive: 缺少 ${JSON.stringify(fragment)}\n${body}`);
        }
    }
    // finally 必须在 catch 之后、方法尾部兜底之前
    const catchAt = body.indexOf("目录下载来源失败");
    const finallyAt = body.lastIndexOf("} finally {");
    const tailAt = body.lastIndexOf("所选来源不可用");
    if (!(catchAt < finallyAt && finallyAt < tailAt)) {
        throw new Error(`amcl i15 downloadCatalogArchive: catch/finally/兜底顺序不对 (${catchAt}/${finallyAt}/${tailAt})`);
    }
    // concatParts:内层 finally(close(inp))必须还原,循环 test 不能还带着守卫
    const concatStart = code.indexOf("  concatParts(p0, p1) {");
    if (concatStart < 0) throw new Error(`amcl i15: 未找到 concatParts\n${code}`);
    const concatEnd = code.indexOf("\n  buildGithubUrls(", concatStart);
    if (concatEnd < 0) throw new Error(`amcl i15: 未找到 concatParts 的结束位置\n${code}`);
    const concat = code.slice(concatStart, concatEnd);
    for (const leftover of ["try/finally not restored", "hole", "xpanda_goto", "decompiler_"]) {
        if (concat.includes(leftover)) {
            throw new Error(`amcl i15 concatParts: 仍残留 ${JSON.stringify(leftover)}\n${concat}`);
        }
    }
    // 守卫物化成循环 test 之后必须变回无条件循环(退出只靠 if (v13.done) break)
    if ((concat.match(/\} finally \{/g) ?? []).length !== 2) {
        throw new Error(`amcl i15 concatParts: 应有内外两层 finally\n${concat}`);
    }
    for (const fragment of [
        "do {",
        "if (v13.done) {",
        "} while (true);",
        // close(inp) 在内层 finally 里(此前是循环体里的一条普通语句,异常时被跳过)
        "g50.closeSync(v27);",
        // close(out) 在外层 finally 里
        "g50.closeSync(v2);",
    ]) {
        if (!concat.includes(fragment)) {
            throw new Error(`amcl i15 concatParts: 缺少 ${JSON.stringify(fragment)}\n${concat}`);
        }
    }
    const expected = fs.readFileSync(path.join(__dirname, "expected", "amcl-launch-i15.js"), "utf-8");
    if (code !== expected) {
        throw new Error(`amcl i15: 输出与快照不一致\n${firstDifference(expected, code)}`);
    }
}

/**
 * 回归:嵌套 try/finally 的 finally 还原(amcl)。
 *
 * 内层 finally 的 guard else 会一直延伸到外层 finally 的清理(q17 `c1599` 写临时
 * 文件后 rename、再 fsync 目录;i11 `n1195` 同形)。以前整段 else 因为含 `hole`
 * 被丢掉,外层 finally 的清理/守卫随之消失,只剩 `/* xpanda ... *\/` 注释。
 * 现在按本 plan 的 end 标记切出真正的续接;没有 end 标记时,只有尾段里带着外层
 * plan 标记(invariant:外层 startPC 更小)才保留。
 */
function verifyAmclNestedFinallyRestoration(clazz: PandaClass, code: string, ctx: BinaryContext): void {
    const decompile = (name: string): string => {
        const helperCode = ctx.decompileNamed(name);
        NodeFactory.parse(helperCode);
        if (helperCode.includes("try/finally not restored")) {
            throw new Error(`${name}: 仍有未还原的 finally\n${helperCode}`);
        }
        return helperCode;
    };

    const q17 = decompile("L&mods/src/main/ets/q17&1.0.0;");
    const c1599Start = q17.indexOf("export function c1599(");
    if (c1599Start < 0) throw new Error(`amcl q17: 未找到 c1599\n${q17.slice(0, 800)}`);
    const c1599 = q17.slice(c1599Start, q17.indexOf("\nexport function", c1599Start));
    if ((c1599.match(/\} finally \{/g) ?? []).length !== 2) {
        throw new Error(`amcl q17 c1599: 外层/内层 finally 缺失\n${c1599}`);
    }
    for (const fragment of [
        "g50.renameSync(p0 + \".writing\", p0);",
        "if (v4 !== undefined) {",
        "g50.closeSync(v4);",
        "g50.closeSync(v0);",
    ]) {
        if (!c1599.includes(fragment)) throw new Error(`amcl q17 c1599: 缺少 ${JSON.stringify(fragment)}\n${c1599}`);
    }

    // 整类输出锁定在 expected/amcl-e11-i11.js(最小的嵌套 finally 样本)
    const i11 = code;
    NodeFactory.parse(i11);
    if (i11.includes("try/finally not restored")) {
        throw new Error("amcl i11: 仍有未还原的 finally\n" + i11);
    }
    const i11Expected = fs.readFileSync(path.join(__dirname, "expected", "amcl-e11-i11.js"), "utf-8");
    if (i11 !== i11Expected) {
        throw new Error(`amcl i11: 输出与快照不一致\n${firstDifference(i11Expected, i11)}`);
    }
    const n1195Start = i11.indexOf("export function n1195(");
    if (n1195Start < 0) throw new Error(`amcl i11: 未找到 n1195\n${i11.slice(0, 800)}`);
    if (!i11.includes("for (v8 of g50.listFileSync(p0 + \"/mc-install-work\")) {")
        || i11.includes("[Symbol.iterator]()")) {
        throw new Error(`amcl i11: u996 的迭代器循环没有还原成 for-of\n${i11}`);
    }
    const n1195 = i11.slice(n1195Start, i11.indexOf("\nexport function", n1195Start));
    if ((n1195.match(/\} finally \{/g) ?? []).length !== 2
        || !n1195.includes("g50.renameSync(p0 + \".writing\", p0);")) {
        throw new Error(`amcl i11 n1195: 文件写入/目录 fsync 的 finally 未还原\n${n1195}`);
    }

    const k11 = decompile("L&feature_core/src/main/ets/e11/k11&1.0.0;");
    const b1223Start = k11.indexOf("export async function b1223(");
    if (b1223Start < 0) throw new Error(`amcl k11: 未找到 b1223\n${k11.slice(0, 800)}`);
    const b1223 = k11.slice(b1223Start, k11.indexOf("\nexport function", b1223Start));
    if ((b1223.match(/\} finally \{/g) ?? []).length < 2 || !b1223.includes("g50.renameSync(v5, v4);")) {
        throw new Error(`amcl k11 b1223: 嵌套 finally 未还原\n${b1223}`);
    }

    const u1 = decompile("L&commons/src/main/ets/h1/u1&1.0.0;");
    const c52Start = u1.indexOf("export async function c52(");
    if (c52Start < 0) throw new Error(`amcl u1: 未找到 c52\n${u1.slice(0, 800)}`);
    const c52 = u1.slice(c52Start, u1.indexOf("\nexport function", c52Start));
    for (const fragment of ["await g50.close(v0);", "local_0_7(v3);"]) {
        if (!c52.includes(fragment)) throw new Error(`amcl u1 c52: 缺少 ${JSON.stringify(fragment)}\n${c52}`);
    }

    decompile("L&commons/src/main/ets/h1/p1&1.0.0;");
    decompile("L&entry/src/main/ets/r5/s5&;");
}

/**
 * 回归:字节码 24.0.0.0 的 try/catch/finally 结构还原(hx360e1.0.2.abc 的 LogExport)。
 *
 * 该版本把真正的 catch / finally handler 的 codeSize 全写成 0,旧逻辑会把
 * handler 整段跳过:catch 体在正常控制流里不可达而被剪掉,输出只剩没有异常
 * 处理的直线代码(LogExport.readLogTail 的 hilog.error 分支、exportLogs 的
 * 失败返回都消失了)。现在按 handler 结构注册真正的 catch;finally 的异常清理
 * 路径先输出成 eager catch,再由 foldEagerCatchToFinally 折回 try/finally。
 * 整类输出锁定在 expected/hx360e-log-export.js。
 */
function verifyHx360eExceptionStructure(clazz: PandaClass, code: string): void {
    NodeFactory.parse(code);
    if (code.includes("created by SimpleAnalysis") || code.includes("decompiler_")) {
        throw new Error(`LogExport: 反编译降级或残留伪语句\n${code}`);
    }
    if (/\bhole\b/.test(code)) {
        throw new Error(`LogExport: 仍残留 hole 哨兵\n${code}`);
    }

    const readStart = code.indexOf("static readLogTail(");
    const readEnd = code.indexOf("static buildText(", readStart);
    if (readStart < 0 || readEnd < 0) throw new Error(`LogExport: 未找到 readLogTail\n${code}`);
    const readBody = code.slice(readStart, readEnd);
    for (const fragment of [
        "} catch (catchAcc) {",
        'hilog.error(local_0_0, local_0_1, "readLogTail failed: %{public}s", JSON.stringify(catchAcc));',
        'return "(read failed: " + p0 + ")\\n";',
        "} finally {",
        "fs.closeSync(v1);",
    ]) {
        if (!readBody.includes(fragment)) {
            throw new Error(`LogExport.readLogTail: 缺少 ${JSON.stringify(fragment)}\n${readBody}`);
        }
    }

    const exportStart = code.indexOf("static async exportLogs(");
    const exportBody = code.slice(exportStart);
    for (const fragment of [
        "} catch (catchAcc) {",
        'hilog.error(local_0_0, local_0_1, "exportLogs failed: %{public}s", JSON.stringify(catchAcc));',
        'return "导出失败（见 hilog）";',
        "} finally {",
        "fs.closeSync(v8);",
        'hilog.info(local_0_0, local_0_1, "exportLogs: %{public}s", v0[0]);',
        'return "已导出 " + v5.length + " 字符 → " + v0[0] + "";',
    ]) {
        if (!exportBody.includes(fragment)) {
            throw new Error(`LogExport.exportLogs: 缺少 ${JSON.stringify(fragment)}\n${exportBody}`);
        }
    }

    const expected = fs.readFileSync(
        path.join(__dirname, "expected", "hx360e-log-export.js"), "utf-8");
    if (code !== expected) {
        throw new Error(`LogExport: 输出与快照不一致\n${firstDifference(expected, code)}`);
    }
}

/**
 * 回归:字节码 24.0.0.0 的类静态字段初始化还原(hx360e1.0.2.abc 的 AppLog)。
 *
 * defineclasswithbuffer 之后,编译器把源码的静态字段初始化收集成
 * #static_initializer 方法,用 callthis0 以类为 this 调用;旧实现把它输出成
 * `(function () { this.dir = ""; ... }).call(acc);`,插在类定义与模块名赋值
 * 之间——不是别名赋值,模块级类定义折叠的别名链扫描在这里放弃,整类停在
 * 匿名类 + lexenv 自引用槽(local_1_0)的搬运形态。
 * 现在先由 foldClassStaticInitializers 折成类的 static 字段,模块级类定义折叠
 * 接着把 `acc = class R{...}; local_1_0 = acc; ... AppLog = acc` 还原成
 * `class AppLog {}`,类方法里的 local_1_0 读取同步改名为 AppLog。
 * 整类输出锁定在 expected/hx360e-app-log.js。
 */
function verifyHx360eAppLogClass(clazz: PandaClass, code: string): void {
    NodeFactory.parse(code);
    if (code.includes("created by SimpleAnalysis") || code.includes("decompiler_")) {
        throw new Error(`AppLog: 反编译降级或残留伪语句\n${code}`);
    }
    for (const fragment of [
        "class AppLog {",
        '  static dir = "";',
        '  static file = "";',
        '  static prevFile = "";',
        "  static started = false;",
        "  static init(p0) {",
        "    AppLog.started = true;",
    ]) {
        if (!code.includes(fragment)) {
            throw new Error(`AppLog: 缺少 ${JSON.stringify(fragment)}\n${code}`);
        }
    }
    for (const residue of ["local_1_0", ".call(acc)", "panda_jmp0_reserved_anonymous"]) {
        if (code.includes(residue)) {
            throw new Error(`AppLog: 类定义未还原(残留 ${JSON.stringify(residue)})\n${code}`);
        }
    }
    const expected = fs.readFileSync(
        path.join(__dirname, "expected", "hx360e-app-log.js"), "utf-8");
    if (code !== expected) {
        throw new Error(`AppLog: 输出与快照不一致\n${firstDifference(expected, code)}`);
    }
}

/**
 * 回归:registerNamedRoute 页面类的模块级还原(hx360e1.0.2.abc 的 GamePage)。
 *
 * 页面类没有模块名赋值(stmodulevar/export 都没有),类槽被两跳搬运后只被
 * registerNamedRoute 的回调读取:
 *   { let local_1_0; acc = class <anon> extends ViewPU{...}; local_1_0 = acc; }
 *   local_0_2 = acc;
 *   registerNamedRoute(function () { return new local_0_2(undefined, {}); }, ...);
 * 旧实现里链扫描遇到非赋值语句就放弃,整类停在匿名类 + lexenv 搬运形态。
 * 现在:
 *   1. defineClassWithBuffer 用类记录名(`#~@0=#GamePage`)命名类表达式;
 *   2. 链扫描把只读语句收集为「保留语句」继续向后找模块名赋值;
 *   3. 没有模块名赋值时退回类表达式自带的名字(树内无其它引用才成立);
 *   4. 类声明插到最外层块元素之前,保留语句里的槽读取改名为类绑定。
 * 还原成 `class GamePage extends ViewPU {...}` + `new GamePage(...)`;
 * 类方法里的 self-ref 槽读取(local_1_0.readMemMb)同步改名为 GamePage。
 * 整类输出锁定在 expected/hx360e-game-page.js。
 */
function verifyHx360eGamePageClass(clazz: PandaClass, code: string): void {
    NodeFactory.parse(code);
    if (code.includes("created by SimpleAnalysis") || code.includes("decompiler_")) {
        throw new Error(`GamePage: 反编译降级或残留伪语句\n${code}`);
    }
    for (const fragment of [
        "class GamePage extends ViewPU {",
        "  static readMemMb() {",
        "v1 = GamePage.readMemMb();",
        "registerNamedRoute(function () {",
        "  return new GamePage(undefined, {});",
    ]) {
        if (!code.includes(fragment)) {
            throw new Error(`GamePage: 缺少 ${JSON.stringify(fragment)}\n${code}`);
        }
    }
    for (const residue of ["local_1_0", "local_0_2 = acc", ".call(acc)", "panda_jmp0_reserved_anonymous"]) {
        if (code.includes(residue)) {
            throw new Error(`GamePage: 类定义未还原(残留 ${JSON.stringify(residue)})\n${code}`);
        }
    }
    const expected = fs.readFileSync(
        path.join(__dirname, "expected", "hx360e-game-page.js"), "utf-8");
    if (code !== expected) {
        throw new Error(`GamePage: 输出与快照不一致\n${firstDifference(expected, code)}`);
    }
}

/**
 * 回归:字节码 24.0.0.0 的 SOURCE_FILE 类标签 + 登录参数校验的短路链还原。
 *
 * 1. lnga1.2.6.abc 的类带 `PandaClassTag.SOURCE_FILE`(tag 0x07),载荷是 4 字节
 *    字符串偏移;旧实现直接抛 PandaParseException,整个文件无法解析。
 * 2. `validateQrParams` 的 `hasLib && hasAct && hasKey && ...` 被降级成
 *    `if (!hasLib) { result = hasLib }` 领头的 if 链,链头折叠后必须还原成
 *    单个 return 逻辑链。
 */
function verifyLngaQrLoginUtils(clazz: PandaClass, code: string): void {
    if (!clazz.sourceFile || !clazz.sourceFile.content.endsWith("common/utils/NgaQrLoginUtils.ts")) {
        throw new Error(`lnga: SOURCE_FILE 标签未解析 (${clazz.sourceFile?.content ?? "null"})`);
    }
    NodeFactory.parse(code);
    const expected = 'return v4 && v6 && v5 && v7 === "login" && v3 === "qrlogin_ui" && v8.length > 0;';
    if (!code.includes(expected)) {
        throw new Error(`lnga: 登录参数校验的短路链未还原(缺 ${expected})\n${code}`);
    }
    if (code.includes("if (!v4) {") || code.includes("v6 = v4;")) {
        throw new Error(`lnga: 取反 test 自赋值链头残留\n${code}`);
    }
    // 参数名分派是源码 switch:最后一个 case 被降级成 `if (v11 !== "qrkey")`
    // 守卫,必须和前面两个 `===` 分支一起还原成 switch + default。
    for (const expected of ['switch (v11)', 'case "__lib":', 'case "__act":', 'case "qrkey":', "default:"]) {
        if (!code.includes(expected)) {
            throw new Error(`lnga: 参数名分派未还原成 switch(缺 ${expected})\n${code}`);
        }
    }
    if (code.includes('if (v11 !== "qrkey")')) {
        throw new Error(`lnga: 尾 case 守卫条件残留\n${code}`);
    }
    const expectedPath = path.join(__dirname, "expected", "lnga-nga-qr-login-utils.js");
    const snapshot = fs.readFileSync(expectedPath, "utf-8");
    if (code !== snapshot) {
        throw new Error(`lnga: 输出与快照不一致\n${firstDifference(snapshot, code)}`);
    }
}

/**
 * 回归:用户 catch 与 finally 共用同一个 try 起点时的还原(lnga1.2.6.abc 的
 * SettingsPanel.clearCache)。
 *
 * 编译器把 finally 的异常路径写成 codeSize === 0 的 handler,try 结束块只恢复
 * 寄存器、hole 哨兵写在"try 正常完成 + 用户 catch 完成"共用的汇合块里;
 * 用户 catch 入口还先带一串寄存器恢复 `mov`(源码的 catch 不引用异常)。
 * 旧实现因此把用户 catch 整段丢掉(finally 落点被当成 catch),finally 也生成
 * 不出计划,只剩 `v10 = hole` + `if (hole == v10) return; throw v10` 残渣。
 *
 * 现在必须是源码结构:`try { … '缓存已清除' … } catch (e) { '清除缓存失败' }
 * finally { … area 复位 … clearingCache = false }`,且不再有 hole 哨兵。
 */
function verifyLngaSettingsPanelException(clazz: PandaClass, code: string): void {
    if (!clazz.name.content.endsWith("/pages/SettingsPanel;")) {
        throw new Error(`lnga SettingsPanel: 类名不符 (${clazz.name.content})`);
    }
    NodeFactory.parse(code);
    if (/\bhole\b/.test(code)) {
        throw new Error(`lnga SettingsPanel: 仍残留 hole 哨兵\n${code}`);
    }
    if (code.includes("try/finally not restored")) {
        throw new Error(`lnga SettingsPanel: try/finally 未还原\n${code}`);
    }
    const start = code.indexOf("async clearCache() {");
    if (start < 0) throw new Error(`lnga SettingsPanel: 未找到 clearCache\n${code}`);
    const body = code.slice(start, code.indexOf("\n  }\n", start));
    if (!body.includes('appStore.showToast("缓存已清除")')) {
        throw new Error(`lnga clearCache: 正常路径丢失\n${body}`);
    }
    // 用户 catch 体(此前整段消失)必须紧跟 try 体,finally 在同一层
    if (!/try \{[\s\S]*?\} catch \(catchAcc\) \{[\s\S]*?appStore\.showToast\("清除缓存失败"\);/.test(body)) {
        throw new Error(`lnga clearCache: 用户 catch 体未还原\n${body}`);
    }
    if (!/\} finally \{[\s\S]*?this\.clearingCache = false;[\s\S]*?\}$/.test(body)) {
        throw new Error(`lnga clearCache: finally 未还原\n${body}`);
    }
    if (body.includes("switch (") || body.includes("case null:")) {
        throw new Error(`lnga clearCache: 仍残留 nullish switch\n${body}`);
    }
    const expectedPath = path.join(__dirname, "expected", "lnga-settings-panel.js");
    const snapshot = fs.readFileSync(expectedPath, "utf-8");
    if (code !== snapshot) {
        throw new Error(`lnga SettingsPanel: 输出与快照不一致\n${firstDifference(snapshot, code)}`);
    }
}

/**
 * 回归:类构造器记录名不带 '#' 前缀的工具链(install1.3.0.abc)的类命名与
 * 「类声明 + prototype 装载」残留还原(WebChromeClientHostApiImpl)。
 *
 * 1. 这批产物的 defineclasswithbuffer 记录名是纯标识符(newWindowWebViewClient /
 *    NewWebView / WebChromeClientImpl),旧命名逻辑只在 '#' 之后取源码类名,
 *    无 '#' 时一律退回 panda_jmp0_reserved_class_N。
 * 2. 源码里声明后未使用的 `class newWindowWebViewClient {}` 编译成
 *    `defineclasswithbuffer; ldobjbyname prototype` 尾巴(没有 store),定点迭代
 *    后只剩 `(class {...}).prototype;` 裸语句;foldPrototypeResidueClasses 把它
 *    原位还原成类声明。落 lexenv 槽的 NewWebView 则由 foldModuleClassDeclarations
 *    折叠并把闭包里的槽读取改名为类绑定。
 * 整类输出锁定在 expected/install-web-chrome-client-host-api-impl.js。
 */
function verifyInstallWebChromeClientClass(clazz: PandaClass, code: string): void {
    NodeFactory.parse(code);
    if (code.includes("created by SimpleAnalysis") || code.includes("decompiler_")) {
        throw new Error(`WebChromeClientHostApiImpl: 反编译降级或残留伪语句\n${code}`);
    }
    for (const fragment of [
        "class newWindowWebViewClient {",
        "class NewWebView extends ViewPU {",
        "new NewWebView(local_1_1, {",
        "export class WebChromeClientHostApiImpl extends WebChromeClientHostApi {",
    ]) {
        if (!code.includes(fragment)) {
            throw new Error(`WebChromeClientHostApiImpl: 缺少 ${JSON.stringify(fragment)}\n${code}`);
        }
    }
    for (const residue of ["panda_jmp0_reserved_class_", ").prototype;", "local_0_1"]) {
        if (code.includes(residue)) {
            throw new Error(`WebChromeClientHostApiImpl: 类定义未还原(残留 ${JSON.stringify(residue)})\n${code}`);
        }
    }
    const expected = fs.readFileSync(
        path.join(__dirname, "expected", "install-web-chrome-client-host-api-impl.js"), "utf-8");
    if (code !== expected) {
        throw new Error(`WebChromeClientHostApiImpl: 输出与快照不一致\n${firstDifference(expected, code)}`);
    }
}

/**
 * 回归:if 条件尾部多条赋值序列还原成嵌套 if。
 * `if (A && B && (x = 1, y = 2, C))` 中序列只在 A/B 为真时求值,可安全搬进分支体;
 * 有 else 时外层条件为假也必须执行 else,因此不能用同一变换(否则 else 丢失)。
 */
function verifySequencedTestPrefixFold(): void {
    const program = NodeFactory.parse(`
function f(A, B, sec) {
  if (A && B && (x = 1, y = 2, sec !== -1)) { clear(); }
  if (A && B && (x = 1, y = 2, sec !== -1)) { clear(); } else { other(); }
}
`);
    SyntaxRewriteSimplify.foldSequencedTestPrefixes(program);
    const code = NodeFactory.generate(program);
    NodeFactory.parse(code);
    if (code.split("if (A && B) {").length - 1 !== 1) {
        throw new Error(`条件序列前缀未拆成嵌套 if\n${code}`);
    }
    if (!code.includes("x = 1;\n    y = 2;\n    if (sec !== -1) {")) {
        throw new Error(`条件序列前缀没有按顺序进入分支体\n${code}`);
    }
    if (!code.includes("if (A && B && (x = 1, y = 2, sec !== -1)) {")
        || !code.includes("} else {\n    other();\n  }")) {
        throw new Error(`带 else 的条件未被保留\n${code}`);
    }
}

/**
 * 回归:纯 rethrow 的 catch(`try { B } catch (e) { throw e }`)只是噪音 ——
 * 同一个异常原样抛出,控制流不变。编译器用它做 finally 的异常跳板、构造器的
 * super 检查、模块初始化的词法环境清理;整块拆掉后输出少一层缩进。
 * 带实际工作的 catch 必须保留;try 体顶层有块级声明时只能去掉 try 外壳、
 * 保留 body 的块,否则 `let` 会泄漏到外层/与同名外层声明冲突。
 */
function verifyRedundantRethrowCatchRemoval(): void {
    const nested = NodeFactory.parse(`
function f(p0) {
  let v0;
  v0 = 0;
  while (v0 < p0) {
    try {
      try {
        v0 += 1;
        if (v0 > 3) continue;
      } catch (e) {
        throw e;
      }
    } catch (e2) {
      throw e2;
    }
  }
  try {
    p0(v0);
  } catch (acc) {
    throw acc;
  }
  try {
    p0(v0, 2);
  } catch (e) {
    p0(e);
  }
  return v0;
}
`);
    SimplifyExport.simplify(nested);
    const code = NodeFactory.generate(nested);
    NodeFactory.parse(code);
    if (code.split("catch (").length - 1 !== 1) {
        throw new Error(`纯 rethrow catch 未拆干净(应只剩真实 catch)\n${code}`);
    }
    if (!code.includes("while (v0 < p0)") || !code.includes("v0 += 1;") || !code.includes("continue;")) {
        throw new Error(`拆 catch 破坏了循环结构\n${code}`);
    }
    if (!/catch \(\w+\) \{\n\s+p0\(/.test(code)) {
        throw new Error(`真实 catch 被误删\n${code}`);
    }

    const scoped = NodeFactory.parse(`
function g(p0) {
  let v1;
  try {
    let v1;
    v1 = p0;
    p0(v1);
  } catch (e) {
    throw e;
  }
  return v1;
}
`);
    SimplifyExport.simplify(scoped);
    const scopedCode = NodeFactory.generate(scoped);
    NodeFactory.parse(scopedCode);
    if (scopedCode.includes("catch")) {
        throw new Error(`块级声明场景的纯 rethrow catch 未拆掉\n${scopedCode}`);
    }
    if (!scopedCode.includes("p0(v1)")) {
        throw new Error(`块级声明场景的 try 体语句丢失\n${scopedCode}`);
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
 * 回归:nullish coalescing 的 lowering 还原。
 *   v8 = item.content.contentId;
 *   switch (item.content.contentId) { case null: case undefined: v8 = ""; }
 * 应还原成 `item.content.contentId ?? ""`;判别式是纯成员表达式，只求值一次。
 * 另外两种不带 switch 的形态(`X = E; if (X == null) X = D; return X` 与
 * `X == null ? D : X`)也要还原成 `X = E ?? D` / `X ?? D`,见各段断言。
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

    // 判别式留在临时量上的形态(右值是不可复制的可选链,复制传播不会把它换进
    // test,switch 合成也因此不成立):`acc = v8?.runs; if (acc == null) acc = [];
    // return acc;` → `return v8?.runs ?? [];`。
    const expected = "return v8?.runs ?? [];";
    const guards = [
        `if (acc == null) { acc = []; }`,
        `if (acc === null || acc === undefined) { acc = []; }`,
        `if (acc != null) {} else { acc = []; }`,
        `if (acc == null) { acc = []; } else { acc = acc; }`,
    ];
    for (const guard of guards) {
        const program = NodeFactory.parse(`
function h(v8) {
  let acc;
  acc = v8?.runs;
  ${guard}
  return acc;
}
`);
        SimplifyExport.simplify(program);
        const code = NodeFactory.generate(program);
        if (!code.includes(expected)) {
            throw new Error(`simplify: if 形态 nullish 未还原成 ??(${guard})\n${code}`);
        }
    }

    // 三目形态:`X == null ? D : X` → `X ?? D`。
    const ternary = NodeFactory.parse(`
function k(v0) {
  return v0 == null ? "" : v0;
}
`);
    SimplifyExport.simplify(ternary);
    const ternaryCode = NodeFactory.generate(ternary);
    if (!ternaryCode.includes('return v0 ?? "";')) {
        throw new Error(`simplify: 三目 nullish 未还原成 ??\n${ternaryCode}`);
    }

    // 右值读取被赋值的变量:在 `X = E ?? D` 里 D 求值时 X 还没有被赋值,
    // 读到的不是 E 的值,不能合并(直接对 pass 断言,避免被后续复制传播改写)。
    const readsTarget = NodeFactory.parse(`
function m(v8) {
  let acc;
  acc = v8?.runs;
  if (acc == null) {
    acc = acc.foo;
  }
  return acc;
}
`);
    new NullishCoalescingSimplify().simplify(readsTarget);
    const readsTargetCode = NodeFactory.generate(readsTarget);
    if (readsTargetCode.includes("??")) {
        throw new Error(`simplify: 右值读取被赋值变量的 nullish 合并不应执行\n${readsTargetCode}`);
    }

    // 分支里还有其它语句时不能合并(否则会丢掉 sideEffect())。
    const multiStatement = NodeFactory.parse(`
function m(v8) {
  let acc;
  acc = v8?.runs;
  if (acc == null) {
    sideEffect();
    acc = [];
  }
  return acc;
}
`);
    SimplifyExport.simplify(multiStatement);
    const multiStatementCode = NodeFactory.generate(multiStatement);
    if (multiStatementCode.includes("??")) {
        throw new Error(`simplify: 多语句分支的 nullish 合并不应执行\n${multiStatementCode}`);
    }
}

/**
 * 回归:同一语句列表里连续的 `if (disc === v) { return ...; }` 守卫链。
 * ArkTS 把源码 switch 折成逐条没有 else 的守卫,`flattenElseAfterExit` 展开
 * else 块之后才形成这种形态,由 simplifyTail 还原成 switch;链尾的 return 是
 * 源码 switch 的 default。只有 case 标签达到 3 个才转换(2 个标签的短链保持
 * if 形式),非终止分支与 `==` 比较不转换。
 */
function verifyIfReturnChainSwitch(): void {
    const program = NodeFactory.parse(`
function f(p0) {
  if (p0.name === A || p0.name === B) {
    return "ab";
  }
  if (p0.name === C) {
    return "c";
  }
  return p0.name;
}
`);
    SimplifyExport.simplify(program);
    const code = NodeFactory.generate(program);
    NodeFactory.parse(code);
    if (!code.includes("switch (p0.name) {")
        || !code.includes("case A:\n    case B:\n      return \"ab\";")
        || !code.includes('case C:\n      return "c";')
        || !code.includes("default:\n      return p0.name;")) {
        throw new Error(`simplify: 守卫链未还原成 switch\n${code}`);
    }
    if (code.includes("if (p0.name ===")) {
        throw new Error(`simplify: 守卫链仍残留 if\n${code}`);
    }

    // 只有两个 case 标签的短链保持 if(避免把两条守卫折成 switch)
    const twoLabels = NodeFactory.parse(`
function f(p0) {
  if (p0.name === A) {
    return 1;
  }
  if (p0.name === B) {
    return 2;
  }
  return 3;
}
`);
    SimplifyExport.simplify(twoLabels);
    const twoLabelsCode = NodeFactory.generate(twoLabels);
    if (twoLabelsCode.includes("switch (")) {
        throw new Error(`simplify: 两个 case 标签的短链被折进 switch\n${twoLabelsCode}`);
    }

    // 三条各一个值的守卫链达到 3 个标签,应转换
    const threeLabels = NodeFactory.parse(`
function f(p0) {
  if (p0.name === A) {
    return 1;
  }
  if (p0.name === B) {
    return 2;
  }
  if (p0.name === C) {
    return 3;
  }
  return 4;
}
`);
    SimplifyExport.simplify(threeLabels);
    const threeLabelsCode = NodeFactory.generate(threeLabels);
    if (!threeLabelsCode.includes("switch (p0.name) {")
        || !threeLabelsCode.includes("default:\n      return 4;")) {
        throw new Error(`simplify: 三个 case 标签的守卫链未折进 switch\n${threeLabelsCode}`);
    }

    // 分支体不终止时不能进 switch(匹配后还要继续检查后面的 if)
    const nonTerminating = NodeFactory.parse(`
function g(p0) {
  if (p0.x === A) {
    consume();
  }
  if (p0.x === B) {
    return 2;
  }
  return 3;
}
`);
    SimplifyExport.simplify(nonTerminating);
    const nonTerminatingCode = NodeFactory.generate(nonTerminating);
    if (nonTerminatingCode.includes("switch (")) {
        throw new Error(`simplify: 非终止分支被折进 switch\n${nonTerminatingCode}`);
    }

    // switch 的 case 用 === 比较,`==` 条件不能转换
    const looseEquality = NodeFactory.parse(`
function h(p0) {
  if (p0.x == A) {
    return 1;
  }
  if (p0.x == B) {
    return 2;
  }
  if (p0.x == C) {
    return 3;
  }
  return 4;
}
`);
    SimplifyExport.simplify(looseEquality);
    const looseEqualityCode = NodeFactory.generate(looseEquality);
    if (looseEqualityCode.includes("switch (")) {
        throw new Error(`simplify: == 条件被折进 switch\n${looseEqualityCode}`);
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
 * 回归:determineFollowLatch 兜底产生的 `label_x: ;` + `xpanda_goto(label_x)`
 * 在循环体会自然落空时也必须还原。
 *
 * 原逻辑要求 label 之后到语句列表结尾一定以 return/throw/break/continue/goto
 * 离开(`terminatesInLoop`),否则包成 while (true) 会变成死循环。但"自然落空"
 * 的原语义就是继续执行循环体后面的语句,循环体末尾补一条 break 即可等价:
 *
 *   label: A; if (c) goto label; B
 *     =>  while (true) { A; if (c) continue; break; } B
 *
 * amcl1.0.6.abc 的 r2/l3 `#loadLive`(events 裁剪循环)与 pages/McGamePage
 * 里的 4 条 goto 都是这个形态,不还原就残留不可执行的 `xpanda_goto(...)`。
 */
function verifyGotoLoopFallthrough(): void {
    const program = NodeFactory.parse(`
function trim(p0, p1, p2) {
  label_1: ;
  if (p0.events.length > p1) {
    p2 = p0.events.shift();
    p0.characters -= p2.lines.length;
    xpanda_goto(label_1);
  }
  if (p0.events.length > 1 && p0.characters > p2) {
    p0.events.shift();
    xpanda_goto(label_1);
  }
  consume(p0);
}
`);
    restoreGotoLoops(program);
    const code = NodeFactory.generate(program);
    NodeFactory.parse(code);
    if (code.includes("xpanda_goto") || code.includes("label_1")) {
        throw new Error(`goto 循环未还原\n${code}`);
    }
    if (!code.includes("while (true) {")) {
        throw new Error(`goto 循环没有包成 while (true)\n${code}`);
    }
    if (!/consume\(p0\);\n\s+break;/.test(code)) {
        throw new Error(`自然落空的循环体末尾没有补 break\n${code}`);
    }
    if ((code.match(/continue;/g) ?? []).length !== 2) {
        throw new Error(`goto 没有替换成 continue\n${code}`);
    }

    // 循环体一定以 return 离开时不需要补 break
    const terminating = NodeFactory.parse(`
function firstNode(p0) {
  label_2: ;
  if (p0.next) {
    p0 = p0.next;
    xpanda_goto(label_2);
  }
  return p0;
}
`);
    restoreGotoLoops(terminating);
    const terminatingCode = NodeFactory.generate(terminating);
    NodeFactory.parse(terminatingCode);
    if (terminatingCode.includes("xpanda_goto") || terminatingCode.includes("label_2")) {
        throw new Error(`goto 循环未还原(终止型)\n${terminatingCode}`);
    }
    if (!terminatingCode.includes("continue;") || !terminatingCode.includes("return p0;")) {
        throw new Error(`终止型循环体结构不对\n${terminatingCode}`);
    }
    if (terminatingCode.includes("break;")) {
        throw new Error(`终止型循环体不应补 break\n${terminatingCode}`);
    }

    // label 已经挂在循环头上(`label: while (true)`),goto 埋在 if 分支里:
    // 回边就是 continue,label 无其它引用时一起删掉
    const labelled = NodeFactory.parse(`
function scan(p0) {
  label_3: while (true) {
    if (p0.i < 0) {
      return p0.out;
    }
    if (p0.seen.has(p0.key)) {
      p0.i -= 1;
      xpanda_goto(label_3);
    }
    p0.out.push(p0.item);
    p0.i -= 1;
  }
}
`);
    restoreGotoLoops(labelled);
    const labelledCode = NodeFactory.generate(labelled);
    NodeFactory.parse(labelledCode);
    if (labelledCode.includes("xpanda_goto") || labelledCode.includes("label_3")) {
        throw new Error(`已带 label 的循环未还原\n${labelledCode}`);
    }
    if (!/while \(true\) \{/.test(labelledCode) || !/p0\.i -= 1;\n\s+continue;/.test(labelledCode)) {
        throw new Error(`已带 label 的循环没有换成 continue\n${labelledCode}`);
    }

    // goto 在嵌套循环里:裸 continue 会绑到内层循环,必须用带标签的 continue 并保留 label
    const nested = NodeFactory.parse(`
function drain(p0) {
  label_4: while (true) {
    for (const item of p0.items) {
      if (item.done) {
        xpanda_goto(label_4);
      }
    }
    break;
  }
}
`);
    restoreGotoLoops(nested);
    const nestedCode = NodeFactory.generate(nested);
    NodeFactory.parse(nestedCode);
    if (nestedCode.includes("xpanda_goto")) {
        throw new Error(`嵌套循环里的 goto 未还原\n${nestedCode}`);
    }
    if (!nestedCode.includes("continue label_4;") || !nestedCode.includes("label_4: while (true)")) {
        throw new Error(`嵌套循环里的 goto 应换成带标签 continue\n${nestedCode}`);
    }

    // 行为等价:goto 程序的语义用等价的带标签 while 表达,比较执行结果
    const behaviorProgram = NodeFactory.parse(`
function trimBehavior(p0) {
  let i = 0;
  let out = [];
  label_3: ;
  if (i < p0.limit) {
    out.push("a" + i);
    i += 1;
    xpanda_goto(label_3);
  }
  if (i < p0.limit + 2 && i > 0) {
    out.push("b" + i);
    i += 1;
    xpanda_goto(label_3);
  }
  out.push("end" + i);
  return out;
}
`);
    restoreGotoLoops(behaviorProgram);
    const behaviorCode = NodeFactory.generate(behaviorProgram);
    const referenceCode = `
function trimBehaviorRef(p0) {
  let i = 0;
  let out = [];
  while (true) {
    if (i < p0.limit) { out.push("a" + i); i += 1; continue; }
    if (i < p0.limit + 2 && i > 0) { out.push("b" + i); i += 1; continue; }
    break;
  }
  out.push("end" + i);
  return out;
}
`;
    const runWithLimit = (source: string, fn: string, limit: number): unknown => {
        const sandbox: Record<string, unknown> = {};
        sandbox.globalThis = sandbox;
        vm.runInNewContext(`${source}\nresult = ${fn}({ limit: ${limit} });`, sandbox, { timeout: 5000 });
        return sandbox.result;
    };
    for (const limit of [0, 1, 5]) {
        const actual = JSON.stringify(runWithLimit(behaviorCode, "trimBehavior", limit));
        const expected = JSON.stringify(runWithLimit(referenceCode, "trimBehaviorRef", limit));
        if (actual !== expected) {
            throw new Error(`goto 循环还原后行为不一致 (limit=${limit}): ${actual} !== ${expected}\n${behaviorCode}`);
        }
    }

    // case 末尾的裸 break 只跳出 switch:循环体仍然落空,必须补 break,否则死循环
    const switchProgram = NodeFactory.parse(`
function pickSwitch(p0) {
  let n = 0;
  label_4: ;
  switch (p0.value) {
    case 1:
      p0.value = 2;
      xpanda_goto(label_4);
    default:
      break;
  }
  n = 7;
  return n;
}
`);
    restoreGotoLoops(switchProgram);
    const switchCode = NodeFactory.generate(switchProgram);
    NodeFactory.parse(switchCode);
    if (switchCode.includes("xpanda_goto") || switchCode.includes("label_4")) {
        throw new Error(`goto 循环未还原(switch 结尾)\n${switchCode}`);
    }
    const switchSandbox: Record<string, unknown> = { value: 1 };
    switchSandbox.globalThis = switchSandbox;
    switchSandbox.arg = switchSandbox;
    vm.runInNewContext(`${switchCode}\nresult = pickSwitch(arg);`, switchSandbox, { timeout: 5000 });
    if (switchSandbox.result !== 7) {
        throw new Error(`switch 结尾的循环体没有正确离开 (result=${String(switchSandbox.result)})\n${switchCode}`);
    }
}

/**
 * 回归:hub 别名折叠不能搬走 X 的唯一一次赋值,而把读取留在别的语句列表里。
 *
 * ArkTS 12(bytecode 12.0.2.0)定义模块级类时在 try 块里留下一个没人用的
 * `ldobjbyname "prototype"`:
 *   { acc = class ...; v1 = acc; local_1_0 = acc; acc = v1; acc = acc.prototype; }
 *   acc = v1; X = acc;
 * 定点迭代把那两个寄存器恢复删掉后,块里只剩 `acc = class ...; local_1_0 = acc`。
 * `X = E; Y = X` 的别名折叠把 E 搬进 local_1_0 并删掉 `acc = E` 时,`X = acc`
 * 在块外、改不到 target,于是 X 拿到了一个从未赋过值的 acc(整个模块的类变成
 * undefined)。同一条规则也不能过度保守:循环体末尾的活跃性来自回边,循环头
 * 一定会重写循环变量,`for (v of xs) { v = v + total; total = v }` 仍要折成
 * `total += v`。
 */
function verifyHubAliasKeepsSourceValue(): void {
    const program = NodeFactory.parse(`
function makeClass() {
  let acc, v1, holder;
  {
    let local_1_0;
    acc = class Defined { static self() { return local_1_0; } };
    v1 = acc;
    local_1_0 = acc;
    acc = acc["prototype"];
  }
  acc = v1;
  holder = acc;
  return holder;
}
function accumulate(xs) {
  let total = 0, acc, v1;
  for (v1 of xs) {
    acc = total + v1;
    total = acc;
  }
  return total;
}
`);
    SimplifyExport.simplify(program);
    const code = NodeFactory.generate(program);
    NodeFactory.parse(code);
    const sandbox: Record<string, unknown> = {};
    sandbox.globalThis = sandbox;
    vm.runInNewContext(`${code}\nresult = makeClass(); total = accumulate([1, 2, 3]);`, sandbox, { timeout: 5000 });
    if (typeof sandbox.result !== "function" || (sandbox.result as { name: string }).name !== "Defined") {
        throw new Error(`simplify: 块外读取的类表达式丢失(acc 唯一赋值被搬走)\n${code}`);
    }
    if (sandbox.total !== 6) {
        throw new Error(`simplify: 循环体别名折叠被过度保守地放弃 (total=${String(sandbox.total)})\n${code}`);
    }
    if (!code.includes("total += v1;")) {
        throw new Error(`simplify: 循环体 X = E; total = X 未折成累加赋值\n${code}`);
    }
}

/**
 * 回归:间接导出(`export {a as b} from "path"`)的序列化顺序是 export_name、local_name,
 * 与本地导出相反。旧实现按本地导出的顺序读,把 `export {resolveFeedTopics as
 * resolveHomeFeedTopics}` 输出成反过来的 `export {resolveHomeFeedTopics as
 * resolveFeedTopics}`,还会把间接导出的名字塞进模块级 `let` 声明
 * (flutter 的 barrel 里是 69 个 `default`,直接生成非法 JS `let default;`)。
 */
function verifyIndirectExportNameOrder(clazz: PandaClass, code: string): void {
    NodeFactory.parse(code);
    const expected = 'export { resolveFeedTopics as resolveHomeFeedTopics } from "@normalized:N&&&data/Index&1.0.0";';
    if (!code.includes(expected)) {
        throw new Error(`hap: 间接导出的 local/export 名字顺序错误\n${code.slice(code.lastIndexOf("export {"))}`);
    }
    for (const line of code.split("\n")) {
        if (!line.startsWith("let ")) continue;
        if (/\bdefault\b/.test(line)) {
            throw new Error(`hap: 间接导出的名字被当成模块级绑定声明\n${line}`);
        }
    }
}

/**
 * 回归:bytecode 12.0.2.0(ArkTS 12)用 `definefieldbyname imm, string_id, v` 定义
 * 类字段(静态字段的 static_initializer、ArkUI 组件的状态字段)。没有注册 kind 时
 * 整个类直接抛 `definefieldbyname not handled!`,旧版应用包没法反编译。
 */
function verifyDefineFieldByNameKind(): void {
    const kind = KIND_MAP.get("definefieldbyname");
    if (kind !== "storeObject") {
        throw new Error(`definefieldbyname 未映射为 storeObject(实际: ${String(kind)})`);
    }
    // 同一族的其它字段定义指令必须保持同样的处理方式(成员赋值)
    for (const name of ["definefieldname", "definepropertybyname"]) {
        if (KIND_MAP.get(name) !== "storeObject") {
            throw new Error(`${name} 未映射为 storeObject(实际: ${String(KIND_MAP.get(name))})`);
        }
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

/**
 * core 单入口必须保持浏览器安全:不能出现 CommonJS require(浏览器里没有 require 全局),
 * 也不能 import Node 内置模块。xpanda-web 以源码形式直接加载 core,一旦出现 require,
 * disAssemble() 在浏览器里会抛 ReferenceError,被 PandaLexical 吞掉后所有类都输出为空
 * (web 端表现为 "decompile failed: ... func_main_0 ..."),而 cli / tsx 环境自带 require
 * 反而不会暴露问题。
 */
function verifyCoreBrowserSafe(): void {
    const srcDir = path.join(__dirname, "..", "src");
    const nodeBuiltins = /from\s+["'](?:node:)?(fs|path|os|zlib|worker_threads|buffer|crypto|child_process|module|url)["']/;
    const visit = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                visit(full);
                continue;
            }
            if (!entry.name.endsWith(".ts")) continue;
            const source = fs.readFileSync(full, "utf-8");
            // 去掉注释后再检查,避免注释里提到 require() 造成误报
            const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
            const relative = path.relative(srcDir, full);
            if (/\brequire\s*\(/.test(code)) {
                throw new Error(`browser safety: ${relative} uses CommonJS require()`);
            }
            if (nodeBuiltins.test(code)) {
                throw new Error(`browser safety: ${relative} imports a Node built-in module`);
            }
        }
    };
    visit(srcDir);
}

/**
 * 按二进制登记的用例表。每个文件只跑一个 pass:遍历一次类表,
 * 命中 matcher 的用例在同一个循环里回调自己的 (clazz, code, ctx)。
 */
const zhihuClassTests: BinaryClassTest[] = [
    { label: "hap try/finally (zhihupp0.59.hap)", matches: (n) => n.includes("ContentFilterRuntimeStore"), run: verifyZhihuTryFinally },
    { label: "hap ContentDetailPages (zhihupp0.59.hap)", matches: (n) => n.includes("ContentDetailPages"), run: verifyZhihuContentDetailPages },
    { label: "hap AbsoluteUrlParser (zhihupp0.59.hap)", matches: (n) => n.includes("AbsoluteUrlParser"), run: verifyZhihuAbsoluteUrlParser },
    { label: "hap for...of iterator close (zhihupp0.59.hap)", matches: (n) => n.includes("repository/DefaultOnlineHistoryRepository"), run: verifyZhihuForOfIteratorClose },
    { label: "hap AppUpdateClient (zhihupp0.59.hap)", matches: (n) => n.includes("update/AppUpdateClient"), run: verifyZhihuAppUpdateClient },
    { label: "hap AppDestination (zhihupp0.59.hap)", matches: (n) => n.includes("navigation/AppDestination"), run: verifyZhihuAppDestination },
    { label: "hap StartupDestinationChannel (zhihupp0.59.hap)", matches: (n) => n.includes("StartupDestinationChannel"), run: verifyZhihuStartupDestinationChannel },
    { label: "hap DeepLinkResolver (zhihupp0.59.hap)", matches: (n) => n.includes("navigation/DeepLinkResolver"), run: verifyZhihuDeepLinkResolver },
    { label: "hap ShareContracts (zhihupp0.59.hap)", matches: (n) => n.includes("platform/ShareContracts"), run: verifyZhihuShareContracts },
    { label: "indirect export name order", matches: (n) => n.includes("HomeFeedMenuState"), run: verifyIndirectExportNameOrder },
];

const yourpipeClassTests: BinaryClassTest[] = [
    { label: "yourpipe SabrResponseDecoder (yourpipe0.7.0.abc)", matches: (n) => n.includes("extractor/sabr/SabrResponseDecoder"), run: verifyYourpipeSabrResponseDecoder },
    { label: "yourpipe MpvPlayerView (yourpipe0.7.0.abc)", matches: (n) => n.includes("components/MpvPlayerView"), run: verifyYourpipeMpvPlayerView },
    { label: "yourpipe anonymous default export (yourpipe0.7.0.abc)", matches: (n) => n.includes("mediaservice/src/main/ets/utils/Logger"), run: verifyYourpipeAnonymousDefaultExport },
    { label: "yourpipe SabrOfflineDownloader goto loop (yourpipe0.7.0.abc)", matches: (n) => n.includes("sabr/SabrOfflineDownloader"), run: verifyYourpipeSabrOfflineDownloader },
    { label: "yourpipe YoutubePageAttestationBootstrap switch case prune (yourpipe0.7.0.abc)", matches: (n) => n.includes("features/player/YoutubePageAttestationBootstrap"), run: verifyYourpipeYoutubePageAttestationBootstrap },
    { label: "yourpipe MusicSearchService (yourpipe0.7.0.abc)", matches: (n) => n.includes("features/home/MusicSearchService"), run: verifyYourpipeMusicSearchService },
    { label: "yourpipe MediaThumb accessors (yourpipe0.7.0.abc)", matches: (n) => n.includes("components/MediaThumb"), run: verifyYourpipeMediaThumb },
    { label: "yourpipe VttSubtitleParser loops (yourpipe0.7.0.abc)", matches: (n) => n.includes("subtitle/VttSubtitleParser"), run: verifyYourpipeVttSubtitleParser },
    { label: "yourpipe PlayQueueManager guard (yourpipe0.7.0.abc)", matches: (n) => n.includes("player/PlayQueueManager"), run: verifyYourpipePlayQueueManager },
    { label: "yourpipe AVPlayer resource object (yourpipe0.7.0.abc)", matches: (n) => n.includes("components/AVPlayer"), run: verifyYourpipeAVPlayerResourceObject },
    { label: "yourpipe HttpDownloader retry try/catch (yourpipe0.7.0.abc)", matches: (n) => n.includes("network/HttpDownloader"), run: verifyYourpipeHttpDownloaderRetryTryCatch },
    { label: "yourpipe ChannelInfoService shared tail merge (yourpipe0.7.0.abc)", matches: (n) => n.includes("features/user/ChannelInfoService"), run: verifyYourpipeChannelInfoService },
];

const amclClassTests: BinaryClassTest[] = [
    { label: "amcl default class export (amcl1.0.6.abc)", matches: (n) => n.includes("entryability/EntryAbility"), run: verifyAmclDefaultClassExport },
    { label: "amcl structure/simplify memory (amcl1.0.6.abc)", matches: (n) => n === "L&entry/src/main/ets/r5/i8&;", run: verifyAmclStructureMemory },
    { label: "amcl unreachable handler island (amcl1.0.6.abc)", matches: (n) => n === "L&commons/src/main/ets/h1/w1&1.0.0;", run: verifyAmclUnreachableHandlerIsland },
    { label: "amcl structured cycle guard (amcl1.0.6.abc)", matches: (n) => n === "L&entry/src/main/ets/r2/l3&;", run: verifyAmclStructuredCycleGuard },
    { label: "amcl break for...of close block (amcl1.0.6.abc)", matches: (n) => n === "L&feature_core/src/main/ets/t11/a12&1.0.0;", run: verifyAmclForOfCloseBlock },
    { label: "amcl readJarMainClass structure (amcl1.0.6.abc)", matches: (n) => n === "L&feature_core/src/main/ets/t11/d12&1.0.0;", run: verifyAmclReadJarMainClass },
    { label: "amcl display listeners loop + empty catch (amcl1.0.6.abc)", matches: (n) => n === "L&entry/src/main/ets/n4/o8&;", run: verifyAmclDisplayListenersLoop },
    { label: "amcl launch labelled-loop goto (amcl1.0.6.abc)", matches: (n) => n === "L&launch/src/main/ets/r16&1.0.0;", run: verifyAmclLaunchGotoLoop },
    { label: "amcl shared try/catch join (amcl1.0.6.abc)", matches: (n) => n === "L&entry/src/main/ets/r5/l8&;", run: verifyAmclSharedTryCatchJoin },
    { label: "amcl shared-start catch + loop-tail finally (amcl1.0.6.abc)", matches: (n) => n === "L&launch/src/main/ets/i15&1.0.0;", run: verifyAmclSharedCatchFinally },
    { label: "amcl nested try/finally restoration (amcl1.0.6.abc)", matches: (n) => n === "L&feature_core/src/main/ets/e11/i11&1.0.0;", run: verifyAmclNestedFinallyRestoration },
    { label: "amcl empty module with export table (amcl1.0.6.abc)", matches: (n) => n === "L&entry/src/main/n5&;", run: verifyAmclEmptyModuleBarrelExport },
];

const hx360eClassTests: BinaryClassTest[] = [
    { label: "hx360e 24.0.0.0 try/catch/finally structure (hx360e1.0.2.abc)", matches: (n) => n === "L&entry/src/main/ets/common/LogExport&;", run: verifyHx360eExceptionStructure },
    { label: "hx360e 24.0.0.0 class static field init (hx360e1.0.2.abc)", matches: (n) => n === "L&entry/src/main/ets/common/AppLog&;", run: verifyHx360eAppLogClass },
    { label: "hx360e 24.0.0.0 named-route page class (hx360e1.0.2.abc)", matches: (n) => n === "L&entry/src/main/ets/pages/GamePage&;", run: verifyHx360eGamePageClass },
];

const lngaClassTests: BinaryClassTest[] = [
    { label: "lnga SOURCE_FILE + qr login short circuit (lnga1.2.6.abc)", matches: (n) => n === "Lcom.example.nga_oh/entry/ets/common/utils/NgaQrLoginUtils;", run: verifyLngaQrLoginUtils },
    { label: "lnga shared-start catch + finally (lnga1.2.6.abc)", matches: (n) => n === "Lcom.example.nga_oh/entry/ets/pages/SettingsPanel;", run: verifyLngaSettingsPanelException },
];

const installClassTests: BinaryClassTest[] = [
    {
        label: "install '#'-less class record names + prototype residue (install1.3.0.abc)",
        matches: (n) => n === "Lpkg_modules/.ohpm/webview_flutter_ohos@63rxyovf6soepjs+sja1e6+fkzygj1xf5z4crizkc8u="
            + "/pkg_modules/webview_flutter_ohos/src/main/ets/io.flutter.plugins/webview_flutter/WebChromeClientHostApiImpl;",
        run: verifyInstallWebChromeClientClass,
    },
    {
        /**
         * 回归:接口/纯类型源文件的空模块标注(install1.3.0.abc)。
         * FlutterUiDisplayListener 是 flutter_ohos 的 interface,ArkTS 编译时接口被擦除,
         * 类记录只剩 5 个模块元数据字段 + 一条 returnundefined 的 func_main_0;
         * simplify 后输出只剩头注释,必须带 empty module 标记,且不得有语句残留。
         */
        label: "install empty interface module marker (install1.3.0.abc)",
        matches: (n) => n === "Lpkg_modules/.ohpm/@ohos+flutter_ohos@zl5sgaygqsqrqqtvxitwwita9ctgsvucjvbitoqeitg="
            + "/pkg_modules/@ohos/flutter_ohos/src/main/ets/embedding/engine/renderer/FlutterUiDisplayListener;",
        run: (_clazz, code) => {
            NodeFactory.parse(code);
            if (!code.includes("* empty module: no runtime code in this class record")) {
                throw new Error(`FlutterUiDisplayListener: 缺少 empty module 标记\n${code}`);
            }
            const body = code.replace(/\/\*[\s\S]*?\*\//g, "").trim();
            if (body.length !== 0) {
                throw new Error(`FlutterUiDisplayListener: 空模块不应有语句残留\n${code}`);
            }
        },
    },
];

async function main(): Promise<void> {
    console.log("[test] simplify return liveness");
    verifyReturnValueLiveness();
    console.log("    ok");

    console.log("[test] simplify accumulator chain fold");
    verifyAccumulatorChainFold();
    console.log("    ok");

    console.log("[test] simplify accumulator member-call chain + hub alias");
    verifyAccumulatorMemberCallChain();
    console.log("    ok");

    console.log("[test] simplify accumulator next-read fold");
    verifyAccumulatorNextReadFold();
    console.log("    ok");

    console.log("[test] simplify do-while break for...of restore");
    verifyDoWhileBreakForOf();
    console.log("    ok");

    console.log("[test] simplify do-while exit scan at block end");
    verifyDoWhileExitScanAtBlockEnd();
    console.log("    ok");

    console.log("[test] simplify reused iterator temp for...of");
    verifyReusedIteratorTempForOf();
    console.log("    ok");

    console.log("[test] simplify else-after-exit flatten");
    verifyElseAfterExitFlatten();
    console.log("    ok");

    console.log("[test] simplify condition materialization into test");
    verifyConditionMaterializationIntoTest();
    console.log("    ok");

    console.log("[test] simplify condition alias fold");
    verifyConditionAliasFold();
    console.log("    ok");

    console.log("[test] simplify tail temp alias fold");
    verifyTailTempAliasFold();
    console.log("    ok");

    console.log("[test] simplify hub alias keeps source value");
    verifyHubAliasKeepsSourceValue();
    console.log("    ok");

    console.log("[test] simplify closure written variable");
    verifyClosureWrittenVariable();
    console.log("    ok");

    console.log("[test] simplify acc call");
    verifyAccCallSimplification();
    console.log("    ok");

    console.log("[test] simplify merged self call");
    verifyMergedSelfCallFold();
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

    console.log("[test] simplify negated test self assignment chain");
    verifyNegatedTestSelfAssignmentChain();
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

    console.log("[test] simplify test sequence keeps read value");
    verifyTestSequenceKeepsReadValue();
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

    console.log("[test] simplify if-return chain switch");
    verifyIfReturnChainSwitch();
    console.log("    ok");

    console.log("[test] hap package (zhihupp0.59.hap)");
    verifyHapPackage();
    console.log("    ok");

    // 一个二进制一个 pass:类表只遍历一次,类只反编译一次。
    runClassSuite("zhihupp0.59.hap", zhihuClassTests, { hapEntry: "ets/modules.abc" });
    runClassSuite("yourpipe0.7.0.abc", yourpipeClassTests, { parse: true });
    runClassSuite("amcl1.0.6.abc", amclClassTests, { parse: true });
    runClassSuite("hx360e1.0.2.abc", hx360eClassTests);
    runClassSuite("lnga1.2.6.abc", lngaClassTests);
    runClassSuite("install1.3.0.abc", installClassTests);

    console.log("[test] simplify sequenced test prefix fold");
    verifySequencedTestPrefixFold();
    console.log("    ok");

    console.log("[test] simplify switch transform completeness");
    verifySwitchTransformRequiresAllCases();
    console.log("    ok");

    console.log("[test] simplify redundant rethrow catch");
    verifyRedundantRethrowCatchRemoval();
    console.log("    ok");

    console.log("[test] simplify hole sentinel cleanup");
    verifySentinelGuardCleanup();
    console.log("    ok");

    console.log("[test] simplify loop liveness after continue");
    verifyLoopLivenessAfterContinue();
    console.log("    ok");

    console.log("[test] simplify goto loop fall-through");
    verifyGotoLoopFallthrough();
    console.log("    ok");

    console.log("[test] output logical chain formatting");
    verifyLogicalChainFormatting();
    console.log("    ok");

    console.log("[test] aged bytecode definefieldbyname kind");
    verifyDefineFieldByNameKind();
    console.log("    ok");

    console.log("[test] core entry stays browser-safe");
    verifyCoreBrowserSafe();
    console.log("    ok");

    const samples: Sample[] = [
        { abc: "md5.abc", expected: "md5.js", verify: verifyMd5 },
        { abc: "class.abc", expected: "class.js", verify: verifyClass },
        { abc: "aes.abc", expected: "aes.js", verify: verifyAes },
    ];

    for (const sample of samples) {
        console.log(`[test] ${sample.abc}`);
        const { code, classes } = decompileSample(sample.abc);
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
