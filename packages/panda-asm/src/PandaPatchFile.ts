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
import { concatBytes, encodeStringEntity, readStringEntity, readUleb128, writeSleb128, writeUleb128 } from "./codec";
import { encodeMethodCode, type CatchBlockInput, type MethodCodeInput, type TryBlockInput } from "./MethodCode";
import {
    encodeModuleRecord, readModuleRecord,
    type ModuleRecord,
} from "./ModuleRecord";

export type { CatchBlockInput, MethodCodeInput, TryBlockInput };

const HEADER_CHECKSUM_OFF = 8;
const HEADER_VERSION_OFF = 12;
const HEADER_FILE_SIZE_OFF = 16;
const HEADER_NUM_CLASSES_OFF = 28;
const HEADER_CLASS_IDX_OFF = 32;
const INDEX_HEADER_SIZE = 40;
const INDEX_HEADER_CLASS_IDX_SIZE_OFF = 8;
const INDEX_HEADER_CLASS_IDX_OFF_OFF = 12;
const INDEX_HEADER_METHOD_IDX_SIZE_OFF = 16;
const INDEX_HEADER_METHOD_IDX_OFF_OFF = 20;

const METHOD_TAG_CODE = 0x01;
const METHOD_TAG_DEBUG_INFO = 0x05;

/** 字段实体 tag(与 Panda FieldTag 一致) */
const FIELD_TAG_NOTHING = 0x00;
const FIELD_TAG_INT_VALUE = 0x01;
const FIELD_TAG_VALUE = 0x02;

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
     * 目标 bytecode 版本对应的 es2abc `--target-api-version`。
     * 缺省按目标 abc 的版本自动映射(12.0.2.0→12、12.0.6.0→13、13.0.1.0→18、24.0.0.0→24),
     * 未知版本会探测 es2abc 的版本映射。
     */
    targetApiVersion?: number;
    /** 保留临时目录(调试用) */
    keepTemp?: boolean;
    /**
     * hook 源码里的模块请求重写:源码 specifier → 目标 abc 中可直接解析的请求串。
     * 例如 `{ ohop: "@normalized:N&&&entry/src/main/ets/common/ohop&" }`。
     * 缺省按目标 abc 的记录名做唯一后缀匹配(见 resolveModuleRequests)。
     */
    moduleRequests?: Record<string, string>;
    /**
     * 未显式给出映射时,是否按目标 abc 里的记录名后缀自动解析 hook 的 import
     * (例如 `ohop` → `@normalized:N&&&<recordName>`)。默认 true。
     */
    resolveModuleRequests?: boolean;
    /** 追加到目标 module import 表里的 local 名;缺省用 hook 名 */
    localName?: string;
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

/** 已搬进目标 abc 的 hook 函数:目标 module import 下标 + hook 名 */
interface HookLoader {
    importIndex: number;
    name: string;
}

/** hook class 搬运时,源实体偏移 → 目标实体偏移/id 的缓存 */
interface ClassImportCaches {
    stringEntities: Map<number, number>;
    stringIds: Map<number, number>;
    literalEntities: Map<number, number>;
    literalIds: Map<number, number>;
    /** hook 源 module record 偏移 → 目标 module record 偏移 */
    moduleRecords: Map<number, number>;
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
    /** 每个 region 的类索引表当前状态(追加新类后 size/off 已过时) */
    private readonly classTableState = new Map<PandaClass["indexHeader"], { offset: number; size: number }>();
    /** 文件头全局类索引表当前状态 */
    private headerClassTableState: { offset: number; size: number } | null = null;
    /** prepareMethodHead 预约的 hook 名 → 目标方法列表(同一个 hook 可挂多个函数) */
    private readonly preparedMethodHeads = new Map<string, PreparedTarget[]>();
    /** 已改写过的 module record(目标类 → 当前记录 + 当前偏移),避免同一次会话重复读取旧值 */
    private readonly moduleRecordOverrides = new Map<PandaClass, { record: ModuleRecord; offset: number }>();
    /** 硬加 module record 时,moduleRecordIdx 字段值在新类实体里的绝对偏移 */
    private readonly moduleRecordValueOffsets = new Map<PandaClass, number>();

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

