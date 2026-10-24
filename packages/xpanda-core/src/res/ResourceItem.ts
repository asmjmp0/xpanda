/**
 * resources.index 中的单条资源条目
 * (移植自 Java jmp0.abc.res.PandaResourceItem)
 * @Author: jmp0
 */
import { ResourceResType } from "./ResourceEnums";
import { ResourceKeyParam, ResourceUtils } from "./ResourceUtils";

export class ResourceItem {
    /** 资源名(MEDIA/PROF 在打包时已去掉扩展名) */
    readonly name: string;
    /** 资源 ID(0x0erxxxxx 形式的 32 位值) */
    readonly id: number;
    /** 资源类型 */
    readonly resType: ResourceResType;
    /** 限定词参数(空数组 = base) */
    readonly keyParams: ResourceKeyParam[];
    /** 原始值字节(字符串含尾部 NUL) */
    readonly data: Uint8Array;
    /** 限定词目录名(base / en_US / dark / ...) */
    readonly limitKey: string;

    constructor(name: string, id: number, resType: ResourceResType, keyParams: ResourceKeyParam[], data: Uint8Array) {
        this.name = name;
        this.id = id;
        this.resType = resType;
        this.keyParams = keyParams;
        this.data = data;
        this.limitKey = ResourceUtils.parseKeyParam(keyParams);
    }

    /**
     * 解析后的值:PLURAL/STRARRAY 为字符串数组,其余按 UTF-8 字符串
     * (等价 Java PandaResourceItem.parseValues;INTEGER/BOOLEAN/COLOR/FLOAT 等在
     *  index 中本身就是编译后的文本,统一按字符串返回)
     */
    get value(): string | string[] {
        if (this.resType === ResourceResType.PLURAL || this.resType === ResourceResType.STRARRAY) {
            return ResourceUtils.bytes2StringArray(this.data);
        }
        return ResourceUtils.bytes2String(this.data);
    }

    /** 值的类型名(string / plural / media / ...) */
    get typeName(): string {
        return ResourceUtils.resTypeToString(this.resType);
    }

    toString(): string {
        const value = this.value;
        const valueText = Array.isArray(value) ? JSON.stringify(value) : JSON.stringify(value);
        return `ResourceItem [id=0x${this.id.toString(16).padStart(8, "0")}, name=${this.name}, limitKey=${this.limitKey}, type=${this.typeName}, value=${valueText}]`;
    }
}
