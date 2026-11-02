/**
 * Class dump: copy selected classes (plus the classes/methods they reference) into a new
 * single-region .abc file.
 *
 * The output keeps the original class table ids for primitive types and rebuilds the
 * method/string/literal-array entity table, so type ids, method ids and literal arrays in
 * the copied bytecode stay valid. Only the data reachable from the selected classes is
 * copied; class-level super classes/interfaces are currently rejected because ArkTS merged
 * abc files flatten them (all class entities in the supported samples carry super = 0).
 *
 * @Author: jmp0
 */
import {
    Adler32,
    OPCODE_FLAG,
    PandaClass,
    PandaFile,
    PandaMethod,
    decodeInstructions,
    encodeInstructionWithOpcode,
} from "xpanda-core";
import { concatBytes, encodeStringEntity, readStringEntity, writeSleb128, writeUleb128 } from "./codec";
import { encodeMethodCode, type CatchBlockInput, type TryBlockInput } from "./MethodCode";
import { encodeModuleRecord, readModuleRecord } from "./ModuleRecord";

/** Panda Header size: magic(8) + checksum(4) + version(4) + 11*4 */
const HEADER_SIZE = 60;
/** Panda RegionHeader size */
const INDEX_HEADER_SIZE = 40;

const HEADER_CHECKSUM_OFF = 8;
const HEADER_FILE_SIZE_OFF = 16;
const HEADER_NUM_CLASSES_OFF = 28;
const HEADER_CLASS_IDX_OFF = 32;
const HEADER_NUM_INDEXES_OFF = 52;
const HEADER_INDEX_SECTION_OFF = 56;

const INDEX_HEADER_CLASS_IDX_SIZE_OFF = 8;
const INDEX_HEADER_CLASS_IDX_OFF_OFF = 12;
const INDEX_HEADER_METHOD_IDX_SIZE_OFF = 16;
const INDEX_HEADER_METHOD_IDX_OFF_OFF = 20;
const INDEX_HEADER_FIELD_IDX_SIZE_OFF = 24;
const INDEX_HEADER_FIELD_IDX_OFF_OFF = 28;
const INDEX_HEADER_PROTO_IDX_SIZE_OFF = 32;
const INDEX_HEADER_PROTO_IDX_OFF_OFF = 36;

const METHOD_TAG_CODE = 0x01;
const METHOD_TAG_SOURCE_LANG = 0x02;
const CLASS_TAG_NOTHING = 0x00;
const CLASS_TAG_SOURCE_LANG = 0x02;
const CLASS_TAG_SOURCE_FILE = 0x07;
const FIELD_TAG_NOTHING = 0x00;
const FIELD_TAG_INT_VALUE = 0x01;
const FIELD_TAG_VALUE = 0x02;

const LITERAL_TAG = {
    TAGVALUE: 0x00,
    BOOL: 0x01,
    INTEGER: 0x02,
    FLOAT: 0x03,
    DOUBLE: 0x04,
    STRING: 0x05,
    METHOD: 0x06,
    GENERATORMETHOD: 0x07,
    ACCESSOR: 0x08,
    METHODAFFILIATE: 0x09,
    ARRAY_U1: 0x0a,
    ARRAY_U8: 0x0b,
    ARRAY_I8: 0x0c,
    ARRAY_U16: 0x0d,
    ARRAY_I16: 0x0e,
    ARRAY_U32: 0x0f,
    ARRAY_I32: 0x10,
    ARRAY_U64: 0x11,
    ARRAY_I64: 0x12,
    ARRAY_F32: 0x13,
    ARRAY_F64: 0x14,
    ARRAY_STRING: 0x15,
    ASYNCGENERATORMETHOD: 0x16,
    LITERALBUFFERINDEX: 0x17,
    LITERALARRAY: 0x18,
    BUILTINTYPEINDEX: 0x19,
    GETTER: 0x1a,
    SETTER: 0x1b,
    NULLVALU: 0xff,
} as const;

