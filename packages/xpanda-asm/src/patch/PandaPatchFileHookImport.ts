/**
 * Moving a compiled hook class, its module record, strings and literals into the target abc.
 * @Author: jmp0
 */
import { PandaClass, PandaFile } from "xpanda-core";
import {
    assemble, assembleInstruction, decodeInstructions, encodeInstructionWithOpcode,
} from "../Assembler";
import type { DecodedInstruction } from "../Assembler";
import {
    concatBytes, encodeStringEntity, readStringEntity, writeSleb128,
} from "../codec";
import {
    buildImportedClassEntity, buildImportedMethodEntity, encodeImportedField, findFieldValueOffset,
    LITERAL_TAG, literalPayloadSize, normalizedRequestForRecord,
} from "./EntityCodec";
import { encodeMethodCode } from "../MethodCode";
import { readU32At, u32Bytes } from "./PatchBinary";
import { encodeModuleRecord, readModuleRecord } from "../ModuleRecord";
import type { ModuleRecord } from "../ModuleRecord";
import { FIELD_TAG_INT_VALUE, FIELD_TAG_VALUE, PandaPatchError } from "./PatchTypes";
import type {
    ClassImportCaches, DynamicSetup, MethodCode, PatchMethodHeadSourceOptions,
} from "./PatchTypes";
import { PandaPatchFileEntities } from "./PandaPatchFileEntities";
import { PandaPatchFileHookSlots } from "./PandaPatchFileHookSlots";

export class PandaPatchFileHookImport extends PandaPatchFileHookSlots {
    protected hookMethodInstructions(
        entry: { name: string; code: MethodCode },
        setterSlot: number | undefined,
        sourceRegion: PandaClass["indexHeader"],
        methodIdByOffset: Map<number, number>,
        caches: ClassImportCaches,
    ): Uint8Array {
        if (setterSlot === undefined) {
            return this.remapHookInstructions(entry.code, sourceRegion, methodIdByOffset, caches);
        }
        if (entry.code.numArgs < 4) {
            throw new PandaPatchError(
                `cannot encode dynamic setter '${entry.name}' (numArgs=${entry.code.numArgs})`);
        }
        return concatBytes([
            assembleInstruction("lda", [3]),
            assembleInstruction("wide.stpatchvar", [setterSlot]),
            assemble("returnundefined"),
        ]);
    }

    /**
     * The hook module's `xpanda_reserved_setup` static method installs every slot.
     * es2abc emits the call at the end of that module's func_main_0, after the
     * exported functions have been stored, so one class serves every target that
     * imports the module.
     */

