import { PandaParseException } from "../../PandaParseException";
import type { IPandaFile } from "../IPandaFile";
import { PandaFileUtils } from "../PandaFileUtils";
import { Offset } from "./Offset";
import { PandaRawType, pandaRawTypeOf, isPrimitiveRawType } from "./enums";

const SHORTY_ELEM_SIZE = 2;
const SHORTY_ELEM_WIDTH = 4;
const SHORTY_ELEM_MASK = 0xf;
const SHORTY_ELEM_PER16 = 4;

/**
 * 方法原型 shorty(移植自 Java jmp0.abc.file.proto.PandaProto)
 * @Author: jmp0
 */
export class PandaProto extends Offset {
    readonly pandaRawTypes: PandaRawType[];
    readonly numRef: number;
    readonly sizeValue: number;
    readonly vList: number[] = [];

    constructor(pandaFile: IPandaFile, offset: number) {
        super(pandaFile, offset);
        const rawTypes: PandaRawType[] = [];
        let index = 0;
        let v = PandaFileUtils.bytes2Uint16(pandaFile.data, offset + index);
        this.vList.push(v);
        index += 2;
        let numRef = 0;
        let elemNum = 0;
        while (v !== 0) {
            const shift = (elemNum % SHORTY_ELEM_PER16) * SHORTY_ELEM_WIDTH;
            const elem = (v >> shift) & SHORTY_ELEM_MASK;
            if (elem === 0) break;
            elemNum++;
            const rawType = pandaRawTypeOf(elem);
            if (rawType === null) throw new PandaParseException("pandaRawType can not be resolved.");
            if (!isPrimitiveRawType(rawType)) numRef++;
            rawTypes.push(rawType);
            if ((elemNum % SHORTY_ELEM_PER16) === 0) {
                v = PandaFileUtils.bytes2Uint16(pandaFile.data, offset + index);
                this.vList.push(v);
                index += 2;
            }
        }
        this.pandaRawTypes = rawTypes;
        this.numRef = numRef;
        this.sizeValue = index + numRef * SHORTY_ELEM_SIZE;
    }

    static create(pandaFile: IPandaFile, offset: number): PandaProto {
        const cached = pandaFile.resolveOffset(offset);
        if (cached instanceof PandaProto) return cached;
        const proto = new PandaProto(pandaFile, offset);
        pandaFile.addOffset(offset, proto);
        return proto;
    }

    getSize(): number {
        return this.sizeValue;
    }
}
