import type { IPandaFile } from "../IPandaFile";
import { Offset } from "../desc/Offset";

/**
 * catch 块(移植自 Java jmp0.abc.file.method.PandaMethodCatchBlock)
 * @Author: jmp0
 */
export class PandaMethodCatchBlock extends Offset {
    readonly typeIdx: number;
    readonly handlerPC: number;
    readonly codeSize: number;
    readonly blockSize: number;

    private constructor(pandaFile: IPandaFile, offset: number) {
        super(pandaFile, offset);
        let index = 0;
        const leb128 = pandaFile.leb128;
        leb128.decode2UnsignedInteger(offset + index);
        this.typeIdx = leb128.unsignedInteger; index += leb128.size;
        leb128.decode2UnsignedInteger(offset + index);
        this.handlerPC = leb128.unsignedInteger; index += leb128.size;
        leb128.decode2UnsignedInteger(offset + index);
        this.codeSize = leb128.unsignedInteger; index += leb128.size;
        this.blockSize = index;
    }

    static create(pandaFile: IPandaFile, offset: number): PandaMethodCatchBlock {
        const cached = pandaFile.resolveOffset(offset);
        if (cached instanceof PandaMethodCatchBlock) return cached;
        const b = new PandaMethodCatchBlock(pandaFile, offset);
        pandaFile.addOffset(offset, b);
        return b;
    }

    getBlockSize(): number {
        return this.blockSize;
    }
}