const ARRAY_ELEMENT_SIZE: Record<number, number> = {
    [LITERAL_TAG.ARRAY_U1]: 1,
    [LITERAL_TAG.ARRAY_U8]: 1,
    [LITERAL_TAG.ARRAY_I8]: 1,
    [LITERAL_TAG.ARRAY_U16]: 2,
    [LITERAL_TAG.ARRAY_I16]: 2,
    [LITERAL_TAG.ARRAY_U32]: 4,
    [LITERAL_TAG.ARRAY_I32]: 4,
    [LITERAL_TAG.ARRAY_F32]: 4,
    [LITERAL_TAG.ARRAY_U64]: 8,
    [LITERAL_TAG.ARRAY_I64]: 8,
    [LITERAL_TAG.ARRAY_F64]: 8,
    [LITERAL_TAG.ARRAY_STRING]: 4,
};

/** Result of dumping one or more classes into a fresh abc. */
export interface DumpClassesResult {
    /** New .abc bytes. */
    data: Uint8Array;
    /** Requested classes, in output order. */
    classes: string[];
    /** Extra classes copied because the requested classes reference them. */
    dependencies: string[];
}

/** Parse/emit helpers local to this file (the abc is built from scratch, not patched in place). */
class ClassDumpBuilder {
    private readonly pf: PandaFile;
    private bytes: Uint8Array;
    private size = HEADER_SIZE + INDEX_HEADER_SIZE;

    /** Target region class table (primitive raw values or class entity offsets). */
    private readonly classTable: number[] = [];
    /** Target region entity table (method / string / literal-array offsets). */
    private readonly entityTable: number[] = [];
    /** Target proto table offsets (only for bytecode versions that still use it). */
    private readonly protoTable: number[] = [];
    private readonly classQueue: PandaClass[] = [];
    private readonly literalQueue: Array<{ sourceOffset: number; id: number }> = [];

    private readonly classSlotByOffset = new Map<number, number>();
    private readonly classNameBySlot: string[] = [];
    private readonly methodEntryByOffset = new Map<number, { id: number; method: PandaMethod }>();
    private readonly methodOffsetBySource = new Map<number, number>();
    private readonly stringOffsetBySource = new Map<number, number>();
    private readonly stringIdBySource = new Map<number, number>();
    private readonly literalOffsetBySource = new Map<number, number>();
    private readonly literalIdBySource = new Map<number, number>();
    private readonly literalCopying = new Set<number>();
    private readonly protoIdBySource = new Map<number, number>();
    private readonly moduleRecordOffsetBySource = new Map<number, number>();

    constructor(pf: PandaFile, selected: PandaClass[]) {
        this.pf = pf;
        this.bytes = new Uint8Array(1024 * 1024);
        // Reserve header + index header so every entity offset is already absolute.
        this.size = HEADER_SIZE + INDEX_HEADER_SIZE;
        // Selected classes take the first class-table slots, keeping the output order stable.
        for (const clazz of selected) this.ensureClassSlot(clazz);
    }

    build(selectedNames: string[]): DumpClassesResult {
        this.processQueues();
        const data = this.emitFile();

        const selected = new Set(selectedNames);
        const dependencies: string[] = [];
        for (let slot = 0; slot < this.classNameBySlot.length; slot++) {
            const name = this.classNameBySlot[slot];
            if (name !== undefined && !selected.has(name) && !dependencies.includes(name)) {
                dependencies.push(name);
            }
        }
        return { data, classes: selectedNames.slice(), dependencies };
    }

    private processQueues(): void {
        let guard = 0;
        while (this.classQueue.length > 0 || this.literalQueue.length > 0) {
            if (++guard > 1_000_000) throw new Error("dump: dependency queue does not converge");
            while (this.classQueue.length > 0) this.buildClass(this.classQueue.shift()!);
            while (this.literalQueue.length > 0) {
                const item = this.literalQueue.shift()!;
                this.copyLiteralArray(item.sourceOffset, item.id);
            }
        }
    }

    // ------------------------------------------------------------ output buffer

    private ensureCapacity(capacity: number): void {
        if (capacity <= this.bytes.length) return;
        let next = this.bytes.length;
        while (next < capacity) next *= 2;
        const grown = new Uint8Array(next);
        grown.set(this.bytes.subarray(0, this.size), 0);
        this.bytes = grown;
    }

