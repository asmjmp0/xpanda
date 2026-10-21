import { PandaParseException } from "../../PandaParseException";
import type { IPandaFile } from "../IPandaFile";
import { PandaFileUtils } from "../PandaFileUtils";
import { Offset } from "../desc/Offset";
import { LiteralTag, literalTagOf } from "../desc/enums";
import { PandaString } from "../desc/PandaString";
import { PandaMethod } from "../method/PandaMethod";
import { PandaLiteral } from "./PandaLiteral";

/**
 * 字面量数组(移植自 Java jmp0.abc.file.literal.PandaLiteralArray)
 * 布局:u32 numLiterals + N 个 (tag, value) 对
 * @Author: jmp0
 */
export class PandaLiteralArray extends Offset {
    readonly numLiterals: number;
    readonly pandaLiterals: Offset[];

    private constructor(pandaFile: IPandaFile, offset: number) {
        super(pandaFile, offset);
        let index = 0;
        this.numLiterals = PandaFileUtils.bytes2UnsignedInteger(pandaFile.data, offset + index);
        index += 4;
        const realSize = Math.trunc(this.numLiterals / 2);
        this.pandaLiterals = new Array(realSize);
        for (let i = 0; i < realSize; i++) {
            const value = pandaFile.data[offset + index];
            const tag = literalTagOf(value);
            if (tag === null) {
                throw new PandaParseException("LiteralTag get null tag_value:" + value);
            }
            index++;
            switch (tag) {
                case LiteralTag.STRING: {
                    const dest = PandaFileUtils.bytes2UnsignedInteger(pandaFile.data, offset + index);
                    this.pandaLiterals[i] = PandaString.create(pandaFile, dest);
                    index += 4;
                    break;
                }
                case LiteralTag.GETTER:
                case LiteralTag.SETTER:
                case LiteralTag.METHOD:
                case LiteralTag.GENERATORMETHOD:
                case LiteralTag.ASYNCGENERATORMETHOD: {
                    const dest = PandaFileUtils.bytes2UnsignedInteger(pandaFile.data, offset + index);
                    this.pandaLiterals[i] = PandaMethod.create(pandaFile, dest);
                    index += 4;
                    break;
                }
                case LiteralTag.INTEGER:
                case LiteralTag.FLOAT:
                case LiteralTag.LITERALBUFFERINDEX: {
                    this.pandaLiterals[i] = PandaLiteral.create(pandaFile, offset + index, tag);
                    index += 4;
                    break;
                }
                case LiteralTag.LITERALARRAY: {
                    const la = PandaFileUtils.bytes2UnsignedInteger(pandaFile.data, offset + index);
                    this.pandaLiterals[i] = PandaLiteralArray.create(pandaFile, la);
                    index += 4;
                    break;
                }
                case LiteralTag.ARRAY_U1:
                case LiteralTag.ARRAY_U8:
                case LiteralTag.ARRAY_I8:
                case LiteralTag.ARRAY_U16:
                case LiteralTag.ARRAY_I16:
                case LiteralTag.ARRAY_U32:
                case LiteralTag.ARRAY_I32:
                case LiteralTag.ARRAY_U64:
                case LiteralTag.ARRAY_I64:
                case LiteralTag.ARRAY_F32:
                case LiteralTag.ARRAY_F64:
                case LiteralTag.ARRAY_STRING: {
                    this.pandaLiterals[i] = PandaLiteral.create(pandaFile, offset + index, tag);
                    i = realSize; // 与 Java 一致:遇到数组字面量即结束
                    break;
                }
                case LiteralTag.DOUBLE: {
                    this.pandaLiterals[i] = PandaLiteral.create(pandaFile, offset + index, tag);
                    index += 8;
                    break;
                }
                case LiteralTag.TAGVALUE:
                case LiteralTag.BOOL:
                case LiteralTag.BUILTINTYPEINDEX:
                case LiteralTag.ACCESSOR:
                case LiteralTag.NULLVALU: {
                    this.pandaLiterals[i] = PandaLiteral.create(pandaFile, offset + index, tag);
                    index += 1;
                    break;
                }
                case LiteralTag.METHODAFFILIATE: {
                    this.pandaLiterals[i] = PandaLiteral.create(pandaFile, offset + index, tag);
                    index += 2;
                    break;
                }
                default:
                    throw new PandaParseException("LiteralTag unknown!");
            }
        }
    }

    static create(pandaFile: IPandaFile, offset: number): PandaLiteralArray {
        const cached = pandaFile.resolveOffset(offset);
        if (cached instanceof PandaLiteralArray) return cached;
        const arr = new PandaLiteralArray(pandaFile, offset);
        pandaFile.addOffset(offset, arr);
        return arr;
    }

    getLiterals(): Offset[] {
        return this.pandaLiterals;
    }
}
