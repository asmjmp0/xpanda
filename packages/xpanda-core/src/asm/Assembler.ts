/**
 * Panda 字节码汇编器(由 opcodes.ts 的操作数布局驱动)与反向的原始指令解码。
 *
 * 设计目标:
 *   - 把 "指令名 + 操作数" 编码成字节码,用于向已有方法插入代码;
 *   - `decodeInstructions` 按同样的布局解码,供插入时定位指令边界、修正相对跳转;
 *   - 操作数顺序与 isa.yaml 的 sig 一致(v1/v2/imm/string_id...)。
 * @Author: jmp0
 */
import { FORMAT_PARAM_SIZE, LAST_INSTRUCTION_CODE, OPCODE_BY_CODE, OPCODES, OPCODE_FLAG } from "../disasm/opcodes";
import type { OpcodeInfo, OpcodeOperand } from "../disasm/opcodes";

export type OperandInput = Record<string, number> | number[] | number;

export interface AssembleOptions {
    /** 指定编码变体格式(如 'V8_V8');缺省选择第一个能容纳操作数的变体 */
    format?: string;
}

export interface DecodedInstruction {
    pc: number;
    size: number;
    opcode: OpcodeInfo;
    /** 编码顺序的原始操作数(寄存器号 / 立即数 / id) */
    operands: number[];
    /** 跳转指令相对偏移字段在指令内的字节偏移(相对 pc) */
    jumpImmediateOffset?: number;
    /** 跳转偏移位宽(8 / 16 / 32) */
    jumpBits?: number;
}

/** 指令头长度:普通指令 1 字节,prefixed 指令 2 字节(prefix + opcode) */
export function instructionHeaderSize(opcode: OpcodeInfo): number {
    return opcode.format.startsWith("PREF_") ? 2 : 1;
}

/** 指令总长度(含指令头与操作数) */
export function instructionSize(opcode: OpcodeInfo): number {
    return instructionHeaderSize(opcode) + (FORMAT_PARAM_SIZE[opcode.format] ?? 0);
}

/** 操作数起始字节偏移(4-bit 操作数按低位优先打包) */
function operandByteOffsets(operands: OpcodeOperand[]): number[] {
    const offsets: number[] = [];
    let byte = 0;
    let nibble = 0;
    for (const operand of operands) {
        offsets.push(byte);
        if (operand.bits === 4) {
            if (nibble === 0) nibble = 4;
            else { nibble = 0; byte++; }
        } else {
            byte += operand.bits / 8;
        }
    }
    return offsets;
}

/** 解码一段指令流(只做结构解析,不解析 id 指向的实体) */
export function decodeInstructions(code: Uint8Array): DecodedInstruction[] {
    const result: DecodedInstruction[] = [];
    let pc = 0;
    while (pc < code.length) {
        let value = code[pc];
        let header = 1;
        if (value >= LAST_INSTRUCTION_CODE) {
            if (pc + 1 >= code.length) throw new Error(`truncated prefixed instruction at pc ${pc}`);
            value |= (code[pc + 1] & 0xff) << 8;
            header = 2;
        }
        const opcode = OPCODE_BY_CODE.get(value);
        if (!opcode) throw new Error(`unknown opcode 0x${value.toString(16)} at pc ${pc}`);
        const size = header + (FORMAT_PARAM_SIZE[opcode.format] ?? 0);
        if (pc + size > code.length) throw new Error(`truncated instruction '${opcode.name}' at pc ${pc}`);

        const decoded: DecodedInstruction = { pc, size, opcode, operands: [] };
        const view = new DataView(code.buffer, code.byteOffset, code.byteLength);
        let byte = pc + header;
        let nibble = 0;
        opcode.operands.forEach((operand) => {
            if (operand.bits === 4) {
                const raw = view.getUint8(byte);
                const nibbleValue = nibble === 0 ? raw & 0xf : (raw >> 4) & 0xf;
                decoded.operands.push(operand.signed && nibbleValue >= 8 ? nibbleValue - 16 : nibbleValue);
                if (nibble === 0) nibble = 4;
                else { nibble = 0; byte++; }
            } else if (operand.bits === 64) {
                decoded.operands.push(view.getFloat64(byte, true));
                byte += 8;
            } else {
                if (operand.bits === 8) {
                    decoded.operands.push(operand.signed ? view.getInt8(byte) : view.getUint8(byte));
                } else if (operand.bits === 16) {
                    decoded.operands.push(operand.signed ? view.getInt16(byte, true) : view.getUint16(byte, true));
                } else if (operand.bits === 32) {
                    decoded.operands.push(operand.signed ? view.getInt32(byte, true) : view.getUint32(byte, true));
                } else {
                    throw new Error(`unsupported operand width ${operand.bits}`);
                }
                byte += operand.bits / 8;
            }
        });

        if ((opcode.flags & OPCODE_FLAG.JUMP) !== 0) {
            let lastImm = -1;
            for (let i = 0; i < opcode.operands.length; i++) {
                if (opcode.operands[i].kind === "imm") lastImm = i;
            }
            if (lastImm < 0) throw new Error(`jump instruction '${opcode.name}' has no imm operand`);
            decoded.jumpImmediateOffset = header + operandByteOffsets(opcode.operands)[lastImm];
            decoded.jumpBits = opcode.operands[lastImm].bits;
        }

        result.push(decoded);
        pc += size;
    }
    return result;
}

