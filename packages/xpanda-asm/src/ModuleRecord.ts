/**
 * Panda module record(module 元数据 literal array)的二进制读写。
 *
 * 布局来自 libpandafile `ModuleDataAccessor`(所有 name/request 都是文件内
 * String 实体的绝对偏移):
 *
 *   literalNum
 *   numModuleRequests, requestOffset[u32] * n
 *   numRegularImports,  { localName[u32], importName[u32], moduleRequestIdx[u16] } * n
 *   numNamespaceImports,{ localName[u32], moduleRequestIdx[u16] } * n
 *   numLocalExports,    { localName[u32], exportName[u32] } * n
 *   numIndirectExports, { exportName[u32], importName[u32], moduleRequestIdx[u16] } * n
 *   numStarExports,     moduleRequestIdx[u16] * n
 *
 * literalNum 是该记录里"标量字段"的个数(6 个 section count + 每个 entry 的字段数),
 * 只被 LiteralDataAccessor 当普通 literal array 枚举时使用;运行时 ModuleDataAccessor
 * 直接跳过它。
 * @Author: jmp0
 */

export interface RegularImportEntry {
    localName: number;
    importName: number;
    moduleRequestIdx: number;
}

export interface NamespaceImportEntry {
    localName: number;
    moduleRequestIdx: number;
}

export interface LocalExportEntry {
    localName: number;
    exportName: number;
}

export interface IndirectExportEntry {
    exportName: number;
    importName: number;
    moduleRequestIdx: number;
}

export interface ModuleRecord {
    moduleRequests: number[];
    regularImports: RegularImportEntry[];
    namespaceImports: NamespaceImportEntry[];
    localExports: LocalExportEntry[];
    indirectExports: IndirectExportEntry[];
    starExports: number[];
}

class Cursor {
    private pos: number;

    constructor(private readonly data: Uint8Array, offset: number) {
        this.pos = offset;
    }

    u16(): number {
        this.need(2);
        const value = this.data[this.pos] | (this.data[this.pos + 1] << 8);
        this.pos += 2;
        return value;
    }

    u32(): number {
        this.need(4);
        const value = (this.data[this.pos]
            | (this.data[this.pos + 1] << 8)
            | (this.data[this.pos + 2] << 16)
            | (this.data[this.pos + 3] << 24)) >>> 0;
        this.pos += 4;
        return value;
    }

    private need(size: number): void {
        if (this.pos + size > this.data.length) {
            throw new Error(`module record truncated at ${this.pos} (+${size}), file size ${this.data.length}`);
        }
    }
}

/** 解析 offset 处的 module record(不校验实体边界,按结构读) */
export function readModuleRecord(data: Uint8Array, offset: number): ModuleRecord {
    const cursor = new Cursor(data, offset);
    cursor.u32(); // literalNum:结构重建时重新计算

    const requestCount = cursor.u32();
    const moduleRequests: number[] = [];
    for (let i = 0; i < requestCount; i++) moduleRequests.push(cursor.u32());

    const regularCount = cursor.u32();
    const regularImports: RegularImportEntry[] = [];
    for (let i = 0; i < regularCount; i++) {
        regularImports.push({
            localName: cursor.u32(),
            importName: cursor.u32(),
            moduleRequestIdx: cursor.u16(),
        });
    }

    const namespaceCount = cursor.u32();
    const namespaceImports: NamespaceImportEntry[] = [];
    for (let i = 0; i < namespaceCount; i++) {
        namespaceImports.push({ localName: cursor.u32(), moduleRequestIdx: cursor.u16() });
    }

    const localExportCount = cursor.u32();
    const localExports: LocalExportEntry[] = [];
    for (let i = 0; i < localExportCount; i++) {
        localExports.push({ localName: cursor.u32(), exportName: cursor.u32() });
    }

    const indirectExportCount = cursor.u32();
    const indirectExports: IndirectExportEntry[] = [];
    for (let i = 0; i < indirectExportCount; i++) {
        indirectExports.push({
            exportName: cursor.u32(),
            importName: cursor.u32(),
            moduleRequestIdx: cursor.u16(),
        });
    }

    const starCount = cursor.u32();
    const starExports: number[] = [];
    for (let i = 0; i < starCount; i++) starExports.push(cursor.u16());

    return { moduleRequests, regularImports, namespaceImports, localExports, indirectExports, starExports };
}

/** literalNum = 6 个 section count + 每个 entry 的字段数 */
export function moduleRecordLiteralNum(record: ModuleRecord): number {
    return 6
        + record.moduleRequests.length
        + record.regularImports.length * 3
        + record.namespaceImports.length * 2
        + record.localExports.length * 2
        + record.indirectExports.length * 3
        + record.starExports.length;
}

/** 把 module record 重新编码为 literal array 实体字节 */
export function encodeModuleRecord(record: ModuleRecord): Uint8Array {
    const parts: Uint8Array[] = [u32Bytes(moduleRecordLiteralNum(record))];

    parts.push(u32Bytes(record.moduleRequests.length));
    for (const request of record.moduleRequests) parts.push(u32Bytes(request));

    parts.push(u32Bytes(record.regularImports.length));
    for (const entry of record.regularImports) {
        parts.push(u32Bytes(entry.localName), u32Bytes(entry.importName), u16Bytes(entry.moduleRequestIdx));
    }

    parts.push(u32Bytes(record.namespaceImports.length));
    for (const entry of record.namespaceImports) {
        parts.push(u32Bytes(entry.localName), u16Bytes(entry.moduleRequestIdx));
    }

    parts.push(u32Bytes(record.localExports.length));
    for (const entry of record.localExports) {
        parts.push(u32Bytes(entry.localName), u32Bytes(entry.exportName));
    }

    parts.push(u32Bytes(record.indirectExports.length));
    for (const entry of record.indirectExports) {
        parts.push(u32Bytes(entry.exportName), u32Bytes(entry.importName), u16Bytes(entry.moduleRequestIdx));
    }

    parts.push(u32Bytes(record.starExports.length));
    for (const request of record.starExports) parts.push(u16Bytes(request));

    let total = 0;
    for (const part of parts) total += part.length;
    const out = new Uint8Array(total);
    let pos = 0;
    for (const part of parts) {
        out.set(part, pos);
        pos += part.length;
    }
    return out;
}

function u16Bytes(value: number): Uint8Array {
    return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff);
}

function u32Bytes(value: number): Uint8Array {
    return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}
