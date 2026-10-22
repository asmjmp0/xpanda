import * as zlib from "zlib";

/**
 * 最小 ZIP 归档读取器(只读),供 HAP 应用包解析使用。
 * HAP 本质是 ZIP 容器,字节码位于 ets/modules.abc 等条目中。
 *
 * 仅实现按 PKWARE APPNOTE.txt 必需的结构:
 *   - EOCD(0x06054b50)从文件尾部向前扫描定位
 *   - 中央目录项(0x02014b50)解析条目元数据
 *   - 本地文件头(0x04034b50)确定条目数据真实起始偏移
 * 解压支持 store(0)与 deflate(8)(经 zlib inflateRaw),与
 * reference/arkcompiler_runtime_core/libziparchive 的读取语义一致;
 * 不支持 ZIP64 与加密条目(HAP 应用包当前不使用)。
 * @Author: jmp0
 */

const EOCD_SIGNATURE = 0x06054b50;
const CEN_SIGNATURE = 0x02014b50;
const LOC_SIGNATURE = 0x04034b50;
/** EOCD 固定部分长度(不含注释) */
const EOCD_MIN_LENGTH = 22;
/** 中央目录项固定部分长度(不含变长字段) */
const CEN_MIN_LENGTH = 46;
/** 本地文件头固定部分长度(不含变长字段) */
const LOC_MIN_LENGTH = 30;
/** EOCD 注释最大长度(APPNOTE 上限,用于向前扫描范围) */
const EOCD_COMMENT_MAX = 0xffff;

/** ZIP 条目(中央目录记录的元数据 + 按需解压) */
export class ZipEntry {
    constructor(
        readonly name: string,
        readonly compressionMethod: number,
        readonly compressedSize: number,
        readonly uncompressedSize: number,
        readonly localHeaderOffset: number,
        private readonly archive: ZipFile,
    ) {}

    isDirectory(): boolean {
        return this.name.endsWith("/");
    }

    /** 解压并返回条目内容(每次调用独立解压,不做缓存) */
    read(): Uint8Array {
        return this.archive.readEntry(this);
    }
}

export class ZipFile {
    private readonly entryList: ZipEntry[] = [];
    private readonly entryByName = new Map<string, ZipEntry>();

    constructor(readonly data: Uint8Array) {
        this.parseCentralDirectory();
    }

    /** 文件前若干字节判断是否为 ZIP 容器(PK\x03\x04 / PK\x05\x06 / PK\x07\x08) */
    static isZip(data: Uint8Array): boolean {
        return data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b
            && (data[2] === 0x03 || data[2] === 0x05 || data[2] === 0x07);
    }

    /** 中央目录中的全部条目(保持归档内顺序,含目录条目) */
    get entries(): readonly ZipEntry[] {
        return this.entryList;
    }

    hasEntry(name: string): boolean {
        return this.entryByName.has(name);
    }

    getEntry(name: string): ZipEntry | null {
        return this.entryByName.get(name) ?? null;
    }

    /** 读取并解压指定条目,条目不存在时返回 null */
    readEntryByName(name: string): Uint8Array | null {
        const entry = this.entryByName.get(name);
        return entry ? this.readEntry(entry) : null;
    }

    readEntry(entry: ZipEntry): Uint8Array {
        const view = new DataView(this.data.buffer, this.data.byteOffset, this.data.byteLength);
        const locOffset = entry.localHeaderOffset;
        if (locOffset + LOC_MIN_LENGTH > this.data.length || view.getUint32(locOffset, true) !== LOC_SIGNATURE) {
            throw new Error("zip: bad local header for " + entry.name);
        }
        // 数据偏移以本地文件头自身的变长字段长度为准(与中央目录可能不一致)
        const nameLength = view.getUint16(locOffset + 26, true);
        const extraLength = view.getUint16(locOffset + 28, true);
        const dataStart = locOffset + LOC_MIN_LENGTH + nameLength + extraLength;
        const raw = this.data.subarray(dataStart, dataStart + entry.compressedSize);
        switch (entry.compressionMethod) {
            case 0: // store
                return raw;
            case 8: { // deflate(raw deflate 流,无 zlib 头)
                const inflated = zlib.inflateRawSync(Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength));
                return new Uint8Array(inflated.buffer, inflated.byteOffset, inflated.byteLength);
            }
            default:
                throw new Error("zip: unsupported compression method " + entry.compressionMethod + " for " + entry.name);
        }
    }

    private parseCentralDirectory(): void {
        const eocdOffset = this.locateEOCD();
        const view = new DataView(this.data.buffer, this.data.byteOffset, this.data.byteLength);
        const entryCount = view.getUint16(eocdOffset + 10, true);
        const cdSize = view.getUint32(eocdOffset + 12, true);
        let offset = view.getUint32(eocdOffset + 16, true);
        const cdEnd = offset + cdSize;
        if (offset + cdSize > this.data.length) throw new Error("zip: central directory out of range");
        for (let i = 0; i < entryCount && offset < cdEnd; i++) {
            if (view.getUint32(offset, true) !== CEN_SIGNATURE) throw new Error("zip: bad central directory entry at " + offset);
            const flags = view.getUint16(offset + 8, true);
            if (flags & 0x1) throw new Error("zip: encrypted entry not supported");
            const method = view.getUint16(offset + 10, true);
            const compressedSize = view.getUint32(offset + 20, true);
            const uncompressedSize = view.getUint32(offset + 24, true);
            const nameLength = view.getUint16(offset + 28, true);
            const extraLength = view.getUint16(offset + 30, true);
            const commentLength = view.getUint16(offset + 32, true);
            const localHeaderOffset = view.getUint32(offset + 42, true);
            const nameBytes = this.data.subarray(offset + CEN_MIN_LENGTH, offset + CEN_MIN_LENGTH + nameLength);
            const name = Buffer.from(nameBytes.buffer, nameBytes.byteOffset, nameBytes.byteLength).toString("utf8");
            const entry = new ZipEntry(name, method, compressedSize, uncompressedSize, localHeaderOffset, this);
            this.entryList.push(entry);
            this.entryByName.set(name, entry);
            offset += CEN_MIN_LENGTH + nameLength + extraLength + commentLength;
        }
    }

    /** 从尾部向前扫描 EOCD(注释长度作一致性校验),返回 EOCD 偏移 */
    private locateEOCD(): number {
        const view = new DataView(this.data.buffer, this.data.byteOffset, this.data.byteLength);
        const minOffset = Math.max(0, this.data.length - EOCD_MIN_LENGTH - EOCD_COMMENT_MAX);
        for (let offset = this.data.length - EOCD_MIN_LENGTH; offset >= minOffset; offset--) {
            if (view.getUint32(offset, true) !== EOCD_SIGNATURE) continue;
            const commentLength = view.getUint16(offset + 20, true);
            if (offset + EOCD_MIN_LENGTH + commentLength > this.data.length) continue;
            return offset;
        }
        throw new Error("zip: end of central directory not found");
    }
}