    protected importHookClass(
        hookFile: PandaFile,
        hookPatch: PandaPatchFileEntities,
        hookClass: PandaClass,
        targetClassName: string,
        options: PatchMethodHeadSourceOptions,
        setterSlots?: Map<string, number>,
        setup?: DynamicSetup,
    ): Map<string, number> {
        this.literalMethodFixups.length = 0;
        const targetRegion = this.requireClass(targetClassName).indexHeader;
        if (targetRegion.protoIdxSize !== 0xffffffff) {
            throw new PandaPatchError(
                "moving the hook class into this abc is not supported: the target has a proto index table");
        }
        if (hookClass.numIfaces > 0) {
            throw new PandaPatchError("moving the hook class is not supported: the class declares interfaces");
        }
        if (hookClass.superClassOff.isValid()) {
            throw new PandaPatchError("moving the hook class is not supported: the class has a super class");
        }

        const sourceClassName = hookClass.getClassName();
        const methods = [...hookClass.pandaMethods.entries()].map(([name, method]) => {
            const code = hookPatch.getMethodCode(sourceClassName, name);
            if (!code || method.methodExternal || !method.methodCode) {
                throw new PandaPatchError(
                    `moving the hook class is not supported: method '${sourceClassName}::${name}' has no code`);
            }
            return { name, method, code };
        });
        const caches: ClassImportCaches = {
            stringEntities: new Map(),
            stringIds: new Map(),
            literalEntities: new Map(),
            literalIds: new Map(),
            moduleRecords: new Map(),
        };
        const sourceRegion = hookClass.indexHeader;

        if (setterSlots) {
            for (const name of setterSlots.keys()) {
                if (!methods.some((entry) => entry.name === name)) {
                    throw new PandaPatchError(
                        `dynamic setter method '${name}' was not compiled into the hook class`);
                }
            }
        }
        if (setup && !methods.some((entry) => entry.name === setup.methodName)) {
            throw new PandaPatchError(
                `dynamic setup method '${setup.methodName}' was not compiled into the hook class`);
        }

        // 第一遍:把代码引用的字符串 / literal array 导入目标 region(id 会登记进实体表)。
        // setter 的源码体马上会被换成 stpatchvar,不必搬它的字符串。
        for (const { name, code } of methods) {
            if (setterSlots?.has(name) || name === setup?.methodName) continue;
            for (const instruction of decodeInstructions(code.instructions)) {
                for (const ref of this.hookIdOperands(instruction, sourceRegion)) {
                    if (ref.kind === "string") {
                        this.importStringId(hookFile, ref.sourceOffset, targetClassName, caches);
                    } else if (ref.kind === "literal-array") {
                        this.importLiteralArrayId(hookFile, ref.sourceOffset, targetClassName, caches);
                    }
                }
            }
        }

        // 方法实体按顺序追加,方法 id = 当前实体表大小 + 序号
        const methodIdBase = this.currentEntityTableSize(targetRegion);
        const methodIdByOffset = new Map<number, number>();
        methods.forEach((entry, index) => methodIdByOffset.set(entry.method.getOffset(), methodIdBase + index));

        // 第二遍:重映射指令并追加 code item。动态 setter 把 numVregs 收成 0
        // (p0 固定在 v3),numArgs 保持编译结果,这样 proto 校验仍然通过。
        const codeOffsets = methods.map((entry) => {
            const setterSlot = setterSlots?.get(entry.name);
            const isSetup = setup !== undefined && entry.name === setup.methodName;
            return this.append(encodeMethodCode({
                numVregs: isSetup ? 1 : setterSlot === undefined ? entry.code.numVregs : 0,
                numArgs: entry.code.numArgs,
                instructions: isSetup
                    ? this.setupInstructions(setup.entries)
                    : this.hookMethodInstructions(entry, setterSlot, sourceRegion, methodIdByOffset, caches),
                tries: [],
            }));
        });

        // 字段类型(原生类型)条目可能追加到 region 类表,必须先解析,
        // 否则新类的下标会在字段构建过程中被挤后。
        const fieldTypeIndexes = this.resolveImportedFieldTypeIndexes(hookClass, sourceRegion, targetRegion);
        const newClassIndex = this.currentClassTableSize(targetRegion);

        // 把 module record 一起搬过来,并重建 module 字段
        const fields = this.buildImportedModuleFields(
            hookFile, hookClass, newClassIndex, caches, options, fieldTypeIndexes);

        const targetRegionIndex = this.pf.indexHeaders.indexOf(targetRegion);
        const methodBodies = methods.map((entry, index) => {
            const nameOffset = this.addString(entry.name);
            // 高 16 位是 method 所属的 index region 下标,hook abc 里恒为 0,搬运后必须改写
            const accessFlags = (entry.method.accessFlag & 0xffff) | (targetRegionIndex << 16);
            return buildImportedMethodEntity(
                newClassIndex, entry.method.protoIdx & 0xffff, nameOffset, accessFlags, codeOffsets[index]);
        });

        const classBytes = buildImportedClassEntity(sourceClassName, hookClass.accessFlags, fields, methodBodies);
        const classOffset = this.append(classBytes);
        // 方法实体内联在类实体里;实体表直接指向内联副本,这样解析出的 PandaMethod
        // 能通过 class_idx 找到父类(module 字段 / import 表都挂在父类上)。
        const methodsLength = methodBodies.reduce((total, body) => total + body.length, 0);
        let methodOffset = classOffset + classBytes.length - methodsLength;
        const methodIds = new Map<string, number>();
        const methodOffsetBySource = new Map<number, number>();
        methods.forEach((entry, index) => {
            methodOffsetBySource.set(entry.method.getOffset(), methodOffset);
            const id = this.appendMethodIndex(targetRegion, methodOffset);
            if (id !== methodIdBase + index) {
                throw new PandaPatchError("internal error: imported hook method id mismatch");
            }
            methodIds.set(entry.name, id);
            methodOffset += methodBodies[index].length;
        });
        for (const fixup of this.literalMethodFixups) {
            const target = methodOffsetBySource.get(fixup.sourceOffset);
            if (target === undefined) {
                throw new PandaPatchError(
                    `moving the hook class: class literal references a method at ${fixup.sourceOffset} outside the class`);
            }
            this.patchU32(fixup.pos, target);
        }
        this.literalMethodFixups.length = 0;

        const registeredIndex = this.appendClassIndex(targetRegion, classOffset);
        if (registeredIndex !== newClassIndex) {
            throw new PandaPatchError("internal error: imported hook class index mismatch");
        }
        // 追加的实体/索引表都落在文件末尾,region end 覆盖到文件尾
        this.extendRegion(targetRegion, this.size);
        return methodIds;
    }