function resolveOperands(opcode: OpcodeInfo, input: OperandInput): number[] | null {
    if (typeof input === "number") {
        if (opcode.operands.length !== 1) return null;
        return [input];
    }
    if (Array.isArray(input)) {
        return input.length === opcode.operands.length ? input : null;
    }
    const values: number[] = [];
    for (const operand of opcode.operands) {
        const value = input[operand.name];
        if (value === undefined) return null;
        values.push(value);
    }
    return values;
}

function operandFits(operand: OpcodeOperand, value: number): boolean {
    if (!Number.isFinite(value)) return false;
    if (operand.kind === "imm" && operand.float) return true;
    if (operand.signed) {
        const limit = 2 ** (operand.bits - 1);
        return value >= -limit && value < limit;
    }
    return value >= 0 && value < 2 ** operand.bits;
}

function encodeVariant(opcode: OpcodeInfo, values: number[]): Uint8Array {
    const out: number[] = [];
    if (opcode.format.startsWith("PREF_")) {
        out.push(opcode.code & 0xff, (opcode.code >>> 8) & 0xff);
    } else {
        out.push(opcode.code & 0xff);
    }
    let pendingNibble: number | null = null;
    opcode.operands.forEach((operand, index) => {
        const value = values[index];
        if (operand.bits === 4) {
            if (pendingNibble === null) {
                pendingNibble = value & 0xf;
            } else {
                out.push((pendingNibble | ((value & 0xf) << 4)) & 0xff);
                pendingNibble = null;
            }
            return;
        }
        if (pendingNibble !== null) throw new Error(`unaligned 4-bit operand in '${opcode.name}'`);
        if (operand.bits === 8) {
            out.push(value & 0xff);
        } else if (operand.bits === 16) {
            out.push(value & 0xff, (value >>> 8) & 0xff);
        } else if (operand.bits === 32) {
            out.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
        } else if (operand.bits === 64) {
            const bytes = new Uint8Array(8);
            new DataView(bytes.buffer).setFloat64(0, value, true);
            out.push(...bytes);
        } else {
            throw new Error(`unsupported operand width ${operand.bits}`);
        }
    });
    if (pendingNibble !== null) throw new Error(`unaligned 4-bit operand in '${opcode.name}'`);
    return Uint8Array.from(out);
}

/**
 * 按指定编码变体重新编码一条指令(不自动选择变体)。
 * 用于帧调整等场景:需要保持原指令的变体,只改操作数。
 */
export function encodeInstructionWithOpcode(opcode: OpcodeInfo, operands: number[]): Uint8Array {
    if (operands.length !== opcode.operands.length) {
        throw new Error(`'${opcode.name}' expects ${opcode.operands.length} operands, got ${operands.length}`);
    }
    operands.forEach((value, index) => {
        if (!operandFits(opcode.operands[index], value)) {
            throw new Error(`operand '${opcode.operands[index].name}' value ${value} does not fit ${opcode.format}`);
        }
    });
    return encodeVariant(opcode, operands);
}

/**
 * 汇编单条指令。
 * 操作数既可按 sig 顺序传数组,也可按参数名传对象({ v1, v2, imm, string_id, ... });
 * 同一条指令有多个编码变体时,自动选择第一个能容纳所有操作数的变体。
 */
export function assembleInstruction(name: string, operands: OperandInput = [], options: AssembleOptions = {}): Uint8Array {
    const variants = OPCODES.filter((opcode) => opcode.name === name
        && (options.format === undefined || opcode.format === options.format));
    if (variants.length === 0) {
        throw new Error(`unknown instruction '${name}'${options.format ? ` with format ${options.format}` : ""}`);
    }
    const expected = variants[0].operands.map((operand) => operand.name).join(", ");
    for (const variant of variants) {
        const values = resolveOperands(variant, operands);
        if (values === null) continue;
        if (!values.every((value, index) => operandFits(variant.operands[index], value))) continue;
        return encodeVariant(variant, values);
    }
    throw new Error(`cannot encode '${name}' with operands ${JSON.stringify(operands)}; expected ${expected}`);
}

function parseNumber(token: string): number {
    if (/^[-+]?0x[0-9a-f]+$/i.test(token)) return parseInt(token, 16);
    const value = Number(token);
    if (!Number.isFinite(value)) throw new Error(`invalid operand '${token}'`);
    return value;
}

/**
 * 汇编一段文本,每条指令一行(分号或换行分隔):
 *
 *   nop
 *   ldai 1
 *   sta v0
 *   lda.str 12
 *
 * vN 表示寄存器,其余按数字/十六进制解析。
 */
export function assemble(source: string): Uint8Array {
    const parts: Uint8Array[] = [];
    for (const rawLine of source.split(/[;\n]/)) {
        const line = rawLine.trim();
        if (line.length === 0 || line.startsWith("#") || line.startsWith("//")) continue;
        const match = /^([^\s]+)\s*(.*)$/.exec(line);
        if (!match) continue;
        const name = match[1];
        const rest = match[2].trim();
        const values: number[] = [];
        if (rest.length > 0) {
            for (const token of rest.split(",").map((part) => part.trim()).filter((part) => part.length > 0)) {
                if (/^v\d+$/i.test(token)) values.push(parseInt(token.substring(1), 10));
                else values.push(parseNumber(token));
            }
        }
        parts.push(assembleInstruction(name, values));
    }
    let total = 0;
    for (const part of parts) total += part.length;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}
