/**
 * panda-asm:加载 .abc(Panda 字节码)文件,修改/新增实体后重新写回。
 *
 * 实现策略(append-only patcher):
 *   - 原始文件字节保持不变;新增实体追加到文件末尾(4 字节对齐);
 *   - 只能"重定位 + 改指针"的实体(如类实体)整体复制到末尾,再改引用它的索引表;
 *   - 定长指针字段(如方法的 CODE tag、类索引表项)原位改写;
 *   - 写回前更新 file_size 与 Adler32 checksum。
 *
 * 与 xpanda-core 的只读解析器配合:实体定位复用 `PandaFile`,序列化由本库完成。
 * @Author: jmp0
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import {
    Adler32, OPCODE_FLAG, PandaClass, PandaFile, PandaMethod,
    assemble, assembleInstruction, decodeInstructions, encodeInstructionWithOpcode,
} from "xpanda-core";
import type { DecodedInstruction, OpcodeInfo } from "xpanda-core";
import { concatBytes, encodeStringEntity, readUleb128, writeUleb128 } from "./codec";
import { encodeMethodCode, type CatchBlockInput, type MethodCodeInput, type TryBlockInput } from "./MethodCode";

export type { CatchBlockInput, MethodCodeInput, TryBlockInput };

const HEADER_CHECKSUM_OFF = 8;
const HEADER_VERSION_OFF = 12;
const HEADER_FILE_SIZE_OFF = 16;
const INDEX_HEADER_SIZE = 40;
const INDEX_HEADER_METHOD_IDX_SIZE_OFF = 16;
const INDEX_HEADER_METHOD_IDX_OFF_OFF = 20;

const METHOD_TAG_CODE = 0x01;
const METHOD_TAG_DEBUG_INFO = 0x05;

/** 方法实体 tag 的载荷长度(所有 tag 载荷均为定长) */
const METHOD_TAG_PAYLOAD_SIZE: Record<number, number> = {
    0x01: 4, // CODE
    0x02: 1, // SOURCE_LANG
    0x03: 4, // RUNTIME_ANNOTATION
    0x04: 4, // RUNTIME_PARAM_ANNOTATION
    0x05: 4, // DEBUG_INFO
    0x06: 4, // ANNOTATION
    0x07: 4, // PARAM_ANNOTATION
    0x08: 4, // TYPE_ANNOTATION
    0x09: 4, // RUNTIME_TYPE_ANNOTATION
};

export class PandaPatchError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PandaPatchError";
    }
}

/**
 * 生成随机 hook 全局名(默认 "__xpanda_hook_<12 位小写字母/数字>")。
 * 用于 AOP 注入时避免固定名字冲突/被识别。
 */
