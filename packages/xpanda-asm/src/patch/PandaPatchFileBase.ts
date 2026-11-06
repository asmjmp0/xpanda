/**
 * PandaPatchFile base: append-only buffer, index tables and entity lookups.
 * @Author: jmp0
 */
import { Adler32, PandaClass, PandaFile, PandaMethod } from "xpanda-core";
import { dumpClasses, type DumpClassesResult } from "../ClassDump";
import { encodeStringEntity, readUleb128 } from "../codec";
import { writeU32 } from "./PatchBinary";
import {
    HEADER_CHECKSUM_OFF, HEADER_CLASS_IDX_OFF, HEADER_FILE_SIZE_OFF, HEADER_VERSION_OFF,
    HEADER_NUM_CLASSES_OFF, INDEX_HEADER_CLASS_IDX_OFF_OFF, INDEX_HEADER_CLASS_IDX_SIZE_OFF,
    INDEX_HEADER_METHOD_IDX_OFF_OFF, INDEX_HEADER_METHOD_IDX_SIZE_OFF, INDEX_HEADER_SIZE,
    METHOD_TAG_CODE, METHOD_TAG_DEBUG_INFO, METHOD_TAG_PAYLOAD_SIZE, PATCH_SLOT_BASE,
    PandaPatchError,
} from "./PatchTypes";
import type {
    AddStringIdResult, ClassOverride, MethodCode, MethodTags, PreparedTarget,
} from "./PatchTypes";
import type { ModuleRecord } from "../ModuleRecord";

export class PandaPatchFileBase {
    protected pf: PandaFile;
    protected data: Uint8Array;
    /** 可增长的工作缓冲:初始为原文件副本,追加实体写在其后 */
    protected bytes: Uint8Array;
    protected size: number;
    /** 每个 IndexHeader 的区域终点(追加实体后需要扩展,否则实体落在区域外解析不到) */
    protected readonly indexHeaderEnds = new Map<PandaClass["indexHeader"], number>();
    /** 已被重建过的类实体(addMethod 之后,后续修改必须基于最新副本) */
    protected readonly classOverrides = new Map<PandaClass, ClassOverride>();
    /** 方法代码的内存覆盖(多次编辑时基于最新版本,而不是载入时快照) */
    protected readonly methodCodeOverrides = new Map<PandaMethod, MethodCode>();
    /** 每个 region 的类索引表当前状态(追加新类后 size/off 已过时) */
    protected readonly classTableState = new Map<PandaClass["indexHeader"], { offset: number; size: number }>();
    /** 文件头全局类索引表当前状态 */
    protected headerClassTableState: { offset: number; size: number } | null = null;
    /** prepareMethodHead 预约的 hook 名 → 目标方法列表(同一个 hook 可挂多个函数) */
    protected readonly preparedMethodHeads = new Map<string, PreparedTarget[]>();
    /**
     * 搬 hook class 时，类字面量里的 METHOD 偏移仍指向源 abc。
     * 方法实体落位后按这个表改成目标偏移。
     */
    protected readonly literalMethodFixups: Array<{ pos: number; sourceOffset: number }> = [];
    /** 已改写过的 module record(目标类 → 当前记录 + 当前偏移),避免同一次会话重复读取旧值 */
    protected readonly moduleRecordOverrides = new Map<PandaClass, { record: ModuleRecord; offset: number }>();
    /** 硬加 module record 时,moduleRecordIdx 字段值在新类实体里的绝对偏移 */
    protected readonly moduleRecordValueOffsets = new Map<PandaClass, number>();
    /** hook 协议字段名(arg / res)在 region 里的 string id 缓存 */
    protected readonly hookProtocolStringIdsByRegion = new Map<PandaClass["indexHeader"], { arg: number; res: number }>();
    /** dynamic setter 的全局属性名在 region 里的 string id */
    protected readonly patchSetterStringIdsByRegion = new Map<PandaClass["indexHeader"], Map<string, number>>();
    /** hook 名 → 已分配的 GlobalPatch 槽 */
    protected readonly patchSlotsByHook = new Map<string, number>();
    /** 文件里和本次会话里已经占用的槽,避免复用 */
    protected readonly observedPatchSlots = new Set<number>();
    protected patchSlotCursor = PATCH_SLOT_BASE;
    protected patchSlotsScanned = false;
    /** 每个 IndexHeader 的实体索引表当前状态(多次扩展后 parsed 对象里的 size 已过时) */
    protected readonly entityTableState = new Map<PandaClass["indexHeader"], { offset: number; size: number }>();
    /**
     * 本次会话待写入索引表的实体偏移(按 id 顺序)。
     * 追加单个实体时只登记、不复制整张表;toBytes() 时每个 region 一次性展开,
     * 避免 N 次追加产生 O(N × tableSize) 的文件膨胀(500 个模块约 100MB)。
     */
    protected readonly pendingEntityEntries = new Map<PandaClass["indexHeader"], number[]>();