    /** 为 module 字段解析目标 region 里的原生类型下标(必要时追加) */
    protected resolveImportedFieldTypeIndexes(
        hookClass: PandaClass,
        sourceRegion: PandaClass["indexHeader"],
        targetRegion: PandaClass["indexHeader"],
    ): Map<string, number> {
        const indexes = new Map<string, number>();
        for (const field of hookClass.pandaFields ?? []) {
            const fieldName = field.getName();
            if (fieldName === "scopeNames") continue;
            const sourceType = sourceRegion.pandaClasses[field.typeIdx];
            if (!sourceType) {
                throw new PandaPatchError(`hook module field '${fieldName}' has an unknown type index`);
            }
            const typeRawValue = sourceType.getOffset();
            if (typeRawValue > 0xffff) {
                throw new PandaPatchError(
                    `hook module field '${fieldName}' uses a class type; only primitive module fields are supported`);
            }
            indexes.set(fieldName, this.targetClassIndexForValue(targetRegion, typeRawValue));
        }
        return indexes;
    }

    /**
     * 重建 hook class 的 module 字段:
     *   - moduleRecordIdx 指向搬进目标文件的 module record;
     *   - isCommonjs / hasTopLevelAwait / isSharedModule / pkgName@... 原样复制(INT_VALUE);
     *   - scopeNames 是编译期 AOP 元数据,运行时不读,直接丢弃;
     *   - 其余 VALUE 字段(注解等)暂不支持。
     */

    protected buildImportedModuleFields(
        hookFile: PandaFile,
        hookClass: PandaClass,
        newClassIndex: number,
        caches: ClassImportCaches,
        options: PatchMethodHeadSourceOptions,
        fieldTypeIndexes: Map<string, number>,
    ): Uint8Array[] {
        const moduleRecordField = hookClass.pandaFields?.find((field) => field.getName() === "moduleRecordIdx");
        if (!moduleRecordField) {
            throw new PandaPatchError(
                "the hook class must carry a 'moduleRecordIdx' field");
        }
        const sourceModuleRecordValueOffset = findFieldValueOffset(hookFile.data, moduleRecordField);
        if (sourceModuleRecordValueOffset === undefined) {
            throw new PandaPatchError("hook 'moduleRecordIdx' field has no VALUE tag");
        }
        const sourceModuleRecordOffset = readU32At(hookFile.data, sourceModuleRecordValueOffset);
        const targetModuleRecordOffset = this.importHookModuleRecord(
            hookFile, sourceModuleRecordOffset, caches, options);

        const fields: Uint8Array[] = [];
        for (const field of hookClass.pandaFields ?? []) {
            const fieldName = field.getName();
            if (fieldName === "scopeNames") continue; // 编译期 AOP 元数据,运行时不需要
            const typeIdx = fieldTypeIndexes.get(fieldName);
            if (typeIdx === undefined) {
                throw new PandaPatchError(`hook module field '${fieldName}' has an unknown type index`);
            }
            const nameOffset = this.addString(fieldName);
            let value: Uint8Array;
            if (fieldName === "moduleRecordIdx") {
                value = concatBytes([Uint8Array.of(FIELD_TAG_VALUE), u32Bytes(targetModuleRecordOffset)]);
            } else if (field.pandaFieldValue) {
                throw new PandaPatchError(
                    `hook module field '${fieldName}' has an unsupported VALUE entity; only moduleRecordIdx is supported`);
            } else {
                value = concatBytes([Uint8Array.of(FIELD_TAG_INT_VALUE), writeSleb128(field.intValue)]);
            }
            fields.push(encodeImportedField(newClassIndex, typeIdx, nameOffset, field.accessFlag, value));
        }
        return fields;
    }