export function generateHookName(prefix = "__xpanda_hook"): string {
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
    let suffix = "";
    for (let i = 0; i < 12; i++) {
        suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return `${prefix}_${suffix}`;
}

export interface MethodCode {
    numVregs: number;
    numArgs: number;
    instructions: Uint8Array;
    tries: TryBlockInput[];
}

export interface AddMethodOptions {
    /** 新方法名 */
    name: string;
    /** 克隆哪个已有方法的方法实体(复用其 proto/access flags/tags);缺省取类的第一个带代码方法 */
    template?: string;
    /** 可选:同时写入新代码;缺省则沿用 template 的代码 */
    code?: MethodCodeInput;
}

export interface AddMethodResult {
    className: string;
    methodName: string;
    /** 新方法实体在文件中的绝对偏移 */
    methodOffset: number;
    /** 类索引表中的方法 id(可用于 call.* 指令) */
    methodId: number;
    /** 新代码项偏移(写入 code 时) */
    codeOffset?: number;
}

export interface AddStringIdResult {
    /** 类索引表中的实体 id(可用于 lda.str 等指令) */
    id: number;
    /** String 实体在文件中的绝对偏移 */
    offset: number;
}

export interface InsertInstructionsResult {
    className: string;
    methodName: string;
    /** 插入位置(原指令流的 PC) */
    atPC: number;
    /** 插入的字节数 */
    insertedLength: number;
    /** 新代码项偏移 */
    codeOffset: number;
    /** 插入后的完整指令流 */
    instructions: Uint8Array;
    /** patchMethodHead 使用的 hook 全局名(未显式指定时为随机生成) */
    hookGlobalName?: string;
}

export interface PatchMethodHeadSourceOptions {
    /** es2abc 可执行文件路径;缺省读 XPANDA_ES2ABC,再回退到仓库 assets/bin/<os>/es2abc[.exe] / PATH */
    es2abc?: string;
    /**
     * 目标 abc 的 filesInfo 行(不含 hook 行)。
     * 缺省从当前 abc 的 `L&...&;` record 推导(单 record 目标可直接工作;
     * 多 record 应用建议显式传入,字段格式见 build.sh)。
     */
    targetFilesInfo?: string[];
    /** hook module 的 record 名;缺省 `&xpanda/hook/<hookGlobalName>&` */
    hookRecordName?: string;
    /**
     * 目标 bytecode 版本对应的 es2abc `--target-api-version`。
     * 缺省按目标 abc 的版本自动映射(12.0.2.0→12、12.0.6.0→13、13.0.1.0→18、24.0.0.0→24),
     * 未知版本会探测 es2abc 的版本映射。
     */
    targetApiVersion?: number;
    /** 保留临时目录(调试用) */
    keepTemp?: boolean;
}

export interface PrepareMethodHeadOptions {
    /** 指定 hook 全局名;缺省随机生成 */
    hookGlobalName?: string;
}

interface MethodTags {
    codeValueOffset: number | null;
    debugInfoTagOffset: number | null;
    end: number;
}

interface ClassOverride {
    /** 当前类实体在文件中的偏移 */
    offset: number;
    /** 当前类实体字节 */
    bytes: Uint8Array;
    numMethods: number;
    /** 方法名 → 方法实体在类实体内的相对偏移 */
    methodRelativeOffsets: Map<string, number>;
}

interface PreparedTarget {
    className: string;
    methodName: string;
    /** async 方法:async 上下文寄存器(用于早退时 asyncfunctionresolve) */
    asyncContextRegister?: number;
    /** async 方法:前导插入 PC(在 asyncfunctionenter; sta vCtx 之后) */
    insertionPC?: number;
}

export interface InsertInstructionsOptions {
    /**
     * atPC 恰好等于 try 起点时,插入的代码是否归入 try:
     *   - "outside"(默认):try 起点后移,注入代码不在 try 内
     *   - "inside":try 起点不变、length 增加(注入代码在 try 内)
     */
    tryInclusion?: "outside" | "inside";
}

export class PandaPatchFile {
    private pf: PandaFile;
    private data: Uint8Array;
    /** 可增长的工作缓冲:初始为原文件副本,追加实体写在其后 */
    private bytes: Uint8Array;
    private size: number;
    /** 每个 IndexHeader 的区域终点(追加实体后需要扩展,否则实体落在区域外解析不到) */
    private readonly indexHeaderEnds = new Map<PandaClass["indexHeader"], number>();
    /** 已被重建过的类实体(addMethod 之后,后续修改必须基于最新副本) */
    private readonly classOverrides = new Map<PandaClass, ClassOverride>();
    /** 方法代码的内存覆盖(多次编辑时基于最新版本,而不是载入时快照) */
    private readonly methodCodeOverrides = new Map<PandaMethod, MethodCode>();
    /** prepareMethodHead 预约的 hook 名 → 目标方法列表(同一个 hook 可挂多个函数) */
    private readonly preparedMethodHeads = new Map<string, PreparedTarget[]>();

    private constructor(data: Uint8Array) {
        this.reset(data);
    }

    /** 载入 .abc 字节(会校验 magic/checksum) */
    static load(data: Uint8Array): PandaPatchFile {
        return new PandaPatchFile(data);
    }

    /** 从磁盘载入 .abc 文件 */
    static loadFile(filePath: string): PandaPatchFile {
        return new PandaPatchFile(new Uint8Array(fs.readFileSync(filePath)));
    }

    /** 用新的 abc 字节重置内部状态(merge 之后重新加载) */
    private reset(data: Uint8Array): void {
        const input = data.slice();
        this.pf = new PandaFile(input);
        this.data = input;
        this.size = input.length;
        this.bytes = new Uint8Array(input.length + 64 * 1024);
        this.bytes.set(input, 0);
        this.indexHeaderEnds.clear();
        this.classOverrides.clear();
        this.methodCodeOverrides.clear();
        this.entityTableState.clear();
        this.preparedMethodHeads.clear();
        for (const indexHeader of this.pf.indexHeaders) {
            this.indexHeaderEnds.set(indexHeader, indexHeader.end);
        }
    }

    /** 全部非 external 类名 */
    getClassNames(): string[] {
        return this.classes().map((clazz) => clazz.getClassName());
    }

    /** 某个类的全部非 external 方法名 */
    getMethodNames(className: string): string[] {
        const clazz = this.requireClass(className);
        const names: string[] = [];
        for (const [name, method] of clazz.pandaMethods) {
            if (!method.methodExternal) names.push(name);
        }
        return names;
    }

    hasMethod(className: string, methodName: string): boolean {
        const clazz = this.findClass(className);
        const method = clazz?.pandaMethods.get(methodName);
        return !!method && !method.methodExternal;
    }

    /** 读取方法代码(用于克隆/改写);方法无代码项时返回 null */
    getMethodCode(className: string, methodName: string): MethodCode | null {
        const method = this.requireMethod(className, methodName);
        const override = this.methodCodeOverrides.get(method);
        if (override) return cloneMethodCode(override);
        const code = method.methodCode;
        if (!code) return null;
        return {
            numVregs: code.numVregs,
            numArgs: code.numArgs,
            instructions: code.instructions.slice(),
            tries: (code.pandaMethodTryBlocks ?? []).map((tryBlock) => ({
                startPC: tryBlock.startPC,
                length: tryBlock.length,
                catches: tryBlock.pandaMethodCatchBlocks.map((catchBlock) => ({
                    typeIdx: catchBlock.typeIdx,
                    handlerPC: catchBlock.handlerPC,
                    codeSize: catchBlock.codeSize,
                })),
            })),
        };
    }

    /**
     * 替换方法实现:追加新 CodeItem,并原位改写方法实体的 CODE tag。
     * 方法原有的 debug info 保留(行号表可能过时,仅影响调试信息,不影响执行)。
     */
    replaceMethodCode(className: string, methodName: string, code: MethodCodeInput): { codeOffset: number } {
        const clazz = this.requireClass(className);
        const method = this.requireMethod(className, methodName);
        if (!method.methodCode) {
            throw new PandaPatchError(`method '${className}::${methodName}' has no code item`);
        }
        const tags = this.scanMethodTags(method.getOffset());
        if (tags.codeValueOffset === null) {
            throw new PandaPatchError(`method '${className}::${methodName}' has no CODE tag`);
        }
        const codeOffset = this.append(encodeMethodCode(code));
        this.patchU32(tags.codeValueOffset, codeOffset);
        this.methodCodeOverrides.set(method, cloneMethodCode({
            numVregs: code.numVregs,
            numArgs: code.numArgs,
            instructions: code.instructions,
            tries: code.tries,
        }));

        // 若类实体已被 addMethod 重建过,同步改写新副本里的方法实体
        const state = this.classOverrides.get(clazz);
        if (state) {
            const relativeOffset = state.methodRelativeOffsets.get(methodName);
            if (relativeOffset !== undefined) {
                const copyTags = this.scanMethodTagsIn(state.bytes, relativeOffset);
                if (copyTags.codeValueOffset !== null) {
                    this.patchU32(state.offset + copyTags.codeValueOffset, codeOffset);
                }
            }
        }
        return { codeOffset };
    }

    /**
     * 在方法的指定 PC 处插入一段已汇编的字节码。
     *
     * 自动完成:
     *   - 校验 atPC 是合法指令边界;
     *   - 修正所有相对跳转(插入点之后的源/目标整体平移);
     *   - 修正 try/catch 的 start/length/handlerPC;
     *   - 必要时抬高 numVregs。
     *
     * 限制:插入片段内部的相对跳转只能指向片段内部(或片段末尾);引用原有指令的
     * 跳转需要调用方自行按插入后位置计算,当前会直接拒绝。
     */
    insertInstructions(
        className: string,
        methodName: string,
        atPC: number,
        bytecode: Uint8Array,
        options: InsertInstructionsOptions = {},
    ): InsertInstructionsResult {
        const current = this.getMethodCode(className, methodName);
        if (!current) throw new PandaPatchError(`method '${className}::${methodName}' has no code item`);

        const original = current.instructions;
        const decoded = decodeInstructions(original);
        if (atPC < 0 || atPC > original.length) {
            throw new PandaPatchError(`atPC ${atPC} is out of range [0, ${original.length}]`);
        }
        if (atPC !== original.length && !decoded.some((instruction) => instruction.pc === atPC)) {
            throw new PandaPatchError(`atPC ${atPC} is not an instruction boundary`);
        }

        // 插入片段内部只允许自包含的相对跳转(片段末尾 == 插入点之后的第一条原有指令)
        const insertedDecoded = decodeInstructions(bytecode);
        for (const instruction of insertedDecoded) {
            if (instruction.jumpImmediateOffset === undefined) continue;
            const width = instruction.jumpBits! / 8;
            const target = instruction.pc + readSignedLE(bytecode, instruction.pc + instruction.jumpImmediateOffset, width);
            if (target < 0 || target > bytecode.length) {
                throw new PandaPatchError(
                    `inserted snippet jumps outside itself (pc ${instruction.pc} -> ${target}); only self-contained jumps are supported`);
            }
        }
        const insertedLength = bytecode.length;
        const newInstructions = new Uint8Array(original.length + insertedLength);
        newInstructions.set(original.subarray(0, atPC), 0);
        newInstructions.set(bytecode, atPC);
        newInstructions.set(original.subarray(atPC), atPC + insertedLength);

        const mapPC = (pc: number): number => (pc < atPC ? pc : pc + insertedLength);

        // 修正原方法中的相对跳转:target = pc + imm,插入点之后的源和目标一起平移
        for (const instruction of decoded) {
            if (instruction.jumpImmediateOffset === undefined) continue;
            const width = instruction.jumpBits! / 8;
            const oldImmediate = readSignedLE(original, instruction.pc + instruction.jumpImmediateOffset, width);
            const oldTarget = instruction.pc + oldImmediate;
            if (oldTarget < 0 || oldTarget > original.length) {
                throw new PandaPatchError(`jump at pc ${instruction.pc} targets ${oldTarget}, outside the method`);
            }
            const newPC = mapPC(instruction.pc);
            const newTarget = mapPC(oldTarget);
            const newImmediate = newTarget - newPC;
            if (!signedFits(newImmediate, instruction.jumpBits!)) {
                throw new PandaPatchError(
                    `jump at pc ${instruction.pc} cannot reach ${newTarget} after insertion (need ${newImmediate})`);
            }
            writeSignedLE(newInstructions, newPC + instruction.jumpImmediateOffset, width, newImmediate);
        }

        // 修正 try/catch:插入点落在 try 内部时长度增加;恰在起点时按 tryInclusion 决定归属
        const newTries: TryBlockInput[] = (current.tries ?? []).map((tryBlock) => {
            const oldEnd = tryBlock.startPC + tryBlock.length;
            let newStart = tryBlock.startPC;
            let newLength = tryBlock.length;
            if (atPC < tryBlock.startPC) {
                newStart += insertedLength;
            } else if (atPC === tryBlock.startPC) {
                if (options.tryInclusion === "inside") newLength += insertedLength;
                else newStart += insertedLength;
            } else if (atPC < oldEnd) {
                newLength += insertedLength;
            }
            return {
                startPC: newStart,
                length: newLength,
                catches: tryBlock.catches.map((catchBlock) => ({
                    typeIdx: catchBlock.typeIdx,
                    handlerPC: mapPC(catchBlock.handlerPC),
                    codeSize: catchBlock.codeSize,
                })),
            };
        });

        // 插入代码可能使用更高的寄存器
        let numVregs = current.numVregs;
        for (const instruction of insertedDecoded) {
            instruction.opcode.operands.forEach((operand, index) => {
                if (operand.kind === "v") {
                    const register = instruction.operands[index];
                    if (register + 1 > numVregs) numVregs = register + 1;
                }
            });
        }

        const { codeOffset } = this.replaceMethodCode(className, methodName, {
            numVregs,
            numArgs: current.numArgs,
            instructions: newInstructions,
            tries: newTries,
        });
        return { className, methodName, atPC, insertedLength, codeOffset, instructions: newInstructions };
    }

    /**
     * 内部:在已 merge 的 abc 上插入 gadget 前导(hook 已由 patchMethodHead 编译并合并)。
     */
    private applyMethodHeadPrologue(
        className: string,
        methodName: string,
        hookGlobalName: string,
        asyncContextRegister?: number,
        insertionPC = 0,
    ): InsertInstructionsResult {
        const current = this.getMethodCode(className, methodName);
        if (!current) throw new PandaPatchError(`method '${className}::${methodName}' has no code item`);

        // 选两个局部寄存器做临时寄存器;避开 async 上下文寄存器,不够时扩帧
        const excluded = asyncContextRegister !== undefined ? new Set([asyncContextRegister]) : new Set<number>();
        const collectFree = (count: number, from: number): number[] => {
            const registers: number[] = [];
            for (let register = from; register < count; register++) {
                if (!excluded.has(register)) registers.push(register);
            }
            return registers;
        };
        let numVregs = current.numVregs;
        let preparedInstructions = current.instructions;
        let preparedTries = current.tries ?? [];
        let free = collectFree(numVregs, 0);
        const delta = Math.max(0, 2 - free.length);
        if (delta > 0) {
            const grown = this.growFrame(current, delta);
            preparedInstructions = grown.instructions;
            preparedTries = grown.tries;
            const oldNumVregs = numVregs;
            numVregs += delta;
            this.replaceMethodCode(className, methodName, {
                numVregs,
                numArgs: current.numArgs,
                instructions: preparedInstructions,
                tries: preparedTries,
            });
            free = free.concat(collectFree(numVregs, oldNumVregs));
        }

        const { id: hookStringId } = this.addStringId(className, hookGlobalName);

        // IC slot 分配(tryldglobalbyname 1 槽,ldobjbyvalue 2 槽,stricteq 1 槽)
        let base = maxIcSlot(preparedInstructions) + 1;
        if (base + 8 > 250) base = 0;
        let nextSlot = base;
        const takeSlots = (count: number): number => {
            const slot = nextSlot;
            nextSlot += count;
            return slot;
        };
        const slotGlobal = takeSlots(1);
        const slotObject0 = takeSlots(2);
        const slotStrictEq = takeSlots(1);
        const slotObject1 = takeSlots(2);

        const vResult = free[0];
        const vTemp = free[1];
        const head = concatBytes([
            assemble("getunmappedargs"),
            assembleInstruction("sta", [vResult]),
            assembleInstruction("tryldglobalbyname", [slotGlobal, hookStringId]),
            assembleInstruction("callarg1", [1, vResult]),
            assembleInstruction("sta", [vResult]),
            assemble("ldai 0"),
            assembleInstruction("ldobjbyvalue", [slotObject0, vResult]),
            assembleInstruction("sta", [vTemp]),
            assemble("ldai 0"),
            assembleInstruction("stricteq", [slotStrictEq, vTemp]),
        ]);
        const earlyReturn: Uint8Array[] = [
            assemble("ldai 1"),
            assembleInstruction("ldobjbyvalue", [slotObject1, vResult]),
        ];
        if (asyncContextRegister !== undefined) {
            // async 函数的 return 必须先 resolve 成 Promise
            earlyReturn.push(assembleInstruction("asyncfunctionresolve", [asyncContextRegister]));
        }
        earlyReturn.push(assemble("return"));
        const tail = concatBytes(earlyReturn);
        // jeqz 的相对偏移 = jeqz 自身长度 + 早退块长度,目标为插入片段末尾(原方法第一条指令)
        const jump = assembleInstruction("jeqz", [2 + tail.length]);
        const snippet = concatBytes([head, jump, tail]);
        const result = this.insertInstructions(className, methodName, insertionPC, snippet, {
            tryInclusion: asyncContextRegister !== undefined ? "inside" : "outside",
        });
        return { ...result, hookGlobalName };
    }

    /**
     * 两段式 AOP 第一步:校验目标方法并预约 hook 名。
     * 同一个 hook 名可以对多个方法各调用一次(显式传同一个 hookGlobalName);
     * 不传时每次生成新的随机名。返回值既用作 hook 函数名,也用作注入代码查找的全局名。
     */
    prepareMethodHead(className: string, methodName: string, options: PrepareMethodHeadOptions = {}): string {
        const current = this.getMethodCode(className, methodName);
        if (!current) throw new PandaPatchError(`method '${className}::${methodName}' has no code item`);
        const decoded = decodeInstructions(current.instructions);
        if (decoded.some((instruction) => /^(creategeneratorobj|generator)/.test(instruction.opcode.name))) {
            throw new PandaPatchError("patchMethodHead does not support generator functions");
        }

        // async 函数:前导插在 `asyncfunctionenter; sta vCtx` 之后,早退用 asyncfunctionresolve
        let asyncContextRegister: number | undefined;
        let insertionPC: number | undefined;
        const asyncIndex = decoded.findIndex((instruction) => instruction.opcode.name === "asyncfunctionenter");
        if (asyncIndex >= 0) {
            const store = decoded[asyncIndex + 1];
            if (!store || store.opcode.name !== "sta" || store.operands.length !== 1) {
                throw new PandaPatchError("unsupported async prologue shape (expected `asyncfunctionenter; sta vCtx`)");
            }
            asyncContextRegister = store.operands[0];
            if (asyncContextRegister >= current.numVregs) {
                throw new PandaPatchError("async context register is not a local register");
            }
            const after = decoded[asyncIndex + 2];
            insertionPC = after ? after.pc : current.instructions.length;
        }

        let hookGlobalName = options.hookGlobalName;
        if (hookGlobalName === undefined) {
            do {
                hookGlobalName = generateHookName();
            } while (this.preparedMethodHeads.has(hookGlobalName));
        }
        let targets = this.preparedMethodHeads.get(hookGlobalName);
        if (!targets) {
            targets = [];
            this.preparedMethodHeads.set(hookGlobalName, targets);
        }
        if (targets.some((target) => target.className === className && target.methodName === methodName)) {
            throw new PandaPatchError(`method '${className}::${methodName}' is already prepared for hook '${hookGlobalName}'`);
        }
        targets.push({ className, methodName, asyncContextRegister, insertionPC });
        return hookGlobalName;
    }

    /**
     * 两段式 AOP 第二步:编译 hook 源码 → 与当前 abc merge → 重新加载 → 给所有预约的方法插入前导。
     * 同一个 hook 名预约了多个方法时,这里只编译/merge 一次,然后逐个插入。
     */
    patchMethodHeads(hookGlobalName: string, hookSource: string, options: PatchMethodHeadSourceOptions = {}): InsertInstructionsResult[] {
        const targets = this.preparedMethodHeads.get(hookGlobalName);
        if (!targets || targets.length === 0) {
            throw new PandaPatchError(`unknown hook name '${hookGlobalName}'; call prepareMethodHead first`);
        }
        const es2abc = resolveEs2abc(options.es2abc);
        // hook / merge 必须使用与目标 abc 相同的字节码版本,否则 merge 会把结果升级到工具默认版本
        const targetBcVersion = this.pf.header.versionString();
        const targetApiVersion = resolveTargetApiVersion(es2abc, targetBcVersion, options.targetApiVersion);
        const apiVersionArgs = ["--target-api-version", String(targetApiVersion)];
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "panda-asm-"));
        try {
            // 1) 编译 hook module(与目标同一 bytecode 版本)
            const hookSourcePath = path.join(tempDir, "hook.js");
            fs.writeFileSync(hookSourcePath, buildHookModuleSource(hookGlobalName, hookSource));
            const hookAbcPath = path.join(tempDir, "hook.abc");
            const hookRecordName = options.hookRecordName ?? `&xpanda/hook/${hookGlobalName}&`;
            runEs2abc(es2abc, [
                "--module", "--merge-abc", ...apiVersionArgs,
                "--record-name", hookRecordName,
                "--output", hookAbcPath,
                hookSourcePath,
            ]);

            // 2) merge 当前 abc + hook.abc
            const baseAbcPath = path.join(tempDir, "base.abc");
            fs.writeFileSync(baseAbcPath, this.toBytes());
            const targetLines = options.targetFilesInfo ?? this.deriveTargetFilesInfo(baseAbcPath);
            if (targetLines.length === 0) {
                throw new PandaPatchError(
                    "cannot derive target filesInfo from this abc (no `L&...&;` records); pass targetFilesInfo explicitly");
            }
            const hookImportPath = `xpanda/hook/${hookGlobalName}.js`;
            const filesInfoPath = path.join(tempDir, "filesInfo.txt");
            fs.writeFileSync(filesInfoPath, [
                ...targetLines,
                `${hookAbcPath};${hookRecordName};esm;entry|entry|1.0.0|${hookImportPath};entry;false;js`,
            ].join("\n") + "\n");

            const mergedAbcPath = path.join(tempDir, "merged.abc");
            runEs2abc(es2abc, [
                "--module", "--merge-abc", "--enable-abc-input", ...apiVersionArgs,
                "--output", mergedAbcPath,
                `@${filesInfoPath}`,
            ]);

            // 3) 校验版本未被升级;保留其它已预约的 hook,然后用 merge 结果重置
            const merged = new Uint8Array(fs.readFileSync(mergedAbcPath));
            const mergedVersion = `${merged[12]}.${merged[13]}.${merged[14]}.${merged[15]}`;
            if (mergedVersion !== targetBcVersion) {
                throw new PandaPatchError(
                    `merged bytecode version ${mergedVersion} does not match target ${targetBcVersion}; `
                    + "pass targetApiVersion explicitly");
            }
            const remaining = new Map(this.preparedMethodHeads);
            remaining.delete(hookGlobalName);
            this.reset(merged);
            for (const [name, list] of remaining) {
                this.preparedMethodHeads.set(name, list);
            }
            return targets.map((target) => this.applyMethodHeadPrologue(
                target.className,
                target.methodName,
                hookGlobalName,
                target.asyncContextRegister,
                target.insertionPC ?? 0,
            ));
        } finally {
            if (options.keepTemp) {
                console.log(`[panda-asm] temp dir kept: ${tempDir}`);
            } else {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        }
    }

    /**
     * 单个目标版本的 patchMethodHeads(只返回第一个结果)。
     * 给同一个 hook 预约了多个方法时请用 patchMethodHeads 拿到全部结果。
     */
    patchMethodHead(hookGlobalName: string, hookSource: string, options: PatchMethodHeadSourceOptions = {}): InsertInstructionsResult {
        return this.patchMethodHeads(hookGlobalName, hookSource, options)[0];
    }

    /**
     * 从当前 abc 的 merged 风格 record(`L&...&;`)推导 filesInfo 行。
     * 只适用于单 module 的简单目标;多 record 应用请显式传 targetFilesInfo。
     */
    private deriveTargetFilesInfo(baseAbcPath: string): string[] {
        const records = new Set<string>();
        for (const clazz of this.classes()) {
            const match = /^L(&[^;]+&);$/.exec(clazz.getClassName());
            if (!match) continue;
            // 已合并进来的 hook record 不再作为目标输入
            if (match[1].startsWith("&xpanda/hook/")) continue;
            records.add(match[1]);
        }
        const lines: string[] = [];
        for (const record of records) {
            const content = record.slice(1, -1); // strip &...&
            const moduleName = content.split("/")[0] || "entry";
            const importPath = `${content}.js`;
            lines.push(`${baseAbcPath};${record};esm;entry|${moduleName}|1.0.0|${importPath};${moduleName};false;js`);
        }
        return lines;
    }

    /**
     * 新增方法:克隆一个模板方法实体(复用 proto/access flags),追加方法名与代码,
     * 重建类实体并重定位,最后把新方法登记到类索引表(返回可用于 call 指令的 id)。
     */
    addMethod(className: string, options: AddMethodOptions): AddMethodResult {
        const clazz = this.requireClass(className);
        const state = this.getClassOverride(clazz);
        if (state.methodRelativeOffsets.has(options.name)) {
            throw new PandaPatchError(`method '${className}::${options.name}' already exists`);
        }
        // 追加的实体落在最后一个 index section 的区域里;多 region 文件暂不支持(会覆盖后续 region 的解析)
        const lastIndexHeader = this.pf.indexHeaders[this.pf.indexHeaders.length - 1];
        if (clazz.indexHeader !== lastIndexHeader) {
            throw new PandaPatchError("addMethod is not supported for files with multiple index sections (class is not in the last one)");
        }
        const template = this.pickTemplate(clazz, options.template);
        const templateTags = this.scanMethodTags(template.getOffset());
        if (options.code && templateTags.codeValueOffset === null) {
            throw new PandaPatchError(`template method '${className}::${template.name.content}' has no CODE tag`);
        }

        const nameOffset = this.append(encodeStringEntity(options.name));
        const codeOffset = options.code ? this.append(encodeMethodCode(options.code)) : undefined;
        const entry = this.buildMethodEntry(template, {
            nameOffset,
            codeOffset,
            dropDebugInfo: true,
        });

        const { bytes: newClassBytes, newMethodRelativeOffset } = this.buildClassWithAppendedMethod(clazz, options.name, entry);
        const newClassOffset = this.appendAndRelocateClass(clazz, newClassBytes);
        const methodOffset = newClassOffset + newMethodRelativeOffset;
        const methodId = this.appendMethodIndex(clazz.indexHeader, methodOffset);

        return { className, methodName: options.name, methodOffset, methodId, codeOffset };
    }

    /** 追加一个 String 实体,返回其绝对偏移(可作方法名等直接引用) */
    addString(text: string): number {
        return this.append(encodeStringEntity(text));
    }

    /** 追加一个 String 实体并登记到类的实体索引表,返回可用于指令的 id */
    addStringId(className: string, text: string): AddStringIdResult {
        const clazz = this.requireClass(className);
        const offset = this.append(encodeStringEntity(text));
        const id = this.appendMethodIndex(clazz.indexHeader, offset);
        return { id, offset };
    }

    /**
     * 写回完整 .abc 字节:更新 file_size、重算 checksum。
     * 不修改内部分配的实体。
     */
    toBytes(): Uint8Array {
        for (const [indexHeader, end] of this.indexHeaderEnds) {
            if (end !== indexHeader.end) {
                this.patchU32(this.indexHeaderRecordOffset(indexHeader) + 4, end);
            }
        }
        this.patchU32(HEADER_FILE_SIZE_OFF, this.size);
        const out = this.bytes.slice(0, this.size);
        const checksum = this.computeChecksum(out);
        writeU32(out, HEADER_CHECKSUM_OFF, checksum);
        return out;
    }

    // ---------------------------------------------------------------- internal

    private classes(): PandaClass[] {
        const result: PandaClass[] = [];
        for (const indexHeader of this.pf.indexHeaders) {
            for (const clazz of indexHeader.pandaClasses) {
                if (!clazz.classExternal) result.push(clazz);
            }
        }
        return result;
    }

    private findClass(className: string): PandaClass | null {
        for (const clazz of this.classes()) {
            if (clazz.getClassName() === className) return clazz;
        }
        return null;
    }

    private requireClass(className: string): PandaClass {
        const clazz = this.findClass(className);
        if (!clazz) throw new PandaPatchError(`class '${className}' not found`);
        return clazz;
    }

    private requireMethod(className: string, methodName: string): PandaMethod {
        const clazz = this.requireClass(className);
        const method = clazz.pandaMethods.get(methodName);
        if (!method) throw new PandaPatchError(`method '${className}::${methodName}' not found`);
        if (method.methodExternal) throw new PandaPatchError(`method '${className}::${methodName}' is external`);
        return method;
    }

    private pickTemplate(clazz: PandaClass, templateName?: string): PandaMethod {
        if (templateName !== undefined) {
            return this.requireMethod(clazz.getClassName(), templateName);
        }
        for (const method of clazz.pandaMethods.values()) {
            if (!method.methodExternal && method.methodCode) return method;
        }
        throw new PandaPatchError(`class '${clazz.getClassName()}' has no method with code to use as template`);
    }

    /** 扫描方法实体的 tag 区,定位 CODE tag 的 u32 载荷位置。 */
    private scanMethodTags(methodOffset: number): MethodTags {
        return this.scanMethodTagsIn(this.data, methodOffset);
    }

    /** 在给定字节数组的 entryOffset 处扫描方法实体 tag 区 */
    private scanMethodTagsIn(bytes: Uint8Array, entryOffset: number): MethodTags {
        let pos = entryOffset + 2 + 2 + 4; // class_idx + proto_idx + name
        const flags = readUleb128(bytes, pos);
        pos += flags.size;
        let codeValueOffset: number | null = null;
        let debugInfoTagOffset: number | null = null;
        while (true) {
            if (pos >= bytes.length) {
                throw new PandaPatchError(`method entity at ${entryOffset} overruns buffer`);
            }
            const tag = bytes[pos];
            if (tag === 0x00) {
                pos += 1;
                break;
            }
            const payloadSize = METHOD_TAG_PAYLOAD_SIZE[tag];
            if (payloadSize === undefined) {
                throw new PandaPatchError(`unsupported method tag 0x${tag.toString(16)} at ${pos}`);
            }
            if (tag === METHOD_TAG_CODE) codeValueOffset = pos + 1;
            if (tag === METHOD_TAG_DEBUG_INFO) debugInfoTagOffset = pos;
            pos += 1 + payloadSize;
        }
        return { codeValueOffset, debugInfoTagOffset, end: pos };
    }

    /**
     * 以模板方法实体为底重建方法实体:
     *   - 可替换 name/CODE 偏移
     *   - 可移除 DEBUG_INFO tag
     */
    private buildMethodEntry(
        template: PandaMethod,
        options: { nameOffset?: number; codeOffset?: number; dropDebugInfo?: boolean },
    ): Uint8Array {
        const offset = template.getOffset();
        const head = this.data.slice(offset, offset + 8); // class_idx, proto_idx, name
        if (options.nameOffset !== undefined) writeU32(head, 4, options.nameOffset);
        const parts: Uint8Array[] = [head];

        let pos = offset + 8;
        const flags = readUleb128(this.data, pos);
        parts.push(this.data.slice(pos, pos + flags.size));
        pos += flags.size;

        while (true) {
            const tag = this.data[pos];
            if (tag === 0x00) {
                parts.push(Uint8Array.of(0));
                break;
            }
            const payloadSize = METHOD_TAG_PAYLOAD_SIZE[tag];
            if (payloadSize === undefined) {
                throw new PandaPatchError(`unsupported method tag 0x${tag.toString(16)} at ${pos}`);
            }
            const whole = this.data.slice(pos, pos + 1 + payloadSize);
            if (options.dropDebugInfo && tag === METHOD_TAG_DEBUG_INFO) {
                pos += 1 + payloadSize;
                continue;
            }
            if (tag === METHOD_TAG_CODE && options.codeOffset !== undefined) {
                writeU32(whole, 1, options.codeOffset);
            }
            parts.push(whole);
            pos += 1 + payloadSize;
        }
        return concatBytes(parts);
    }

    /** 计算类实体字节中 num_methods 这个 uleb128 字段的相对偏移 */
    private classNumMethodsFieldOffsetIn(bytes: Uint8Array, nameSize: number): number {
        let pos = nameSize;
        pos += 4; // super_class_off
        pos += readUleb128(bytes, pos).size; // access_flags
        pos += readUleb128(bytes, pos).size; // num_fields
        return pos;
    }

    /** 取(或初始化)类的当前实体状态;addMethod 之后后续修改都基于最新副本 */
    private getClassOverride(clazz: PandaClass): ClassOverride {
        let state = this.classOverrides.get(clazz);
        if (!state) {
            const methodRelativeOffsets = new Map<string, number>();
            for (const [name, method] of clazz.pandaMethods) {
                methodRelativeOffsets.set(name, method.getOffset() - clazz.getOffset());
            }
            state = {
                offset: clazz.getOffset(),
                bytes: this.data.slice(clazz.getOffset(), clazz.getOffset() + clazz.index),
                numMethods: clazz.numMethods,
                methodRelativeOffsets,
            };
            this.classOverrides.set(clazz, state);
        }
        return state;
    }

    /**
     * 在类实体副本末尾追加一个方法实体;返回新类实体字节与新方法实体的相对偏移。
     */
    private buildClassWithAppendedMethod(
        clazz: PandaClass,
        methodName: string,
        methodEntry: Uint8Array,
    ): { bytes: Uint8Array; newMethodRelativeOffset: number } {
        const state = this.getClassOverride(clazz);
        const raw = state.bytes;
        const numMethodsRelative = this.classNumMethodsFieldOffsetIn(raw, clazz.name.getSize());
        const oldCount = readUleb128(raw, numMethodsRelative);
        const newCountBytes = writeUleb128(state.numMethods + 1);
        const before = raw.subarray(0, numMethodsRelative);
        const after = raw.subarray(numMethodsRelative + oldCount.size);
        const baseLength = before.length + newCountBytes.length + after.length;
        const out = new Uint8Array(baseLength + methodEntry.length);
        out.set(before, 0);
        out.set(newCountBytes, before.length);
        out.set(after, before.length + newCountBytes.length);
        out.set(methodEntry, baseLength);

        // num_methods 的 uleb 长度变化会让其后所有方法实体整体平移
        const shift = newCountBytes.length - oldCount.size;
        if (shift !== 0) {
            for (const [name, relative] of state.methodRelativeOffsets) {
                state.methodRelativeOffsets.set(name, relative + shift);
            }
        }
        state.methodRelativeOffsets.set(methodName, baseLength);
        state.bytes = out;
        state.numMethods += 1;
        return { bytes: out, newMethodRelativeOffset: baseLength };
    }

    /**
     * 扩帧:新增 delta 个局部寄存器,所有参数寄存器索引整体后移 delta。
     * 受宽度影响的指令(4-bit → 8-bit 等)会重新编码,并修正跳转与 try/catch。
     */
    private growFrame(code: MethodCode, delta: number): { instructions: Uint8Array; tries: TryBlockInput[] } {
        const decoded = decodeInstructions(code.instructions);
        const oldNumVregs = code.numVregs;
        interface FrameItem {
            oldPC: number;
            opcode: OpcodeInfo;
            /** 已按 delta 平移后的操作数(跳转的 imm 仍是原值) */
            operands: number[];
            isJump: boolean;
            immIndex: number;
            bytes: Uint8Array;
        }
        const items: FrameItem[] = [];
        for (const instruction of decoded) {
            if ((instruction.opcode.flags & (OPCODE_FLAG.RANGE_0 | OPCODE_FLAG.RANGE_1)) !== 0) {
                this.assertRangeDoesNotCrossFrameBoundary(instruction, oldNumVregs);
            }
            const shifted = instruction.operands.map((value, index) => {
                const operand = instruction.opcode.operands[index];
                return operand.kind === "v" && value >= oldNumVregs ? value + delta : value;
            });
            let immIndex = -1;
            instruction.opcode.operands.forEach((operand, index) => {
                if (operand.kind === "imm") immIndex = index;
            });
            items.push({
                oldPC: instruction.pc,
                opcode: instruction.opcode,
                operands: shifted,
                isJump: instruction.jumpImmediateOffset !== undefined,
                immIndex,
                bytes: encodeWithFallback(instruction.opcode, shifted),
            });
        }

        for (let round = 0; round < 16; round++) {
            const newPCs: number[] = [];
            let total = 0;
            for (const item of items) {
                newPCs.push(total);
                total += item.bytes.length;
            }
            const boundaryMap = new Map<number, number>();
            items.forEach((item, index) => boundaryMap.set(item.oldPC, newPCs[index]));
            boundaryMap.set(code.instructions.length, total);

            let changed = false;
            for (let index = 0; index < items.length; index++) {
                const item = items[index];
                if (!item.isJump) continue;
                const oldTarget = item.oldPC + item.operands[item.immIndex];
                const newTarget = boundaryMap.get(oldTarget);
                if (newTarget === undefined) {
                    throw new PandaPatchError(`jump at pc ${item.oldPC} targets non-boundary ${oldTarget}`);
                }
                const newImmediate = newTarget - newPCs[index];
                const values = item.operands.slice();
                values[item.immIndex] = newImmediate;
                const bytes = encodeWithFallback(item.opcode, values);
                if (!sameBytes(bytes, item.bytes)) {
                    item.bytes = bytes;
                    changed = true;
                }
            }
            if (changed) continue;

            const instructions = new Uint8Array(total);
            let cursor = 0;
            for (const item of items) {
                instructions.set(item.bytes, cursor);
                cursor += item.bytes.length;
            }
            const tries = (code.tries ?? []).map((tryBlock) => {
                const start = boundaryMap.get(tryBlock.startPC);
                const end = boundaryMap.get(tryBlock.startPC + tryBlock.length);
                if (start === undefined || end === undefined) {
                    throw new PandaPatchError(
                        `try block [${tryBlock.startPC}, ${tryBlock.startPC + tryBlock.length}) does not align with instruction boundaries`);
                }
                return {
                    startPC: start,
                    length: end - start,
                    catches: tryBlock.catches.map((catchBlock) => {
                        const handler = boundaryMap.get(catchBlock.handlerPC);
                        if (handler === undefined) {
                            throw new PandaPatchError(`catch handler ${catchBlock.handlerPC} is not an instruction boundary`);
                        }
                        return { typeIdx: catchBlock.typeIdx, handlerPC: handler, codeSize: catchBlock.codeSize };
                    }),
                };
            });
            return { instructions, tries };
        }
        throw new PandaPatchError("frame adjustment did not stabilize");
    }

    /** 扩帧时 range 指令不能跨越 局部寄存器/参数寄存器 分界(否则平移后不再连续) */
    private assertRangeDoesNotCrossFrameBoundary(instruction: DecodedInstruction, oldNumVregs: number): void {
        let base: number | undefined;
        let count: number | undefined;
        instruction.opcode.operands.forEach((operand, index) => {
            if (operand.kind === "v" && base === undefined) base = instruction.operands[index];
            if (operand.kind === "imm") count = instruction.operands[index];
        });
        if (base !== undefined && count !== undefined && base < oldNumVregs && base + count > oldNumVregs) {
            throw new PandaPatchError(
                `method contains range instruction '${instruction.opcode.name}' crossing the locals/params boundary; `
                + "frame growth is not supported for this method");
        }
    }

    /** 追加新类实体,并把所有指向旧类实体的索引表项改成新偏移 */
    private appendAndRelocateClass(clazz: PandaClass, newClassBytes: Uint8Array): number {
        const state = this.getClassOverride(clazz);
        const oldOffset = state.offset;
        const newOffset = this.append(newClassBytes);
        this.patchClassTable(this.pf.header.classIdxOff, this.pf.header.numClasses, oldOffset, newOffset);
        for (const indexHeader of this.pf.indexHeaders) {
            this.patchClassTable(indexHeader.classIdxOff, indexHeader.classIdxSize, oldOffset, newOffset);
        }
        state.offset = newOffset;
        this.extendRegion(clazz.indexHeader, newOffset + newClassBytes.length);
        return newOffset;
    }

    /** 扩展 IndexHeader 的 [start,end) 区域,让追加的实体能被 resolveIndexHeaderByOffset 解析到 */
    private extendRegion(indexHeader: PandaClass["indexHeader"], end: number): void {
        const current = this.indexHeaderEnds.get(indexHeader) ?? indexHeader.end;
        if (end > current) this.indexHeaderEnds.set(indexHeader, end);
    }

    private patchClassTable(tableOffset: number, count: number, oldOffset: number, newOffset: number): void {
        for (let i = 0; i < count; i++) {
            const entryOffset = tableOffset + i * 4;
            if (this.readU32(entryOffset) === oldOffset) {
                this.patchU32(entryOffset, newOffset);
            }
        }
    }

    /** 每个 IndexHeader 的实体索引表当前状态(多次扩展后 parsed 对象里的 size 已过时) */
    private readonly entityTableState = new Map<PandaClass["indexHeader"], { offset: number; size: number }>();

    /**
     * 把实体偏移追加到类的实体索引表(method/string/literal 共用),
     * 返回新 id;表整体搬到文件末尾,并改写 IndexHeader 的 size/off 字段。
     */
    private appendMethodIndex(indexHeader: PandaClass["indexHeader"], entityOffset: number): number {
        let state = this.entityTableState.get(indexHeader);
        if (!state) {
            if (indexHeader.methodIdxSize === 0 || indexHeader.methodIdxOff === 0xffffffff) {
                throw new PandaPatchError("class has no entity index table to extend");
            }
            state = { offset: indexHeader.methodIdxOff, size: indexHeader.methodIdxSize };
            this.entityTableState.set(indexHeader, state);
        }
        const count = state.size;
        const table = new Uint8Array((count + 1) * 4);
        for (let i = 0; i < count; i++) {
            writeU32(table, i * 4, this.readU32(state.offset + i * 4));
        }
        writeU32(table, count * 4, entityOffset);
        const newTableOffset = this.append(table);

        const recordOffset = this.indexHeaderRecordOffset(indexHeader);
        this.patchU32(recordOffset + INDEX_HEADER_METHOD_IDX_SIZE_OFF, count + 1);
        this.patchU32(recordOffset + INDEX_HEADER_METHOD_IDX_OFF_OFF, newTableOffset);
        state.offset = newTableOffset;
        state.size = count + 1;
        return count;
    }

    private indexHeaderRecordOffset(indexHeader: PandaClass["indexHeader"]): number {
        const index = this.pf.indexHeaders.indexOf(indexHeader);
        if (index < 0) throw new PandaPatchError("index header not owned by this file");
        return this.pf.header.indexSectionOff + index * INDEX_HEADER_SIZE;
    }

    private computeChecksum(bytes: Uint8Array): number {
        const adler32 = new Adler32();
        adler32.update(bytes, HEADER_VERSION_OFF, bytes.length - HEADER_VERSION_OFF);
        // 运行时校验用完整 Adler32(libpandafile ValidateChecksum),不能 mask
        return adler32.getValue();
    }

    // ---------------------------------------------------------------- buffer io

    private ensure(capacity: number): void {
        if (capacity <= this.bytes.length) return;
        let next = this.bytes.length;
        while (next < capacity) next *= 2;
        const grown = new Uint8Array(next);
        grown.set(this.bytes.subarray(0, this.size), 0);
        this.bytes = grown;
    }

    private append(part: Uint8Array): number {
        while (this.size % 4 !== 0) {
            this.ensure(this.size + 1);
            this.bytes[this.size++] = 0;
        }
        const offset = this.size;
        this.ensure(offset + part.length);
        this.bytes.set(part, offset);
        this.size += part.length;
        return offset;
    }

    private readU32(offset: number): number {
        const b = this.bytes;
        return (b[offset] | (b[offset + 1] << 8) | (b[offset + 2] << 16) | (b[offset + 3] << 24)) >>> 0;
    }

    private patchU32(offset: number, value: number): void {
        this.ensure(offset + 4);
        writeU32(this.bytes, offset, value);
    }
}