    protected constructor(data: Uint8Array) {
        this.reset(data);
    }

    /** 用新的 abc 字节重置内部状态 */
    protected reset(data: Uint8Array): void {
        const input = data.slice();
        this.pf = new PandaFile(input);
        this.data = input;
        this.size = input.length;
        this.bytes = new Uint8Array(input.length + 64 * 1024);
        this.bytes.set(input, 0);
        this.indexHeaderEnds.clear();
        this.classOverrides.clear();
        this.methodCodeOverrides.clear();
        this.classTableState.clear();
        this.headerClassTableState = null;
        this.entityTableState.clear();
        this.pendingEntityEntries.clear();
        this.preparedMethodHeads.clear();
        this.moduleRecordOverrides.clear();
        this.moduleRecordValueOffsets.clear();
        this.literalMethodFixups.length = 0;
        this.hookProtocolStringIdsByRegion.clear();
        this.patchSetterStringIdsByRegion.clear();
        this.patchSlotsByHook.clear();
        this.observedPatchSlots.clear();
        this.patchSlotCursor = PATCH_SLOT_BASE;
        this.patchSlotsScanned = false;
        for (const indexHeader of this.pf.indexHeaders) {
            this.indexHeaderEnds.set(indexHeader, indexHeader.end);
        }
    }

    /** 全部非 external 类名 */
    getClassNames(): string[] {
        return this.classes().map((clazz) => clazz.getClassName());
    }

    /** 某个类的全部非 external 方法名 */
    getMethodNames(className: string): string[] {
        const clazz = this.requireClass(className);
        const names: string[] = [];
        for (const [name, method] of clazz.pandaMethods) {
            if (!method.methodExternal) names.push(name);
        }
        return names;
    }

    hasMethod(className: string, methodName: string): boolean {
        const clazz = this.findClass(className);
        const method = clazz?.pandaMethods.get(methodName);
        return !!method && !method.methodExternal;
    }

    /**
     * 把一个或多个类(以及它们引用到的类/方法)导出为一个新的、独立的 .abc。
     * 当前补丁会话里的修改会先经过 toBytes(),因此导出结果反映最新状态。
     */

    dumpClasses(classNames: string[]): DumpClassesResult {
        return dumpClasses(this.toBytes(), classNames);
    }

    protected classes(): PandaClass[] {
        const result: PandaClass[] = [];
        for (const indexHeader of this.pf.indexHeaders) {
            for (const clazz of indexHeader.pandaClasses) {
                if (!clazz.classExternal) result.push(clazz);
            }
        }
        return result;
    }

    protected findClass(className: string): PandaClass | null {
        for (const clazz of this.classes()) {
            if (clazz.getClassName() === className) return clazz;
        }
        return null;
    }

    protected requireClass(className: string): PandaClass {
        const clazz = this.findClass(className);
        if (!clazz) throw new PandaPatchError(`class '${className}' not found`);
        return clazz;
    }

