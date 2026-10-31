/**
 * panda-asm 集成测试:
 *   1. 无修改 round-trip 字节级一致;
 *   2. replaceMethodCode:换掉方法实现,重新解析/反编译确认生效;
 *   3. addMethod:新增方法(克隆模板 proto),类实体重定位后索引表可用;
 *   4. addMethod + 新代码;addStringId 索引表扩展;
 *   5. 两个样本(md5.abc / class.abc)都验证,排除单文件偶然性。
 * @Author: jmp0
 */
import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";
import * as crypto from "crypto";
import { assemble, decodeInstructions, PandaDecompiler, PandaFile } from "xpanda-core";
import { PandaPatchFile } from "../src";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error("ASSERT FAILED: " + message);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

function loadSample(fileName: string): Uint8Array {
    return new Uint8Array(fs.readFileSync(path.join(__dirname, "..", "..", "xpanda-core", "test", "resources", fileName)));
}

function findClass(pandaFile: PandaFile, className: string) {
    for (const indexHeader of pandaFile.indexHeaders) {
        for (const clazz of indexHeader.pandaClasses) {
            if (clazz.getClassName() === className && !clazz.classExternal) return clazz;
        }
    }
    return null;
}

function decompileClassOf(pandaFile: PandaFile, className: string): string {
    pandaFile.parseAssembly();
    const clazz = findClass(pandaFile, className);
    assert(clazz, `class ${className} not found after patch`);
    return new PandaDecompiler().decompileClass(clazz);
}

// ---------------------------------------------------------------- 1. identity
function testIdentityRoundTrip(sample: string): void {
    const original = loadSample(sample);
    const patched = PandaPatchFile.load(original).toBytes();
    assert(bytesEqual(original, patched), `${sample}: unmodified round-trip must be byte-identical`);
}

// ---------------------------------------------------------------- 2. replace code
function testReplaceMethodCode(): void {
    const className = "L_GLOBAL;";
    const patchFile = PandaPatchFile.load(loadSample("md5.abc"));
    const rhexCode = patchFile.getMethodCode(className, "rhex");
    const hexCode = patchFile.getMethodCode(className, "hex");
    assert(rhexCode && hexCode, "md5 hex/rhex must have code");
    assert(!bytesEqual(rhexCode.instructions, hexCode.instructions), "hex/rhex bodies must differ");

    patchFile.replaceMethodCode(className, "hex", rhexCode);
    const patchedBytes = patchFile.toBytes();

    // 重新解析:hex 的指令应与原 rhex 完全一致,且其它方法不受影响
    const pandaFile = new PandaFile(patchedBytes);
    const clazz = findClass(pandaFile, className);
    assert(clazz, "class L_GLOBAL must still parse");
    const newHex = clazz.pandaMethods.get("hex");
    assert(newHex?.methodCode, "hex must still have code");
    assert(bytesEqual(newHex.methodCode.instructions, rhexCode.instructions), "hex code must be replaced by rhex code");

    // 反编译确认:hex 的函数体变成 rhex 的实现
    const output = decompileClassOf(pandaFile, className);
    const hexBody = output.slice(output.indexOf("function hex("));
    assert(hexBody.includes("0123456789abcdef"), "decompiled hex must contain rhex's hex-table logic");
    assert(!hexBody.includes('p0.join("")'), "decompiled hex must no longer contain its original body");
}

// ---------------------------------------------------------------- 3. add method
function testAddMethod(): void {
    const className = "L_GLOBAL;";
    const patchFile = PandaPatchFile.load(loadSample("md5.abc"));
    const templateCode = patchFile.getMethodCode(className, "add32");
    assert(templateCode, "add32 must have code");

    const result = patchFile.addMethod(className, { name: "patched_helper", template: "add32" });
    const patchedBytes = patchFile.toBytes();

    const pandaFile = new PandaFile(patchedBytes);
    const clazz = findClass(pandaFile, className);
    assert(clazz, "class L_GLOBAL must still parse");
    const added = clazz.pandaMethods.get("patched_helper");
    assert(added, "patched_helper must exist after reparse");
    assert(added.methodCode, "patched_helper must have code");
    assert(bytesEqual(added.methodCode.instructions, templateCode.instructions), "patched_helper must clone add32 code");
    assert(added.getOffset() === result.methodOffset, "reported method offset must match reparsed entity");

    // 索引表:新 id 指向新方法实体
    const indexHeader = clazz.indexHeader;
    assert(indexHeader.pandaMethods[result.methodId], "method id must resolve");
    assert(indexHeader.pandaMethods[result.methodId].getOffset() === result.methodOffset,
        "method id must point at the new method entity");

    // 反编译确认整个类仍可正常还原(parseAssembly 已成功反汇编过新方法)
    const output = decompileClassOf(pandaFile, className);
    assert(output.includes("function add32("), "class must still decompile after addMethod");
}

// ---------------------------------------------------------------- 4. add method + code
function testAddMethodWithNewCode(): void {
    const className = "L_GLOBAL;";
    const patchFile = PandaPatchFile.load(loadSample("md5.abc"));
    const code = patchFile.getMethodCode(className, "add32");
    assert(code, "add32 must have code");

    const result = patchFile.addMethod(className, { name: "patched_add", template: "add32", code });
    assert(result.codeOffset !== undefined, "adding with code must report code offset");

    const patchedBytes = patchFile.toBytes();
    const pandaFile = new PandaFile(patchedBytes);
    const clazz = findClass(pandaFile, className);
    assert(clazz, "class L_GLOBAL must still parse");
    const added = clazz.pandaMethods.get("patched_add");
    assert(added?.methodCode, "patched_add must have code");
    assert(bytesEqual(added.methodCode.instructions, code.instructions), "patched_add code must match input");

    const output = decompileClassOf(pandaFile, className);
    assert(output.includes("function add32("), "class must still decompile after addMethod with code");
}