    private append(part: Uint8Array): number {
        while (this.size % 4 !== 0) {
            this.ensureCapacity(this.size + 1);
            this.bytes[this.size++] = 0;
        }
        const offset = this.size;
        this.ensureCapacity(offset + part.length);
        this.bytes.set(part, offset);
        this.size += part.length;
        return offset;
    }

    // ------------------------------------------------------------ class table

    private ensureClassSlot(clazz: PandaClass): number {
        if (!clazz || clazz.classExternal || !clazz.isValid()) {
            throw new Error(`dump: external or invalid class cannot be dumped: ${clazz?.getClassName() ?? "?"}`);
        }
        const offset = clazz.getOffset();
        const existing = this.classSlotByOffset.get(offset);
        if (existing !== undefined) return existing;
        if (clazz.superClassOff.getOffset() !== 0) {
            throw new Error(`dump: class ${clazz.getClassName()} has a super class; not supported yet`);
        }
        if (clazz.numIfaces > 0) {
            throw new Error(`dump: class ${clazz.getClassName()} declares interfaces; not supported yet`);
        }
        const slot = this.classTable.length;
        this.classTable.push(0);
        this.classNameBySlot[slot] = clazz.getClassName();
        this.classSlotByOffset.set(offset, slot);
        this.classQueue.push(clazz);
        return slot;
    }

    private ensureType(sourceRegion: PandaClass["indexHeader"], sourceId: number): number {
        const sourceClass = sourceRegion.pandaClasses[sourceId];
        if (!sourceClass) throw new Error(`dump: type id ${sourceId} is out of range`);
        const raw = sourceClass.getOffset();
        if (raw <= HEADER_SIZE) {
            // Primitive type entries encode the raw type in the class-table value.
            const existing = this.classTable.indexOf(raw);
            if (existing >= 0) return existing;
            const slot = this.classTable.length;
            this.classTable.push(raw);
            return slot;
        }
        if (sourceClass.classExternal) {
            throw new Error(`dump: type ${sourceClass.getClassName()} is external; not supported yet`);
        }
        return this.ensureClassSlot(sourceClass);
    }

    // ------------------------------------------------------------ string/literal/proto entities

    private copyString(sourceOffset: number): number {
        const existing = this.stringOffsetBySource.get(sourceOffset);
        if (existing !== undefined) return existing;
        const text = readStringEntity(this.pf.data, sourceOffset);
        const offset = this.append(encodeStringEntity(text));
        this.stringOffsetBySource.set(sourceOffset, offset);
        return offset;
    }

    private ensureStringId(sourceOffset: number): number {
        const existing = this.stringIdBySource.get(sourceOffset);
        if (existing !== undefined) return existing;
        const offset = this.copyString(sourceOffset);
        const id = this.entityTable.length;
        this.entityTable.push(offset);
        this.stringIdBySource.set(sourceOffset, id);
        return id;
    }

    private ensureLiteralId(sourceOffset: number): number {
        let id = this.literalIdBySource.get(sourceOffset);
        if (id !== undefined) return id;
        id = this.entityTable.length;
        this.entityTable.push(0);
        this.literalIdBySource.set(sourceOffset, id);
        this.literalQueue.push({ sourceOffset, id });
        return id;
    }

    private ensureProto(proto: PandaMethod["pandaProto"]): number {
        if (!proto) return 0xffff;
        const sourceOffset = proto.getOffset();
        const existing = this.protoIdBySource.get(sourceOffset);
        if (existing !== undefined) return existing;
        const bytes = this.pf.data.subarray(sourceOffset, sourceOffset + proto.getSize());
        const offset = this.append(bytes.slice());
        const id = this.protoTable.length;
        this.protoTable.push(offset);
        this.protoIdBySource.set(sourceOffset, id);
        return id;
    }

    // ------------------------------------------------------------ methods

    private lookupSourceMethod(sourceRegion: PandaClass["indexHeader"], sourceId: number): PandaMethod {
        const offset = sourceRegion.pandaMethods[sourceId]?.getOffset();
        if (offset === undefined) throw new Error(`dump: method id ${sourceId} is out of range`);
        const method = PandaMethod.create(this.pf, offset);
        method.resolve();
        return method;
    }