    /**
     * 把 hook 的 module record 搬进目标文件:字符串实体重新分配,hook 的 import 请求
     * 按 moduleRequests 映射或按目标记录名后缀自动解析。
     */

    protected importHookModuleRecord(
        hookFile: PandaFile,
        sourceOffset: number,
        caches: ClassImportCaches,
        options: PatchMethodHeadSourceOptions,
    ): number {
        const cached = caches.moduleRecords.get(sourceOffset);
        if (cached !== undefined) return cached;
        const record = readModuleRecord(hookFile.data, sourceOffset);
        const importString = (offset: number): number => this.copyStringEntity(hookFile, offset, caches);
        const imported: ModuleRecord = {
            moduleRequests: record.moduleRequests.map((offset) => {
                const request = readStringEntity(hookFile.data, offset);
                const rewritten = this.resolveHookModuleRequest(request, options);
                return rewritten === request
                    ? importString(offset)
                    : this.addString(rewritten);
            }),
            regularImports: record.regularImports.map((entry) => ({
                localName: importString(entry.localName),
                importName: importString(entry.importName),
                moduleRequestIdx: entry.moduleRequestIdx,
            })),
            namespaceImports: record.namespaceImports.map((entry) => ({
                localName: importString(entry.localName),
                moduleRequestIdx: entry.moduleRequestIdx,
            })),
            localExports: record.localExports.map((entry) => ({
                localName: importString(entry.localName),
                exportName: importString(entry.exportName),
            })),
            indirectExports: record.indirectExports.map((entry) => ({
                exportName: importString(entry.exportName),
                importName: importString(entry.importName),
                moduleRequestIdx: entry.moduleRequestIdx,
            })),
            starExports: record.starExports.slice(),
        };
        const targetOffset = this.append(encodeModuleRecord(imported));
        caches.moduleRecords.set(sourceOffset, targetOffset);
        return targetOffset;
    }

    /**
     * hook 源码的 import 请求 → 目标 abc 中可解析的请求串:
     *   - 显式 moduleRequests 映射优先(值可以是请求串,也可以直接写 `&recordName&`);
     *   - `@...` / 相对路径原样保留;
     *   - 其余按记录名后缀唯一匹配,转成 `@normalized:N&&&<recordName>`;
     *   - 匹配不到时原样保留(交给运行时/用户显式映射)。
     */

    protected resolveHookModuleRequest(
        request: string,
        options: PatchMethodHeadSourceOptions,
    ): string {
        const explicit = options.moduleRequests?.[request];
        if (explicit !== undefined) {
            // 也接受直接写记录名(&recordName&),统一转成 normalized 请求
            return explicit.startsWith("&") ? normalizedRequestForRecord(explicit) : explicit;
        }
        if (options.resolveModuleRequests === false) return request;
        if (request.startsWith("@") || request.startsWith(".") || request.startsWith("/")) return request;
        const matches = this.findRecordNamesBySuffix(request);
        if (matches.length === 1) return normalizedRequestForRecord(matches[0]);
        if (matches.length > 1) {
            throw new PandaPatchError(
                `hook import '${request}' matches multiple records (${matches.join(", ")}); `
                + "pass moduleRequests to disambiguate");
        }
        return request;
    }