// ---------------------------------------------------------------- 5. string id
function testAddStringId(): void {
    const className = "L_GLOBAL;";
    const patchFile = PandaPatchFile.load(loadSample("md5.abc"));
    const added = patchFile.addStringId(className, "xpanda_patch_string");
    const patchedBytes = patchFile.toBytes();

    const pandaFile = new PandaFile(patchedBytes);
    const clazz = findClass(pandaFile, className);
    assert(clazz, "class L_GLOBAL must still parse");
    const entity = clazz.indexHeader.pandaMethods[added.id];
    assert(entity, "string id must resolve");
    assert(entity.getOffset() === added.offset, "string id must point at the new string entity");
    // String 实体内容:uleb 长度 + mutf8 + NUL,直接按字节校验结尾
    const expectedPrefix = String.fromCharCode((("xpanda_patch_string".length << 1) | 1));
    const tail = Buffer.from(patchedBytes).subarray(added.offset, added.offset + 64).toString("latin1");
    assert(tail.startsWith(expectedPrefix + "xpanda_patch_string"),
        `string entity must encode text, got ${JSON.stringify(tail.slice(0, 32))}`);
}

// ---------------------------------------------------------------- 6. second sample
function testSecondSample(): void {
    const sample = "class.abc";
    const patchFile = PandaPatchFile.load(loadSample(sample));
    const classNames = patchFile.getClassNames();
    assert(classNames.length > 0, `${sample} must expose classes`);

    let className: string | null = null;
    let template: string | null = null;
    for (const candidate of classNames) {
        for (const methodName of patchFile.getMethodNames(candidate)) {
            if (patchFile.getMethodCode(candidate, methodName) !== null) {
                className = candidate;
                template = methodName;
                break;
            }
        }
        if (className) break;
    }
    assert(className && template, `${sample} must have a class with a method carrying code`);
    const result = patchFile.addMethod(className, { name: "patched_probe", template });

    const pandaFile = new PandaFile(patchFile.toBytes());
    const clazz = findClass(pandaFile, className);
    assert(clazz?.pandaMethods.has("patched_probe"), `${sample}: patched_probe must exist`);
    assert(clazz.pandaMethods.get("patched_probe")?.getOffset() === result.methodOffset,
        `${sample}: method offset must match`);
}

// ---------------------------------------------------------------- 7. merged abc (v24)
function testMergeAbcV24(): void {
    const sample = "lnga1.2.6.abc";
    const className = "Lcom.example.nga_oh/entry/ets/common/cache/LruCache;";
    const patchFile = PandaPatchFile.load(loadSample(sample));
    const template = "#~@1>#get";
    const code = patchFile.getMethodCode(className, template);
    assert(code, `${sample}: template method must have code`);

    const result = patchFile.addMethod(className, { name: "#*#patched_helper", template, code });
    const pandaFile = new PandaFile(patchFile.toBytes());
    const clazz = findClass(pandaFile, className);
    assert(clazz, `${sample}: class must still parse`);
    const added = clazz.pandaMethods.get("#*#patched_helper");
    assert(added?.methodCode, `${sample}: added method must have code`);
    assert(added.getOffset() === result.methodOffset, `${sample}: added method offset must match`);
    assert(bytesEqual(added.methodCode.instructions, code.instructions), `${sample}: added method code must match`);
}

// ---------------------------------------------------------------- 7. sequential edits
function testSequentialEdits(): void {
    const className = "L_GLOBAL;";
    const patchFile = PandaPatchFile.load(loadSample("md5.abc"));
    const code = patchFile.getMethodCode(className, "add32");
    assert(code, "add32 must have code");

    const first = patchFile.addMethod(className, { name: "patched_one", template: "add32", code });
    const second = patchFile.addMethod(className, { name: "patched_two", template: "add32", code });
    const stringA = patchFile.addStringId(className, "patch_string_a");
    const stringB = patchFile.addStringId(className, "patch_string_b");

    const rhex = patchFile.getMethodCode(className, "rhex");
    assert(rhex, "rhex must have code");
    patchFile.replaceMethodCode(className, "add32", rhex);

    const pandaFile = new PandaFile(patchFile.toBytes());
    const clazz = findClass(pandaFile, className);
    assert(clazz, "class must still parse after sequential edits");
    for (const name of ["patched_one", "patched_two"]) {
        const added = clazz.pandaMethods.get(name);
        assert(added?.methodCode, `${name} must survive later edits`);
        assert(bytesEqual(added.methodCode.instructions, code.instructions), `${name} code must be intact`);
    }
    assert(first.methodId !== second.methodId, "each added method must get its own id");
    assert(clazz.indexHeader.pandaMethods[stringA.id].getOffset() === stringA.offset, "first string id must survive");
    assert(clazz.indexHeader.pandaMethods[stringB.id].getOffset() === stringB.offset, "second string id must resolve");
    assert(bytesEqual(clazz.pandaMethods.get("add32").methodCode.instructions, rhex.instructions),
        "replaceMethodCode after addMethod must patch the class copy too");
}