    /** 用新的 abc 字节重置内部状态 */
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
        this.classTableState.clear();
        this.headerClassTableState = null;
        this.entityTableState.clear();
        this.preparedMethodHeads.clear();
        this.moduleRecordOverrides.clear();
        this.moduleRecordValueOffsets.clear();
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
     * 内部:在目标方法头插入 hook 前导。
     * hook 函数从目标 module 的 import 绑定读取(`ldexternalmodulevar <import_idx>`),
     * 该 import 指向随 hook class 一起搬进目标 abc 的 hook module record。
     */
    private applyMethodHeadPrologue(
        className: string,
        methodName: string,
        hook: HookLoader,
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

        // IC slot 分配(ldobjbyvalue 2 槽,stricteq 1 槽)
        let base = maxIcSlot(preparedInstructions) + 1;
        if (base + 8 > 250) base = 0;
        let nextSlot = base;
        const takeSlots = (count: number): number => {
            const slot = nextSlot;
            nextSlot += count;
            return slot;
        };
        const slotObject0 = takeSlots(2);
        const slotStrictEq = takeSlots(1);
        const slotObject1 = takeSlots(2);

        // hook 函数来自目标 module 的 import 绑定(hook 以独立 module 求值)。
        const loadHook = assembleInstruction("ldexternalmodulevar", [hook.importIndex]);

        const vResult = free[0];
        const vTemp = free[1];
        const head = concatBytes([
            assemble("getunmappedargs"),
            assembleInstruction("sta", [vResult]),
            loadHook,
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
        return { ...result, hookGlobalName: hook.name };
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
     * 两段式 AOP 第二步:编译 hook 源码 → 把 hook class 搬进目标 abc → 给所有预约的方法插入前导。
     * 同一个 hook 名预约了多个方法时,这里只编译/搬运一次,然后逐个插入。
     */
    patchMethodHeads(hookGlobalName: string, hookSource: string, options: PatchMethodHeadSourceOptions = {}): InsertInstructionsResult[] {
        const targets = this.preparedMethodHeads.get(hookGlobalName);
        if (!targets || targets.length === 0) {
            throw new PandaPatchError(`unknown hook name '${hookGlobalName}'; call prepareMethodHead first`);
        }
        return this.patchHookSource(
            [hookGlobalName], new Map([[hookGlobalName, targets]]), hookSource, options);
    }

    /**
     * 把同一份 hook 源文件里的多个 hook 函数一次性注入目标 abc:
     * 源文件按 hook 名分组只编译一次、只搬一个 hook module,每个 hook 各自 import,
     * 再挂到 `prepareMethodHead` 预约的目标方法上。
     *
     * 源文件里除这些入口函数外的顶层函数会作为同一个 module 的辅助函数一起搬走。
     * 所有 hook 的目标类必须位于同一个 index region(hook class 只会搬一份)。
     */
    patchHookBundle(
        hookGlobalNames: string[],
        hookSource: string,
        options: PatchMethodHeadSourceOptions = {},
    ): InsertInstructionsResult[] {
        if (hookGlobalNames.length === 0) {
            throw new PandaPatchError("patchHookBundle requires at least one hook name");
        }
        if (new Set(hookGlobalNames).size !== hookGlobalNames.length) {
            throw new PandaPatchError("patchHookBundle hook names must be unique");
        }
        const targetsByHook = new Map<string, PreparedTarget[]>();
        for (const hookGlobalName of hookGlobalNames) {
            const targets = this.preparedMethodHeads.get(hookGlobalName);
            if (!targets || targets.length === 0) {
                throw new PandaPatchError(`unknown hook name '${hookGlobalName}'; call prepareMethodHead first`);
            }
            targetsByHook.set(hookGlobalName, targets);
        }
        return this.patchHookSource(hookGlobalNames, targetsByHook, hookSource, options);
    }

    private patchHookSource(
        hookGlobalNames: string[],
        targetsByHook: Map<string, PreparedTarget[]>,
        hookSource: string,
        options: PatchMethodHeadSourceOptions,
    ): InsertInstructionsResult[] {
        const es2abc = resolveEs2abc(options.es2abc);
        // hook 必须使用与目标 abc 相同的字节码版本
        const targetBcVersion = this.pf.header.versionString();
        const targetApiVersion = resolveTargetApiVersion(es2abc, targetBcVersion, options.targetApiVersion);
        const apiVersionArgs = ["--target-api-version", String(targetApiVersion)];
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "panda-asm-"));
        try {
            return this.patchMethodHeadsClass(
                hookGlobalNames, targetsByHook, hookSource, es2abc, apiVersionArgs, targetBcVersion, tempDir, options);
        } finally {
            if (options.keepTemp) {
                console.log(`[panda-asm] temp dir kept: ${tempDir}`);
            } else {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        }
    }

    /**
     * class 注入:es2abc 把 hook 源码编译成带独立 module record 的 abc,把这个 hook class
     * (类实体 + 方法 + 字符串/literal array 依赖 + module record)整体搬到目标 abc 的同一
     * region,并把 module 字段(import/export 表)一起搬过来。
     *
     * 然后给目标 module 追加 import 表项(指向 hook record),前导用
     * `ldexternalmodulevar` 取 hook 函数 —— hook 内部的 import / 顶层变量因此能正常解析。
     *
     * 目标 region 需要 proto index table 无效(>= 12.0.1.0)。
     */
    private patchMethodHeadsClass(
        hookGlobalNames: string[],
        targetsByHook: Map<string, PreparedTarget[]>,
        hookSource: string,
        es2abc: string,
        apiVersionArgs: string[],
        targetBcVersion: string,
        tempDir: string,
        options: PatchMethodHeadSourceOptions,
    ): InsertInstructionsResult[] {
        // 一个 bundle 只生成一个 hook module;module 名取第一个 hook 名(与单 hook 的命名保持一致)
        const hookModuleName = hookGlobalNames[0];
        const hookSourcePath = path.join(tempDir, "hook-class.js");
        fs.writeFileSync(hookSourcePath, buildHookClassSource(hookGlobalNames, hookSource));
        const hookAbcPath = path.join(tempDir, "hook-class.abc");
        const hookRecordName = `&xpanda/hook/${hookModuleName}&`;
        runEs2abc(es2abc, [
            "--module", "--merge-abc", ...apiVersionArgs,
            "--record-name", hookRecordName,
            "--output", hookAbcPath,
            hookSourcePath,
        ]);

        const hookBytes = new Uint8Array(fs.readFileSync(hookAbcPath));
        const hookVersion = `${hookBytes[12]}.${hookBytes[13]}.${hookBytes[14]}.${hookBytes[15]}`;
        if (hookVersion !== targetBcVersion) {
            throw new PandaPatchError(
                `hook bytecode version ${hookVersion} does not match target ${targetBcVersion}; `
                + "pass targetApiVersion explicitly");
        }
        const hookFile = new PandaFile(hookBytes);
        const hookPatch = PandaPatchFile.load(hookBytes);
        const hookClassName = `L${hookRecordName};`;
        const hookClass = hookFile.getAllClasses().find((clazz) => clazz.getClassName() === hookClassName);
        if (!hookClass) {
            throw new PandaPatchError(
                "moving the hook class requires the hook source to declare "
                + `'function ${hookModuleName}(...)'; class '${hookClassName}' was not compiled`);
        }
        const hookModuleData = hookClass.pandaClassModuleData;
        if (!hookModuleData) {
            throw new PandaPatchError("hook abc has no module record; the hook must be compiled as an ES module");
        }
        for (const hookGlobalName of hookGlobalNames) {
            const hookMethodName = `#*#${hookGlobalName}`;
            if (!hookClass.pandaMethods.has(hookMethodName)) {
                throw new PandaPatchError(
                    "moving the hook class requires the hook source to declare "
                    + `'function ${hookGlobalName}(...)'; method '${hookClassName}::${hookMethodName}' was not compiled`);
            }
            const exported = hookModuleData.exports.some((exp) =>
                exp.path === null && exp.exportName === hookGlobalName);
            if (!exported) {
                throw new PandaPatchError(
                    `the hook module must export '${hookGlobalName}' (use 'export function ${hookGlobalName}(...)')`);
            }
        }

        // 一个 bundle 的 hook class 只搬进一个 region;所有 hook 的目标类必须都在该 region,
        // 否则需要多份 hook class 副本,暂不支持。
        let targetRegion: PandaClass["indexHeader"] | undefined;
        const targetClasses: PandaClass[] = [];
        const hooksByClass = new Map<string, Set<string>>();
        for (const hookGlobalName of hookGlobalNames) {
            for (const target of targetsByHook.get(hookGlobalName)!) {
                const targetClass = this.requireClass(target.className);
                if (targetRegion === undefined) {
                    targetRegion = targetClass.indexHeader;
                } else if (targetClass.indexHeader !== targetRegion) {
                    throw new PandaPatchError(
                        "moving the hook class into methods of different index regions is not supported");
                }
                if (!targetClasses.includes(targetClass)) targetClasses.push(targetClass);
                let classHooks = hooksByClass.get(target.className);
                if (!classHooks) {
                    classHooks = new Set();
                    hooksByClass.set(target.className, classHooks);
                }
                classHooks.add(hookGlobalName);
            }
        }
        if (targetRegion === undefined || targetClasses.length === 0) {
            throw new PandaPatchError("patchHookBundle requires at least one prepared target method");
        }
        // localName 是目标 module record 内的局部名:同一个类导入多个 hook 时无法共用一个
        if (options.localName !== undefined) {
            for (const [className, classHooks] of hooksByClass) {
                if (classHooks.size > 1) {
                    throw new PandaPatchError(
                        `localName cannot be used because '${className}' imports multiple hooks; `
                        + "use the default per-hook local names");
                }
            }
        }

        // 目标类没有 module record(bundle-pack / 未合并 abc)时硬加一个:
        // isCommonjs + moduleRecordIdx + 空 module record,后续再追加 hook import。
        for (const targetClass of targetClasses) {
            this.ensureModuleRecord(targetClass);
        }

        this.importHookClass(hookFile, hookPatch, hookClass, targetClasses[0].getClassName(), options);

        const recordName = hookClassName.slice(1, -1);
        const request = normalizedRequestForRecord(recordName);
        const importKey = (className: string, hookGlobalName: string): string =>
            `${className}\u0000${hookGlobalName}`;
        const importIndexByClassHook = new Map<string, number>();
        for (const hookGlobalName of hookGlobalNames) {
            for (const target of targetsByHook.get(hookGlobalName)!) {
                const key = importKey(target.className, hookGlobalName);
                if (importIndexByClassHook.has(key)) continue;
                importIndexByClassHook.set(key, this.addModuleImport(
                    target.className,
                    options.localName ?? hookGlobalName,
                    hookGlobalName,
                    request));
            }
        }

        const results: InsertInstructionsResult[] = [];
        for (const hookGlobalName of hookGlobalNames) {
            for (const target of targetsByHook.get(hookGlobalName)!) {
                results.push(this.applyMethodHeadPrologue(
                    target.className,
                    target.methodName,
                    {
                        importIndex: importIndexByClassHook.get(importKey(target.className, hookGlobalName))!,
                        name: hookGlobalName,
                    },
                    target.asyncContextRegister,
                    target.insertionPC ?? 0,
                ));
            }
        }
        for (const hookGlobalName of hookGlobalNames) {
            this.preparedMethodHeads.delete(hookGlobalName);
        }
        return results;
    }

    /**
     * 把一个 class 从 hook abc 搬到目标 region:
     *   - 方法代码里的字符串 / literal array / 方法 id 按目标 region 重新分配;
     *   - 方法实体重写 class_idx / proto_idx / name / header index,丢弃 debug/annotation tag;
     *   - 类实体保留 name / super / access_flags / fields / methods,module 字段
     *     (含 module record)一起搬过来;
     *   - 类与方法的索引表追加到文件末尾。
     * 返回导入后的方法名 → region 内方法 id。
     */
    private importHookClass(
        hookFile: PandaFile,
        hookPatch: PandaPatchFile,
        hookClass: PandaClass,
        targetClassName: string,
        options: PatchMethodHeadSourceOptions,
    ): Map<string, number> {
        const targetRegion = this.requireClass(targetClassName).indexHeader;
        if (targetRegion.protoIdxSize !== 0xffffffff) {
            throw new PandaPatchError(
                "moving the hook class into this abc is not supported: the target has a proto index table");
        }
        if (hookClass.numIfaces > 0) {
            throw new PandaPatchError("moving the hook class is not supported: the class declares interfaces");
        }
        if (hookClass.superClassOff.isValid()) {
            throw new PandaPatchError("moving the hook class is not supported: the class has a super class");
        }

        const sourceClassName = hookClass.getClassName();
        const methods = [...hookClass.pandaMethods.entries()].map(([name, method]) => {
            const code = hookPatch.getMethodCode(sourceClassName, name);
            if (!code || method.methodExternal || !method.methodCode) {
                throw new PandaPatchError(
                    `moving the hook class is not supported: method '${sourceClassName}::${name}' has no code`);
            }
            return { name, method, code };
        });
        const caches: ClassImportCaches = {
            stringEntities: new Map(),
            stringIds: new Map(),
            literalEntities: new Map(),
            literalIds: new Map(),
            moduleRecords: new Map(),
        };
        const sourceRegion = hookClass.indexHeader;

        // 第一遍:把代码引用的字符串 / literal array 导入目标 region(id 会登记进实体表)
        for (const { code } of methods) {
            for (const instruction of decodeInstructions(code.instructions)) {
                for (const ref of this.hookIdOperands(instruction, sourceRegion)) {
                    if (ref.kind === "string") {
                        this.importStringId(hookFile, ref.sourceOffset, targetClassName, caches);
                    } else if (ref.kind === "literal-array") {
                        this.importLiteralArrayId(hookFile, ref.sourceOffset, targetClassName, caches);
                    }
                }
            }
        }

        // 方法实体按顺序追加,方法 id = 当前实体表大小 + 序号
        const methodIdBase = this.currentEntityTableSize(targetRegion);
        const methodIdByOffset = new Map<number, number>();
        methods.forEach((entry, index) => methodIdByOffset.set(entry.method.getOffset(), methodIdBase + index));

        // 第二遍:重映射指令并追加 code item
        const codeOffsets = methods.map((entry) => this.append(encodeMethodCode({
            numVregs: entry.code.numVregs,
            numArgs: entry.code.numArgs,
            instructions: this.remapHookInstructions(entry.code, sourceRegion, methodIdByOffset, caches),
            tries: [],
        })));

        // 字段类型(原生类型)条目可能追加到 region 类表,必须先解析,
        // 否则新类的下标会在字段构建过程中被挤后。
        const fieldTypeIndexes = this.resolveImportedFieldTypeIndexes(hookClass, sourceRegion, targetRegion);
        const newClassIndex = this.currentClassTableSize(targetRegion);

        // 把 module record 一起搬过来,并重建 module 字段
        const fields = this.buildImportedModuleFields(
            hookFile, hookClass, newClassIndex, caches, options, fieldTypeIndexes);

        const targetRegionIndex = this.pf.indexHeaders.indexOf(targetRegion);
        const methodBodies = methods.map((entry, index) => {
            const nameOffset = this.addString(entry.name);
            // 高 16 位是 method 所属的 index region 下标,hook abc 里恒为 0,搬运后必须改写
            const accessFlags = (entry.method.accessFlag & 0xffff) | (targetRegionIndex << 16);
            return buildImportedMethodEntity(
                newClassIndex, entry.method.protoIdx & 0xffff, nameOffset, accessFlags, codeOffsets[index]);
        });

        const classBytes = buildImportedClassEntity(sourceClassName, hookClass.accessFlags, fields, methodBodies);
        const classOffset = this.append(classBytes);
        // 方法实体内联在类实体里;实体表直接指向内联副本,这样解析出的 PandaMethod
        // 能通过 class_idx 找到父类(module 字段 / import 表都挂在父类上)。
        const methodsLength = methodBodies.reduce((total, body) => total + body.length, 0);
        let methodOffset = classOffset + classBytes.length - methodsLength;
        const methodIds = new Map<string, number>();
        methods.forEach((entry, index) => {
            const id = this.appendMethodIndex(targetRegion, methodOffset);
            if (id !== methodIdBase + index) {
                throw new PandaPatchError("internal error: imported hook method id mismatch");
            }
            methodIds.set(entry.name, id);
            methodOffset += methodBodies[index].length;
        });

        const registeredIndex = this.appendClassIndex(targetRegion, classOffset);
        if (registeredIndex !== newClassIndex) {
            throw new PandaPatchError("internal error: imported hook class index mismatch");
        }
        // 追加的实体/索引表都落在文件末尾,region end 覆盖到文件尾
        this.extendRegion(targetRegion, this.size);
        return methodIds;
    }

    /** 为 module 字段解析目标 region 里的原生类型下标(必要时追加) */
    private resolveImportedFieldTypeIndexes(
        hookClass: PandaClass,
        sourceRegion: PandaClass["indexHeader"],
        targetRegion: PandaClass["indexHeader"],
    ): Map<string, number> {
        const indexes = new Map<string, number>();
        for (const field of hookClass.pandaFields ?? []) {
            const fieldName = field.getName();
            if (fieldName === "scopeNames") continue;
            const sourceType = sourceRegion.pandaClasses[field.typeIdx];
            if (!sourceType) {
                throw new PandaPatchError(`hook module field '${fieldName}' has an unknown type index`);
            }
            const typeRawValue = sourceType.getOffset();
            if (typeRawValue > 0xffff) {
                throw new PandaPatchError(
                    `hook module field '${fieldName}' uses a class type; only primitive module fields are supported`);
            }
            indexes.set(fieldName, this.targetClassIndexForValue(targetRegion, typeRawValue));
        }
        return indexes;
    }

    /**
     * 重建 hook class 的 module 字段:
     *   - moduleRecordIdx 指向搬进目标文件的 module record;
     *   - isCommonjs / hasTopLevelAwait / isSharedModule / pkgName@... 原样复制(INT_VALUE);
     *   - scopeNames 是编译期 AOP 元数据,运行时不读,直接丢弃;
     *   - 其余 VALUE 字段(注解等)暂不支持。
     */
    private buildImportedModuleFields(
        hookFile: PandaFile,
        hookClass: PandaClass,
        newClassIndex: number,
        caches: ClassImportCaches,
        options: PatchMethodHeadSourceOptions,
        fieldTypeIndexes: Map<string, number>,
    ): Uint8Array[] {
        const moduleRecordField = hookClass.pandaFields?.find((field) => field.getName() === "moduleRecordIdx");
        if (!moduleRecordField) {
            throw new PandaPatchError(
                "the hook class must carry a 'moduleRecordIdx' field");
        }
        const sourceModuleRecordValueOffset = findFieldValueOffset(hookFile.data, moduleRecordField);
        if (sourceModuleRecordValueOffset === undefined) {
            throw new PandaPatchError("hook 'moduleRecordIdx' field has no VALUE tag");
        }
        const sourceModuleRecordOffset = readU32At(hookFile.data, sourceModuleRecordValueOffset);
        const targetModuleRecordOffset = this.importHookModuleRecord(
            hookFile, sourceModuleRecordOffset, caches, options);

        const fields: Uint8Array[] = [];
        for (const field of hookClass.pandaFields ?? []) {
            const fieldName = field.getName();
            if (fieldName === "scopeNames") continue; // 编译期 AOP 元数据,运行时不需要
            const typeIdx = fieldTypeIndexes.get(fieldName);
            if (typeIdx === undefined) {
                throw new PandaPatchError(`hook module field '${fieldName}' has an unknown type index`);
            }
            const nameOffset = this.addString(fieldName);
            let value: Uint8Array;
            if (fieldName === "moduleRecordIdx") {
                value = concatBytes([Uint8Array.of(FIELD_TAG_VALUE), u32Bytes(targetModuleRecordOffset)]);
            } else if (field.pandaFieldValue) {
                throw new PandaPatchError(
                    `hook module field '${fieldName}' has an unsupported VALUE entity; only moduleRecordIdx is supported`);
            } else {
                value = concatBytes([Uint8Array.of(FIELD_TAG_INT_VALUE), writeSleb128(field.intValue)]);
            }
            fields.push(encodeImportedField(newClassIndex, typeIdx, nameOffset, field.accessFlag, value));
        }
        return fields;
    }

    /**
     * 把 hook 的 module record 搬进目标文件:字符串实体重新分配,hook 的 import 请求
     * 按 moduleRequests 映射或按目标记录名后缀自动解析。
     */
    private importHookModuleRecord(
        hookFile: PandaFile,
        sourceOffset: number,
        caches: ClassImportCaches,
        options: PatchMethodHeadSourceOptions,
    ): number {
        const cached = caches.moduleRecords.get(sourceOffset);
        if (cached !== undefined) return cached;
        const record = readModuleRecord(hookFile.data, sourceOffset);
        const importString = (offset: number): number => this.copyStringEntity(hookFile, offset, caches);
        const imported: ModuleRecord = {
            moduleRequests: record.moduleRequests.map((offset) => {
                const request = readStringEntity(hookFile.data, offset);
                const rewritten = this.resolveHookModuleRequest(request, options);
                return rewritten === request
                    ? importString(offset)
                    : this.addString(rewritten);
            }),
            regularImports: record.regularImports.map((entry) => ({
                localName: importString(entry.localName),
                importName: importString(entry.importName),
                moduleRequestIdx: entry.moduleRequestIdx,
            })),
            namespaceImports: record.namespaceImports.map((entry) => ({
                localName: importString(entry.localName),
                moduleRequestIdx: entry.moduleRequestIdx,
            })),
            localExports: record.localExports.map((entry) => ({
                localName: importString(entry.localName),
                exportName: importString(entry.exportName),
            })),
            indirectExports: record.indirectExports.map((entry) => ({
                exportName: importString(entry.exportName),
                importName: importString(entry.importName),
                moduleRequestIdx: entry.moduleRequestIdx,
            })),
            starExports: record.starExports.slice(),
        };
        const targetOffset = this.append(encodeModuleRecord(imported));
        caches.moduleRecords.set(sourceOffset, targetOffset);
        return targetOffset;
    }

    /**
     * hook 源码的 import 请求 → 目标 abc 中可解析的请求串:
     *   - 显式 moduleRequests 映射优先(值可以是请求串,也可以直接写 `&recordName&`);
     *   - `@...` / 相对路径原样保留;
     *   - 其余按记录名后缀唯一匹配,转成 `@normalized:N&&&<recordName>`;
     *   - 匹配不到时原样保留(交给运行时/用户显式映射)。
     */
    private resolveHookModuleRequest(
        request: string,
        options: PatchMethodHeadSourceOptions,
    ): string {
        const explicit = options.moduleRequests?.[request];
        if (explicit !== undefined) {
            // 也接受直接写记录名(&recordName&),统一转成 normalized 请求
            return explicit.startsWith("&") ? normalizedRequestForRecord(explicit) : explicit;
        }
        if (options.resolveModuleRequests === false) return request;
        if (request.startsWith("@") || request.startsWith(".") || request.startsWith("/")) return request;
        const matches = this.findRecordNamesBySuffix(request);
        if (matches.length === 1) return normalizedRequestForRecord(matches[0]);
        if (matches.length > 1) {
            throw new PandaPatchError(
                `hook import '${request}' matches multiple records (${matches.join(", ")}); `
                + "pass moduleRequests to disambiguate");
        }
        return request;
    }

    /** 目标 abc 里以 name 结尾的记录名(用于把 hook 的裸 import 解析成记录名) */
    private findRecordNamesBySuffix(name: string): string[] {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = new RegExp(`(^|.*/)${escaped}(&[^/]*)?$`);
        const matches: string[] = [];
        for (const clazz of this.pf.getAllClasses()) {
            if (clazz.classExternal) continue;
            const className = clazz.getClassName();
            if (className.length < 3 || !className.startsWith("L") || !className.endsWith(";")) continue;
            const recordName = className.slice(1, -1);
            if (pattern.test(recordName) && !matches.includes(recordName)) matches.push(recordName);
        }
        return matches;
    }

    /** 在目标 region 类表里找原生类型条目(offset 值 ≤ header size),没有则只在 region 表追加 */
    private targetClassIndexForValue(region: PandaClass["indexHeader"], rawValue: number): number {
        const state = this.classTableState.get(region)
            ?? { offset: region.classIdxOff, size: region.classIdxSize };
        for (let i = 0; i < state.size; i++) {
            if (this.readU32(state.offset + i * 4) === rawValue) return i;
        }
        return this.appendClassIndex(region, rawValue, false);
    }

    /**
     * 给目标类的 module record 追加一条 regular import,返回它在 module 环境数组里的下标。
     * 要求目标 module 没有 namespace import(追加 regular import 会移动它们的下标)。
     * 已存在相同 (importName, request) 的 import 时直接复用。
     */
    private addModuleImport(className: string, localName: string, importName: string, request: string): number {
        const clazz = this.requireClass(className);
        let state = this.moduleRecordOverrides.get(clazz);
        if (!state) {
            if (!clazz.pandaClassModuleData) {
                throw new PandaPatchError(`class '${className}' has no module record`);
            }
            const offset = clazz.pandaClassModuleData.getOffset();
            state = { record: readModuleRecord(this.bytes, offset), offset };
            this.moduleRecordOverrides.set(clazz, state);
        }
        const record = state.record;
        if (record.namespaceImports.length > 0) {
            throw new PandaPatchError(
                `module '${className}' has namespace imports; appending a regular import would shift them`);
        }
        for (let i = 0; i < record.regularImports.length; i++) {
            const entry = record.regularImports[i];
            if (entry.moduleRequestIdx >= record.moduleRequests.length) continue;
            if (readStringEntity(this.bytes, entry.importName) !== importName) continue;
            if (readStringEntity(this.bytes, record.moduleRequests[entry.moduleRequestIdx]) !== request) continue;
            return i;
        }
        // 同一 hook bundle 的多个 hook 从同一个 module 导入:复用已有的 module request,
        // 避免同一个请求串在 module record 里出现多份
        let requestIndex = -1;
        for (let i = 0; i < record.moduleRequests.length; i++) {
            if (readStringEntity(this.bytes, record.moduleRequests[i]) === request) {
                requestIndex = i;
                break;
            }
        }
        if (requestIndex < 0) {
            requestIndex = record.moduleRequests.length;
            record.moduleRequests.push(this.addString(request));
        }
        const index = record.regularImports.length;
        record.regularImports.push({
            localName: this.addString(localName),
            importName: this.addString(importName),
            moduleRequestIdx: requestIndex,
        });
        const newOffset = this.append(encodeModuleRecord(record));
        if (!this.patchModuleRecordField(clazz, newOffset)) {
            throw new PandaPatchError(`cannot patch 'moduleRecordIdx' of '${className}'`);
        }
        state.offset = newOffset;
        this.extendRegion(clazz.indexHeader, this.size);
        return index;
    }

    /** 把 class 的 moduleRecordIdx 字段值改成新的 module record 偏移 */
    private patchModuleRecordField(clazz: PandaClass, newOffset: number): boolean {
        const tracked = this.moduleRecordValueOffsets.get(clazz);
        if (tracked !== undefined) {
            this.patchU32(tracked, newOffset);
            return true;
        }
        const field = clazz.pandaFields?.find((candidate) => candidate.getName() === "moduleRecordIdx");
        if (!field) return false;
        const valueOffset = findFieldValueOffset(this.bytes, field);
        if (valueOffset === undefined) return false;
        this.patchU32(valueOffset, newOffset);
        return true;
    }

    /**
     * 目标类没有 module record 时硬加一个:给类实体追加 `isCommonjs`(INT 0)与
     * `moduleRecordIdx`(VALUE → 新 module record)字段,并重建/重定位类实体。
     *
     * 注意:运行时用"任意类带 moduleRecordIdx/isCommonjs"判定 merged abc;对 bundle-pack
     * 文件做这件事会让整个文件按 merged 语义加载(调用方需自行确认可接受)。
     */
    private ensureModuleRecord(clazz: PandaClass): void {
        if (clazz.pandaClassModuleData) return;
        if (this.moduleRecordOverrides.has(clazz)) return;

        const record: ModuleRecord = {
            moduleRequests: [],
            regularImports: [],
            namespaceImports: [],
            localExports: [],
            indirectExports: [],
            starExports: [],
        };
        const recordOffset = this.append(encodeModuleRecord(record));

        const region = clazz.indexHeader;
        const classIndex = this.classIndexOf(clazz);
        // 与 es2abc 的 module 字段一致:isCommonjs 用 U1(编码值 2),moduleRecordIdx 用 I32(6)
        const isCommonjsType = this.targetClassIndexForValue(region, 2);
        const moduleRecordType = this.targetClassIndexForValue(region, 6);
        const isCommonjsField = encodeImportedField(
            classIndex, isCommonjsType, this.addString("isCommonjs"), 0,
            concatBytes([Uint8Array.of(FIELD_TAG_INT_VALUE), writeSleb128(0)]));
        const moduleRecordField = encodeImportedField(
            classIndex, moduleRecordType, this.addString("moduleRecordIdx"), 0,
            concatBytes([Uint8Array.of(FIELD_TAG_VALUE), u32Bytes(recordOffset)]));

        const { bytes, appendedFieldOffsets, methodShift } = this.buildClassWithAppendedFields(
            clazz, [isCommonjsField, moduleRecordField]);
        const newOffset = this.relocateClassEntity(clazz, bytes, methodShift);
        // VALUE tag 的 u32 载荷 = 字段实体起点 + 8(class/type/name) + uleb(access=0) + tag
        const valueOffset = newOffset + appendedFieldOffsets[1] + 8 + writeUleb128(0).length + 1;
        this.moduleRecordValueOffsets.set(clazz, valueOffset);
        this.moduleRecordOverrides.set(clazz, { record, offset: recordOffset });
        this.extendRegion(region, this.size);
    }

    /** 类在所属 region 类表里的下标 */
    private classIndexOf(clazz: PandaClass): number {
        const state = this.classOverrides.get(clazz);
        const offset = state?.offset ?? clazz.getOffset();
        const table = this.classTableState.get(clazz.indexHeader)
            ?? { offset: clazz.indexHeader.classIdxOff, size: clazz.indexHeader.classIdxSize };
        for (let i = 0; i < table.size; i++) {
            if (this.readU32(table.offset + i * 4) === offset) return i;
        }
        throw new PandaPatchError(`class '${clazz.getClassName()}' is not registered in its region class table`);
    }

    /**
     * 在类实体的字段区末尾追加字段实体(num_fields 同步 +1),返回新类实体字节与
     * 每个新字段在类实体内的相对偏移。
     */
    private buildClassWithAppendedFields(
        clazz: PandaClass,
        fields: Uint8Array[],
    ): { bytes: Uint8Array; appendedFieldOffsets: number[]; methodShift: number } {
        const state = this.getClassOverride(clazz);
        const raw = state.bytes;
        const nameSize = clazz.name.getSize();
        let pos = nameSize + 4; // super_class_off
        const access = readUleb128(raw, pos); pos += access.size;
        const numFields = readUleb128(raw, pos); pos += numFields.size;
        const numMethods = readUleb128(raw, pos); pos += numMethods.size;
        const tagsStart = pos;

        // 跳过类 tag 区(注解 tag 无法安全重建)
        let tagPos = tagsStart;
        while (tagPos < raw.length && raw[tagPos] !== 0) {
            const tag = raw[tagPos++];
            if (tag === 0x01) { // INTERFACES
                const count = readUleb128(raw, tagPos);
                tagPos += count.size + count.value * 2;
            } else if (tag === 0x02) { // SOURCE_LANG
                tagPos += 1;
            } else if (tag === 0x07) { // SOURCE_FILE
                tagPos += 4;
            } else {
                throw new PandaPatchError(
                    `cannot add module fields to a class with tag 0x${tag.toString(16)}`);
            }
        }
        if (tagPos >= raw.length) {
            throw new PandaPatchError("class entity tags are truncated");
        }
        const tagsEnd = tagPos + 1;

        let methodsStart = tagsEnd;
        for (const field of clazz.pandaFields ?? []) methodsStart += field.getSize();
        if (methodsStart > raw.length) {
            throw new PandaPatchError(`class '${clazz.getClassName()}' layout mismatch (fields exceed entity)`);
        }

        const header = concatBytes([
            raw.subarray(0, nameSize),
            raw.subarray(nameSize, nameSize + 4),
            writeUleb128(access.value),
            writeUleb128(numFields.value + fields.length),
            writeUleb128(numMethods.value),
        ]);
        const tags = raw.subarray(tagsStart, tagsEnd);
        const existingFields = raw.subarray(tagsEnd, methodsStart);
        const methods = raw.subarray(methodsStart);

        const appendedFieldOffsets: number[] = [];
        let cursor = header.length + tags.length + existingFields.length;
        for (const field of fields) {
            appendedFieldOffsets.push(cursor);
            cursor += field.length;
        }
        const bytes = concatBytes([header, tags, existingFields, ...fields, methods]);
        // 方法整体右移(字段插在方法之前);状态更新留给 relocateClassEntity,
        // 那里才能同时用旧相对偏移改方法索引表。
        return { bytes, appendedFieldOffsets, methodShift: cursor - methodsStart };
    }

    /**
     * 把重建后的类实体追加到文件末尾,并把类索引表 / 方法索引表里的旧偏移改成新偏移。
     * (类实体里的方法实体是内联的,方法索引表必须跟着搬。)
     */
    private relocateClassEntity(clazz: PandaClass, newBytes: Uint8Array, methodShift: number): number {
        const state = this.getClassOverride(clazz);
        const oldOffset = state.offset;
        const oldRelativeOffsets = new Map(state.methodRelativeOffsets);
        const newOffset = this.append(newBytes);

        const regionTable = this.classTableState.get(clazz.indexHeader)
            ?? { offset: clazz.indexHeader.classIdxOff, size: clazz.indexHeader.classIdxSize };
        for (let i = 0; i < regionTable.size; i++) {
            const entry = regionTable.offset + i * 4;
            if (this.readU32(entry) === oldOffset) this.patchU32(entry, newOffset);
        }
        if (this.pf.header.classIdxOff !== 0xffffffff) {
            const headerTable = this.headerClassTableState
                ?? { offset: this.pf.header.classIdxOff, size: this.pf.header.numClasses };
            for (let i = 0; i < headerTable.size; i++) {
                const entry = headerTable.offset + i * 4;
                if (this.readU32(entry) === oldOffset) this.patchU32(entry, newOffset);
            }
        }

        const moved = new Map<number, number>();
        for (const [, relative] of oldRelativeOffsets) {
            moved.set(oldOffset + relative, newOffset + relative + methodShift);
        }
        const entityTable = this.entityTableState.get(clazz.indexHeader)
            ?? { offset: clazz.indexHeader.methodIdxOff, size: clazz.indexHeader.methodIdxSize };
        for (let i = 0; i < entityTable.size; i++) {
            const entry = entityTable.offset + i * 4;
            const target = moved.get(this.readU32(entry));
            if (target !== undefined) this.patchU32(entry, target);
        }

        // 字面量数组里的 METHOD tag 存的是方法实体绝对偏移(不是 id),也要跟着搬
        this.patchMethodLiteralOffsets(moved);

        for (const [name, relative] of oldRelativeOffsets) {
            state.methodRelativeOffsets.set(name, relative + methodShift);
        }
        state.offset = newOffset;
        state.bytes = newBytes;
        this.extendRegion(clazz.indexHeader, newOffset + newBytes.length);
        return newOffset;
    }

    /**
     * 改写 literal array 里指向旧方法实体的 METHOD/GETTER/SETTER 偏移。
     * v24 的 header 没有 literal array 表,因此从所有方法的 `literalarray_id`
     * 操作数收集数组偏移(defineclasswithbuffer 的类 buffer 也在其中)。
     */
    private patchMethodLiteralOffsets(moved: Map<number, number>): void {
        if (moved.size === 0) return;
        const arrays = new Set<number>();
        for (const clazz of this.pf.getAllClasses()) {
            if (clazz.classExternal) continue;
            const className = clazz.getClassName();
            if (!className.startsWith("L") || !className.endsWith(";")) continue;
            for (const method of clazz.pandaMethods.values()) {
                const code = this.getMethodCode(className, method.name.content);
                if (!code) continue;
                for (const instruction of decodeInstructions(code.instructions)) {
                    for (let i = 0; i < instruction.opcode.operands.length; i++) {
                        if (instruction.opcode.operands[i].name !== "literalarray_id") continue;
                        const id = instruction.operands[i];
                        const entry = method.indexHeader.pandaMethods[id];
                        if (entry) arrays.add(entry.getOffset());
                    }
                }
            }
        }
        for (const offset of arrays) this.patchMethodLiteralOffsetsInArray(offset, moved);
    }

    private patchMethodLiteralOffsetsInArray(offset: number, moved: Map<number, number>): void {
        const realSize = Math.trunc(this.readU32(offset) / 2);
        let pos = offset + 4;
        for (let i = 0; i < realSize; i++) {
            if (pos >= this.size) return;
            const tag = this.bytes[pos++];
            switch (tag) {
                case LITERAL_TAG.METHOD:
                case LITERAL_TAG.GENERATORMETHOD:
                case LITERAL_TAG.ASYNCGENERATORMETHOD:
                case LITERAL_TAG.GETTER:
                case LITERAL_TAG.SETTER: {
                    const target = moved.get(this.readU32(pos));
                    if (target !== undefined) this.patchU32(pos, target);
                    pos += 4;
                    break;
                }
                case LITERAL_TAG.STRING:
                case LITERAL_TAG.LITERALARRAY:
                case LITERAL_TAG.INTEGER:
                case LITERAL_TAG.FLOAT:
                case LITERAL_TAG.LITERALBUFFERINDEX:
                    pos += 4;
                    break;
                case LITERAL_TAG.DOUBLE:
                    pos += 8;
                    break;
                case LITERAL_TAG.METHODAFFILIATE:
                    pos += 2;
                    break;
                case LITERAL_TAG.ARRAY_U1:
                case LITERAL_TAG.ARRAY_U8:
                case LITERAL_TAG.ARRAY_I8:
                case LITERAL_TAG.ARRAY_U16:
                case LITERAL_TAG.ARRAY_I16:
                case LITERAL_TAG.ARRAY_U32:
                case LITERAL_TAG.ARRAY_I32:
                case LITERAL_TAG.ARRAY_U64:
                case LITERAL_TAG.ARRAY_I64:
                case LITERAL_TAG.ARRAY_F32:
                case LITERAL_TAG.ARRAY_F64:
                case LITERAL_TAG.ARRAY_STRING:
                    // 数组字面量的载荷长度依赖元素类型,遇到即停止(方法引用不会出现在其后)
                    return;
                default: // TAGVALUE / BOOL / ACCESSOR / BUILTINTYPEINDEX / NULLVALUE
                    pos += 1;
                    break;
            }
        }
    }

    /** 当前 region 实体(method/string/literal array)索引表大小(含本次会话已追加的条目) */
    private currentEntityTableSize(region: PandaClass["indexHeader"]): number {
        return this.entityTableState.get(region)?.size ?? region.methodIdxSize;
    }

    /** 当前 region 类索引表大小(含本次会话已追加的条目) */
    private currentClassTableSize(region: PandaClass["indexHeader"]): number {
        return this.classTableState.get(region)?.size ?? region.classIdxSize;
    }

    /**
     * 重映射 hook 方法代码里的实体 id 并按目标 region 重新编码:
     *   - 字符串 / literal array id 使用第一遍导入时登记的目标 id;
     *   - 方法 id 通过 methodIdByOffset 映射(同一 class 内的方法,如 definefunc 目标)。
     */
    private remapHookInstructions(
        source: MethodCode,
        sourceRegion: PandaClass["indexHeader"],
        methodIdByOffset: Map<number, number>,
        caches: ClassImportCaches,
    ): Uint8Array {
        const parts: Uint8Array[] = [];
        for (const instruction of decodeInstructions(source.instructions)) {
            const operands = instruction.operands.slice();
            for (const ref of this.hookIdOperands(instruction, sourceRegion)) {
                if (ref.kind === "string") {
                    const id = caches.stringIds.get(ref.sourceOffset);
                    if (id === undefined) throw new PandaPatchError("internal error: hook string id not imported");
                    operands[ref.index] = id;
                } else if (ref.kind === "literal-array") {
                    const id = caches.literalIds.get(ref.sourceOffset);
                    if (id === undefined) throw new PandaPatchError("internal error: hook literal array id not imported");
                    operands[ref.index] = id;
                } else {
                    const id = methodIdByOffset.get(ref.sourceOffset);
                    if (id === undefined) {
                        throw new PandaPatchError(
                            `moving the hook class does not support method '${instruction.opcode.name}' `
                            + "referencing a method outside the imported class");
                    }
                    operands[ref.index] = id;
                }
            }
            parts.push(encodeInstructionWithOpcode(instruction.opcode, operands));
        }
        return concatBytes(parts);
    }

    /** 列出一条指令里的实体 id 引用(string / literal array / method) */
    private hookIdOperands(
        instruction: DecodedInstruction,
        sourceRegion: PandaClass["indexHeader"],
    ): Array<{ index: number; kind: "string" | "literal-array" | "method"; sourceOffset: number }> {
        const refs: Array<{ index: number; kind: "string" | "literal-array" | "method"; sourceOffset: number }> = [];
        const flags = instruction.opcode.flags;
        instruction.opcode.operands.forEach((operand, index) => {
            if (operand.kind !== "id") return;
            const sourceId = instruction.operands[index];
            const entry = sourceRegion.pandaMethods[sourceId];
            if (!entry) {
                throw new PandaPatchError(
                    `moving the hook class: entity id ${sourceId} of '${instruction.opcode.name}' is out of range`);
            }
            if ((flags & OPCODE_FLAG.STRING_ID) !== 0) {
                refs.push({ index, kind: "string", sourceOffset: entry.getOffset() });
            } else if ((flags & OPCODE_FLAG.LITERALARRAY_ID) !== 0) {
                refs.push({ index, kind: "literal-array", sourceOffset: entry.getOffset() });
            } else if ((flags & OPCODE_FLAG.METHOD_ID) !== 0) {
                refs.push({ index, kind: "method", sourceOffset: entry.getOffset() });
            } else {
                throw new PandaPatchError(
                    `moving the hook class does not support '${instruction.opcode.name}' entity references`);
            }
        });
        return refs;
    }

    /** 把源字符串实体复制到目标文件,并登记到目标类的 region 实体表,返回目标 id */
    private importStringId(
        sourceFile: PandaFile,
        sourceOffset: number,
        className: string,
        caches: ClassImportCaches,
    ): number {
        let id = caches.stringIds.get(sourceOffset);
        if (id === undefined) {
            const targetOffset = this.copyStringEntity(sourceFile, sourceOffset, caches);
            id = this.appendMethodIndex(this.requireClass(className).indexHeader, targetOffset);
            caches.stringIds.set(sourceOffset, id);
        }
        return id;
    }

    /** 复制源字符串实体,返回目标文件中的绝对偏移 */
    private copyStringEntity(sourceFile: PandaFile, sourceOffset: number, caches: ClassImportCaches): number {
        let offset = caches.stringEntities.get(sourceOffset);
        if (offset === undefined) {
            offset = this.append(encodeStringEntity(readStringEntity(sourceFile.data, sourceOffset)));
            caches.stringEntities.set(sourceOffset, offset);
        }
        return offset;
    }

    /** 复制源 literal array 实体(含嵌套实体),登记到目标类的 region 实体表,返回目标 id */
    private importLiteralArrayId(
        sourceFile: PandaFile,
        sourceOffset: number,
        className: string,
        caches: ClassImportCaches,
    ): number {
        let id = caches.literalIds.get(sourceOffset);
        if (id === undefined) {
            const targetOffset = this.copyLiteralArrayEntity(sourceFile, sourceOffset, caches);
            id = this.appendMethodIndex(this.requireClass(className).indexHeader, targetOffset);
            caches.literalIds.set(sourceOffset, id);
        }
        return id;
    }

    /**
     * 复制 literal array 实体到目标文件末尾,把其中的绝对偏移(字符串 / 嵌套 literal array)
     * 重定位到新位置,返回新实体的绝对偏移。
     */
    private copyLiteralArrayEntity(
        sourceFile: PandaFile,
        sourceOffset: number,
        caches: ClassImportCaches,
    ): number {
        const cached = caches.literalEntities.get(sourceOffset);
        if (cached !== undefined) return cached;
        const data = sourceFile.data;
        const count = readU32At(data, sourceOffset);
        const realSize = Math.trunc(count / 2);
        const parts: Uint8Array[] = [u32Bytes(count)];
        let pos = sourceOffset + 4;
        for (let i = 0; i < realSize; i++) {
            const tag = data[pos++];
            if (tag === LITERAL_TAG.STRING) {
                const entityOffset = this.copyStringEntity(sourceFile, readU32At(data, pos), caches);
                pos += 4;
                parts.push(Uint8Array.of(tag), u32Bytes(entityOffset));
            } else if (tag === LITERAL_TAG.LITERALARRAY) {
                const entityOffset = this.copyLiteralArrayEntity(sourceFile, readU32At(data, pos), caches);
                pos += 4;
                parts.push(Uint8Array.of(tag), u32Bytes(entityOffset));
            } else {
                const payload = literalPayloadSize(tag);
                if (payload === null) {
                    throw new PandaPatchError(
                        `moving the hook class: literal tag 0x${tag.toString(16)} is not supported (method/array literal)`);
                }
                parts.push(data.subarray(pos - 1, pos + payload));
                pos += payload;
            }
        }
        const offset = this.append(concatBytes(parts));
        caches.literalEntities.set(sourceOffset, offset);
        return offset;
    }

    /**
     * 单个目标版本的 patchMethodHeads(只返回第一个结果)。
     * 给同一个 hook 预约了多个方法时请用 patchMethodHeads 拿到全部结果。
     */
    patchMethodHead(hookGlobalName: string, hookSource: string, options: PatchMethodHeadSourceOptions = {}): InsertInstructionsResult {
        return this.patchMethodHeads(hookGlobalName, hookSource, options)[0];
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

    /**
     * 把一个新类实体登记到 region 的类索引表(表整体搬到文件末尾),同时追加到文件头的
     * 全局类索引表。返回新类在 region 类表中的下标。
     * registerGlobal=false 用于原生类型条目(值 ≤ header size,不能进全局类表)。
     */
    private appendClassIndex(
        indexHeader: PandaClass["indexHeader"],
        entityOffset: number,
        registerGlobal = true,
    ): number {
        let state = this.classTableState.get(indexHeader);
        if (!state) {
            if (indexHeader.classIdxSize === 0 || indexHeader.classIdxOff === 0xffffffff) {
                throw new PandaPatchError("class has no class index table to extend");
            }
            state = { offset: indexHeader.classIdxOff, size: indexHeader.classIdxSize };
            this.classTableState.set(indexHeader, state);
        }
        const index = state.size;
        const table = new Uint8Array((state.size + 1) * 4);
        for (let i = 0; i < state.size; i++) {
            writeU32(table, i * 4, this.readU32(state.offset + i * 4));
        }
        writeU32(table, state.size * 4, entityOffset);
        const newTableOffset = this.append(table);

        const recordOffset = this.indexHeaderRecordOffset(indexHeader);
        this.patchU32(recordOffset + INDEX_HEADER_CLASS_IDX_SIZE_OFF, state.size + 1);
        this.patchU32(recordOffset + INDEX_HEADER_CLASS_IDX_OFF_OFF, newTableOffset);
        state.offset = newTableOffset;
        state.size += 1;

        // 文件头全局类索引表(所有 region 的类都登记在这里)
        if (registerGlobal && this.pf.header.classIdxOff !== 0xffffffff) {
            let headerState = this.headerClassTableState;
            if (!headerState) {
                headerState = { offset: this.pf.header.classIdxOff, size: this.pf.header.numClasses };
                this.headerClassTableState = headerState;
            }
            const headerTable = new Uint8Array((headerState.size + 1) * 4);
            for (let i = 0; i < headerState.size; i++) {
                writeU32(headerTable, i * 4, this.readU32(headerState.offset + i * 4));
            }
            writeU32(headerTable, headerState.size * 4, entityOffset);
            const headerTableOffset = this.append(headerTable);
            this.patchU32(HEADER_NUM_CLASSES_OFF, headerState.size + 1);
            this.patchU32(HEADER_CLASS_IDX_OFF, headerTableOffset);
            headerState.offset = headerTableOffset;
            headerState.size += 1;
        }
        return index;
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

/** 已知 bytecode 版本 → es2abc --target-api-version(保证 hook 与目标同版本) */
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

/** literal array 里的 tag 值(与 Panda LiteralTag 一致) */
const LITERAL_TAG = {
    TAGVALUE: 0x00,
    BOOL: 0x01,
    INTEGER: 0x02,
    FLOAT: 0x03,
    DOUBLE: 0x04,
    STRING: 0x05,
    METHOD: 0x06,
    GENERATORMETHOD: 0x07,
    ACCESSOR: 0x08,
    METHODAFFILIATE: 0x09,
    ARRAY_U1: 0x0a,
    ARRAY_U8: 0x0b,
    ARRAY_I8: 0x0c,
    ARRAY_U16: 0x0d,
    ARRAY_I16: 0x0e,
    ARRAY_U32: 0x0f,
    ARRAY_I32: 0x10,
    ARRAY_U64: 0x11,
    ARRAY_I64: 0x12,
    ARRAY_F32: 0x13,
    ARRAY_F64: 0x14,
    ARRAY_STRING: 0x15,
    ASYNCGENERATORMETHOD: 0x16,
    LITERALBUFFERINDEX: 0x17,
    LITERALARRAY: 0x18,
    BUILTINTYPEINDEX: 0x19,
    GETTER: 0x1a,
    SETTER: 0x1b,
    NULLVALU: 0xff,
} as const;

/**
 * 直接复制的 literal tag 的载荷字节数;STRING / LITERALARRAY 由调用方重定位,
 * METHOD 系列与 ARRAY 系列暂不支持(返回 null)。
 */
function literalPayloadSize(tag: number): number | null {
    switch (tag) {
        case LITERAL_TAG.INTEGER:
        case LITERAL_TAG.FLOAT:
        case LITERAL_TAG.LITERALBUFFERINDEX:
            return 4;
        case LITERAL_TAG.DOUBLE:
            return 8;
        case LITERAL_TAG.METHODAFFILIATE:
            return 2;
        case LITERAL_TAG.TAGVALUE:
        case LITERAL_TAG.BOOL:
        case LITERAL_TAG.ACCESSOR:
        case LITERAL_TAG.BUILTINTYPEINDEX:
        case LITERAL_TAG.NULLVALU:
            return 1;
        default:
            return null;
    }
}

function readU32At(bytes: Uint8Array, offset: number): number {
    return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function u32Bytes(value: number): Uint8Array {
    const out = new Uint8Array(4);
    writeU32(out, 0, value);
    return out;
}

function writeU16(target: Uint8Array, offset: number, value: number): void {
    target[offset] = value & 0xff;
    target[offset + 1] = (value >>> 8) & 0xff;
}

/**
 * 重建一个方法实体:class_idx / proto_idx / name / access flags + CODE tag(丢弃
 * debug info 与注解 tag,避免搬运 LNP / 注解引用)。
 */
function buildImportedMethodEntity(
    classIdx: number,
    protoIdx: number,
    nameOffset: number,
    accessFlags: number,
    codeOffset: number,
): Uint8Array {
    const head = new Uint8Array(8);
    writeU16(head, 0, classIdx);
    writeU16(head, 2, protoIdx);
    writeU32(head, 4, nameOffset);
    return concatBytes([
        head,
        writeUleb128(accessFlags),
        Uint8Array.of(METHOD_TAG_CODE),
        u32Bytes(codeOffset),
        Uint8Array.of(0x00),
    ]);
}

/**
 * 重建一个类实体:name + super(0) + access_flags + num_fields + num_methods
 * + 空 tag 区 + 字段实体 + 方法实体。
 * fields 里包含 module 元数据字段(moduleRecordIdx 等)。
 */
function buildImportedClassEntity(
    name: string,
    accessFlags: number,
    fields: Uint8Array[],
    methods: Uint8Array[],
): Uint8Array {
    return concatBytes([
        encodeStringEntity(name),
        u32Bytes(0),
        writeUleb128(accessFlags),
        writeUleb128(fields.length),
        writeUleb128(methods.length),
        Uint8Array.of(0x00),
        ...fields,
        ...methods,
    ]);
}

/** 字段实体:class_idx(u16) + type_idx(u16) + name(u32) + access_flags(uleb) + tag 区 */
function encodeImportedField(
    classIdx: number,
    typeIdx: number,
    nameOffset: number,
    accessFlags: number,
    valueTags: Uint8Array,
): Uint8Array {
    const head = new Uint8Array(8);
    writeU16(head, 0, classIdx);
    writeU16(head, 2, typeIdx);
    writeU32(head, 4, nameOffset);
    return concatBytes([
        head,
        writeUleb128(accessFlags),
        valueTags,
        Uint8Array.of(FIELD_TAG_NOTHING),
    ]);
}

/**
 * 找到字段实体里 VALUE tag 的 u32 载荷偏移(用于原位改写 moduleRecordIdx)。
 * 字段布局:class_idx(u16) + type_idx(u16) + name(u32) + access_flags(uleb) + tag 区。
 */
function findFieldValueOffset(data: Uint8Array, field: { getOffset(): number }): number | undefined {
    let pos = field.getOffset() + 8;
    pos += readUleb128(data, pos).size;
    while (pos < data.length) {
        const tag = data[pos++];
        if (tag === FIELD_TAG_NOTHING) return undefined;
        if (tag === FIELD_TAG_INT_VALUE) {
            pos += readUleb128(data, pos).size;
        } else if (tag === FIELD_TAG_VALUE) {
            return pos;
        } else {
            return undefined;
        }
    }
    return undefined;
}

/** 记录名 → 运行时可直接解析的 normalized 请求串(前缀 15 字节,第 16 个 & 属于记录名) */
function normalizedRequestForRecord(recordName: string): string {
    const bare = recordName.startsWith("&") ? recordName.slice(1) : recordName;
    return `@normalized:N&&&${bare}`;
}

/**
 * class 注入要求 hook 源码声明同名函数(编译后成为 hook class 的 `#*#<name>` 方法)。
 * 函数声明会被改写成 `export function` —— 目标 module 需要 import 这个导出。
 */
function buildHookClassSource(hookNames: string[], source: string): string {
    let result = source.trim();
    for (const hookName of hookNames) {
        if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(hookName)) {
            throw new PandaPatchError(`invalid hook name '${hookName}'`);
        }
        const declaration = new RegExp(`(?:^|[\\s;}])(?:async\\s+)?function\\s+${hookName}\\b`);
        if (!declaration.test(result)) {
            throw new PandaPatchError(
                "moving the hook class requires the hook source to declare "
                + `'function ${hookName}(...)'`);
        }

        if (new RegExp(`(?:^|[\\s;}])export\\s+default\\s+(?:async\\s+)?function\\s+${hookName}\\b`).test(result)) {
            throw new PandaPatchError(
                `the hook module cannot use 'export default function ${hookName}'; `
                + `declare 'export function ${hookName}(...)' instead`);
        }
        const exportedFunction = new RegExp(`(?:^|[\\s;}])export\\s+(?:async\\s+)?function\\s+${hookName}\\b`);
        const exportedSpecifier = new RegExp(`\\bexport\\s*\\{[^}]*\\b${hookName}\\b[^}]*\\}`);
        if (exportedFunction.test(result) || exportedSpecifier.test(result)) continue;
        const match = new RegExp(`(^|[\\s;}])((?:async\\s+)?function\\s+${hookName}\\b)`).exec(result);
        if (!match) {
            throw new PandaPatchError(
                "moving the hook class requires the hook source to declare "
                + `'function ${hookName}(...)'`);
        }
        const insertAt = match.index + match[1].length;
        result = `${result.slice(0, insertAt)}export ${result.slice(insertAt)}`;
    }
    return `${result}\n`;
}

function $0(){

}