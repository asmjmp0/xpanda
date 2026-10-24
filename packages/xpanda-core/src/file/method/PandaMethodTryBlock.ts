import type { IPandaFile } from "../IPandaFile";
import { Offset } from "../desc/Offset";
import { PandaMethodCatchBlock } from "./PandaMethodCatchBlock";

/**
 * try 块(移植自 Java jmp0.abc.file.method.PandaMethodTryBlock)
 * @Author: jmp0
 */
export class PandaMethodTryBlock extends Offset {
    readonly startPC: number;
    readonly length: number;
    readonly numCatches: number;
    readonly blockSize: number;
    readonly pandaMethodCatchBlocks: PandaMethodCatchBlock[];

    private constructor(pandaFile: IPandaFile, offset: number) {
        super(pandaFile, offset);
        let index = 0;
        const leb128 = pandaFile.leb128;
        leb128.decode2UnsignedInteger(offset + index);
        this.startPC = leb128.unsignedInteger; index += leb128.size;
        leb128.decode2UnsignedInteger(offset + index);
        this.length = leb128.unsignedInteger; index += leb128.size;
        leb128.decode2UnsignedInteger(offset + index);
        this.numCatches = leb128.unsignedInteger; index += leb128.size;
        this.pandaMethodCatchBlocks = [];
        for (let i = 0; i < this.numCatches; i++) {
            const catchBlock = PandaMethodCatchBlock.create(pandaFile, offset + index);
            this.pandaMethodCatchBlocks.push(catchBlock);
            index += catchBlock.getBlockSize();
        }
        this.blockSize = index;
    }

    static create(pandaFile: IPandaFile, offset: number): PandaMethodTryBlock {
        const cached = pandaFile.resolveOffset(offset);
        if (cached instanceof PandaMethodTryBlock) return cached;
        const b = new PandaMethodTryBlock(pandaFile, offset);
        pandaFile.addOffset(offset, b);
        return b;
    }

    getBlockSize(): number {
        return this.blockSize;
    }
}
