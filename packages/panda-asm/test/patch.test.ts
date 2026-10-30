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
function stripModuleExports(code: string): string {
    return code.replace(/^export\s+\{[^}]*\};\s*$/gm, "")
        .replace(/^export\s+(?=(?:async\s+)?(?:class|function|const|let|var)\b)/gm, "");
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
    const patchFile = PandaPatchFile.load(
        new Uint8Array(fs.readFileSync(path.join(__dirname, "resources", "target-only.abc"))));

    const hookName = patchFile.prepareMethodHead(targetClass, methodName);
    assert(/^__xpanda_hook_[a-z0-9]{12}$/.test(hookName), `prepare must return a random hook name, got ${hookName}`);

    const result = patchFile.patchMethodHead(hookName, `function ${hookName}(args) { return [1]; }`, { es2abc });
    assert(result.hookGlobalName === hookName, "workflow must report the prepared hook name");

    const pandaFile = new PandaFile(patchFile.toBytes());
    pandaFile.parseAssembly();
    const target = findClass(pandaFile, targetClass);
    assert(target, "target class must survive merge");
    const hookClass = pandaFile.indexHeaders.flatMap((header) => header.pandaClasses)
        .find((clazz) => !clazz.classExternal && clazz.getClassName().includes("xpanda/hook"));
    assert(hookClass, "hook record must be merged into the abc");

    const sandbox: Record<string, unknown> = { console: { log: () => { /* ignore */ } } };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(stripModuleExports(new PandaDecompiler().decompileClass(hookClass)), sandbox, { timeout: 5000 });
    vm.runInNewContext(stripModuleExports(new PandaDecompiler().decompileClass(target)), sandbox, { timeout: 5000 });
    const targetFn = sandbox.target as (a: number, b: number) => unknown;
    assert(targetFn(1, 2) === 3, "hook returning [1] must preserve the original result");
    sandbox[hookName] = () => [0, 42];
    assert(targetFn(1, 2) === 42, "hook returning [0, value] must early-return the value");
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
    const patchFile = PandaPatchFile.load(
        new Uint8Array(fs.readFileSync(path.join(__dirname, "resources", "target-multi.abc"))));

    const hookName = patchFile.prepareMethodHead(targetClass, "#*#targetA");
    patchFile.prepareMethodHead(targetClass, "#*#targetB", { hookGlobalName: hookName });

    const results = patchFile.patchMethodHeads(hookName, `function ${hookName}(args) { return [1]; }`, { es2abc });
    assert(results.length === 2, `one hook must patch both methods, got ${results.length}`);

    const pandaFile = new PandaFile(patchFile.toBytes());
    pandaFile.parseAssembly();
    const target = findClass(pandaFile, targetClass);
    assert(target, "target class must survive merge");
    const hookClass = pandaFile.indexHeaders.flatMap((header) => header.pandaClasses)
        .find((clazz) => !clazz.classExternal && clazz.getClassName().includes(`xpanda/hook/${hookName}`));
    assert(hookClass, "hook record must be merged in");

    const sandbox: Record<string, unknown> = { console: { log: () => { /* ignore */ } } };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(stripModuleExports(new PandaDecompiler().decompileClass(hookClass)), sandbox, { timeout: 5000 });
    vm.runInNewContext(stripModuleExports(new PandaDecompiler().decompileClass(target)), sandbox, { timeout: 5000 });
    const targetA = sandbox.targetA as (a: number, b: number) => unknown;
    const targetB = sandbox.targetB as (a: number, b: number) => unknown;
    assert(targetA(2, 3) === 5 && targetB(2, 3) === 6, "both functions must keep their original behavior");
    sandbox[hookName] = () => [0, 42];
    assert(targetA(2, 3) === 42 && targetB(2, 3) === 42, "both functions must early-return");
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
    assert(target, "target class must survive both merges");
    const hookClasses = pandaFile.indexHeaders.flatMap((header) => header.pandaClasses)
        .filter((clazz) => !clazz.classExternal && clazz.getClassName().includes("xpanda/hook/"));
    assert(hookClasses.length === 2, `both hook records must survive, got ${hookClasses.length}`);

    const sandbox: Record<string, unknown> = { console: { log: () => { /* ignore */ } } };
    sandbox.globalThis = sandbox;
    for (const hookClass of hookClasses) {
        vm.runInNewContext(stripModuleExports(new PandaDecompiler().decompileClass(hookClass)), sandbox, { timeout: 5000 });
    }
    vm.runInNewContext(stripModuleExports(new PandaDecompiler().decompileClass(target)), sandbox, { timeout: 5000 });
    assert((sandbox.targetA as (a: number, b: number) => unknown)(2, 3) === 11, "first hook must patch targetA");
    assert((sandbox.targetB as (a: number, b: number) => unknown)(2, 3) === 22, "second hook must patch targetB");
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
    const patchFile = PandaPatchFile.load(
        new Uint8Array(fs.readFileSync(path.join(__dirname, "resources", "target-async.abc"))));

    const hookName = patchFile.prepareMethodHead(targetClass, methodName);
    patchFile.patchMethodHead(hookName, `function ${hookName}(args) { return [1]; }`, { es2abc });

    const pandaFile = new PandaFile(patchFile.toBytes());
    pandaFile.parseAssembly();
    const target = findClass(pandaFile, targetClass);
    assert(target, "async target must survive merge");
    const hookClass = pandaFile.indexHeaders.flatMap((header) => header.pandaClasses)
        .find((clazz) => !clazz.classExternal && clazz.getClassName().includes(`xpanda/hook/${hookName}`));
    assert(hookClass, "async hook record must exist");

    const sandbox: Record<string, unknown> = { console: { log: () => { /* ignore */ } } };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(stripModuleExports(new PandaDecompiler().decompileClass(hookClass)), sandbox, { timeout: 5000 });
    vm.runInNewContext(stripModuleExports(new PandaDecompiler().decompileClass(target)), sandbox, { timeout: 5000 });
    const af = sandbox.af as (a: number) => Promise<number>;
    assert(await af(1) === 2, "non-fatal hook must preserve the async result");
    sandbox[hookName] = () => [0, 42];
    assert(await af(1) === 42, "hook returning [0, value] must early-return from the async function");
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
    await testHookAsyncFunction();
    console.log("panda-asm: all tests passed");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
