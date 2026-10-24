/**
 * resources.index 解析工具
 * (移植自 Java jmp0.abc.res.PandaResourceUtils,并依据 restool 6.1
 *  ResourceUtil::GetKeyParamValue / PaserKeyParam 适配新格式)
 * @Author: jmp0
 */
import {
    ResourceDeviceType,
    ResourceInputDevice,
    ResourceKeyType,
    ResourceNightMode,
    ResourceOrientationType,
    ResourceResolutionType,
    ResourceResType,
    RESOURCE_CLUSTER_NAMES,
    RESOURCE_DEVICE_NAMES,
    RESOURCE_RESOLUTION_NAMES,
} from "./ResourceEnums";
import { PandaParseException } from "../PandaParseException";

/** 限定词参数(KeyParam:keyType 4 字节 + value 4 字节,小端) */
export interface ResourceKeyParam {
    keyType: ResourceKeyType;
    value: number;
}

const textDecoder = new TextDecoder("utf-8");

export class ResourceUtils {
    /** 读取 u16(小端,无符号) */
    static readU16(bytes: Uint8Array, index: number): number {
        return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(index, true);
    }

    /** 读取 u32(小端,无符号;资源 ID 可达 0x0300002E,不能复用 .abc 的 28 位掩码读取) */
    static readU32(bytes: Uint8Array, index: number): number {
        return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(index, true);
    }

    /** 读取 i32(小端,有符号;keyType/value 在 restool 中按 int32 写出) */
    static readI32(bytes: Uint8Array, index: number): number {
        return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(index, true);
    }

    /** 去掉尾部 NUL 后按 UTF-8 解码(等价 restool bytes2String / Java PandaResourceUtils.bytes2String) */
    static bytes2String(bytes: Uint8Array): string {
        let end = bytes.length;
        while (end > 0 && bytes[end - 1] === 0) end--;
        return textDecoder.decode(bytes.subarray(0, end));
    }

    /**
     * 解析字符串数组([u16 size][bytes][NUL] 循环,小端)
     * 等价 Java PandaResourceUtils.bytes2StringArray / restool DecomposeStrings
     */
    static bytes2StringArray(bytes: Uint8Array): string[] {
        const result: string[] = [];
        let i = 0;
        while (i + 2 <= bytes.length) {
            const size = ResourceUtils.readU16(bytes, i);
            i += 2;
            result.push(textDecoder.decode(bytes.subarray(i, i + size)));
            i += size + 1; // 跳过字符串后的 NUL
        }
        return result;
    }

    /** ResType 数值 → 集群名(string / media / profile ...),未知返回 "unknown" */
    static resTypeToString(resType: ResourceResType): string {
        return RESOURCE_CLUSTER_NAMES[resType] ?? "unknown";
    }

    /** 单个限定词的显示值(等价 restool GetKeyParamValue) */
    static keyParamValue(param: ResourceKeyParam): string {
        switch (param.keyType) {
            case ResourceKeyType.ORIENTATION:
                return param.value === ResourceOrientationType.VERTICAL ? "vertical" : "horizontal";
            case ResourceKeyType.NIGHTMODE:
                return param.value === ResourceNightMode.DARK ? "dark" : "light";
            case ResourceKeyType.DEVICETYPE: {
                return RESOURCE_DEVICE_NAMES[param.value] ?? "";
            }
            case ResourceKeyType.RESOLUTION: {
                return RESOURCE_RESOLUTION_NAMES[param.value] ?? "";
            }
            case ResourceKeyType.INPUTDEVICE:
                return param.value === ResourceInputDevice.NOT_SET ? "not set" : "pointDevice";
            default:
                // LANGUAGE / SCRIPT / REGION / MCC / MNC:值为打包的 1~2 字符,按小端字节读出
                return ResourceUtils.localeValue(param.value);
        }
    }

    /** LANGUAGE/SCRIPT/REGION 等的打包字符值:按小端 u32 拆字节,从高到低取非 NUL 字节(等价 GetLocaleLimitkey) */
    static localeValue(value: number): string {
        const bytes = new Uint8Array(4);
        new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
        let result = "";
        for (let i = bytes.length - 1; i >= 0; i--) {
            if (bytes[i] !== 0) result += String.fromCharCode(bytes[i]);
        }
        return result;
    }

    /** 生成限定词目录名(base / en_US / dark / ...),等价 restool PaserKeyParam */
    static parseKeyParam(params: ResourceKeyParam[]): string {
        if (params.length === 0) return "base";
        let result = "";
        for (const param of params) {
            let limitKey = ResourceUtils.keyParamValue(param);
            if (!limitKey) continue;
            if (param.keyType === ResourceKeyType.MCC) limitKey = "mcc" + limitKey;
            if (param.keyType === ResourceKeyType.MNC) limitKey = "mnc" + limitKey;
            // REGION/MNC 用 _ 连接,其余用 - 连接
            result += (param.keyType === ResourceKeyType.REGION || param.keyType === ResourceKeyType.MNC ? "_" : "-") + limitKey;
        }
        return result.startsWith("_") || result.startsWith("-") ? result.substring(1) : result;
    }

    /** ResType 数值 → 枚举,未知返回 INVALID */
    static resolveResType(value: number): ResourceResType {
        if (Object.values(ResourceResType).includes(value as ResourceResType)) {
            return value as ResourceResType;
        }
        return ResourceResType.INVALID;
    }

    /** 校验块 tag(KEYS/IDSS/DATA) */
    static checkTag(bytes: Uint8Array, offset: number, expect: string): void {
        const tag = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
        if (tag !== expect) {
            throw new PandaParseException(`ResourceIndexFile: tag must be '${expect}', got '${tag}' at 0x${offset.toString(16)}`);
        }
    }
}
