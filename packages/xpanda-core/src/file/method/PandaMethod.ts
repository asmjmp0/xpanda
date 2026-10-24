import { PandaParseException } from "../../PandaParseException";
import type { IPandaFile } from "../IPandaFile";
import { PandaFileUtils } from "../PandaFileUtils";
import { Offset } from "../desc/Offset";
import { PandaString } from "../desc/PandaString";
import { PandaMethodTag } from "../desc/enums";
import type { PandaClass } from "../clazz/PandaClass";
import type { IndexHeader } from "../desc/IndexHeader";
import { PandaProto } from "../desc/PandaProto";
import { PandaMethodCode } from "./PandaMethodCode";
import type { PandaIRCFG } from "../../disasm/PandaIRCFG";

/**
 * 方法(移植自 Java jmp0.abc.file.method.PandaMethod)
 * @Author: jmp0
 */
export class PandaMethod extends Offset {
    readonly classIdx: number;
    readonly protoIdx: number;
    pandaClass: PandaClass | null = null;
    pandaProto: PandaProto | null = null;
    readonly indexHeader: IndexHeader | null;
    readonly name: PandaString;
    readonly sizeValue: number;
    readonly accessFlag: number;
    readonly methodExternal: boolean;
    methodCode: PandaMethodCode | null = null;
    debugInfoOffset = 0;
    sourceLang = 0;
    annotationOffsets: number[] = [];

    constructor(pandaFile: IPandaFile, offset: number) {
        super(pandaFile, offset);
        this.indexHeader = pandaFile.resolveIndexHeaderByOffset(this);
        let index = 0;
        this.classIdx = PandaFileUtils.bytes2Uint16(pandaFile.data, offset + index); index += 2;
        this.protoIdx = PandaFileUtils.bytes2Uint16(pandaFile.data, offset + index); index += 2;
        this.name = PandaString.create(pandaFile, PandaFileUtils.readOffsetValue(pandaFile, offset + index)); index += 4;
        const leb128 = pandaFile.leb128;
        leb128.decode2UnsignedInteger(offset + index);
        this.accessFlag = leb128.unsignedInteger;
        this.methodExternal = this.isExternal();
        if (this.methodExternal) {
            index += leb128.size;
            leb128.decode2UnsignedInteger(offset + index);
            this.sizeValue = index;
            return;
        }
        index += leb128.size;
        let tag = pandaFile.data[this.offsetValue + index];
        while (tag !== PandaMethodTag.NOTHING) {
            index++;
            if (tag === PandaMethodTag.CODE) {
                const codeOffset = PandaFileUtils.bytes2UnsignedInteger(pandaFile.data, this.offsetValue + index);
                this.methodCode = PandaMethodCode.create(pandaFile, codeOffset, this);
                index += 4;
            } else if (tag === PandaMethodTag.SOURCE_LANG) {
                this.sourceLang = pandaFile.data[this.offsetValue + index];
                index += 1;
            } else if (tag === PandaMethodTag.RUNTIME_ANNOTATION) {
                throw new PandaParseException("PandaMethodTag.RUNTIME_ANNOTATION");
            } else if (tag === PandaMethodTag.RUNTIME_PARAM_ANNOTATION) {
                throw new PandaParseException("PandaMethodTag.RUNTIME_PARAM_ANNOTATION");
            } else if (tag === PandaMethodTag.DEBUG_INFO) {
                this.debugInfoOffset = PandaFileUtils.bytes2UnsignedInteger(pandaFile.data, this.offsetValue + index);
                index += 4;
            } else if (tag === PandaMethodTag.ANNOTATION) {
                this.annotationOffsets.push(PandaFileUtils.bytes2UnsignedInteger(pandaFile.data, this.offsetValue + index));
                index += 4;
            } else if (tag === PandaMethodTag.PARAM_ANNOTATION) {
                throw new PandaParseException("PandaMethodTag.PARAM_ANNOTATION");
            } else if (tag === PandaMethodTag.TYPE_ANNOTATION) {
                throw new PandaParseException("PandaMethodTag.TYPE_ANNOTATION");
            } else if (tag === PandaMethodTag.RUNTIME_TYPE_ANNOTATION) {
                throw new PandaParseException("PandaMethodTag.RUNTIME_TYPE_ANNOTATION");
            }
            tag = pandaFile.data[this.offsetValue + index];
        }
        this.sizeValue = index + 1;
    }

    static create(pandaFile: IPandaFile, offset: number): PandaMethod {
        const cached = pandaFile.resolveOffset(offset);
        if (cached instanceof PandaMethod) return cached;
        const method = new PandaMethod(pandaFile, offset);
        pandaFile.addOffset(offset, method);
        return method;
    }

    resolve(): void {
        if (this.indexHeader) {
            if (this.classIdx < this.indexHeader.classIdxSize) this.pandaClass = this.indexHeader.pandaClasses[this.classIdx];
            if (this.protoIdx < this.indexHeader.protoIdxSize && this.indexHeader.pandaProtos) this.pandaProto = this.indexHeader.pandaProtos[this.protoIdx];
        }
    }

    getParent(): PandaClass | null {
        return this.pandaClass;
    }

    isMethodExternal(): boolean {
        return this.methodExternal;
    }

    hasException(): boolean {
        return this.methodCode?.pandaMethodTryBlocks != null;
    }

    getName(): PandaString {
        return this.name;
    }

    disAssemble(): PandaIRCFG | null {
        if (!this.methodCode) return null;
        // 延迟引入避免循环依赖
        const { PandaDisAssembler } = require("../../disasm/PandaDisAssembler");
        return PandaDisAssembler.disAssembly(this);
    }

    getSize(): number {
        return this.sizeValue;
    }

    toString(): string {
        return "method:" + this.name;
    }
}
