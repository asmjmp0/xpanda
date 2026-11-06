/**
 * Class/method entity rebuilding, relocation and literal-array fixups.
 * @Author: jmp0
 */
import { PandaClass, PandaMethod } from "xpanda-core";
import { decodeInstructions } from "../Assembler";
import { concatBytes, encodeStringEntity, readUleb128, writeUleb128 } from "../codec";
import { encodeMethodCode, type MethodCodeInput } from "../MethodCode";
import { LITERAL_TAG } from "./EntityCodec";
import { cloneMethodCode, writeU32 } from "./PatchBinary";
import { PandaPatchError, METHOD_TAG_CODE, METHOD_TAG_DEBUG_INFO, METHOD_TAG_PAYLOAD_SIZE } from "./PatchTypes";
import type {
    AddMethodOptions, AddMethodResult, ClassOverride, MethodCode,
} from "./PatchTypes";
import { PandaPatchFileBase } from "./PandaPatchFileBase";

export class PandaPatchFileEntities extends PandaPatchFileBase {
    /** Internal: a fresh patch session used to read the compiled hook abc. */
    protected static createForImport(data: Uint8Array): PandaPatchFileEntities {
        return new PandaPatchFileEntities(data);
    }

    /** 读取方法代码(用于克隆/改写);方法无代码项时返回 null */
    getMethodCode(className: string, methodName: string): MethodCode | null {
        const method = this.requireMethod(className, methodName);
        const override = this.methodCodeOverrides.get(method);
        if (override) return cloneMethodCode(override);
        const code = method.methodCode;
        if (!code) return null;
        return {
            numVregs: code.numVregs,
            numArgs: code.numArgs,
            instructions: code.instructions.slice(),
            tries: (code.pandaMethodTryBlocks ?? []).map((tryBlock) => ({
                startPC: tryBlock.startPC,
                length: tryBlock.length,
                catches: tryBlock.pandaMethodCatchBlocks.map((catchBlock) => ({
                    typeIdx: catchBlock.typeIdx,
                    handlerPC: catchBlock.handlerPC,
                    codeSize: catchBlock.codeSize,
                })),
            })),
        };
    }

    /**
     * 替换方法实现:追加新 CodeItem,并原位改写方法实体的 CODE tag。
     * 方法原有的 debug info 保留(行号表可能过时,仅影响调试信息,不影响执行)。
     */

    replaceMethodCode(className: string, methodName: string, code: MethodCodeInput): { codeOffset: number } {
        const clazz = this.requireClass(className);
        const method = this.requireMethod(className, methodName);
        if (!method.methodCode) {
            throw new PandaPatchError(`method '${className}::${methodName}' has no code item`);
        }
        const tags = this.scanMethodTags(method.getOffset());
        if (tags.codeValueOffset === null) {
            throw new PandaPatchError(`method '${className}::${methodName}' has no CODE tag`);
        }
        const codeOffset = this.append(encodeMethodCode(code));
        this.patchU32(tags.codeValueOffset, codeOffset);
        this.methodCodeOverrides.set(method, cloneMethodCode({
            numVregs: code.numVregs,
            numArgs: code.numArgs,
            instructions: code.instructions,
            tries: code.tries,
        }));

        // 若类实体已被 addMethod 重建过,同步改写新副本里的方法实体
        const state = this.classOverrides.get(clazz);
        if (state) {
            const relativeOffset = state.methodRelativeOffsets.get(methodName);
            if (relativeOffset !== undefined) {
                const copyTags = this.scanMethodTagsIn(state.bytes, relativeOffset);
                if (copyTags.codeValueOffset !== null) {
                    this.patchU32(state.offset + copyTags.codeValueOffset, codeOffset);
                }
            }
        }
        return { codeOffset };
    }

    /**
     * 在方法的指定 PC 处插入一段已汇编的字节码。
     *
     * 自动完成:
     *   - 校验 atPC 是合法指令边界;
     *   - 修正所有相对跳转(插入点之后的源/目标整体平移);
     *   - 修正 try/catch 的 start/length/handlerPC;
     *   - 必要时抬高 numVregs。
     *
     * 限制:插入片段内部的相对跳转只能指向片段内部(或片段末尾);引用原有指令的
     * 跳转需要调用方自行按插入后位置计算,当前会直接拒绝。
     */