    private ownerClassOf(method: PandaMethod): PandaClass {
        if (method.pandaClass) return method.pandaClass;
        const region = method.indexHeader;
        const clazz = region?.pandaClasses[method.classIdx];
        if (!clazz) throw new Error(`dump: method ${method.name.content} has no owner class`);
        return clazz;
    }

    private ensureMethodId(method: PandaMethod): number {
        const sourceOffset = method.getOffset();
        const existing = this.methodEntryByOffset.get(sourceOffset);
        if (existing) return existing.id;
        this.ensureClassSlot(this.ownerClassOf(method));
        const id = this.entityTable.length;
        this.entityTable.push(0);
        this.methodEntryByOffset.set(sourceOffset, { id, method });
        return id;
    }

    /**
     * Resolve a method entity's offset in the target file. Literal arrays store method
     * offsets (not ids), so the owning class may have to be built first.
     */
    private ensureMethodOffset(method: PandaMethod): number {
        const sourceOffset = method.getOffset();
        this.ensureMethodId(method);
        let guard = 0;
        while (!this.methodOffsetBySource.has(sourceOffset)) {
            if (this.classQueue.length === 0) {
                throw new Error(`dump: could not locate method ${method.name.content} in the copied classes`);
            }
            if (++guard > 1_000_000) throw new Error("dump: method offset wait does not converge");
            this.buildClass(this.classQueue.shift()!);
        }
        return this.methodOffsetBySource.get(sourceOffset)!;
    }

    // ------------------------------------------------------------ class/method emission

    private buildClass(clazz: PandaClass): void {
        const classSlot = this.ensureClassSlot(clazz);
        const sourceRegion = clazz.indexHeader;

        const fieldParts: Uint8Array[] = [];
        for (const field of clazz.pandaFields ?? []) {
            const name = field.getName();
            if (field.fieldExternal) {
                throw new Error(`dump: external field '${name}' on ${clazz.getClassName()} is not supported`);
            }
            // Compiler AOP metadata; not needed at runtime and has no bytecode references.
            if (name === "scopeNames") continue;
            const typeIdx = this.ensureType(sourceRegion, field.typeIdx);
            const nameOffset = this.copyString(field.name.getOffset());
            let valueTags: Uint8Array;
            if (field.pandaFieldValue) {
                if (name !== "moduleRecordIdx") {
                    throw new Error(`dump: unsupported VALUE field '${name}' on ${clazz.getClassName()}`);
                }
                const recordOffset = this.ensureModuleRecord(field.pandaFieldValue.getOffset());
                valueTags = concatBytes([Uint8Array.of(FIELD_TAG_VALUE), u32(recordOffset)]);
            } else {
                valueTags = concatBytes([Uint8Array.of(FIELD_TAG_INT_VALUE), writeSleb128(field.intValue)]);
            }
            const head = new Uint8Array(8);
            writeU16(head, 0, classSlot);
            writeU16(head, 2, typeIdx);
            writeU32(head, 4, nameOffset);
            fieldParts.push(concatBytes([
                head,
                writeUleb128(field.accessFlag),
                valueTags,
                Uint8Array.of(FIELD_TAG_NOTHING),
            ]));
        }

        const methods = [...clazz.pandaMethods.values()];
        const methodBodies: Uint8Array[] = [];
        for (const method of methods) methodBodies.push(this.buildMethod(method, classSlot));

        const classTags: Uint8Array[] = [];
        if (clazz.sourceLang !== 0) {
            classTags.push(Uint8Array.of(CLASS_TAG_SOURCE_LANG, clazz.sourceLang));
        }
        if (clazz.sourceFile && clazz.sourceFile.isValid()) {
            classTags.push(Uint8Array.of(CLASS_TAG_SOURCE_FILE), u32(this.copyString(clazz.sourceFile.getOffset())));
        }
        const nameBytes = encodeStringEntity(clazz.getClassName());
        const accessFlags = writeUleb128(clazz.accessFlags);
        const fieldCount = writeUleb128(fieldParts.length);
        const methodCount = writeUleb128(methodBodies.length);
        const classBytes = concatBytes([
            nameBytes,
            u32(0), // super
            accessFlags,
            fieldCount,
            methodCount,
            ...classTags,
            Uint8Array.of(CLASS_TAG_NOTHING),
            ...fieldParts,
            ...methodBodies,
        ]);
        const classOffset = this.append(classBytes);
        this.classTable[classSlot] = classOffset;

        let methodOffset = classOffset + nameBytes.length + 4
            + accessFlags.length + fieldCount.length + methodCount.length
            + classTags.reduce((total, part) => total + part.length, 0) + 1
            + fieldParts.reduce((total, part) => total + part.length, 0);
        for (let i = 0; i < methods.length; i++) {
            const method = methods[i];
            const entry = this.methodEntryByOffset.get(method.getOffset());
            if (!entry) throw new Error("dump: internal error: missing method entity entry");
            this.methodOffsetBySource.set(method.getOffset(), methodOffset);
            this.entityTable[entry.id] = methodOffset;
            methodOffset += methodBodies[i].length;
        }
    }

