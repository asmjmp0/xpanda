/**
 * Panda 文件常量与枚举(移植自 Java jmp0.abc.file 各枚举)
 * @Author: jmp0
 */
export enum PandaClassTag {
    NOTHING = 0x00,
    INTERFACES = 0x01,
    SOURCE_LANG = 0x02,
    RUNTIME_ANNOTATION = 0x03,
    ANNOTATION = 0x04,
    RUNTIME_TYPE_ANNOTATION = 0x05,
    TYPE_ANNOTATION = 0x06,
    SOURCE_FILE = 0x07,
}

export enum PandaMethodTag {
    NOTHING = 0x00,
    CODE = 0x01,
    SOURCE_LANG = 0x02,
    RUNTIME_ANNOTATION = 0x03,
    RUNTIME_PARAM_ANNOTATION = 0x04,
    DEBUG_INFO = 0x05,
    ANNOTATION = 0x06,
    PARAM_ANNOTATION = 0x07,
    TYPE_ANNOTATION = 0x08,
    RUNTIME_TYPE_ANNOTATION = 0x09,
}

export enum PandaFieldTag {
    NOTHING = 0x00,
    INT_VALUE = 0x01,
    VALUE = 0x02,
    RUNTIME_ANNOTATION = 0x03,
    ANNOTATION = 0x04,
    RUNTIME_TYPE_ANNOTATION = 0x05,
    TYPE_ANNOTATION = 0x06,
}

export enum LiteralTag {
    TAGVALUE = 0x00,
    BOOL = 0x01,
    INTEGER = 0x02,
    FLOAT = 0x03,
    DOUBLE = 0x04,
    STRING = 0x05,
    METHOD = 0x06,
    GENERATORMETHOD = 0x07,
    ACCESSOR = 0x08,
    METHODAFFILIATE = 0x09,
    ARRAY_U1 = 0x0a,
    ARRAY_U8 = 0x0b,
    ARRAY_I8 = 0x0c,
    ARRAY_U16 = 0x0d,
    ARRAY_I16 = 0x0e,
    ARRAY_U32 = 0x0f,
    ARRAY_I32 = 0x10,
    ARRAY_U64 = 0x11,
    ARRAY_I64 = 0x12,
    ARRAY_F32 = 0x13,
    ARRAY_F64 = 0x14,
    ARRAY_STRING = 0x15,
    ASYNCGENERATORMETHOD = 0x16,
    LITERALBUFFERINDEX = 0x17,
    LITERALARRAY = 0x18,
    BUILTINTYPEINDEX = 0x19,
    GETTER = 0x1a,
    SETTER = 0x1b,
    NULLVALU = 0xff,
}

export function literalTagOf(value: number): LiteralTag | null {
    for (const key of Object.keys(LiteralTag)) {
        const v = (LiteralTag as any)[key];
        if (typeof v === "number" && v === value) return v as LiteralTag;
    }
    return null;
}

/** LiteralTag -> 字面量字节宽度 */
export function literalTagSize(tag: LiteralTag): number {
    switch (tag) {
        case LiteralTag.INTEGER:
        case LiteralTag.FLOAT:
        case LiteralTag.LITERALBUFFERINDEX:
            return 4;
        case LiteralTag.DOUBLE:
            return 8;
        case LiteralTag.METHODAFFILIATE:
            return 2;
        default:
            return 1;
    }
}

export enum PandaRawType {
    VOID = 0x01,
    U1 = 0x02,
    I8 = 0x03,
    U8 = 0x04,
    I16 = 0x05,
    U16 = 0x06,
    I32 = 0x07,
    U32 = 0x08,
    F32 = 0x09,
    F64 = 0x0a,
    I64 = 0x0b,
    U64 = 0x0c,
    REF = 0x0d,
    TAG = 0x0e,
}

export function pandaRawTypeOf(value: number): PandaRawType | null {
    if (value >= 0x01 && value <= 0x0e) return value as PandaRawType;
    return null;
}

export function isPrimitiveRawType(t: PandaRawType): boolean {
    return t !== PandaRawType.REF;
}

/** 字段类型 = 原始类型 + U1(Java PandaRawType.toFieldType) */
export function toFieldType(t: PandaRawType): PandaRawType {
    return pandaRawTypeOf(t + PandaRawType.U1) ?? t;
}

export function rawTypeString(t: PandaRawType, isField: boolean): string {
    const type = isField ? toFieldType(t) : t;
    if (type === PandaRawType.TAG) return "any";
    if (type === PandaRawType.REF) return "ref";
    return PandaRawType[type].toLowerCase();
}