    /** 类在所属 region 类表里的下标 */
    protected classIndexOf(clazz: PandaClass): number {
        const state = this.classOverrides.get(clazz);
        const offset = state?.offset ?? clazz.getOffset();
        const table = this.classTableState.get(clazz.indexHeader)
            ?? { offset: clazz.indexHeader.classIdxOff, size: clazz.indexHeader.classIdxSize };
        for (let i = 0; i < table.size; i++) {
            if (this.readU32(table.offset + i * 4) === offset) return i;
        }
        throw new PandaPatchError(`class '${clazz.getClassName()}' is not registered in its region class table`);
    }

    /**
     * 在类实体的字段区末尾追加字段实体(num_fields 同步 +1),返回新类实体字节与
     * 每个新字段在类实体内的相对偏移。
     */

    protected buildClassWithAppendedFields(
        clazz: PandaClass,
        fields: Uint8Array[],
    ): { bytes: Uint8Array; appendedFieldOffsets: number[]; methodShift: number } {
        const state = this.getClassOverride(clazz);
        const raw = state.bytes;
        const nameSize = clazz.name.getSize();
        let pos = nameSize + 4; // super_class_off
        const access = readUleb128(raw, pos); pos += access.size;
        const numFields = readUleb128(raw, pos); pos += numFields.size;
        const numMethods = readUleb128(raw, pos); pos += numMethods.size;
        const tagsStart = pos;

        // 跳过类 tag 区(注解 tag 无法安全重建)
        let tagPos = tagsStart;
        while (tagPos < raw.length && raw[tagPos] !== 0) {
            const tag = raw[tagPos++];
            if (tag === 0x01) { // INTERFACES
                const count = readUleb128(raw, tagPos);
                tagPos += count.size + count.value * 2;
            } else if (tag === 0x02) { // SOURCE_LANG
                tagPos += 1;
            } else if (tag === 0x07) { // SOURCE_FILE
                tagPos += 4;
            } else {
                throw new PandaPatchError(
                    `cannot add module fields to a class with tag 0x${tag.toString(16)}`);
            }
        }
        if (tagPos >= raw.length) {
            throw new PandaPatchError("class entity tags are truncated");
        }
        const tagsEnd = tagPos + 1;

        let methodsStart = tagsEnd;
        for (const field of clazz.pandaFields ?? []) methodsStart += field.getSize();
        if (methodsStart > raw.length) {
            throw new PandaPatchError(`class '${clazz.getClassName()}' layout mismatch (fields exceed entity)`);
        }

        const header = concatBytes([
            raw.subarray(0, nameSize),
            raw.subarray(nameSize, nameSize + 4),
            writeUleb128(access.value),
            writeUleb128(numFields.value + fields.length),
            writeUleb128(numMethods.value),
        ]);
        const tags = raw.subarray(tagsStart, tagsEnd);
        const existingFields = raw.subarray(tagsEnd, methodsStart);
        const methods = raw.subarray(methodsStart);

        const appendedFieldOffsets: number[] = [];
        let cursor = header.length + tags.length + existingFields.length;
        for (const field of fields) {
            appendedFieldOffsets.push(cursor);
            cursor += field.length;
        }
        const bytes = concatBytes([header, tags, existingFields, ...fields, methods]);
        // 方法整体右移(字段插在方法之前);状态更新留给 relocateClassEntity,
        // 那里才能同时用旧相对偏移改方法索引表。
        return { bytes, appendedFieldOffsets, methodShift: cursor - methodsStart };
    }

    /**
     * 把重建后的类实体追加到文件末尾,并把类索引表 / 方法索引表里的旧偏移改成新偏移。
     * (类实体里的方法实体是内联的,方法索引表必须跟着搬。)
     */