    protected requireMethod(className: string, methodName: string): PandaMethod {
        const clazz = this.requireClass(className);
        const method = clazz.pandaMethods.get(methodName);
        if (!method) throw new PandaPatchError(`method '${className}::${methodName}' not found`);
        if (method.methodExternal) throw new PandaPatchError(`method '${className}::${methodName}' is external`);
        return method;
    }

    protected pickTemplate(clazz: PandaClass, templateName?: string): PandaMethod {
        if (templateName !== undefined) {
            return this.requireMethod(clazz.getClassName(), templateName);
        }
        for (const method of clazz.pandaMethods.values()) {
            if (!method.methodExternal && method.methodCode) return method;
        }
        throw new PandaPatchError(`class '${clazz.getClassName()}' has no method with code to use as template`);
    }

    /** 扫描方法实体的 tag 区,定位 CODE tag 的 u32 载荷位置。 */
    protected scanMethodTags(methodOffset: number): MethodTags {
        return this.scanMethodTagsIn(this.data, methodOffset);
    }

    /** 在给定字节数组的 entryOffset 处扫描方法实体 tag 区 */
    protected scanMethodTagsIn(bytes: Uint8Array, entryOffset: number): MethodTags {
        let pos = entryOffset + 2 + 2 + 4; // class_idx + proto_idx + name
        const flags = readUleb128(bytes, pos);
        pos += flags.size;
        let codeValueOffset: number | null = null;
        let debugInfoTagOffset: number | null = null;
        while (true) {
            if (pos >= bytes.length) {
                throw new PandaPatchError(`method entity at ${entryOffset} overruns buffer`);
            }
            const tag = bytes[pos];
            if (tag === 0x00) {
                pos += 1;
                break;
            }
            const payloadSize = METHOD_TAG_PAYLOAD_SIZE[tag];
            if (payloadSize === undefined) {
                throw new PandaPatchError(`unsupported method tag 0x${tag.toString(16)} at ${pos}`);
            }
            if (tag === METHOD_TAG_CODE) codeValueOffset = pos + 1;
            if (tag === METHOD_TAG_DEBUG_INFO) debugInfoTagOffset = pos;
            pos += 1 + payloadSize;
        }
        return { codeValueOffset, debugInfoTagOffset, end: pos };
    }

    /**
     * 以模板方法实体为底重建方法实体:
     *   - 可替换 name/CODE 偏移
     *   - 可移除 DEBUG_INFO tag
     */

    /** 追加一个 String 实体,返回其绝对偏移(可作方法名等直接引用) */
    addString(text: string): number {
        return this.append(encodeStringEntity(text));
    }

    /** 追加一个 String 实体并登记到类的实体索引表,返回可用于指令的 id */
    addStringId(className: string, text: string): AddStringIdResult {
        const clazz = this.requireClass(className);
        const offset = this.append(encodeStringEntity(text));
        const id = this.appendMethodIndex(clazz.indexHeader, offset);
        return { id, offset };
    }

    /**
     * 写回完整 .abc 字节:更新 file_size、重算 checksum。
     * 不修改内部分配的实体。
     */

    toBytes(): Uint8Array {
        this.flushEntityTables();
        for (const [indexHeader, end] of this.indexHeaderEnds) {
            if (end !== indexHeader.end) {
                this.patchU32(this.indexHeaderRecordOffset(indexHeader) + 4, end);
            }
        }
        this.patchU32(HEADER_FILE_SIZE_OFF, this.size);
        const out = this.bytes.slice(0, this.size);
        const checksum = this.computeChecksum(out);
        writeU32(out, HEADER_CHECKSUM_OFF, checksum);
        return out;
    }

    // ---------------------------------------------------------------- internal

    /** 当前 region 实体(method/string/literal array)索引表大小(含本次会话已追加的条目) */
    protected currentEntityTableSize(region: PandaClass["indexHeader"]): number {
        return (this.entityTableState.get(region)?.size ?? region.methodIdxSize)
            + (this.pendingEntityEntries.get(region)?.length ?? 0);
    }

