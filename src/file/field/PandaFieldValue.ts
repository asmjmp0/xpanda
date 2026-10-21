import type { IPandaFile } from "../IPandaFile";
import { Offset } from "../desc/Offset";
import { PandaRawType } from "../desc/enums";
import { PandaParseException } from "../../PandaParseException";

/**
 * 字段静态值(移植自 Java jmp0.abc.file.field.PandaFieldValue)
 * VALUE tag 存储的是 4 字节偏移(this.offset),值本身位于该偏移处:
 *   U32/I32/F32 读 4 字节;I64/U64/F64 读 8 字节。
 * 注:Java 版对 8 字节类型误读了文件头部 magic 字节作为偏移(在 md5.abc 上未被触发),
 *     这里按与 4 字节类型对称的正确语义实现。
 * @Author: jmp0
 */
export class PandaFieldValue extends Offset {
    readonly pandaRawType: PandaRawType;
    readonly value: number | bigint;

    private constructor(pandaFile: IPandaFile, offset: number, rawType: PandaRawType) {
        super(pandaFile, offset);
        this.pandaRawType = rawType;
        const dv = new DataView(pandaFile.data.buffer, pandaFile.data.byteOffset, pandaFile.data.byteLength);
        const size = (rawType === PandaRawType.I64 || rawType === PandaRawType.U64 || rawType === PandaRawType.F64) ? 8 : 4;
        if (offset + size > pandaFile.data.byteLength || offset < 0) {
            throw new PandaParseException(
                `PandaFieldValue out of bounds: rawType=${PandaRawType[rawType]} offset=${offset} fileSize=${pandaFile.data.byteLength}`);
        }
        switch (rawType) {
            case PandaRawType.I64: {
                this.value = Number(dv.getBigInt64(offset, true));
                break;
            }
            case PandaRawType.U64: {
                this.value = dv.getBigUint64(offset, true);
                break;
            }
            case PandaRawType.F64: {
                this.value = dv.getFloat64(offset, true);
                break;
            }
            case PandaRawType.U32: {
                this.value = dv.getUint32(offset, true);
                break;
            }
            case PandaRawType.I32: {
                this.value = dv.getInt32(offset, true);
                break;
            }
            case PandaRawType.F32: {
                this.value = dv.getFloat32(offset, true);
                break;
            }
            default:
                throw new PandaParseException(PandaRawType[rawType] + " not supported!");
        }
    }

    static create(pandaFile: IPandaFile, offset: number, rawType: PandaRawType): PandaFieldValue {
        const cached = pandaFile.resolveOffset(offset);
        if (cached instanceof PandaFieldValue) return cached;
        const v = new PandaFieldValue(pandaFile, offset, rawType);
        pandaFile.addOffset(offset, v);
        return v;
    }

    toString(): string {
        return String(this.value);
    }
}
