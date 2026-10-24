import type { IPandaFile } from "../IPandaFile";
import { PandaFileUtils } from "../PandaFileUtils";
import { PandaClass } from "../clazz/PandaClass";
import { PandaProto } from "./PandaProto";
import { Offset } from "./Offset";

export const INDEX_HEADER_SIZE = 10 * 4;

/**
 * RegionHeader(移植自 Java jmp0.abc.file.desc.IndexHeader)
 *
 * struct RegionHeader {
 *     uint32_t start;
 *     uint32_t end;
 *     uint32_t class_idx_size;
 *     uint32_t class_idx_off;
 *     uint32_t method_idx_size;
 *     uint32_t method_idx_off;
 *     uint32_t field_idx_size;
 *     uint32_t field_idx_off;
 *     uint32_t proto_idx_size;
 *     uint32_t proto_idx_off;
 * };
 *
 * 从 12.0.1.0 起 field/proto 索引被 0xffffffff 置为无效。
 * @Author: jmp0
 */
export class IndexHeader {
    readonly start: number;
    readonly end: number;
    readonly classIdxSize: number;
    readonly classIdxOff: number;
    readonly methodIdxSize: number;
    readonly methodIdxOff: number;
    readonly fieldIdxSize: number;
    readonly fieldIdxOff: number;
    readonly protoIdxSize: number;
    readonly protoIdxOff: number;

    readonly pandaClasses: PandaClass[];
    readonly pandaMethods: Offset[];
    readonly pandaFields: Offset[] | null;
    readonly pandaProtos: PandaProto[] | null;
    private moduleLiteralSet = new Set<number>();

    constructor(private readonly pandaFile: IPandaFile, index: number) {
        const bs = PandaFileUtils.readSubBytes(pandaFile.data, index, INDEX_HEADER_SIZE);
        let nowIndex = 0;
        this.start = PandaFileUtils.bytes2UnsignedInteger(bs, nowIndex); nowIndex += 4;
        this.end = PandaFileUtils.bytes2UnsignedInteger(bs, nowIndex); nowIndex += 4;
        this.classIdxSize = PandaFileUtils.bytes2UnsignedInteger(bs, nowIndex); nowIndex += 4;
        this.classIdxOff = PandaFileUtils.bytes2UnsignedInteger(bs, nowIndex); nowIndex += 4;
        this.methodIdxSize = PandaFileUtils.bytes2UnsignedInteger(bs, nowIndex); nowIndex += 4;
        this.methodIdxOff = PandaFileUtils.bytes2UnsignedInteger(bs, nowIndex); nowIndex += 4;
        this.fieldIdxSize = PandaFileUtils.bytes2UnsignedInteger(bs, nowIndex); nowIndex += 4;
        this.fieldIdxOff = PandaFileUtils.bytes2UnsignedInteger(bs, nowIndex); nowIndex += 4;
        this.protoIdxSize = PandaFileUtils.bytes2UnsignedInteger(bs, nowIndex); nowIndex += 4;
        this.protoIdxOff = PandaFileUtils.bytes2UnsignedInteger(bs, nowIndex); nowIndex += 4;

        this.pandaClasses = this.parseIndexHeaderClasses();
        this.pandaMethods = this.parseIndexHeaderMethods();
        this.pandaFields = this.parseIndexHeaderFields();
        this.pandaProtos = this.parseIndexHeaderProtos();
    }

    private parseIndexHeaderClasses(): PandaClass[] {
        const ret: PandaClass[] = [];
        for (let i = 0; i < this.classIdxSize; i++) {
            const off = PandaFileUtils.bytes2UnsignedInteger(this.pandaFile.data, this.classIdxOff + i * 4);
            ret.push(PandaClass.create(this.pandaFile, off, this));
        }
        return ret;
    }

    private parseIndexHeaderMethods(): Offset[] {
        const ret: Offset[] = [];
        for (let i = 0; i < this.methodIdxSize; i++) {
            ret.push(new Offset(this.pandaFile, PandaFileUtils.bytes2UnsignedInteger(this.pandaFile.data, this.methodIdxOff + i * 4)));
        }
        return ret;
    }

    private parseIndexHeaderFields(): Offset[] | null {
        if (this.fieldIdxOff === 0xffffffff) return null;
        const ret: Offset[] = [];
        for (let i = 0; i < this.fieldIdxSize; i++) {
            ret.push(new Offset(this.pandaFile, PandaFileUtils.bytes2UnsignedInteger(this.pandaFile.data, this.fieldIdxOff + i * 4)));
        }
        return ret;
    }

    private parseIndexHeaderProtos(): PandaProto[] | null {
        if (this.protoIdxOff === 0xffffffff) return null;
        const ret: PandaProto[] = [];
        for (let i = 0; i < this.protoIdxSize; i++) {
            ret.push(PandaProto.create(this.pandaFile, PandaFileUtils.bytes2UnsignedInteger(this.pandaFile.data, this.protoIdxOff + i * 4)));
        }
        return ret;
    }

    addModuleLiteral(offset: number): void {
        this.moduleLiteralSet.add(offset);
    }

    moduleLiteralContain(offset: number): boolean {
        return this.moduleLiteralSet.has(offset);
    }

    resolve(): void {
        for (const pandaClass of this.pandaClasses) {
            pandaClass.resolve();
        }
    }
}