function writeU32(target: Uint8Array, offset: number, value: number): void {
    target[offset] = value & 0xff;
    target[offset + 1] = (value >>> 8) & 0xff;
    target[offset + 2] = (value >>> 16) & 0xff;
    target[offset + 3] = (value >>> 24) & 0xff;
}

function readSignedLE(bytes: Uint8Array, offset: number, width: number): number {
    if (width === 1) return (bytes[offset] << 24) >> 24;
    if (width === 2) return ((bytes[offset] | (bytes[offset + 1] << 8)) << 16) >> 16;
    if (width === 4) {
        return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24));
    }
    throw new PandaPatchError(`unsupported jump immediate width ${width}`);
}

function writeSignedLE(target: Uint8Array, offset: number, width: number, value: number): void {
    if (width === 1) {
        target[offset] = value & 0xff;
    } else if (width === 2) {
        target[offset] = value & 0xff;
        target[offset + 1] = (value >> 8) & 0xff;
    } else if (width === 4) {
        writeU32(target, offset, value);
    } else {
        throw new PandaPatchError(`unsupported jump immediate width ${width}`);
    }
}

function signedFits(value: number, bits: number): boolean {
    const limit = 2 ** (bits - 1);
    return value >= -limit && value < limit;
}

function cloneMethodCode(code: MethodCode): MethodCode {
    return {
        numVregs: code.numVregs,
        numArgs: code.numArgs,
        instructions: code.instructions.slice(),
        tries: (code.tries ?? []).map((tryBlock) => ({
            startPC: tryBlock.startPC,
            length: tryBlock.length,
            catches: tryBlock.catches.map((catchBlock) => ({ ...catchBlock })),
        })),
    };
}