    /** 目标 abc 里以 name 结尾的记录名(用于把 hook 的裸 import 解析成记录名) */
    protected findRecordNamesBySuffix(name: string): string[] {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = new RegExp(`(^|.*/)${escaped}(&[^/]*)?$`);
        const matches: string[] = [];
        for (const clazz of this.pf.getAllClasses()) {
            if (clazz.classExternal) continue;
            const className = clazz.getClassName();
            if (className.length < 3 || !className.startsWith("L") || !className.endsWith(";")) continue;
            const recordName = className.slice(1, -1);
            if (pattern.test(recordName) && !matches.includes(recordName)) matches.push(recordName);
        }
        return matches;
    }

    protected remapHookInstructions(
        source: MethodCode,
        sourceRegion: PandaClass["indexHeader"],
        methodIdByOffset: Map<number, number>,
        caches: ClassImportCaches,
    ): Uint8Array {
        const parts: Uint8Array[] = [];
        for (const instruction of decodeInstructions(source.instructions)) {
            const operands = instruction.operands.slice();
            for (const ref of this.hookIdOperands(instruction, sourceRegion)) {
                if (ref.kind === "string") {
                    const id = caches.stringIds.get(ref.sourceOffset);
                    if (id === undefined) throw new PandaPatchError("internal error: hook string id not imported");
                    operands[ref.index] = id;
                } else if (ref.kind === "literal-array") {
                    const id = caches.literalIds.get(ref.sourceOffset);
                    if (id === undefined) throw new PandaPatchError("internal error: hook literal array id not imported");
                    operands[ref.index] = id;
                } else {
                    const id = methodIdByOffset.get(ref.sourceOffset);
                    if (id === undefined) {
                        throw new PandaPatchError(
                            `moving the hook class does not support method '${instruction.opcode.name}' `
                            + "referencing a method outside the imported class");
                    }
                    operands[ref.index] = id;
                }
            }
            parts.push(encodeInstructionWithOpcode(instruction.opcode, operands));
        }
        return concatBytes(parts);
    }

    protected hookIdOperands(
        instruction: DecodedInstruction,
        sourceRegion: PandaClass["indexHeader"],
    ): Array<{ index: number; kind: "string" | "literal-array" | "method"; sourceOffset: number }> {
        const refs: Array<{ index: number; kind: "string" | "literal-array" | "method"; sourceOffset: number }> = [];
        instruction.opcode.operands.forEach((operand, index) => {
            if (operand.kind !== "id") return;
            const sourceId = instruction.operands[index];
            const entry = sourceRegion.pandaMethods[sourceId];
            if (!entry) {
                throw new PandaPatchError(
                    `moving the hook class: entity id ${sourceId} of '${instruction.opcode.name}' is out of range`);
            }
            // 一条指令可以同时带 method_id 和 literalarray_id（defineclasswithbuffer）。
            // 按操作数名字区分，不能用指令级 flag，否则方法实体会被当成字面量数组解析。
            const kind = operand.name === "string_id" ? "string"
                : operand.name === "literalarray_id" ? "literal-array"
                    : operand.name === "method_id" ? "method"
                        : undefined;
            if (kind === undefined) {
                throw new PandaPatchError(
                    `moving the hook class does not support '${instruction.opcode.name}' operand '${operand.name}'`);
            }
            refs.push({ index, kind, sourceOffset: entry.getOffset() });
        });
        return refs;
    }

    /** 把源字符串实体复制到目标文件,并登记到目标类的 region 实体表,返回目标 id */
    protected importStringId(
        sourceFile: PandaFile,
        sourceOffset: number,
        className: string,
        caches: ClassImportCaches,
    ): number {
        let id = caches.stringIds.get(sourceOffset);
        if (id === undefined) {
            const targetOffset = this.copyStringEntity(sourceFile, sourceOffset, caches);
            id = this.appendMethodIndex(this.requireClass(className).indexHeader, targetOffset);
            caches.stringIds.set(sourceOffset, id);
        }
        return id;
    }