// ---------------------------------------------------------------- 8. insert instructions
function readSigned(bytes: Uint8Array, offset: number, width: number): number {
    if (width === 1) return (bytes[offset] << 24) >> 24;
    if (width === 2) return ((bytes[offset] | (bytes[offset + 1] << 8)) << 16) >> 16;
    return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24);
}

function assertJumpTargetsValid(instructions: Uint8Array): void {
    const decoded = decodeInstructions(instructions);
    const boundaries = new Set(decoded.map((instruction) => instruction.pc));
    boundaries.add(instructions.length);
    for (const instruction of decoded) {
        if (instruction.jumpImmediateOffset === undefined) continue;
        const width = instruction.jumpBits! / 8;
        const target = instruction.pc + readSigned(instructions, instruction.pc + instruction.jumpImmediateOffset, width);
        assert(boundaries.has(target), `jump at pc ${instruction.pc} targets non-boundary ${target}`);
    }
}

function testInsertAtBoundaries(): void {
    const className = "L_GLOBAL;";
    const methodName = "md51";
    const original = PandaPatchFile.load(loadSample("md5.abc")).getMethodCode(className, methodName);
    assert(original, "md51 must have code");
    const decoded = decodeInstructions(original.instructions);
    const boundaries = [0, decoded[Math.floor(decoded.length / 2)].pc, original.instructions.length];

    for (const atPC of boundaries) {
        const patchFile = PandaPatchFile.load(loadSample("md5.abc"));
        const result = patchFile.insertInstructions(className, methodName, atPC, assemble("nop"));
        assert(result.insertedLength === 1, "inserted length");
        assert(result.instructions.length === original.instructions.length + 1, "in-memory result length");

        // 内存模型应反映插入后的代码(连续编辑的基础)
        const modelCode = patchFile.getMethodCode(className, methodName);
        assert(modelCode && bytesEqual(modelCode.instructions, result.instructions), "getMethodCode must reflect insertion");

        const pandaFile = new PandaFile(patchFile.toBytes());
        const clazz = findClass(pandaFile, className);
        assert(clazz, "class must still parse after insert");
        const method = clazz.pandaMethods.get(methodName);
        assert(method?.methodCode, "method must still have code");
        assert(method.methodCode.instructions.length === original.instructions.length + 1,
            `atPC ${atPC}: code length must grow by 1`);
        assertJumpTargetsValid(method.methodCode.instructions);
        decompileClassOf(pandaFile, className);
    }
}

function testInsertPreservesExecution(): void {
    const className = "L_GLOBAL;";
    const methodName = "md51";
    const original = PandaPatchFile.load(loadSample("md5.abc")).getMethodCode(className, methodName);
    assert(original, "md51 must have code");

    const patchFile = PandaPatchFile.load(loadSample("md5.abc"));
    const firstDecoded = decodeInstructions(original.instructions);
    const firstPC = firstDecoded[Math.floor(firstDecoded.length / 3)].pc;
    patchFile.insertInstructions(className, methodName, firstPC, assemble("nop"));

    // 不重新载入,连续插入:必须基于最新的指令流
    const afterFirst = patchFile.getMethodCode(className, methodName);
    assert(afterFirst, "code after first insert");
    const secondDecoded = decodeInstructions(afterFirst.instructions);
    patchFile.insertInstructions(className, methodName, secondDecoded[Math.floor(secondDecoded.length / 2)].pc, assemble("nop"));

    const finalCode = patchFile.getMethodCode(className, methodName);
    assert(finalCode && finalCode.instructions.length === original.instructions.length + 2,
        "two insertions must accumulate");

    const pandaFile = new PandaFile(patchFile.toBytes());
    pandaFile.parseAssembly();
    const clazz = findClass(pandaFile, className);
    assert(clazz, "class must still parse");
    const output = new PandaDecompiler().decompileClass(clazz);

    const sandbox: Record<string, unknown> = { console: { log: () => { /* ignore */ } } };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(output, sandbox, { timeout: 5000 });
    const md5 = sandbox.md5 as (value: string) => string;
    assert(typeof md5 === "function", "decompiled output must expose md5");
    const expected = crypto.createHash("md5").update("admin").digest("hex");
    assert(md5("admin") === expected, `patched md5 must still produce the correct digest (got ${md5("admin")}, want ${expected})`);
}

function testInsertTryBlockFixup(): void {
    const patchFile = PandaPatchFile.load(loadSample("lnga1.2.6.abc"));
    let target: {
        className: string;
        methodName: string;
        tryBlock: { startPC: number; length: number; handlerPC: number };
    } | null = null;
    for (const candidateClass of patchFile.getClassNames()) {
        for (const name of patchFile.getMethodNames(candidateClass)) {
            const code = patchFile.getMethodCode(candidateClass, name);
            if (!code || (code.tries ?? []).length === 0) continue;
            const tryBlock = code.tries![0];
            target = {
                className: candidateClass,
                methodName: name,
                tryBlock: {
                    startPC: tryBlock.startPC,
                    length: tryBlock.length,
                    handlerPC: tryBlock.catches[0]?.handlerPC ?? 0,
                },
            };
            break;
        }
        if (target) break;
    }
    assert(target, "lnga must have a method with try blocks");

    const { className, methodName, tryBlock } = target;
    // 在 try 起点插入:start 后移,length 不变
    const result = patchFile.insertInstructions(className, methodName, tryBlock.startPC, assemble("nop"));
    assert(result.insertedLength === 1, "try insert length");

    const pandaFile = new PandaFile(patchFile.toBytes());
    const clazz = findClass(pandaFile, className);
    assert(clazz, "class must parse after try insert");
    const method = clazz.pandaMethods.get(methodName);
    assert(method?.methodCode?.pandaMethodTryBlocks?.length, "try blocks must survive");
    const patchedTry = method.methodCode.pandaMethodTryBlocks.find(
        (block) => block.startPC === tryBlock.startPC + 1 && block.length === tryBlock.length);
    assert(patchedTry, "try block must keep its length and shift its start by 1");
}