/** 优先按原变体编码;寄存器位宽不够时退化为自动选择变体 */
function encodeWithFallback(opcode: OpcodeInfo, operands: number[]): Uint8Array {
    try {
        return encodeInstructionWithOpcode(opcode, operands);
    } catch {
        return assembleInstruction(opcode.name, operands);
    }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

/** 方法内已使用的最大 IC slot(用于在方法头插入代码时分配新 slot) */
function maxIcSlot(instructions: Uint8Array): number {
    let max = -1;
    for (const instruction of decodeInstructions(instructions)) {
        if ((instruction.opcode.flags & (OPCODE_FLAG.IC_SLOT | OPCODE_FLAG.JIT_IC_SLOT)) === 0) continue;
        instruction.opcode.operands.forEach((operand, index) => {
            if (operand.kind === "imm") max = Math.max(max, instruction.operands[index]);
        });
    }
    return max;
}

/** 已知 bytecode 版本 → es2abc --target-api-version(保证 hook/merge 与目标同版本) */
const TARGET_API_BY_BC_VERSION: Record<string, number> = {
    "12.0.2.0": 12,
    "12.0.6.0": 13,
    "13.0.1.0": 18,
    "24.0.0.0": 24,
};

/** 目标 abc 的 bytecode 版本 → es2abc target-api-version(未知版本时探测) */
function resolveTargetApiVersion(es2abc: string, bcVersion: string, explicit?: number): number {
    if (explicit !== undefined) return explicit;
    const known = TARGET_API_BY_BC_VERSION[bcVersion];
    if (known !== undefined) return known;
    for (let api = 12; api <= 40; api++) {
        try {
            const output = execFileSync(es2abc, ["--target-bc-version", "--target-api-version", String(api)], {
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"],
            }).trim();
            if (output === bcVersion) return api;
        } catch {
            // 该 API 版本不可用,继续尝试
        }
    }
    throw new PandaPatchError(
        `target bytecode version '${bcVersion}' is not supported by es2abc; pass targetApiVersion explicitly`);
}

/** 仓库内置 es2abc 的路径(按操作系统选择 macos / windows / linux) */
function bundledEs2abcPath(): string | null {
    let platformDir: string;
    switch (process.platform) {
        case "darwin":
            platformDir = "macos";
            break;
        case "win32":
            platformDir = "windows";
            break;
        case "linux":
            platformDir = "linux";
            break;
        default:
            return null;
    }
    const executable = process.platform === "win32" ? "es2abc.exe" : "es2abc";
    return path.resolve(__dirname, "..", "..", "..", "assets", "bin", platformDir, executable);
}

/** 定位 es2abc:显式路径 > XPANDA_ES2ABC > 仓库 assets/bin/<os>/es2abc[.exe] > PATH */
function resolveEs2abc(explicit?: string): string {
    const candidates: string[] = [];
    if (explicit) candidates.push(explicit);
    if (process.env.XPANDA_ES2ABC) candidates.push(process.env.XPANDA_ES2ABC);
    const bundled = bundledEs2abcPath();
    if (bundled) candidates.push(bundled);
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }
    return process.platform === "win32" ? "es2abc.exe" : "es2abc"; // 交给 PATH
}