    protected relocateClassEntity(clazz: PandaClass, newBytes: Uint8Array, methodShift: number): number {
        const state = this.getClassOverride(clazz);
        const oldOffset = state.offset;
        const oldRelativeOffsets = new Map(state.methodRelativeOffsets);
        const newOffset = this.append(newBytes);

        const regionTable = this.classTableState.get(clazz.indexHeader)
            ?? { offset: clazz.indexHeader.classIdxOff, size: clazz.indexHeader.classIdxSize };
        for (let i = 0; i < regionTable.size; i++) {
            const entry = regionTable.offset + i * 4;
            if (this.readU32(entry) === oldOffset) this.patchU32(entry, newOffset);
        }
        if (this.pf.header.classIdxOff !== 0xffffffff) {
            const headerTable = this.headerClassTableState
                ?? { offset: this.pf.header.classIdxOff, size: this.pf.header.numClasses };
            for (let i = 0; i < headerTable.size; i++) {
                const entry = headerTable.offset + i * 4;
                if (this.readU32(entry) === oldOffset) this.patchU32(entry, newOffset);
            }
        }

        const moved = new Map<number, number>();
        for (const [, relative] of oldRelativeOffsets) {
            moved.set(oldOffset + relative, newOffset + relative + methodShift);
        }
        const entityTable = this.entityTableState.get(clazz.indexHeader)
            ?? { offset: clazz.indexHeader.methodIdxOff, size: clazz.indexHeader.methodIdxSize };
        for (let i = 0; i < entityTable.size; i++) {
            const entry = entityTable.offset + i * 4;
            const target = moved.get(this.readU32(entry));
            if (target !== undefined) this.patchU32(entry, target);
        }
        // Entities appended in this session are not in the table yet; they may
        // still reference a method that just moved with the class.
        const pending = this.pendingEntityEntries.get(clazz.indexHeader);
        if (pending) {
            for (let i = 0; i < pending.length; i++) {
                const target = moved.get(pending[i]);
                if (target !== undefined) pending[i] = target;
            }
        }

        // 字面量数组里的 METHOD tag 存的是方法实体绝对偏移(不是 id),也要跟着搬
        this.patchMethodLiteralOffsets(moved);

        for (const [name, relative] of oldRelativeOffsets) {
            state.methodRelativeOffsets.set(name, relative + methodShift);
        }
        state.offset = newOffset;
        state.bytes = newBytes;
        this.extendRegion(clazz.indexHeader, newOffset + newBytes.length);
        return newOffset;
    }

    /**
     * 改写 literal array 里指向旧方法实体的 METHOD/GETTER/SETTER 偏移。
     * v24 的 header 没有 literal array 表,因此从所有方法的 `literalarray_id`
     * 操作数收集数组偏移(defineclasswithbuffer 的类 buffer 也在其中)。
     */

    protected patchMethodLiteralOffsets(moved: Map<number, number>): void {
        if (moved.size === 0) return;
        const arrays = new Set<number>();
        for (const clazz of this.pf.getAllClasses()) {
            if (clazz.classExternal) continue;
            const className = clazz.getClassName();
            if (!className.startsWith("L") || !className.endsWith(";")) continue;
            for (const method of clazz.pandaMethods.values()) {
                const code = this.getMethodCode(className, method.name.content);
                if (!code) continue;
                for (const instruction of decodeInstructions(code.instructions)) {
                    for (let i = 0; i < instruction.opcode.operands.length; i++) {
                        if (instruction.opcode.operands[i].name !== "literalarray_id") continue;
                        const id = instruction.operands[i];
                        const entry = method.indexHeader.pandaMethods[id];
                        if (entry) arrays.add(entry.getOffset());
                    }
                }
            }
        }
        for (const offset of arrays) this.patchMethodLiteralOffsetsInArray(offset, moved);
    }

