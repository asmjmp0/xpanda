/**
 * CodeItem / try/catch 块的编码。
 *
 * CodeItem 布局(与 libpandafile 一致):
 *   uleb128 num_vregs
 *   uleb128 num_args
 *   uleb128 code_size
 *   uleb128 tries_size
 *   uint8_t instructions[code_size]
 *   TryBlock tries[tries_size]
 *
 * TryBlock 布局:
 *   uleb128 start_pc
 *   uleb128 length
 *   uleb128 num_catches
 *   CatchBlock catches[num_catches]
 *
 * CatchBlock 布局:
 *   uleb128 type_idx      (0 表示 catch-all)
 *   uleb128 handler_pc
 *   uleb128 code_size
 * @Author: jmp0
 */
import { concatBytes, writeUleb128 } from "./codec";

export interface CatchBlockInput {
    /** 捕获类型在类索引表中的 id,0 表示 catch-all */
    typeIdx: number;
    handlerPC: number;
    codeSize: number;
}

export interface TryBlockInput {
    startPC: number;
    length: number;
    catches: CatchBlockInput[];
}

export interface MethodCodeInput {
    numVregs: number;
    numArgs: number;
    instructions: Uint8Array;
    tries?: TryBlockInput[];
}

/** 编码一个 CodeItem */
export function encodeMethodCode(code: MethodCodeInput): Uint8Array {
    const tries = code.tries ?? [];
    const parts: Uint8Array[] = [
        writeUleb128(code.numVregs),
        writeUleb128(code.numArgs),
        writeUleb128(code.instructions.length),
        writeUleb128(tries.length),
        code.instructions,
    ];
    for (const tryBlock of tries) {
        parts.push(writeUleb128(tryBlock.startPC));
        parts.push(writeUleb128(tryBlock.length));
        parts.push(writeUleb128(tryBlock.catches.length));
        for (const catchBlock of tryBlock.catches) {
            parts.push(writeUleb128(catchBlock.typeIdx));
            parts.push(writeUleb128(catchBlock.handlerPC));
            parts.push(writeUleb128(catchBlock.codeSize));
        }
    }
    return concatBytes(parts);
}