    private buildMethod(method: PandaMethod, classSlot: number): Uint8Array {
        if (method.methodExternal || !method.methodCode) {
            throw new Error(`dump: method '${method.name.content}' has no code; external methods are not supported`);
        }
        this.ensureMethodId(method);
        const sourceRegion = method.indexHeader;
        const code = method.methodCode;

        const instructions = this.remapInstructions(code.instructions, sourceRegion);
        const tries: TryBlockInput[] = (code.pandaMethodTryBlocks ?? []).map((tryBlock) => ({
            startPC: tryBlock.startPC,
            length: tryBlock.length,
            catches: tryBlock.pandaMethodCatchBlocks.map((catchBlock): CatchBlockInput => ({
                // typeIdx 0 is catch-all, not a class-table index.
                typeIdx: catchBlock.typeIdx === 0 ? 0 : this.ensureType(sourceRegion, catchBlock.typeIdx),
                handlerPC: catchBlock.handlerPC,
                codeSize: catchBlock.codeSize,
            })),
        }));
        const codeOffset = this.append(encodeMethodCode({
            numVregs: code.numVregs,
            numArgs: code.numArgs,
            instructions,
            tries,
        }));
        const nameOffset = this.copyString(method.name.getOffset());
        const protoIdx = this.ensureProto(method.pandaProto);

        const head = new Uint8Array(8);
        writeU16(head, 0, classSlot);
        writeU16(head, 2, protoIdx);
        writeU32(head, 4, nameOffset);
        const tags: Uint8Array[] = [Uint8Array.of(METHOD_TAG_CODE), u32(codeOffset)];
        if (method.sourceLang !== 0) tags.push(Uint8Array.of(METHOD_TAG_SOURCE_LANG, method.sourceLang));
        return concatBytes([
            head,
            writeUleb128(method.accessFlag & 0xffff),
            ...tags,
            Uint8Array.of(0x00),
        ]);
    }

    private remapInstructions(instructions: Uint8Array, sourceRegion: PandaClass["indexHeader"]): Uint8Array {
        const parts: Uint8Array[] = [];
        for (const instruction of decodeInstructions(instructions)) {
            const operands = instruction.operands.slice();
            instruction.opcode.operands.forEach((operand, index) => {
                if (operand.kind !== "id") return;
                const sourceId = instruction.operands[index];
                const classDefinition = instruction.opcode.name === "defineclasswithbuffer"
                    || instruction.opcode.name === "callruntime.definesendableclass";
                if (classDefinition && index === 1) {
                    operands[index] = this.ensureMethodId(this.lookupSourceMethod(sourceRegion, sourceId));
                } else if (classDefinition && index === 2) {
                    const sourceOffset = sourceRegion.pandaMethods[sourceId]?.getOffset();
                    if (sourceOffset === undefined) throw new Error(`dump: literal id ${sourceId} is out of range`);
                    operands[index] = this.ensureLiteralId(sourceOffset);
                } else if (instruction.opcode.flags & OPCODE_FLAG.TYPE_ID) {
                    operands[index] = this.ensureType(sourceRegion, sourceId);
                } else if (instruction.opcode.flags & OPCODE_FLAG.METHOD_ID) {
                    operands[index] = this.ensureMethodId(this.lookupSourceMethod(sourceRegion, sourceId));
                } else if (instruction.opcode.flags & OPCODE_FLAG.STRING_ID) {
                    const sourceOffset = sourceRegion.pandaMethods[sourceId]?.getOffset();
                    if (sourceOffset === undefined) throw new Error(`dump: string id ${sourceId} is out of range`);
                    operands[index] = this.ensureStringId(sourceOffset);
                } else if (instruction.opcode.flags & OPCODE_FLAG.LITERALARRAY_ID) {
                    const sourceOffset = sourceRegion.pandaMethods[sourceId]?.getOffset();
                    if (sourceOffset === undefined) throw new Error(`dump: literal id ${sourceId} is out of range`);
                    operands[index] = this.ensureLiteralId(sourceOffset);
                } else if (instruction.opcode.flags & OPCODE_FLAG.FIELD_ID) {
                    throw new Error(`dump: field-id instruction '${instruction.opcode.name}' is not supported`);
                }
            });
            parts.push(encodeInstructionWithOpcode(instruction.opcode, operands));
        }
        return concatBytes(parts);
    }