function testInsertRejectsInvalidInput(): void {
    const className = "L_GLOBAL;";
    const methodName = "md51";
    const patchFile = PandaPatchFile.load(loadSample("md5.abc"));
    const code = patchFile.getMethodCode(className, methodName);
    assert(code, "md51 must have code");
    const decoded = decodeInstructions(code.instructions);
    const multiByte = decoded.find((instruction) => instruction.size > 1);
    assert(multiByte, "must have a multi-byte instruction");

    let threw = false;
    try {
        patchFile.insertInstructions(className, methodName, multiByte.pc + 1, assemble("nop"));
    } catch {
        threw = true;
    }
    assert(threw, "inserting at a non-boundary must throw");

    threw = false;
    try {
        patchFile.insertInstructions(className, methodName, 0, assemble("jmp -4"));
    } catch {
        threw = true;
    }
    assert(threw, "inserted snippet with an escaping jump must throw");

    threw = false;
    try {
        patchFile.insertInstructions(className, methodName, code.instructions.length + 1, assemble("nop"));
    } catch {
        threw = true;
    }
    assert(threw, "inserting out of range must throw");
}

// ---------------------------------------------------------------- 9. prepare + patch workflow
function stripModuleSyntax(code: string): string {
    return code.replace(/^import\s+[^;]+;\s*$/gm, "")
        .replace(/^export\s+\{[^}]*\};\s*$/gm, "")
        .replace(/^export\s+default\s+/gm, "")
        .replace(/^export\s+(?=(?:async\s+)?(?:class|function|const|let|var)\b)/gm, "");
}

/** 反编译 hook 的 module record 类并执行(等价于运行时求值 hook module,定义导出的 hook 函数) */
function runHookModule(
    pandaFile: PandaFile,
    hookName: string,
    sandbox: Record<string, unknown>,
): void {
    const hookClass = pandaFile.indexHeaders.flatMap((header) => header.pandaClasses)
        .find((clazz) => !clazz.classExternal && clazz.getClassName().includes(`xpanda/hook/${hookName}`));
    assert(hookClass, "moved hook class must exist");
    vm.runInNewContext(stripModuleSyntax(new PandaDecompiler().decompileClass(hookClass)), sandbox, { timeout: 5000 });
}

// ---------------------------------------------------------------- 10. two-phase workflow
function testPrepareAndPatchWorkflow(): void {
    const es2abc = bundledEs2abc();
    if (!es2abc) {
        console.log("[patch] skip prepare/patch workflow (es2abc not found)");
        return;
    }
    const targetClass = "L&entry/src/main/ets/target&;";
    const methodName = "#*#target";
    const fixturePath = path.join(__dirname, "resources", "target-only.abc");
    const patchFile = PandaPatchFile.load(new Uint8Array(fs.readFileSync(fixturePath)));

    const hookName = patchFile.prepareMethodHead(targetClass, methodName);
    assert(/^__xpanda_hook_[a-z0-9]{12}$/.test(hookName), `prepare must return a random hook name, got ${hookName}`);

    const result = patchFile.patchMethodHead(hookName, `function ${hookName}(args) { return [1]; }`, { es2abc });
    assert(result.hookGlobalName === hookName, "workflow must report the prepared hook name");

    const pandaFile = new PandaFile(patchFile.toBytes());
    pandaFile.parseAssembly();
    const target = findClass(pandaFile, targetClass);
    assert(target, "target class must survive the hook class move");
    const hookClass = pandaFile.indexHeaders.flatMap((header) => header.pandaClasses)
        .find((clazz) => !clazz.classExternal && clazz.getClassName().includes(`xpanda/hook/${hookName}`));
    assert(hookClass, "hook class must be moved into the abc");

    const sandbox: Record<string, unknown> = { console: { log: () => { /* ignore */ } } };
    sandbox.globalThis = sandbox;
    runHookModule(pandaFile, hookName, sandbox);
    vm.runInNewContext(stripModuleSyntax(new PandaDecompiler().decompileClass(target)), sandbox, { timeout: 5000 });
    const targetFn = sandbox.target as (a: number, b: number) => unknown;
    assert(targetFn(1, 2) === 3, "hook returning [1] must preserve the original result");

    // interception: patch a fresh copy with [0, value]
    const interceptFile = PandaPatchFile.load(new Uint8Array(fs.readFileSync(fixturePath)));
    const interceptHook = interceptFile.prepareMethodHead(targetClass, methodName);
    interceptFile.patchMethodHead(interceptHook, `function ${interceptHook}(args) { return [0, 42]; }`, { es2abc });
    const interceptPanda = new PandaFile(interceptFile.toBytes());
    const interceptTarget = findClass(interceptPanda, targetClass);
    assert(interceptTarget, "intercept target must exist");
    const interceptSandbox: Record<string, unknown> = { console: { log: () => { /* ignore */ } } };
    interceptSandbox.globalThis = interceptSandbox;
    runHookModule(interceptPanda, interceptHook, interceptSandbox);
    vm.runInNewContext(stripModuleSyntax(new PandaDecompiler().decompileClass(interceptTarget)),
        interceptSandbox, { timeout: 5000 });
    assert((interceptSandbox.target as (a: number, b: number) => unknown)(1, 2) === 42,
        "hook returning [0, value] must early-return the value");
}

