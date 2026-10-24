import type { IPandaFile } from "../IPandaFile";
import { Offset } from "../desc/Offset";
import { LiteralTag, literalTagSize } from "../desc/enums";
import { PandaParseException } from "../../PandaParseException";

/**
 * 字面量(移植自 Java jmp0.abc.file.literal.PandaLiteral 及其四个子类)
 * Java 的子类仅是字节宽度不同,这里统一由 tag 决定宽度
 * @Author: jmp0
 */
export class PandaLiteral extends Offset {
    readonly tag: LiteralTag;
    readonly valueByteArr: Uint8Array;
    size = 0;

    constructor(pandaFile: IPandaFile, offset: number, size: number, tag: LiteralTag) {
        super(pandaFile, offset);
        this.size = size;
        this.tag = tag;
        this.valueByteArr = pandaFile.data.subarray(offset, offset + size);
    }

    static create(pandaFile: IPandaFile, offset: number, tag: LiteralTag): PandaLiteral {
        const cached = pandaFile.resolveOffset(offset);
        if (cached instanceof PandaLiteral && cached.tag === tag) return cached;
        const lit = new PandaLiteral(pandaFile, offset, literalTagSize(tag), tag);
        pandaFile.addOffset(offset, lit);
        return lit;
    }

    getValue(): number {
        const dv = new DataView(this.valueByteArr.buffer, this.valueByteArr.byteOffset, this.valueByteArr.byteLength);
        switch (this.tag) {
            case LiteralTag.INTEGER: return dv.getInt32(0, true);
            case LiteralTag.FLOAT: return dv.getFloat32(0, true);
            case LiteralTag.DOUBLE: return dv.getFloat64(0, true);
            case LiteralTag.METHODAFFILIATE: return dv.getInt16(0, true);
            default: throw new PandaParseException("LiteralTag " + this.tag + " not known.");
        }
    }

    getSize(): number {
        return this.size;
    }

    toString(): string {
        switch (this.tag) {
            case LiteralTag.NULLVALU: return "null";
            case LiteralTag.BOOL: return String(this.valueByteArr[0] === 1);
            case LiteralTag.INTEGER:
            case LiteralTag.FLOAT:
            case LiteralTag.DOUBLE:
            case LiteralTag.METHODAFFILIATE:
                try {
                    return String(this.getValue());
                } catch { /* fallthrough */ }
                return LiteralTag[this.tag].toLowerCase() + ":" + Array.from(this.valueByteArr);
            default:
                return LiteralTag[this.tag].toLowerCase() + ":" + Array.from(this.valueByteArr);
        }
    }

    toByteArray(): Uint8Array {
        return this.valueByteArr.slice();
    }
}
