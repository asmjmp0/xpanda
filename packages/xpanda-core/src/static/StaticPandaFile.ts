import { Adler32 } from "../codec/Adler32";
import { Leb128 } from "../codec/Leb128";
import { PandaParseException } from "../PandaParseException";
import { PandaClass } from "../file/clazz/PandaClass";
import type { Header } from "../file/desc/Header";
import { IndexHeader } from "../file/desc/IndexHeader";
import { Offset } from "../file/desc/Offset";
import { PandaString } from "../file/desc/PandaString";
import type { IPandaFile } from "../file/IPandaFile";
import { PandaFileUtils } from "../file/PandaFileUtils";
import { StaticHeader, isStaticAbcVersion } from "./StaticHeader";
import { StaticPandaDisAssembler } from "./StaticPandaDisAssembler";

/**
 * ArkTS-Sta (.abc produced by the static runtime, version 0.1.0.7 family).
 *
 * This parser is intentionally independent from the dynamic {@link PandaFile}:
 * the 72-byte header and the header-owned class table are static-only. The
 * entity records (class/field/method/proto/code) are byte-compatible with the
 * dynamic format, so the existing entity classes are reused after the file
 * context is built.
 *
 * @Author: jmp0
 */
export class StaticPandaFile implements IPandaFile {
    readonly data: Uint8Array;
    readonly leb128: Leb128;
    readonly header: Header;
    readonly staticHeader: StaticHeader;
    readonly indexHeaders: IndexHeader[] = [];
    readonly lnpOffsets: Offset[] = [];
    readonly foreignPandaClasses: PandaClass[] = [];
    private readonly offsets = new Map<number, unknown>();

    constructor(data: Uint8Array) {
        this.data = data;
        this.leb128 = new Leb128(data);
        this.staticHeader = new StaticHeader(data, 0);
        const header = this.staticHeader;
        if (!isStaticAbcVersion(header.version)) {
            throw new PandaParseException("not an ArkTS-Sta abc, version " + header.versionString());
        }
        if (header.fileSize > data.length) {
            throw new PandaParseException("static abc file is truncated");
        }
        this.header = header as unknown as Header;

        const checksumOffset = 12;
        const adler32 = new Adler32();
        adler32.update(data, checksumOffset, header.fileSize - checksumOffset);
        const calcCheckSum = adler32.getValue() & 0x0fffffff;
        if (header.checksum !== calcCheckSum) {
            throw new PandaParseException(
                `Checksum check failed, the file may be encrypted. calcChecksum=${calcCheckSum} fileChecksum=${header.checksum}`);
        }

        for (let i = 0; i < header.numLnps; i++) {
            this.lnpOffsets.push(new Offset(this, PandaFileUtils.readOffsetValue(this, header.lnpIdxOff + i * 4)));
        }

        for (let i = 0; i < header.numIndexes; i++) {
            this.indexHeaders.push(new IndexHeader(this, header.indexSectionOff + i * INDEX_HEADER_SIZE_FOR_FILE));
        }

        // The region class index contains primitive type entries (their "offset"
        // is the field encoding, 0..12) and may omit classes that are never
        // referenced by an item. The header class table is the authoritative
        // `File::GetClasses()` list; append the local classes the region index
        // does not carry, while keeping the region positions intact for the
        // per-method class_idx resolution.
        this.appendHeaderOnlyClasses();
        for (const indexHeader of this.indexHeaders) {
            indexHeader.resolve();
        }
    }

    private appendHeaderOnlyClasses(): void {
        const header = this.staticHeader;
        if (header.classIdxOff === 0xffffffff || header.numClasses === 0) return;
        const indexHeader = this.indexHeaders[0];
        if (!indexHeader) return;
        const known = new Set<number>();
        for (const clazz of indexHeader.pandaClasses) known.add(clazz.getOffset());
        const foreignStart = header.foreignOff;
        const foreignEnd = foreignStart + header.foreignSize;
        const foreignSeen = new Set<number>();
        for (let i = 0; i < header.numClasses; i++) {
            const offset = PandaFileUtils.bytes2UnsignedInteger(this.data, header.classIdxOff + i * 4);
            if (offset >= foreignStart && offset < foreignEnd) {
                if (foreignSeen.has(offset)) continue;
                foreignSeen.add(offset);
                this.foreignPandaClasses.push(PandaClass.create(this, offset, indexHeader));
                continue;
            }
            if (known.has(offset)) continue;
            known.add(offset);
            indexHeader.pandaClasses.push(PandaClass.create(this, offset, indexHeader));
        }
    }

    resolveOffset(ptr: number): unknown | undefined {
        return this.offsets.get(ptr);
    }

    addOffset(ptr: number, obj: unknown): void {
        this.offsets.set(ptr, obj);
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

    getAllClasses(): PandaClass[] {
        const classes: PandaClass[] = [];
        for (const indexHeader of this.indexHeaders) {
            classes.push(...indexHeader.pandaClasses);
        }
        return classes;
    }

    /**
     * Disassemble every method so string/entity references are decoded and
     * cached, mirroring the dynamic PandaFile.parseAssembly(). One malformed
     * method must not abort the whole file.
     */
    parseAssembly(): void {
        for (const clazz of this.getAllClasses()) {
            for (const method of clazz.pandaMethods.values()) {
                if (!method.methodCode) continue;
                try {
                    StaticPandaDisAssembler.disAssembly(method);
                } catch {
                    // Keep the entities decoded by the other methods.
                }
            }
        }
    }

    /** All decoded strings (complete only after parseAssembly). */
    getAllStrings(): PandaString[] {
        const strings: PandaString[] = [];
        for (const value of this.offsets.values()) {
            if (value instanceof PandaString) strings.push(value);
        }
        return strings;
    }
}

const INDEX_HEADER_SIZE_FOR_FILE = 10 * 4;