// ---------------------------------------------------------------- 9. version consistency
function bundledEs2abc(): string | null {
    const platformDir = process.platform === "darwin" ? "macos"
        : process.platform === "win32" ? "windows"
        : "linux";
    const executable = process.platform === "win32" ? "es2abc.exe" : "es2abc";
    const candidate = path.resolve(__dirname, "..", "..", "..", "assets", "bin", platformDir, executable);
    return fs.existsSync(candidate) ? candidate : null;
}

function testPatchPreservesBytecodeVersion(): void {
    const es2abc = bundledEs2abc();
    if (!es2abc) {
        console.log("[patch] skip version consistency (es2abc not found)");
        return;
    }

    // 13.0.1.0 目标:merge 若不指定 target-api-version 会被升级到 24.0.0.0
    const targetClass = "L&entry/src/main/ets/target&;";
    const methodName = "#*#target";
    const patchFile = PandaPatchFile.load(
        new Uint8Array(fs.readFileSync(path.join(__dirname, "resources", "target-v13.abc"))));
    const before = new PandaFile(patchFile.toBytes());
    assert(before.header.versionString() === "13.0.1.0", `fixture must be 13.0.1.0, got ${before.header.versionString()}`);

    const hookName = patchFile.prepareMethodHead(targetClass, methodName);
    patchFile.patchMethodHead(hookName, `function ${hookName}(args) { return [1]; }`, { es2abc });

    const after = new PandaFile(patchFile.toBytes());
    assert(after.header.versionString() === "13.0.1.0",
        `patched abc must keep the target bytecode version, got ${after.header.versionString()}`);
}

// ---------------------------------------------------------------- 10. hook multiple functions
function testHookMultipleFunctions(): void {
    const es2abc = bundledEs2abc();
    if (!es2abc) {
        console.log("[patch] skip multi-function hook (es2abc not found)");
        return;
    }
    const targetClass = "L&entry/src/main/ets/target&;";
    const fixturePath = path.join(__dirname, "resources", "target-multi.abc");
    const patchFile = PandaPatchFile.load(new Uint8Array(fs.readFileSync(fixturePath)));

    const hookName = patchFile.prepareMethodHead(targetClass, "#*#targetA");
    patchFile.prepareMethodHead(targetClass, "#*#targetB", { hookGlobalName: hookName });

    const results = patchFile.patchMethodHeads(hookName, `function ${hookName}(args) { return [1]; }`, { es2abc });
    assert(results.length === 2, `one hook must patch both methods, got ${results.length}`);

    const pandaFile = new PandaFile(patchFile.toBytes());
    pandaFile.parseAssembly();
    const target = findClass(pandaFile, targetClass);
    assert(target, "target class must survive the hook class move");
    const hookClass = pandaFile.indexHeaders.flatMap((header) => header.pandaClasses)
        .find((clazz) => !clazz.classExternal && clazz.getClassName().includes(`xpanda/hook/${hookName}`));
    assert(hookClass, "moved hook class must exist");

    const sandbox: Record<string, unknown> = { console: { log: () => { /* ignore */ } } };
    sandbox.globalThis = sandbox;
    runHookModule(pandaFile, hookName, sandbox);
    vm.runInNewContext(stripModuleSyntax(new PandaDecompiler().decompileClass(target)), sandbox, { timeout: 5000 });
    const targetA = sandbox.targetA as (a: number, b: number) => unknown;
    const targetB = sandbox.targetB as (a: number, b: number) => unknown;
    assert(targetA(2, 3) === 5 && targetB(2, 3) === 6, "both functions must keep their original behavior");

    // interception: one hook shared by both methods in a fresh copy
    const interceptFile = PandaPatchFile.load(new Uint8Array(fs.readFileSync(fixturePath)));
    const interceptHook = interceptFile.prepareMethodHead(targetClass, "#*#targetA");
    interceptFile.prepareMethodHead(targetClass, "#*#targetB", { hookGlobalName: interceptHook });
    interceptFile.patchMethodHeads(interceptHook, `function ${interceptHook}(args) { return [0, 42]; }`, { es2abc });
    const interceptPanda = new PandaFile(interceptFile.toBytes());
    const interceptTarget = findClass(interceptPanda, targetClass);
    assert(interceptTarget, "intercept target must exist");
    const interceptSandbox: Record<string, unknown> = { console: { log: () => { /* ignore */ } } };
    interceptSandbox.globalThis = interceptSandbox;
    runHookModule(interceptPanda, interceptHook, interceptSandbox);
    vm.runInNewContext(stripModuleSyntax(new PandaDecompiler().decompileClass(interceptTarget)),
        interceptSandbox, { timeout: 5000 });
    assert((interceptSandbox.targetA as (a: number, b: number) => unknown)(2, 3) === 42
        && (interceptSandbox.targetB as (a: number, b: number) => unknown)(2, 3) === 42,
    "both functions must early-return");
}