    /** 当前 region 类索引表大小(含本次会话已追加的条目) */
    protected currentClassTableSize(region: PandaClass["indexHeader"]): number {
        return this.classTableState.get(region)?.size ?? region.classIdxSize;
    }

    /**
     * 重映射 hook 方法代码里的实体 id 并按目标 region 重新编码:
     *   - 字符串 / literal array id 使用第一遍导入时登记的目标 id;
     *   - 方法 id 通过 methodIdByOffset 映射(同一 class 内的方法,如 definefunc 目标)。
     */

    /** 扩展 IndexHeader 的 [start,end) 区域,让追加的实体能被 resolveIndexHeaderByOffset 解析到 */
    protected extendRegion(indexHeader: PandaClass["indexHeader"], end: number): void {
        const current = this.indexHeaderEnds.get(indexHeader) ?? indexHeader.end;
        if (end > current) this.indexHeaderEnds.set(indexHeader, end);
    }

    protected patchClassTable(tableOffset: number, count: number, oldOffset: number, newOffset: number): void {
        for (let i = 0; i < count; i++) {
            const entryOffset = tableOffset + i * 4;
            if (this.readU32(entryOffset) === oldOffset) {
                this.patchU32(entryOffset, newOffset);
            }
        }
    }

    /**
     * 把实体偏移追加到类的实体索引表(method/string/literal 共用),
     * 返回新 id;表整体搬到文件末尾,并改写 IndexHeader 的 size/off 字段。
     */
    protected appendMethodIndex(indexHeader: PandaClass["indexHeader"], entityOffset: number): number {
        let state = this.entityTableState.get(indexHeader);
        if (!state) {
            if (indexHeader.methodIdxSize === 0 || indexHeader.methodIdxOff === 0xffffffff) {
                throw new PandaPatchError("class has no entity index table to extend");
            }
            state = { offset: indexHeader.methodIdxOff, size: indexHeader.methodIdxSize };
            this.entityTableState.set(indexHeader, state);
        }
        let pending = this.pendingEntityEntries.get(indexHeader);
        if (!pending) {
            pending = [];
            this.pendingEntityEntries.set(indexHeader, pending);
        }
        const id = state.size + pending.length;
        pending.push(entityOffset);
        return id;
    }

    /**
     * 把每个 region 的待追加实体一次性写入索引表。
     * 旧实现每次追加都复制整张表,大 abc 上注入几百个模块会产生上百 MB 的中间表。
     */
    protected flushEntityTables(): void {
        for (const [indexHeader, pending] of this.pendingEntityEntries) {
            if (pending.length === 0) continue;
            const state = this.entityTableState.get(indexHeader);
            if (!state) continue;
            const count = state.size;
            const table = new Uint8Array((count + pending.length) * 4);
            for (let i = 0; i < count; i++) {
                writeU32(table, i * 4, this.readU32(state.offset + i * 4));
            }
            for (let i = 0; i < pending.length; i++) {
                writeU32(table, (count + i) * 4, pending[i]);
            }
            const newTableOffset = this.append(table);
            const recordOffset = this.indexHeaderRecordOffset(indexHeader);
            this.patchU32(recordOffset + INDEX_HEADER_METHOD_IDX_SIZE_OFF, count + pending.length);
            this.patchU32(recordOffset + INDEX_HEADER_METHOD_IDX_OFF_OFF, newTableOffset);
            this.extendRegion(indexHeader, newTableOffset + table.length);
            state.offset = newTableOffset;
            state.size = count + pending.length;
            pending.length = 0;
        }
    }

    protected indexHeaderRecordOffset(indexHeader: PandaClass["indexHeader"]): number {
        const index = this.pf.indexHeaders.indexOf(indexHeader);
        if (index < 0) throw new PandaPatchError("index header not owned by this file");
        return this.pf.header.indexSectionOff + index * INDEX_HEADER_SIZE;
    }