function runEs2abc(binary: string, args: string[]): void {
    try {
        execFileSync(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
        const failure = error as { stderr?: Buffer; message?: string };
        const stderr = failure.stderr ? failure.stderr.toString().trim() : "";
        throw new PandaPatchError(
            `es2abc failed: ${binary} ${args.join(" ")}\n${failure.message ?? ""}${stderr ? `\n${stderr}` : ""}`);
    }
}

/**
 * 把用户提供的 hook 源码包装成 module:
 *   - 源码已声明同名函数/变量时直接使用,并追加 `globalThis.<name> = <name>;`
 *   - 否则当作表达式(`(args) => ...` / `function () {}`),包装成 `const <name> = (...)`。
 */
function buildHookModuleSource(hookName: string, source: string): string {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(hookName)) {
        throw new PandaPatchError(`invalid hook name '${hookName}'`);
    }
    const trimmed = source.trim();
    const declares = new RegExp(`(?:function|class|const|let|var)\\s+${hookName}\\b`).test(trimmed);
    const code = declares ? trimmed : `const ${hookName} = (${trimmed});`;
    const assignment = `globalThis.${hookName} = ${hookName};`;
    const needsAssignment = !code.includes(`globalThis.${hookName}`);
    return `${code}\n${needsAssignment ? assignment : ""}\n`;
}

function $0(){

}