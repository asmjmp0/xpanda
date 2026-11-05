/**
 * Low-level byte/instruction helpers shared by the patcher.
 * @Author: jmp0
 */
import { OPCODE_FLAG } from "xpanda-core";
import type { OpcodeInfo } from "xpanda-core";
import {
    assembleInstruction,
    decodeInstructions,
    encodeInstructionWithOpcode,
} from "../Assembler";
import type { MethodCode } from "./PatchTypes";
import { PandaPatchError as PatchError } from "./PatchTypes";

export function writeU32(target: Uint8Array, offset: number, value: number): void {
    target[offset] = value & 0xff;
    target[offset + 1] = (value >>> 8) & 0xff;
    target[offset + 2] = (value >>> 16) & 0xff;
    target[offset + 3] = (value >>> 24) & 0xff;
}

export function readSignedLE(bytes: Uint8Array, offset: number, width: number): number {
    if (width === 1) return (bytes[offset] << 24) >> 24;
    if (width === 2) return ((bytes[offset] | (bytes[offset + 1] << 8)) << 16) >> 16;
    if (width === 4) {
        return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24));
    }
    throw new PatchError(`unsupported jump immediate width ${width}`);
}

export function writeSignedLE(target: Uint8Array, offset: number, width: number, value: number): void {
    if (width === 1) {
        target[offset] = value & 0xff;
    } else if (width === 2) {
        target[offset] = value & 0xff;
        target[offset + 1] = (value >> 8) & 0xff;
    } else if (width === 4) {
        writeU32(target, offset, value);
    } else {
        throw new PatchError(`unsupported jump immediate width ${width}`);
    }
}

export function signedFits(value: number, bits: number): boolean {
    const limit = 2 ** (bits - 1);
    return value >= -limit && value < limit;
}

export function cloneMethodCode(code: MethodCode): MethodCode {
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
export function encodeWithFallback(opcode: OpcodeInfo, operands: number[]): Uint8Array {
    try {
        return encodeInstructionWithOpcode(opcode, operands);
    } catch {
        return assembleInstruction(opcode.name, operands);
    }
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

/** 方法内已使用的最大 IC slot(用于在方法头插入代码时分配新 slot) */
export function maxIcSlot(instructions: Uint8Array): number {
    let max = -1;
    for (const instruction of decodeInstructions(instructions)) {
        if ((instruction.opcode.flags & (OPCODE_FLAG.IC_SLOT | OPCODE_FLAG.JIT_IC_SLOT)) === 0) continue;
        instruction.opcode.operands.forEach((operand, index) => {
            if (operand.kind === "imm") max = Math.max(max, instruction.operands[index]);
        });
    }
    return max;
}

export function readU32At(bytes: Uint8Array, offset: number): number {
    return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

export function u32Bytes(value: number): Uint8Array {
    const out = new Uint8Array(4);
    writeU32(out, 0, value);
    return out;
}

export function writeU16(target: Uint8Array, offset: number, value: number): void {
    target[offset] = value & 0xff;
    target[offset + 1] = (value >>> 8) & 0xff;
}