    /**
     * 把一个新类实体登记到 region 的类索引表(表整体搬到文件末尾),同时追加到文件头的
     * 全局类索引表。返回新类在 region 类表中的下标。
     * registerGlobal=false 用于原生类型条目(值 ≤ header size,不能进全局类表)。
     */

    protected appendClassIndex(
        indexHeader: PandaClass["indexHeader"],
        entityOffset: number,
        registerGlobal = true,
    ): number {
        let state = this.classTableState.get(indexHeader);
        if (!state) {
            if (indexHeader.classIdxSize === 0 || indexHeader.classIdxOff === 0xffffffff) {
                throw new PandaPatchError("class has no class index table to extend");
            }
            state = { offset: indexHeader.classIdxOff, size: indexHeader.classIdxSize };
            this.classTableState.set(indexHeader, state);
        }
        const index = state.size;
        const table = new Uint8Array((state.size + 1) * 4);
        for (let i = 0; i < state.size; i++) {
            writeU32(table, i * 4, this.readU32(state.offset + i * 4));
        }
        writeU32(table, state.size * 4, entityOffset);
        const newTableOffset = this.append(table);

        const recordOffset = this.indexHeaderRecordOffset(indexHeader);
        this.patchU32(recordOffset + INDEX_HEADER_CLASS_IDX_SIZE_OFF, state.size + 1);
        this.patchU32(recordOffset + INDEX_HEADER_CLASS_IDX_OFF_OFF, newTableOffset);
        state.offset = newTableOffset;
        state.size += 1;

        // 文件头全局类索引表(所有 region 的类都登记在这里)
        if (registerGlobal && this.pf.header.classIdxOff !== 0xffffffff) {
            let headerState = this.headerClassTableState;
            if (!headerState) {
                headerState = { offset: this.pf.header.classIdxOff, size: this.pf.header.numClasses };
                this.headerClassTableState = headerState;
            }
            const headerTable = new Uint8Array((headerState.size + 1) * 4);
            for (let i = 0; i < headerState.size; i++) {
                writeU32(headerTable, i * 4, this.readU32(headerState.offset + i * 4));
            }
            writeU32(headerTable, headerState.size * 4, entityOffset);
            const headerTableOffset = this.append(headerTable);
            this.patchU32(HEADER_NUM_CLASSES_OFF, headerState.size + 1);
            this.patchU32(HEADER_CLASS_IDX_OFF, headerTableOffset);
            headerState.offset = headerTableOffset;
            headerState.size += 1;
        }
        return index;
    }

    protected computeChecksum(bytes: Uint8Array): number {
        const adler32 = new Adler32();
        adler32.update(bytes, HEADER_VERSION_OFF, bytes.length - HEADER_VERSION_OFF);
        // 运行时校验用完整 Adler32(libpandafile ValidateChecksum),不能 mask
        return adler32.getValue();
    }

    // ---------------------------------------------------------------- buffer io

    protected ensure(capacity: number): void {
        if (capacity <= this.bytes.length) return;
        let next = this.bytes.length;
        while (next < capacity) next *= 2;
        const grown = new Uint8Array(next);
        grown.set(this.bytes.subarray(0, this.size), 0);
        this.bytes = grown;
    }

    protected append(part: Uint8Array): number {
        while (this.size % 4 !== 0) {
            this.ensure(this.size + 1);
            this.bytes[this.size++] = 0;
        }
        const offset = this.size;
        this.ensure(offset + part.length);
        this.bytes.set(part, offset);
        this.size += part.length;
        return offset;
    }

    protected readU32(offset: number): number {
        const b = this.bytes;
        return (b[offset] | (b[offset + 1] << 8) | (b[offset + 2] << 16) | (b[offset + 3] << 24)) >>> 0;
    }

    protected patchU32(offset: number, value: number): void {
        this.ensure(offset + 4);
        writeU32(this.bytes, offset, value);
    }
}