    protected patchMethodLiteralOffsetsInArray(offset: number, moved: Map<number, number>): void {
        const realSize = Math.trunc(this.readU32(offset) / 2);
        let pos = offset + 4;
        for (let i = 0; i < realSize; i++) {
            if (pos >= this.size) return;
            const tag = this.bytes[pos++];
            switch (tag) {
                case LITERAL_TAG.METHOD:
                case LITERAL_TAG.GENERATORMETHOD:
                case LITERAL_TAG.ASYNCGENERATORMETHOD:
                case LITERAL_TAG.GETTER:
                case LITERAL_TAG.SETTER: {
                    const target = moved.get(this.readU32(pos));
                    if (target !== undefined) this.patchU32(pos, target);
                    pos += 4;
                    break;
                }
                case LITERAL_TAG.STRING:
                case LITERAL_TAG.LITERALARRAY:
                case LITERAL_TAG.INTEGER:
                case LITERAL_TAG.FLOAT:
                case LITERAL_TAG.LITERALBUFFERINDEX:
                    pos += 4;
                    break;
                case LITERAL_TAG.DOUBLE:
                    pos += 8;
                    break;
                case LITERAL_TAG.METHODAFFILIATE:
                    pos += 2;
                    break;
                case LITERAL_TAG.ARRAY_U1:
                case LITERAL_TAG.ARRAY_U8:
                case LITERAL_TAG.ARRAY_I8:
                case LITERAL_TAG.ARRAY_U16:
                case LITERAL_TAG.ARRAY_I16:
                case LITERAL_TAG.ARRAY_U32:
                case LITERAL_TAG.ARRAY_I32:
                case LITERAL_TAG.ARRAY_U64:
                case LITERAL_TAG.ARRAY_I64:
                case LITERAL_TAG.ARRAY_F32:
                case LITERAL_TAG.ARRAY_F64:
                case LITERAL_TAG.ARRAY_STRING:
                    // 数组字面量的载荷长度依赖元素类型,遇到即停止(方法引用不会出现在其后)
                    return;
                default: // TAGVALUE / BOOL / ACCESSOR / BUILTINTYPEINDEX / NULLVALUE
                    pos += 1;
                    break;
            }
        }
    }

    addMethod(className: string, options: AddMethodOptions): AddMethodResult {
        const clazz = this.requireClass(className);
        const state = this.getClassOverride(clazz);
        if (state.methodRelativeOffsets.has(options.name)) {
            throw new PandaPatchError(`method '${className}::${options.name}' already exists`);
        }
        // 追加的实体落在最后一个 index section 的区域里;多 region 文件暂不支持(会覆盖后续 region 的解析)
        const lastIndexHeader = this.pf.indexHeaders[this.pf.indexHeaders.length - 1];
        if (clazz.indexHeader !== lastIndexHeader) {
            throw new PandaPatchError("addMethod is not supported for files with multiple index sections (class is not in the last one)");
        }
        const template = this.pickTemplate(clazz, options.template);
        const templateTags = this.scanMethodTags(template.getOffset());
        if (options.code && templateTags.codeValueOffset === null) {
            throw new PandaPatchError(`template method '${className}::${template.name.content}' has no CODE tag`);
        }

        const nameOffset = this.append(encodeStringEntity(options.name));
        const codeOffset = options.code ? this.append(encodeMethodCode(options.code)) : undefined;
        const entry = this.buildMethodEntry(template, {
            nameOffset,
            codeOffset,
            dropDebugInfo: true,
        });

        const { bytes: newClassBytes, newMethodRelativeOffset } = this.buildClassWithAppendedMethod(clazz, options.name, entry);
        const newClassOffset = this.appendAndRelocateClass(clazz, newClassBytes);
        const methodOffset = newClassOffset + newMethodRelativeOffset;
        const methodId = this.appendMethodIndex(clazz.indexHeader, methodOffset);

        return { className, methodName: options.name, methodOffset, methodId, codeOffset };
    }

    protected buildMethodEntry(
        template: PandaMethod,
        options: { nameOffset?: number; codeOffset?: number; dropDebugInfo?: boolean },
    ): Uint8Array {
        const offset = template.getOffset();
        const head = this.data.slice(offset, offset + 8); // class_idx, proto_idx, name
        if (options.nameOffset !== undefined) writeU32(head, 4, options.nameOffset);
        const parts: Uint8Array[] = [head];

        let pos = offset + 8;
        const flags = readUleb128(this.data, pos);
        parts.push(this.data.slice(pos, pos + flags.size));
        pos += flags.size;

        while (true) {
            const tag = this.data[pos];
            if (tag === 0x00) {
                parts.push(Uint8Array.of(0));
                break;
            }
            const payloadSize = METHOD_TAG_PAYLOAD_SIZE[tag];
            if (payloadSize === undefined) {
                throw new PandaPatchError(`unsupported method tag 0x${tag.toString(16)} at ${pos}`);
            }
            const whole = this.data.slice(pos, pos + 1 + payloadSize);
            if (options.dropDebugInfo && tag === METHOD_TAG_DEBUG_INFO) {
                pos += 1 + payloadSize;
                continue;
            }
            if (tag === METHOD_TAG_CODE && options.codeOffset !== undefined) {
                writeU32(whole, 1, options.codeOffset);
            }
            parts.push(whole);
            pos += 1 + payloadSize;
        }
        return concatBytes(parts);
    }

