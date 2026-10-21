import type { IPandaFile } from "../IPandaFile";
import { PandaFileUtils } from "../PandaFileUtils";
import { Offset } from "../desc/Offset";
import type { PandaMethod } from "./PandaMethod";
import { PandaMethodTryBlock } from "./PandaMethodTryBlock";

/**
 * 方法指令体(移植自 Java jmp0.abc.file.method.PandaMethodCode)
 * @Author: jmp0
 */
export class PandaMethodCode extends Offset {
    readonly numVregs: number;
    readonly numArgs: number;
    readonly codeSize: number;
    readonly triesSize: number;
    readonly instructions: Uint8Array;
    pandaMethodTryBlocks: PandaMethodTryBlock[] | null = null;
    readonly sizeValue: number;

    private constructor(pandaFile: IPandaFile, offset: number, private readonly pandaMethod: PandaMethod) {
        super(pandaFile, offset);
        let index = 0;
        const leb128 = pandaFile.leb128;
        leb128.decode2UnsignedInteger(offset + index);
        this.numVregs = leb128.unsignedInteger; index += leb128.size;
        leb128.decode2UnsignedInteger(offset + index);
        this.numArgs = leb128.unsignedInteger; index += leb128.size;
        leb128.decode2UnsignedInteger(offset + index);
        this.codeSize = leb128.unsignedInteger; index += leb128.size;
        leb128.decode2UnsignedInteger(offset + index);
        this.triesSize = leb128.unsignedInteger; index += leb128.size;
        this.instructions = PandaFileUtils.readSubBytes(pandaFile.data, offset + index, this.codeSize);
        index += this.codeSize;
        if (this.triesSize > 0) {
            this.pandaMethodTryBlocks = [];
            for (let i = 0; i < this.triesSize; i++) {
                const tryBlock = PandaMethodTryBlock.create(pandaFile, offset + index);
                this.pandaMethodTryBlocks.push(tryBlock);
                index += tryBlock.getBlockSize();
            }
        }
        this.sizeValue = index;
    }

    static create(pandaFile: IPandaFile, offset: number, method: PandaMethod): PandaMethodCode {
        const cached = pandaFile.resolveOffset(offset);
        if (cached instanceof PandaMethodCode) return cached;
        const code = new PandaMethodCode(pandaFile, offset, method);
        pandaFile.addOffset(offset, code);
        return code;
    }

    getParent(): PandaMethod {
        return this.pandaMethod;
    }

    getSize(): number {
        return this.sizeValue;
    }
}