    private ensureModuleRecord(sourceOffset: number): number {
        const existing = this.moduleRecordOffsetBySource.get(sourceOffset);
        if (existing !== undefined) return existing;
        const record = readModuleRecord(this.pf.data, sourceOffset);
        const copy = (offset: number): number => this.copyString(offset);
        const imported = {
            moduleRequests: record.moduleRequests.map(copy),
            regularImports: record.regularImports.map((entry) => ({
                localName: copy(entry.localName),
                importName: copy(entry.importName),
                moduleRequestIdx: entry.moduleRequestIdx,
            })),
            namespaceImports: record.namespaceImports.map((entry) => ({
                localName: copy(entry.localName),
                moduleRequestIdx: entry.moduleRequestIdx,
            })),
            localExports: record.localExports.map((entry) => ({
                localName: copy(entry.localName),
                exportName: copy(entry.exportName),
            })),
            indirectExports: record.indirectExports.map((entry) => ({
                exportName: copy(entry.exportName),
                importName: copy(entry.importName),
                moduleRequestIdx: entry.moduleRequestIdx,
            })),
            starExports: record.starExports.slice(),
        };
        const offset = this.append(encodeModuleRecord(imported));
        this.moduleRecordOffsetBySource.set(sourceOffset, offset);
        return offset;
    }

    // ------------------------------------------------------------ literal arrays