    /** 计算类实体字节中 num_methods 这个 uleb128 字段的相对偏移 */
    protected classNumMethodsFieldOffsetIn(bytes: Uint8Array, nameSize: number): number {
        let pos = nameSize;
        pos += 4; // super_class_off
        pos += readUleb128(bytes, pos).size; // access_flags
        pos += readUleb128(bytes, pos).size; // num_fields
        return pos;
    }

    /** 取(或初始化)类的当前实体状态;addMethod 之后后续修改都基于最新副本 */
    protected getClassOverride(clazz: PandaClass): ClassOverride {
        let state = this.classOverrides.get(clazz);
        if (!state) {
            const methodRelativeOffsets = new Map<string, number>();
            for (const [name, method] of clazz.pandaMethods) {
                methodRelativeOffsets.set(name, method.getOffset() - clazz.getOffset());
            }
            state = {
                offset: clazz.getOffset(),
                bytes: this.data.slice(clazz.getOffset(), clazz.getOffset() + clazz.index),
                numMethods: clazz.numMethods,
                methodRelativeOffsets,
            };
            this.classOverrides.set(clazz, state);
        }
        return state;
    }

    /**
     * 在类实体副本末尾追加一个方法实体;返回新类实体字节与新方法实体的相对偏移。
     */

    protected buildClassWithAppendedMethod(
        clazz: PandaClass,
        methodName: string,
        methodEntry: Uint8Array,
    ): { bytes: Uint8Array; newMethodRelativeOffset: number } {
        const state = this.getClassOverride(clazz);
        const raw = state.bytes;
        const numMethodsRelative = this.classNumMethodsFieldOffsetIn(raw, clazz.name.getSize());
        const oldCount = readUleb128(raw, numMethodsRelative);
        const newCountBytes = writeUleb128(state.numMethods + 1);
        const before = raw.subarray(0, numMethodsRelative);
        const after = raw.subarray(numMethodsRelative + oldCount.size);
        const baseLength = before.length + newCountBytes.length + after.length;
        const out = new Uint8Array(baseLength + methodEntry.length);
        out.set(before, 0);
        out.set(newCountBytes, before.length);
        out.set(after, before.length + newCountBytes.length);
        out.set(methodEntry, baseLength);

        // num_methods 的 uleb 长度变化会让其后所有方法实体整体平移
        const shift = newCountBytes.length - oldCount.size;
        if (shift !== 0) {
            for (const [name, relative] of state.methodRelativeOffsets) {
                state.methodRelativeOffsets.set(name, relative + shift);
            }
        }
        state.methodRelativeOffsets.set(methodName, baseLength);
        state.bytes = out;
        state.numMethods += 1;
        return { bytes: out, newMethodRelativeOffset: baseLength };
    }

    /**
     * 扩帧:新增 delta 个局部寄存器,所有参数寄存器索引整体后移 delta。
     * 受宽度影响的指令(4-bit → 8-bit 等)会重新编码,并修正跳转与 try/catch。
     */

    /** 追加新类实体,并把所有指向旧类实体的索引表项改成新偏移 */
    protected appendAndRelocateClass(clazz: PandaClass, newClassBytes: Uint8Array): number {
        const state = this.getClassOverride(clazz);
        const oldOffset = state.offset;
        const newOffset = this.append(newClassBytes);
        this.patchClassTable(this.pf.header.classIdxOff, this.pf.header.numClasses, oldOffset, newOffset);
        for (const indexHeader of this.pf.indexHeaders) {
            this.patchClassTable(indexHeader.classIdxOff, indexHeader.classIdxSize, oldOffset, newOffset);
        }
        state.offset = newOffset;
        this.extendRegion(clazz.indexHeader, newOffset + newClassBytes.length);
        return newOffset;
    }

}
