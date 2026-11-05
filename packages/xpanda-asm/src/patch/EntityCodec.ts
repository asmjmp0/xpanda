/**
 * Encoding of imported classes/methods/fields and literal arrays.
 * @Author: jmp0
 */
import { concatBytes, encodeStringEntity, readUleb128, writeUleb128 } from "../codec";
import { u32Bytes, writeU16, writeU32 } from "./PatchBinary";
import {
    FIELD_TAG_INT_VALUE,
    FIELD_TAG_NOTHING,
    FIELD_TAG_VALUE,
    METHOD_TAG_CODE,
} from "./PatchTypes";

/** literal array 里的 tag 值(与 Panda LiteralTag 一致) */
export const LITERAL_TAG = {
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

/**
 * 直接复制的 literal tag 的载荷字节数;STRING / LITERALARRAY 由调用方重定位,
 * METHOD 系列与 ARRAY 系列暂不支持(返回 null)。
 */
export function literalPayloadSize(tag: number): number | null {
    switch (tag) {
        case LITERAL_TAG.INTEGER:
        case LITERAL_TAG.FLOAT:
        case LITERAL_TAG.LITERALBUFFERINDEX:
            return 4;
        case LITERAL_TAG.DOUBLE:
            return 8;
        case LITERAL_TAG.METHODAFFILIATE:
            return 2;
        case LITERAL_TAG.TAGVALUE:
        case LITERAL_TAG.BOOL:
        case LITERAL_TAG.ACCESSOR:
        case LITERAL_TAG.BUILTINTYPEINDEX:
        case LITERAL_TAG.NULLVALU:
            return 1;
        default:
            return null;
    }
}

/**
 * 重建一个方法实体:class_idx / proto_idx / name / access flags + CODE tag(丢弃
 * debug info 与注解 tag,避免搬运 LNP / 注解引用)。
 */
export function buildImportedMethodEntity(
    classIdx: number,
    protoIdx: number,
    nameOffset: number,
    accessFlags: number,
    codeOffset: number,
): Uint8Array {
    const head = new Uint8Array(8);
    writeU16(head, 0, classIdx);
    writeU16(head, 2, protoIdx);
    writeU32(head, 4, nameOffset);
    return concatBytes([
        head,
        writeUleb128(accessFlags),
        Uint8Array.of(METHOD_TAG_CODE),
        u32Bytes(codeOffset),
        Uint8Array.of(0x00),
    ]);
}

/**
 * 重建一个类实体:name + super(0) + access_flags + num_fields + num_methods
 * + 空 tag 区 + 字段实体 + 方法实体。
 * fields 里包含 module 元数据字段(moduleRecordIdx 等)。
 */
export function buildImportedClassEntity(
    name: string,
    accessFlags: number,
    fields: Uint8Array[],
    methods: Uint8Array[],
): Uint8Array {
    return concatBytes([
        encodeStringEntity(name),
        u32Bytes(0),
        writeUleb128(accessFlags),
        writeUleb128(fields.length),
        writeUleb128(methods.length),
        Uint8Array.of(0x00),
        ...fields,
        ...methods,
    ]);
}

/** 字段实体:class_idx(u16) + type_idx(u16) + name(u32) + access_flags(uleb) + tag 区 */
export function encodeImportedField(
    classIdx: number,
    typeIdx: number,
    nameOffset: number,
    accessFlags: number,
    valueTags: Uint8Array,
): Uint8Array {
    const head = new Uint8Array(8);
    writeU16(head, 0, classIdx);
    writeU16(head, 2, typeIdx);
    writeU32(head, 4, nameOffset);
    return concatBytes([
        head,
        writeUleb128(accessFlags),
        valueTags,
        Uint8Array.of(FIELD_TAG_NOTHING),
    ]);
}

/**
 * 找到字段实体里 VALUE tag 的 u32 载荷偏移(用于原位改写 moduleRecordIdx)。
 * 字段布局:class_idx(u16) + type_idx(u16) + name(u32) + access_flags(uleb) + tag 区。
 */
export function findFieldValueOffset(data: Uint8Array, field: { getOffset(): number }): number | undefined {
    let pos = field.getOffset() + 8;
    pos += readUleb128(data, pos).size;
    while (pos < data.length) {
        const tag = data[pos++];
        if (tag === FIELD_TAG_NOTHING) return undefined;
        if (tag === FIELD_TAG_INT_VALUE) {
            pos += readUleb128(data, pos).size;
        } else if (tag === FIELD_TAG_VALUE) {
            return pos;
        } else {
            return undefined;
        }
    }
    return undefined;
}

/** 记录名 → 运行时可直接解析的 normalized 请求串(前缀 15 字节,第 16 个 & 属于记录名) */
export function normalizedRequestForRecord(recordName: string): string {
    const bare = recordName.startsWith("&") ? recordName.slice(1) : recordName;
    return `@normalized:N&&&${bare}`;
}