// ---------------------------------------------------------------- 11. multiple hooks in one session
function testMultipleHooksInOneSession(): void {
    const es2abc = bundledEs2abc();
    if (!es2abc) {
        console.log("[patch] skip multiple hooks (es2abc not found)");
        return;
    }
    const targetClass = "L&entry/src/main/ets/target&;";
    const patchFile = PandaPatchFile.load(
        new Uint8Array(fs.readFileSync(path.join(__dirname, "resources", "target-multi.abc"))));

    const first = patchFile.prepareMethodHead(targetClass, "#*#targetA");
    const second = patchFile.prepareMethodHead(targetClass, "#*#targetB");
    assert(first !== second, "random hooks must differ");

    patchFile.patchMethodHead(first, `function ${first}(args) { return [0, 11]; }`, { es2abc });
    patchFile.patchMethodHead(second, `function ${second}(args) { return [0, 22]; }`, { es2abc });

    const pandaFile = new PandaFile(patchFile.toBytes());
    pandaFile.parseAssembly();
    const target = findClass(pandaFile, targetClass);
    assert(target, "target class must survive both hook class moves");
    const hookClasses = pandaFile.indexHeaders.flatMap((header) => header.pandaClasses)
        .filter((clazz) => !clazz.classExternal && clazz.getClassName().includes("xpanda/hook/"));
    assert(hookClasses.length === 2, `both hook classes must exist, got ${hookClasses.length}`);
    const moduleImports = target.pandaClassModuleData!.imports;
    for (const hook of [first, second]) {
        assert(moduleImports.some((entry) => entry.importName === hook),
            `target module must import hook '${hook}'`);
        const code = target.pandaMethods.get(hook === first ? "#*#targetA" : "#*#targetB")!.methodCode!;
        const load = decodeInstructions(code.instructions)
            .find((instruction) => instruction.opcode.name === "ldexternalmodulevar");
        assert(load, `prologue of '${hook}' must use ldexternalmodulevar`);
        assert(moduleImports[load!.operands[0] as number]?.importName === hook,
            `prologue of '${hook}' must reference its own import entry`);
    }

    const sandbox: Record<string, unknown> = { console: { log: () => { /* ignore */ } } };
    sandbox.globalThis = sandbox;
    runHookModule(pandaFile, first, sandbox);
    runHookModule(pandaFile, second, sandbox);
    vm.runInNewContext(stripModuleSyntax(new PandaDecompiler().decompileClass(target)), sandbox, { timeout: 5000 });
    assert((sandbox.targetA as (a: number, b: number) => unknown)(2, 3) === 11, "first hook must patch targetA");
    assert((sandbox.targetB as (a: number, b: number) => unknown)(2, 3) === 22, "second hook must patch targetB");
}

// ---------------------------------------------------------------- 11b. multiple hooks from one source file
function testHookBundleSingleSource(): void {
    const es2abc = bundledEs2abc();
    if (!es2abc) {
        console.log("[patch] skip hook bundle (es2abc not found)");
        return;
    }
    const targetClass = "L&entry/src/main/ets/target&;";
    const patchFile = PandaPatchFile.load(
        new Uint8Array(fs.readFileSync(path.join(__dirname, "resources", "target-multi.abc"))));

    const first = patchFile.prepareMethodHead(targetClass, "#*#targetA");
    const second = patchFile.prepareMethodHead(targetClass, "#*#targetB");
    const results = patchFile.patchHookBundle([first, second], `
        function bundleHelper(args) { return args[0] + args[1]; }
        function ${first}(args) { return [0, bundleHelper(args) + 10]; }
        function ${second}(args) { return [0, bundleHelper(args) + 20]; }
    `, { es2abc });
    assert(results.length === 2, `one bundle must patch both methods, got ${results.length}`);
    assert(results[0].hookGlobalName === first && results[1].hookGlobalName === second,
        "bundle results must keep hook order");

    const pandaFile = new PandaFile(patchFile.toBytes());
    pandaFile.parseAssembly();
    const hookClasses = pandaFile.indexHeaders.flatMap((header) => header.pandaClasses)
        .filter((clazz) => !clazz.classExternal && clazz.getClassName().includes("xpanda/hook/"));
    assert(hookClasses.length === 1, `one bundle must move exactly one hook class, got ${hookClasses.length}`);
    assert(hookClasses[0].pandaMethods.has(`#*#${first}`) && hookClasses[0].pandaMethods.has(`#*#${second}`),
        "both hook functions must live in the same moved hook class");
    assert(hookClasses[0].pandaMethods.has("#*#bundleHelper"),
        "helper functions declared in the same source must move with the hook class");

    const target = findClass(pandaFile, targetClass);
    assert(target, "target class must survive the hook class move");
    const moduleImports = target.pandaClassModuleData!.imports;
    for (const hook of [first, second]) {
        assert(moduleImports.some((entry) => entry.importName === hook),
            `target module must import hook '${hook}'`);
    }
    const bundleRequest = `@normalized:N&&&xpanda/hook/${first}&`;
    const requestEntries = target.pandaClassModuleData!.requestedModules!
        .filter((moduleRequest) => moduleRequest.toString() === bundleRequest);
    assert(requestEntries.length === 1,
        `both hook imports must share one module request, got ${requestEntries.length}`);
    for (const [methodName, hook] of [["#*#targetA", first], ["#*#targetB", second]] as const) {
        const code = target.pandaMethods.get(methodName)!.methodCode!;
        const load = decodeInstructions(code.instructions)
            .find((instruction) => instruction.opcode.name === "ldexternalmodulevar");
        assert(load, `prologue of '${methodName}' must use ldexternalmodulevar`);
        assert(moduleImports[load!.operands[0] as number]?.importName === hook,
            `prologue of '${methodName}' must reference its own import entry`);
    }

    const sandbox: Record<string, unknown> = { console: { log: () => { /* ignore */ } } };
    sandbox.globalThis = sandbox;
    runHookModule(pandaFile, first, sandbox);
    vm.runInNewContext(stripModuleSyntax(new PandaDecompiler().decompileClass(target)), sandbox, { timeout: 5000 });
    assert((sandbox.targetA as (a: number, b: number) => unknown)(2, 3) === 15,
        "first hook must run with the shared helper");
    assert((sandbox.targetB as (a: number, b: number) => unknown)(2, 3) === 25,
        "second hook must run with the shared helper");
}