    /** 复制源字符串实体,返回目标文件中的绝对偏移 */
    protected copyStringEntity(sourceFile: PandaFile, sourceOffset: number, caches: ClassImportCaches): number {
        let offset = caches.stringEntities.get(sourceOffset);
        if (offset === undefined) {
            offset = this.append(encodeStringEntity(readStringEntity(sourceFile.data, sourceOffset)));
            caches.stringEntities.set(sourceOffset, offset);
        }
        return offset;
    }

    /** 复制源 literal array 实体(含嵌套实体),登记到目标类的 region 实体表,返回目标 id */
    protected importLiteralArrayId(
        sourceFile: PandaFile,
        sourceOffset: number,
        className: string,
        caches: ClassImportCaches,
    ): number {
        let id = caches.literalIds.get(sourceOffset);
        if (id === undefined) {
            const targetOffset = this.copyLiteralArrayEntity(sourceFile, sourceOffset, caches);
            id = this.appendMethodIndex(this.requireClass(className).indexHeader, targetOffset);
            caches.literalIds.set(sourceOffset, id);
        }
        return id;
    }

    /**
     * 复制 literal array 实体到目标文件末尾,把其中的绝对偏移(字符串 / 嵌套 literal array)
     * 重定位到新位置,返回新实体的绝对偏移。
     */

    protected copyLiteralArrayEntity(
        sourceFile: PandaFile,
        sourceOffset: number,
        caches: ClassImportCaches,
    ): number {
        const cached = caches.literalEntities.get(sourceOffset);
        if (cached !== undefined) return cached;
        const data = sourceFile.data;
        const count = readU32At(data, sourceOffset);
        const realSize = Math.trunc(count / 2);
        const parts: Uint8Array[] = [u32Bytes(count)];
        const methodFixups: Array<{ rel: number; sourceOffset: number }> = [];
        let rel = 4;
        let pos = sourceOffset + 4;
        for (let i = 0; i < realSize; i++) {
            const tag = data[pos++];
            if (tag === LITERAL_TAG.STRING) {
                const entityOffset = this.copyStringEntity(sourceFile, readU32At(data, pos), caches);
                pos += 4;
                parts.push(Uint8Array.of(tag), u32Bytes(entityOffset));
                rel += 5;
            } else if (tag === LITERAL_TAG.LITERALARRAY) {
                const entityOffset = this.copyLiteralArrayEntity(sourceFile, readU32At(data, pos), caches);
                pos += 4;
                parts.push(Uint8Array.of(tag), u32Bytes(entityOffset));
                rel += 5;
            } else if (tag === LITERAL_TAG.METHOD || tag === LITERAL_TAG.GENERATORMETHOD
                || tag === LITERAL_TAG.ASYNCGENERATORMETHOD || tag === LITERAL_TAG.GETTER
                || tag === LITERAL_TAG.SETTER) {
                // 源方法实体偏移，等本类方法搬完再改成目标偏移。
                methodFixups.push({ rel: rel + 1, sourceOffset: readU32At(data, pos) });
                pos += 4;
                parts.push(Uint8Array.of(tag), u32Bytes(methodFixups[methodFixups.length - 1].sourceOffset));
                rel += 5;
            } else {
                const payload = literalPayloadSize(tag);
                if (payload === null) {
                    throw new PandaPatchError(
                        `moving the hook class: literal tag 0x${tag.toString(16)} is not supported (method/array literal)`);
                }
                parts.push(data.subarray(pos - 1, pos + payload));
                pos += payload;
                rel += 1 + payload;
            }
        }
        const offset = this.append(concatBytes(parts));
        for (const fixup of methodFixups) {
            this.literalMethodFixups.push({ pos: offset + fixup.rel, sourceOffset: fixup.sourceOffset });
        }
        caches.literalEntities.set(sourceOffset, offset);
        return offset;
    }

    /**
     * 单个目标版本的 patchMethodHeads(只返回第一个结果)。
     * 给同一个 hook 预约了多个方法时请用 patchMethodHeads 拿到全部结果。
     */

}
