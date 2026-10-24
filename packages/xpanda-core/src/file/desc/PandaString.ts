import { MUTF8 } from "../../codec/MUTF8";
import type { IPandaFile } from "../IPandaFile";
import { Offset } from "./Offset";

/**
 * Panda 字符串(移植自 Java jmp0.abc.file.desc.PandaString)
 * 编码为 leb128(utf16Size) + MUTF8 字节 + NUL 终止符
 * utf16Size 最低位为 1 表示 ASCII
 * @Author: jmp0
 */
export class PandaString extends Offset {
    readonly utf16Size: number;
    readonly sizeValue: number;
    readonly isAscii: boolean;
    readonly content: string;

    /** 请使用 PandaString.create,构造器仅内部使用 */
    constructor(pandaFile: IPandaFile | null, offset: number | null) {
        super(pandaFile, offset);
        if (!pandaFile || offset === null || !this.isValid()) {
            this.utf16Size = 0;
            this.sizeValue = 0;
            this.content = "";
            this.isAscii = true;
            return;
        }
        const leb128 = pandaFile.leb128;
        leb128.decode2UnsignedInteger(this.offsetValue);
        this.utf16Size = leb128.unsignedInteger;
        this.isAscii = (this.utf16Size & 1) === 1;
        const byteSize = this.utf16Size >> 1;
        this.content = MUTF8.decode(pandaFile.data, this.offsetValue + leb128.size, byteSize);
        this.sizeValue = leb128.size + byteSize + 1;
    }

    static create(pandaFile: IPandaFile, offset: number): PandaString {
        const cached = pandaFile.resolveOffset(offset);
        if (cached instanceof PandaString) return cached;
        const str = new PandaString(pandaFile, offset);
        pandaFile.addOffset(offset, str);
        return str;
    }

    getSize(): number {
        return this.sizeValue;
    }

    toString(): string {
        return "\"" + this.content + "\"";
    }
}
