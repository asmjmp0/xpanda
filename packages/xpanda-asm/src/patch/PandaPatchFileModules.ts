/**
 * Module-record editing: imports, moduleRecordIdx fields and hard-added records.
 * @Author: jmp0
 */
import { PandaClass } from "xpanda-core";
import { concatBytes, readStringEntity, writeSleb128, writeUleb128 } from "../codec";
import { encodeImportedField, findFieldValueOffset } from "./EntityCodec";
import { u32Bytes } from "./PatchBinary";
import { encodeModuleRecord, readModuleRecord } from "../ModuleRecord";
import type { ModuleRecord } from "../ModuleRecord";
import { PandaPatchError, FIELD_TAG_INT_VALUE, FIELD_TAG_VALUE } from "./PatchTypes";
import { PandaPatchFileCode } from "./PandaPatchFileCode";

export class PandaPatchFileModules extends PandaPatchFileCode {
    /** 在目标 region 类表里找原生类型条目(offset 值 ≤ header size),没有则只在 region 表追加 */
    protected targetClassIndexForValue(region: PandaClass["indexHeader"], rawValue: number): number {
        const state = this.classTableState.get(region)
            ?? { offset: region.classIdxOff, size: region.classIdxSize };
        for (let i = 0; i < state.size; i++) {
            if (this.readU32(state.offset + i * 4) === rawValue) return i;
        }
        return this.appendClassIndex(region, rawValue, false);
    }

    /**
     * 给目标类的 module record 追加一条 regular import,返回它在 module 环境数组里的下标。
     * 要求目标 module 没有 namespace import(追加 regular import 会移动它们的下标)。
     * 已存在相同 (importName, request) 的 import 时直接复用。
     */

    protected addModuleImport(className: string, localName: string, importName: string, request: string): number {
        const clazz = this.requireClass(className);
        let state = this.moduleRecordOverrides.get(clazz);
        if (!state) {
            if (!clazz.pandaClassModuleData) {
                throw new PandaPatchError(`class '${className}' has no module record`);
            }
            const offset = clazz.pandaClassModuleData.getOffset();
            state = { record: readModuleRecord(this.bytes, offset), offset };
            this.moduleRecordOverrides.set(clazz, state);
        }
        const record = state.record;
        if (record.namespaceImports.length > 0) {
            throw new PandaPatchError(
                `module '${className}' has namespace imports; appending a regular import would shift them`);
        }
        for (let i = 0; i < record.regularImports.length; i++) {
            const entry = record.regularImports[i];
            if (entry.moduleRequestIdx >= record.moduleRequests.length) continue;
            if (readStringEntity(this.bytes, entry.importName) !== importName) continue;
            if (readStringEntity(this.bytes, record.moduleRequests[entry.moduleRequestIdx]) !== request) continue;
            return i;
        }
        // 同一 hook bundle 的多个 hook 从同一个 module 导入:复用已有的 module request,
        // 避免同一个请求串在 module record 里出现多份
        let requestIndex = -1;
        for (let i = 0; i < record.moduleRequests.length; i++) {
            if (readStringEntity(this.bytes, record.moduleRequests[i]) === request) {
                requestIndex = i;
                break;
            }
        }
        if (requestIndex < 0) {
            requestIndex = record.moduleRequests.length;
            record.moduleRequests.push(this.addString(request));
        }
        const index = record.regularImports.length;
        record.regularImports.push({
            localName: this.addString(localName),
            importName: this.addString(importName),
            moduleRequestIdx: requestIndex,
        });
        const newOffset = this.append(encodeModuleRecord(record));
        if (!this.patchModuleRecordField(clazz, newOffset)) {
            throw new PandaPatchError(`cannot patch 'moduleRecordIdx' of '${className}'`);
        }
        state.offset = newOffset;
        this.extendRegion(clazz.indexHeader, this.size);
        return index;
    }

    /** 把 class 的 moduleRecordIdx 字段值改成新的 module record 偏移 */
    protected patchModuleRecordField(clazz: PandaClass, newOffset: number): boolean {
        const tracked = this.moduleRecordValueOffsets.get(clazz);
        if (tracked !== undefined) {
            this.patchU32(tracked, newOffset);
            return true;
        }
        const field = clazz.pandaFields?.find((candidate) => candidate.getName() === "moduleRecordIdx");
        if (!field) return false;
        const valueOffset = findFieldValueOffset(this.bytes, field);
        if (valueOffset === undefined) return false;
        this.patchU32(valueOffset, newOffset);
        return true;
    }

    /**
     * 目标类没有 module record 时硬加一个:给类实体追加 `isCommonjs`(INT 0)与
     * `moduleRecordIdx`(VALUE → 新 module record)字段,并重建/重定位类实体。
     *
     * 注意:运行时用"任意类带 moduleRecordIdx/isCommonjs"判定 merged abc;对 bundle-pack
     * 文件做这件事会让整个文件按 merged 语义加载(调用方需自行确认可接受)。
     */

    protected ensureModuleRecord(clazz: PandaClass): void {
        if (clazz.pandaClassModuleData) return;
        if (this.moduleRecordOverrides.has(clazz)) return;

        const record: ModuleRecord = {
            moduleRequests: [],
            regularImports: [],
            namespaceImports: [],
            localExports: [],
            indirectExports: [],
            starExports: [],
        };
        const recordOffset = this.append(encodeModuleRecord(record));

        const region = clazz.indexHeader;
        const classIndex = this.classIndexOf(clazz);
        // 与 es2abc 的 module 字段一致:isCommonjs 用 U1(编码值 2),moduleRecordIdx 用 I32(6)
        const isCommonjsType = this.targetClassIndexForValue(region, 2);
        const moduleRecordType = this.targetClassIndexForValue(region, 6);
        const isCommonjsField = encodeImportedField(
            classIndex, isCommonjsType, this.addString("isCommonjs"), 0,
            concatBytes([Uint8Array.of(FIELD_TAG_INT_VALUE), writeSleb128(0)]));
        const moduleRecordField = encodeImportedField(
            classIndex, moduleRecordType, this.addString("moduleRecordIdx"), 0,
            concatBytes([Uint8Array.of(FIELD_TAG_VALUE), u32Bytes(recordOffset)]));

        const { bytes, appendedFieldOffsets, methodShift } = this.buildClassWithAppendedFields(
            clazz, [isCommonjsField, moduleRecordField]);
        const newOffset = this.relocateClassEntity(clazz, bytes, methodShift);
        // VALUE tag 的 u32 载荷 = 字段实体起点 + 8(class/type/name) + uleb(access=0) + tag
        const valueOffset = newOffset + appendedFieldOffsets[1] + 8 + writeUleb128(0).length + 1;
        this.moduleRecordValueOffsets.set(clazz, valueOffset);
        this.moduleRecordOverrides.set(clazz, { record, offset: recordOffset });
        this.extendRegion(region, this.size);
    }

}
