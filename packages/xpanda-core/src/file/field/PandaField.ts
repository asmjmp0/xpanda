import { PandaParseException } from "../../PandaParseException";
import type { IPandaFile } from "../IPandaFile";
import { PandaFileUtils } from "../PandaFileUtils";
import { Offset } from "../desc/Offset";
import { PandaString } from "../desc/PandaString";
import { PandaFieldTag } from "../desc/enums";
import { PandaRawType, toFieldType } from "../desc/enums";
import { PandaType } from "../type/PandaType";
import type { PandaClass } from "../clazz/PandaClass";
import type { IndexHeader } from "../desc/IndexHeader";
import { PandaFieldValue } from "./PandaFieldValue";

/**
 * 类字段(移植自 Java jmp0.abc.file.field.PandaField)
 * @Author: jmp0
 */
export class PandaField extends Offset {
    readonly classIdx: number;
    readonly typeIdx: number;
    pandaClass: PandaClass | null = null;
    pandaType: PandaType | null = null;
    readonly name: PandaString;
    readonly fieldExternal: boolean;
    readonly sizeValue: number;
    readonly accessFlag: number;
    intValue = 0;
    pandaRawValue: Offset | null = null;
    pandaFieldValue: PandaFieldValue | null = null;
    readonly tagList: number[] = [];

    constructor(pandaFile: IPandaFile, offset: number) {
        super(pandaFile, offset);
        let index = 0;
        this.classIdx = PandaFileUtils.bytes2Uint16(pandaFile.data, offset + index); index += 2;
        this.typeIdx = PandaFileUtils.bytes2Uint16(pandaFile.data, offset + index); index += 2;
        this.name = PandaString.create(pandaFile, PandaFileUtils.readOffsetValue(pandaFile, offset + index)); index += 4;
        const leb128 = pandaFile.leb128;
        this.fieldExternal = this.isExternal();
        if (this.fieldExternal) {
            this.sizeValue = index;
            this.accessFlag = 0;
            return;
        }
        leb128.decode2UnsignedInteger(offset + index);
        this.accessFlag = leb128.unsignedInteger;
        index += leb128.size;
        let tag = pandaFile.data[this.offsetValue + index];
        this.tagList.push(tag);
        while (tag !== PandaFieldTag.NOTHING) {
            index++;
            if (tag === PandaFieldTag.INT_VALUE) {
                leb128.decode2Integer(offset + index);
                this.intValue = leb128.signedResult;
                index += leb128.size;
            } else if (tag === PandaFieldTag.VALUE) {
                this.pandaRawValue = new Offset(pandaFile, PandaFileUtils.bytes2UnsignedInteger(pandaFile.data, offset + index));
                index += 4;
            } else if (tag === PandaFieldTag.RUNTIME_ANNOTATION) {
                throw new PandaParseException("PandaFieldTag.RUNTIME_ANNOTATION");
            } else if (tag === PandaFieldTag.ANNOTATION) {
                throw new PandaParseException("PandaFieldTag.ANNOTATION");
            } else if (tag === PandaFieldTag.RUNTIME_TYPE_ANNOTATION) {
                throw new PandaParseException("PandaFieldTag.RUNTIME_TYPE_ANNOTATION");
            } else if (tag === PandaFieldTag.TYPE_ANNOTATION) {
                throw new PandaParseException("PandaFieldTag.TYPE_ANNOTATION");
            }
            tag = pandaFile.data[this.offsetValue + index];
            this.tagList.push(tag);
        }
        this.sizeValue = index + 1;
    }

    static create(pandaFile: IPandaFile, offset: number): PandaField {
        const cached = pandaFile.resolveOffset(offset);
        if (cached instanceof PandaField) return cached;
        const field = new PandaField(pandaFile, offset);
        pandaFile.addOffset(offset, field);
        return field;
    }

    resolve(): void {
        const indexHeader = this.pandaFile!.resolveIndexHeaderByOffset(this);
        if (indexHeader) {
            if (this.classIdx < indexHeader.classIdxSize) this.pandaClass = indexHeader.pandaClasses[this.classIdx];
            if (this.typeIdx < indexHeader.classIdxSize) this.pandaType = new PandaType(indexHeader.pandaClasses[this.typeIdx], true);
        }
        if (this.pandaType && this.pandaRawValue) {
            this.pandaFieldValue = PandaFieldValue.create(this.pandaFile!, this.pandaRawValue.getOffset(), toFieldType(this.pandaType.rawType));
            if (this.pandaType.primitive && this.pandaType.rawType === PandaRawType.U32) {
                if (this.name.content === "moduleRecordIdx") {
                    (this.pandaClass!.getParent() as IndexHeader).addModuleLiteral(this.pandaRawValue.getOffset());
                }
            }
            this.pandaRawValue = null;
        }
    }

    getParent(): PandaClass | null {
        return this.pandaClass;
    }

    getName(): string {
        return this.name.content;
    }

    toString(): string {
        return "field:" + this.name;
    }

    getSize(): number {
        return this.sizeValue;
    }
}
