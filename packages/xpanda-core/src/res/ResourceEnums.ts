/**
 * resources.index 枚举定义
 * (移植自 Java jmp0.abc.res.types,并依据 restool 6.1 resource_data.h 补全)
 * @Author: jmp0
 */

/** 限定词类型(KeyParam.keyType) */
export enum ResourceKeyType {
    LANGUAGE = 0,
    REGION = 1,
    RESOLUTION = 2,
    ORIENTATION = 3,
    DEVICETYPE = 4,
    SCRIPT = 5,
    NIGHTMODE = 6,
    MCC = 7,
    MNC = 8,
    /** 保留 */
    RESERVED = 9,
    INPUTDEVICE = 10,
}

/** 资源类型(记录头的 resType / ResTypeHeader.resType) */
export enum ResourceResType {
    ELEMENT = 0,
    RAW = 6,
    INTEGER = 8,
    STRING = 9,
    STRARRAY = 10,
    INTARRAY = 11,
    BOOLEAN = 12,
    COLOR = 14,
    ID = 15,
    THEME = 16,
    PLURAL = 17,
    FLOAT = 18,
    MEDIA = 19,
    PROF = 20,
    PATTERN = 22,
    SYMBOL = 23,
    RES = 24,
    INVALID = -1,
}

/** 屏幕方向(ORIENTATION.value) */
export enum ResourceOrientationType {
    VERTICAL = 0,
    HORIZONTAL = 1,
}

/** 设备类型(DEVICETYPE.value) */
export enum ResourceDeviceType {
    PHONE = 0,
    TABLET = 1,
    CAR = 2,
    RESERVED = 3,
    TV = 4,
    WEARABLE = 6,
    TWOINONE = 7,
}

/** 分辨率(RESOLUTION.value) */
export enum ResourceResolutionType {
    SDPI = 120,
    MDPI = 160,
    LDPI = 240,
    XLDPI = 320,
    XXLDPI = 480,
    XXXLDPI = 640,
}

/** 深色模式(NIGHTMODE.value) */
export enum ResourceNightMode {
    DARK = 0,
    LIGHT = 1,
}

/** 输入设备(INPUTDEVICE.value) */
export enum ResourceInputDevice {
    NOT_SET = -1,
    POINTING_DEVICE = 0,
}

/** ResType → restool 资源目录/内容集群名(参考 g_fileClusterMap / g_contentClusterMap / g_copyFileMap) */
export const RESOURCE_CLUSTER_NAMES: Record<number, string> = {
    [ResourceResType.ELEMENT]: "element",
    [ResourceResType.RAW]: "rawfile",
    [ResourceResType.MEDIA]: "media",
    [ResourceResType.PROF]: "profile",
    [ResourceResType.ID]: "id",
    [ResourceResType.INTEGER]: "integer",
    [ResourceResType.STRING]: "string",
    [ResourceResType.STRARRAY]: "strarray",
    [ResourceResType.INTARRAY]: "intarray",
    [ResourceResType.BOOLEAN]: "boolean",
    [ResourceResType.COLOR]: "color",
    [ResourceResType.PLURAL]: "plural",
    [ResourceResType.FLOAT]: "float",
    [ResourceResType.PATTERN]: "pattern",
    [ResourceResType.THEME]: "theme",
    [ResourceResType.SYMBOL]: "symbol",
    [ResourceResType.RES]: "resfile",
};

/** 设备类型值 → 限定词名(参考 g_deviceMap) */
export const RESOURCE_DEVICE_NAMES: Record<number, string> = {
    [ResourceDeviceType.PHONE]: "phone",
    [ResourceDeviceType.TABLET]: "tablet",
    [ResourceDeviceType.CAR]: "car",
    [ResourceDeviceType.TV]: "tv",
    [ResourceDeviceType.WEARABLE]: "wearable",
    [ResourceDeviceType.TWOINONE]: "2in1",
};

/** 分辨率值 → 限定词名(参考 g_resolutionMap) */
export const RESOURCE_RESOLUTION_NAMES: Record<number, string> = {
    [ResourceResolutionType.SDPI]: "sdpi",
    [ResourceResolutionType.MDPI]: "mdpi",
    [ResourceResolutionType.LDPI]: "ldpi",
    [ResourceResolutionType.XLDPI]: "xldpi",
    [ResourceResolutionType.XXLDPI]: "xxldpi",
    [ResourceResolutionType.XXXLDPI]: "xxxldpi",
};