    private copyLiteralArray(sourceOffset: number, id: number): void {
        const cached = this.literalOffsetBySource.get(sourceOffset);
        if (cached !== undefined) {
            this.entityTable[id] = cached;
            return;
        }
        if (this.literalCopying.has(sourceOffset)) {
            throw new Error(`dump: recursive literal array at offset ${sourceOffset}`);
        }
        this.literalCopying.add(sourceOffset);

        const data = this.pf.data;
        const count = readU32At(data, sourceOffset);
        const realSize = Math.trunc(count / 2);
        const parts: Uint8Array[] = [u32(count)];
        let pos = sourceOffset + 4;
        for (let i = 0; i < realSize; i++) {
            const tag = data[pos++];
            if (tag === LITERAL_TAG.STRING) {
                const stringOffset = this.copyString(readU32At(data, pos));
                pos += 4;
                parts.push(Uint8Array.of(tag), u32(stringOffset));
            } else if (tag === LITERAL_TAG.LITERALARRAY) {
                const nestedSource = readU32At(data, pos);
                pos += 4;
                const nestedId = this.ensureLiteralId(nestedSource);
                const nestedOffset = this.literalOffsetBySource.get(nestedSource);
                if (nestedOffset === undefined) this.copyLiteralArray(nestedSource, nestedId);
                parts.push(Uint8Array.of(tag), u32(this.literalOffsetBySource.get(nestedSource)!));
            } else if (tag === LITERAL_TAG.METHOD || tag === LITERAL_TAG.GENERATORMETHOD
                || tag === LITERAL_TAG.ASYNCGENERATORMETHOD || tag === LITERAL_TAG.GETTER
                || tag === LITERAL_TAG.SETTER) {
                const methodSource = readU32At(data, pos);
                pos += 4;
                const method = PandaMethod.create(this.pf, methodSource);
                method.resolve();
                parts.push(Uint8Array.of(tag), u32(this.ensureMethodOffset(method)));
            } else if (tag === LITERAL_TAG.DOUBLE) {
                parts.push(data.subarray(pos - 1, pos + 8));
                pos += 8;
            } else if (tag === LITERAL_TAG.METHODAFFILIATE) {
                parts.push(data.subarray(pos - 1, pos + 2));
                pos += 2;
            } else if (tag === LITERAL_TAG.INTEGER || tag === LITERAL_TAG.FLOAT
                || tag === LITERAL_TAG.LITERALBUFFERINDEX) {
                parts.push(data.subarray(pos - 1, pos + 4));
                pos += 4;
            } else if (ARRAY_ELEMENT_SIZE[tag] !== undefined) {
                const length = readU32At(data, pos);
                const elementSize = ARRAY_ELEMENT_SIZE[tag];
                pos += 4;
                parts.push(Uint8Array.of(tag), u32(length));
                if (tag === LITERAL_TAG.ARRAY_STRING) {
                    for (let j = 0; j < length; j++) {
                        const stringOffset = this.copyString(readU32At(data, pos));
                        pos += 4;
                        parts.push(u32(stringOffset));
                    }
                } else {
                    const byteLength = length * elementSize;
                    parts.push(data.subarray(pos, pos + byteLength));
                    pos += byteLength;
                }
            } else {
                // TAGVALUE / BOOL / ACCESSOR / BUILTINTYPEINDEX / NULLVALUE
                parts.push(data.subarray(pos - 1, pos + 1));
                pos += 1;
            }
        }

        const offset = this.append(concatBytes(parts));
        this.literalOffsetBySource.set(sourceOffset, offset);
        this.entityTable[id] = offset;
        this.literalCopying.delete(sourceOffset);
    }

    // ------------------------------------------------------------ file emission

    private emitFile(): Uint8Array {
        // A zero entry means a class or entity id was allocated but never materialized.
        for (let i = 0; i < this.classTable.length; i++) {
            if (this.classTable[i] === 0) throw new Error(`dump: unresolved class table slot ${i}`);
        }
        for (let i = 0; i < this.entityTable.length; i++) {
            if (this.entityTable[i] === 0) throw new Error(`dump: unresolved entity table id ${i}`);
        }
        const tablesStart = Math.ceil(this.size / 4) * 4;
        const classTableOffset = tablesStart;
        const regionClassBytes = this.classTable.length * 4;
        // The header's global class table lists real class entities only (primitive type
        // entries such as U1/U16 live in the region table and are not classes).
        const globalClasses = this.classTable.filter((value) => value > HEADER_SIZE);
        const globalClassTableOffset = classTableOffset + regionClassBytes;
        const globalClassBytes = globalClasses.length * 4;
        const entityTableOffset = globalClassTableOffset + globalClassBytes;
        const entityBytes = this.entityTable.length * 4;
        const protoTableOffset = entityTableOffset + entityBytes;
        const protoBytes = this.protoTable.length * 4;
        const fileSize = protoTableOffset + protoBytes;

        this.ensureCapacity(fileSize);
        const out = this.bytes.subarray(0, fileSize);

        const magic = "PANDA\0\0\0";
        for (let i = 0; i < 8; i++) out[i] = magic.charCodeAt(i);
        out.set(this.pf.header.version, 12);
        writeU32(out, HEADER_FILE_SIZE_OFF, fileSize);
        writeU32(out, HEADER_NUM_CLASSES_OFF, globalClasses.length);
        writeU32(out, HEADER_CLASS_IDX_OFF, globalClassTableOffset);
        writeU32(out, HEADER_NUM_INDEXES_OFF, 1);
        writeU32(out, HEADER_INDEX_SECTION_OFF, HEADER_SIZE);

        const indexHeaderOffset = HEADER_SIZE;
        writeU32(out, indexHeaderOffset + 0, HEADER_SIZE + INDEX_HEADER_SIZE);
        writeU32(out, indexHeaderOffset + 4, fileSize);
        writeU32(out, indexHeaderOffset + INDEX_HEADER_CLASS_IDX_SIZE_OFF, this.classTable.length);
        writeU32(out, indexHeaderOffset + INDEX_HEADER_CLASS_IDX_OFF_OFF, classTableOffset);
        writeU32(out, indexHeaderOffset + INDEX_HEADER_METHOD_IDX_SIZE_OFF, this.entityTable.length);
        writeU32(out, indexHeaderOffset + INDEX_HEADER_METHOD_IDX_OFF_OFF, entityTableOffset);
        writeU32(out, indexHeaderOffset + INDEX_HEADER_FIELD_IDX_SIZE_OFF, 0);
        writeU32(out, indexHeaderOffset + INDEX_HEADER_FIELD_IDX_OFF_OFF, 0xffffffff);
        writeU32(out, indexHeaderOffset + INDEX_HEADER_PROTO_IDX_SIZE_OFF,
            this.protoTable.length > 0 ? this.protoTable.length : 0xffffffff);
        writeU32(out, indexHeaderOffset + INDEX_HEADER_PROTO_IDX_OFF_OFF,
            this.protoTable.length > 0 ? protoTableOffset : 0xffffffff);

        for (let i = 0; i < this.classTable.length; i++) {
            writeU32(out, classTableOffset + i * 4, this.classTable[i]);
        }
        for (let i = 0; i < globalClasses.length; i++) {
            writeU32(out, globalClassTableOffset + i * 4, globalClasses[i]);
        }
        for (let i = 0; i < this.entityTable.length; i++) {
            writeU32(out, entityTableOffset + i * 4, this.entityTable[i]);
        }
        for (let i = 0; i < this.protoTable.length; i++) {
            writeU32(out, protoTableOffset + i * 4, this.protoTable[i]);
        }

        const adler32 = new Adler32();
        adler32.update(out, 12, out.length - 12);
        writeU32(out, HEADER_CHECKSUM_OFF, adler32.getValue());
        return out.slice();
    }
}