// ---------------------------------------------------------------- 12. async function
async function testHookAsyncFunction(): Promise<void> {
    const es2abc = bundledEs2abc();
    if (!es2abc) {
        console.log("[patch] skip async hook (es2abc not found)");
        return;
    }
    const targetClass = "L&entry/src/main/ets/target&;";
    const methodName = "#*#af";
    const fixturePath = path.join(__dirname, "resources", "target-async.abc");

    const patchFile = PandaPatchFile.load(new Uint8Array(fs.readFileSync(fixturePath)));
    const hookName = patchFile.prepareMethodHead(targetClass, methodName);
    patchFile.patchMethodHead(hookName, `function ${hookName}(args) { return [1]; }`, { es2abc });

    const pandaFile = new PandaFile(patchFile.toBytes());
    pandaFile.parseAssembly();
    const target = findClass(pandaFile, targetClass);
    assert(target, "async target must survive the hook class move");
    const hookClass = pandaFile.indexHeaders.flatMap((header) => header.pandaClasses)
        .find((clazz) => !clazz.classExternal && clazz.getClassName().includes(`xpanda/hook/${hookName}`));
    assert(hookClass, "moved async hook class must exist");

    const sandbox: Record<string, unknown> = { console: { log: () => { /* ignore */ } } };
    sandbox.globalThis = sandbox;
    runHookModule(pandaFile, hookName, sandbox);
    vm.runInNewContext(stripModuleSyntax(new PandaDecompiler().decompileClass(target)), sandbox, { timeout: 5000 });
    const af = sandbox.af as (a: number) => Promise<number>;
    assert(await af(1) === 2, "non-fatal hook must preserve the async result");

    // interception: fresh copy with [0, value]
    const interceptFile = PandaPatchFile.load(new Uint8Array(fs.readFileSync(fixturePath)));
    const interceptHook = interceptFile.prepareMethodHead(targetClass, methodName);
    interceptFile.patchMethodHead(interceptHook, `function ${interceptHook}(args) { return [0, 42]; }`, { es2abc });
    const interceptPanda = new PandaFile(interceptFile.toBytes());
    const interceptTarget = findClass(interceptPanda, targetClass);
    assert(interceptTarget, "intercept async target must exist");
    const interceptSandbox: Record<string, unknown> = { console: { log: () => { /* ignore */ } } };
    interceptSandbox.globalThis = interceptSandbox;
    runHookModule(interceptPanda, interceptHook, interceptSandbox);
    vm.runInNewContext(stripModuleSyntax(new PandaDecompiler().decompileClass(interceptTarget)),
        interceptSandbox, { timeout: 5000 });
    assert(await (interceptSandbox.af as (a: number) => Promise<number>)(1) === 42,
        "hook returning [0, value] must early-return from the async function");
}

