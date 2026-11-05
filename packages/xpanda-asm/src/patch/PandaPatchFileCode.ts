/**
 * Method body editing: instruction insertion and frame growth.
 * @Author: jmp0
 */
import { OPCODE_FLAG } from "xpanda-core";
import type { OpcodeInfo } from "xpanda-core";
import { decodeInstructions } from "../Assembler";
import type { DecodedInstruction } from "../Assembler";
import { encodeWithFallback, readSignedLE, sameBytes, signedFits, writeSignedLE } from "./PatchBinary";
import { PandaPatchError } from "./PatchTypes";
import type { InsertInstructionsOptions, InsertInstructionsResult, MethodCode } from "./PatchTypes";
import type { TryBlockInput } from "../MethodCode";
import { PandaPatchFileEntities } from "./PandaPatchFileEntities";

export class PandaPatchFileCode extends PandaPatchFileEntities {
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

        // 插入代码可能使用更高的局部寄存器;参数寄存器(index >= numVregs)不占局部寄存器空间
        let numVregs = current.numVregs;
        for (const instruction of insertedDecoded) {
            instruction.opcode.operands.forEach((operand, index) => {
                if (operand.kind === "v") {
                    const register = instruction.operands[index];
                    if (register < current.numVregs && register + 1 > numVregs) numVregs = register + 1;
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
     *
     * 注入的前导等价于:
     *   const res = hook(this, arguments);
     *   if (res.arg) { p0 = res.arg[0]; p1 = res.arg[1]; ... }
     *   if (res.res) { return res.res; }
     *
     * 参数直接写回参数寄存器:局部寄存器之后的前 3 个是
     * func_name / new.target / this,p0 从 `numVregs + 3` 开始。
     * `res.arg` 按数组/类数组下标读取(等价于 `[p0, p1] = res.arg`)。
     *
     * `patchSlot` 给定时,函数从 `wide.ldpatchvar` 读取。槽里是 hole / undefined / 其它
     * falsy 值则跳过整个前导(原方法照常执行)。调用方必须先在模块初始化里
     * `wide.stpatchvar` 把数组扩到这个下标,空表上的 load 是越界读。
     */

    protected growFrame(code: MethodCode, delta: number): { instructions: Uint8Array; tries: TryBlockInput[] } {
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
    protected assertRangeDoesNotCrossFrameBoundary(instruction: DecodedInstruction, oldNumVregs: number): void {
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

}