function readU32At(bytes: Uint8Array, offset: number): number {
    return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function u32(value: number): Uint8Array {
    const out = new Uint8Array(4);
    writeU32(out, 0, value);
    return out;
}

function writeU16(target: Uint8Array, offset: number, value: number): void {
    target[offset] = value & 0xff;
    target[offset + 1] = (value >>> 8) & 0xff;
}

function writeU32(target: Uint8Array, offset: number, value: number): void {
    target[offset] = value & 0xff;
    target[offset + 1] = (value >>> 8) & 0xff;
    target[offset + 2] = (value >>> 16) & 0xff;
    target[offset + 3] = (value >>> 24) & 0xff;
}

/**
 * Dump selected classes into a new single-region abc.
 *
 * Class names are accepted as `Lpkg/Name;` or `pkg/Name`. The selected classes plus any
 * classes/methods referenced from their bytecode are copied; unrelated classes are dropped.
 * @throws when a class is missing, external, or uses a shape the dump builder cannot copy
 * (a bytecode-level super class / interface table, a non-module VALUE field, or field-id
 * instructions).
 */
export function dumpClasses(data: Uint8Array, classNames: string[]): DumpClassesResult {
    if (classNames.length === 0) throw new Error("dump: at least one class name is required");
    const pandaFile = new PandaFile(data);
    const allClasses = pandaFile.getAllClasses().filter((clazz) => !clazz.classExternal && clazz.name.content);
    const selected: PandaClass[] = [];
    const selectedNames: string[] = [];
    for (const query of classNames) {
        const normalized = query.replace(/^L/, "").replace(/;$/, "");
        const exact = allClasses.filter((clazz) =>
            clazz.name.content === query
            || clazz.name.content.replace(/^L/, "").replace(/;$/, "") === normalized);
        if (exact.length === 0) throw new Error(`dump: class not found: ${query}`);
        if (exact.length > 1) {
            throw new Error(`dump: ambiguous class ${query}: ${exact.map((clazz) => clazz.getClassName()).join(", ")}`);
        }
        const clazz = exact[0];
        if (selected.includes(clazz)) continue;
        selected.push(clazz);
        selectedNames.push(clazz.getClassName());
    }
    return new ClassDumpBuilder(pandaFile, selected).build(selectedNames);
}
