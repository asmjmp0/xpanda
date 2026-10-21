import { Adler32 } from "../codec/Adler32";
import { Leb128 } from "../codec/Leb128";
import { PandaParseException } from "../PandaParseException";
import { Header } from "./desc/Header";
import { IndexHeader } from "./desc/IndexHeader";
import { Offset } from "./desc/Offset";
import { PandaClass } from "./clazz/PandaClass";
import { PandaString } from "./desc/PandaString";
import type { IPandaFile } from "./IPandaFile";

export const ENTRY_FUNCTION_MAIN = "func_main_0";

/**
 * Panda (.abc) 文件(移植自 Java jmp0.abc.file.PandaFile)
 * @Author: jmp0
 */
export class PandaFile implements IPandaFile {
    readonly data: Uint8Array;
    readonly leb128: Leb128;
    readonly header: Header;
    readonly indexHeaders: IndexHeader[];
    private readonly offsets = new Map<number, unknown>();
    readonly lnpOffsets: Offset[];
    readonly foreignPandaClasses: PandaClass[];

    constructor(data: Uint8Array) {
        this.data = data;
        this.leb128 = new Leb128(data);
        this.header = new Header(data, 0);

        // 校验 checksum
        const checksumOffset = 12;
        const adler32 = new Adler32();
        adler32.update(data, checksumOffset, data.length - checksumOffset);
        const calcCheckSum = adler32.getValue() & 0x0fffffff;
        if (this.header.checksum !== calcCheckSum) {
            throw new PandaParseException(
                `Checksum check failed,the file may be encrypted. calcChecksum=${calcCheckSum} fileChecksum=${this.header.checksum}`);
        }

        // 解析 lnp 偏移表
        const lnpSize = this.header.numLnps;
        this.lnpOffsets = [];
        for (let i = 0; i < lnpSize; i++) {
            const off = PandaFile_readOffsetValue(this, this.header.lnpIdxOff + i * 4);
            this.lnpOffsets.push(new Offset(this, off));
        }

        // 解析 RegionHeader
        const regionHeaderSize = this.header.numIndexes;
        this.indexHeaders = [];
        for (let i = 0; i < regionHeaderSize; i++) {
            this.indexHeaders.push(new IndexHeader(this, this.header.indexSectionOff + i * INDEX_HEADER_SIZE_FOR_FILE));
        }
        for (const indexHeader of this.indexHeaders) {
            indexHeader.resolve();
        }

        // 解析 foreign classes
        const foreignPandaClasses: PandaClass[] = [];
        let foreignIndex = 0;
        while (foreignIndex < this.header.foreignSize) {
            const pandaClass = PandaClass.create(this, this.header.foreignOff + foreignIndex, this.indexHeaders[0]);
            foreignIndex += pandaClass.index;
            foreignPandaClasses.push(pandaClass);
        }
        this.foreignPandaClasses = foreignPandaClasses;
    }

    static from(path: string): PandaFile {
        const fs = require("fs");
        return new PandaFile(new Uint8Array(fs.readFileSync(path)));
    }

    resolveIndexHeaderByOffset(offset: Offset): IndexHeader | null {
        if (!offset.isValid()) return null;
        for (const indexHeader of this.indexHeaders) {
            if (offset.getOffset() >= indexHeader.start && offset.getOffset() < indexHeader.end) {
                return indexHeader;
            }
        }
        return null;
    }

    resolveOffset(ptr: number): unknown | undefined {
        return this.offsets.get(ptr);
    }

    addOffset(ptr: number, obj: unknown): void {
        this.offsets.set(ptr, obj);
    }

    /** 获取所有已解析的类 */
    getAllClasses(): PandaClass[] {
        const classes: PandaClass[] = [];
        for (const indexHeader of this.indexHeaders) {
            classes.push(...indexHeader.pandaClasses);
        }
        return classes;
    }

    /** 反汇编所有类的所有方法 */
    parseAssembly(): void {
        for (const indexHeader of this.indexHeaders) {
            for (const pandaClass of indexHeader.pandaClasses) {
                pandaClass.disAssembleAllMethods();
            }
        }
    }

    /** 导出所有已解析的字符串 */
    dumpAllString(): string {
        this.parseAssembly();
        const sb: string[] = [];
        for (const value of this.offsets.values()) {
            if (value instanceof PandaString) {
                sb.push(value.getOffset() + "->" + value.content + "\n");
            }
        }
        return sb.join("");
    }
}

function PandaFile_readOffsetValue(pandaFile: PandaFile, index: number): number {
    const dv = new DataView(pandaFile.data.buffer, pandaFile.data.byteOffset, pandaFile.data.byteLength);
    const value = dv.getInt32(index, true);
    return value === -1 ? 0xffffffff : (value & 0x0fffffff);
}

const INDEX_HEADER_SIZE_FOR_FILE = 10 * 4;