// ---------------------------------------------------------------- 13. hook module: import / export 表随类搬运
function testHookModuleImport(): void {
    const es2abc = bundledEs2abc();
    if (!es2abc) {
        console.log("[patch] skip hook module import (es2abc not found)");
        return;
    }
    const targetClass = "L&entry/src/main/ets/target&;";
    const fixturePath = path.join(__dirname, "resources", "target-only.abc");
    const patchFile = PandaPatchFile.load(new Uint8Array(fs.readFileSync(fixturePath)));
    const hookName = patchFile.prepareMethodHead(targetClass, "#*#target");
    patchFile.patchMethodHead(hookName, `import { dep } from "depmod";
function ${hookName}(args) {
    console.log("dep", dep.value);
    return [1];
}`, { es2abc, moduleRequests: { depmod: "@normalized:N&&&entry/src/main/ets/depmod&" } });

    const pandaFile = new PandaFile(patchFile.toBytes());
    pandaFile.parseAssembly();
    const target = findClass(pandaFile, targetClass);
    assert(target, "target class must survive the hook class move");
    const hookClass = pandaFile.indexHeaders.flatMap((header) => header.pandaClasses)
        .find((clazz) => !clazz.classExternal && clazz.getClassName().includes(`xpanda/hook/${hookName}`));
    assert(hookClass, "moved hook class must exist");
    assert(hookClass.pandaClassModuleData, "moved hook class must keep its module record");
    assert(hookClass.pandaFields?.some((field) => field.getName() === "moduleRecordIdx"),
        "moved hook class must keep moduleRecordIdx");
    assert(hookClass.pandaFields?.some((field) => field.getName() === "isCommonjs"),
        "moved hook class must stay a runtime record (isCommonjs field)");
    assert(hookClass.pandaClassModuleData.exports.some((exp) =>
        exp.path === null && exp.exportName === hookName),
    "hook module must export the hook function");

    const hookImports = hookClass.pandaClassModuleData.imports.map((entry) => entry.toString());
    assert(hookImports.some((entry) => entry.includes(`"@normalized:N&&&entry/src/main/ets/depmod&"`)),
        `hook import must be rewritten to the target request, got ${JSON.stringify(hookImports)}`);

    const targetModule = target.pandaClassModuleData;
    assert(targetModule, "target class must keep its module record");
    const addedImport = targetModule.imports.find((entry) => entry.importName === hookName);
    assert(addedImport, "target module must import the hook export");
    assert(addedImport!.path === `@normalized:N&&&xpanda/hook/${hookName}&`,
        `target import must reference the hook record, got ${addedImport!.path}`);

    const targetMethod = target.pandaMethods.get("#*#target");
    assert(targetMethod?.methodCode, "patched target method must keep code");
    const prologue = decodeInstructions(targetMethod.methodCode.instructions)
        .slice(0, 4)
        .map((instruction) => instruction.opcode.name);
    assert(prologue.includes("ldexternalmodulevar"),
        `prologue must load the hook via the module import, got ${prologue.join(",")}`);

    // 执行:反编译 hook module(定义导出的 hook 函数)+ 目标类
    const logs: unknown[][] = [];
    const sandbox: Record<string, unknown> = {
        console: { log: (...args: unknown[]) => logs.push(args) },
        dep: { value: 7 },
    };
    sandbox.globalThis = sandbox;
    runHookModule(pandaFile, hookName, sandbox);
    vm.runInNewContext(stripModuleSyntax(new PandaDecompiler().decompileClass(target)), sandbox, { timeout: 5000 });
    const targetFn = sandbox.target as (a: number, b: number) => unknown;
    assert(targetFn(1, 2) === 3, "hook returning [1] must preserve the original result");
    assert(logs.length === 1 && logs[0][0] === "dep" && logs[0][1] === 7,
        `hook module import must stay readable, got ${JSON.stringify(logs)}`);
}

// ---------------------------------------------------------------- 14. 目标没有 module record 时硬加
function testHookAddsModuleRecord(): void {
    const es2abc = bundledEs2abc();
    if (!es2abc) {
        console.log("[patch] skip forced module record (es2abc not found)");
        return;
    }
    const patchFile = PandaPatchFile.load(
        new Uint8Array(fs.readFileSync(path.join(__dirname, "resources", "unmerged.abc"))));
    const hookName = patchFile.prepareMethodHead("L_GLOBAL;", "#~@0<#test", { hookGlobalName: "TestHook" });
    patchFile.patchMethodHead(hookName,
        `function TestHook(args) { console.log("hook args", args); return [1]; }`, { es2abc });

    const pandaFile = new PandaFile(patchFile.toBytes());
    pandaFile.parseAssembly();
    const target = findClass(pandaFile, "L_GLOBAL;");
    assert(target, "target _GLOBAL must survive the class rebuild");
    assert(target.pandaClassModuleData, "target must gain a module record");
    assert(target.pandaFields?.some((field) => field.getName() === "moduleRecordIdx"),
        "target must gain moduleRecordIdx");
    assert(target.pandaFields?.some((field) => field.getName() === "isCommonjs"),
        "target must gain isCommonjs");
    const addedImport = target.pandaClassModuleData.imports.find((entry) => entry.importName === hookName);
    assert(addedImport, "target module must import the hook");

    const testMethod = target.pandaMethods.get("#~@0<#test");
    assert(testMethod?.methodCode, "hooked target method must keep code");
    const prologue = decodeInstructions(testMethod.methodCode.instructions)
        .slice(0, 4)
        .map((instruction) => instruction.opcode.name);
    assert(prologue.includes("ldexternalmodulevar"),
        `prologue must load the hook via the module import, got ${prologue.join(",")}`);

    // 类被重建/重定位后,方法仍要能正确解析(类 buffer 里的方法偏移已同步)
    const logs: unknown[][] = [];
    const sandbox: Record<string, unknown> = { console: { log: (...args: unknown[]) => logs.push(args) } };
    sandbox.globalThis = sandbox;
    runHookModule(pandaFile, hookName, sandbox);
    // 目标模块末尾本来就有 Test.test("hello") 调用,执行反编译结果即可
    vm.runInNewContext(stripModuleSyntax(new PandaDecompiler().decompileClass(target)), sandbox, { timeout: 5000 });
    assert(logs.some((entry) => entry[0] === "hook args") && logs.some((entry) => entry[0] === "hello"),
        `hook plus original body must both log, got ${JSON.stringify(logs)}`);
}

async function main(): Promise<void> {
    testIdentityRoundTrip("md5.abc");
    testIdentityRoundTrip("class.abc");
    testReplaceMethodCode();
    testAddMethod();
    testAddMethodWithNewCode();
    testAddStringId();
    testSecondSample();
    testMergeAbcV24();
    testSequentialEdits();
    testInsertAtBoundaries();
    testInsertPreservesExecution();
    testInsertTryBlockFixup();
    testInsertRejectsInvalidInput();
    testPrepareAndPatchWorkflow();
    testPatchPreservesBytecodeVersion();
    testHookMultipleFunctions();
    testMultipleHooksInOneSession();
    testHookBundleSingleSource();
    testHookModuleImport();
    testHookAddsModuleRecord();
    await testHookAsyncFunction();
    console.log("panda-asm: all tests passed");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
