/**
 * resources.index 解析入口
 * (移植自 Java jmp0.abc.res.PandaResourceFile,并依据 restool 6.1
 *  ResourceTable::LoadResTable / LoadNewResTable 适配新格式)
 *
 * 两种格式由版本串首词区分(restool IsNewModule):
 *  - 旧格式 "Restool <ver>":  header(136) + N×KEYS + N×IDSS + 记录流
 *  - 新格式 "RestoolV2 <ver>": header(140) + N×KEYS(configId) + IDSS + DATA + 数据池
 * @Author: jmp0
 */
import { PandaParseException } from "../PandaParseException";
import { ResourceItem } from "./ResourceItem";
import { ResourceKeyParam, ResourceUtils } from "./ResourceUtils";
import { ResourceResType } from "./ResourceEnums";

const VERSION_MAX_LEN = 128;

/** ResIndex:IDSS 中 资源ID → DATA 内 ResInfo 偏移 的索引项 */
interface ResourceResIndex {
    resId: number;
    offset: number;
    name: string;
    resType: ResourceResType;
}

/** ResInfo 的值条目:限定词配置 ID → 数据池偏移 */
interface ResourceConfigOffset {
    configId: number;
    dataOffset: number;
}

export class ResourceIndexFile {
    readonly data: Uint8Array;
    /** 版本串,如 "RestoolV2 6.1.0.003" */
    readonly version: string;
    /** 是否为新模块格式(RestoolV2 三段式) */
    readonly isNewModule: boolean;
    /** 文件声明总长(u32@128) */
    readonly fileSize: number;
    /** 解析出的全部资源条目 */
    readonly items: ResourceItem[] = [];

    constructor(data: Uint8Array) {
        if (data.length < VERSION_MAX_LEN + 8) {
            throw new PandaParseException("ResourceIndexFile: file too small to be a resources.index");
        }
        this.data = data;
        this.version = ResourceUtils.bytes2String(data.subarray(0, VERSION_MAX_LEN));
        this.fileSize = ResourceUtils.readU32(data, VERSION_MAX_LEN);
        const keyConfigCount = ResourceUtils.readU32(data, VERSION_MAX_LEN + 4);
        // restool IsNewModule:版本串首词为 "Restool" 是旧格式,否则为新格式
        this.isNewModule = this.version.split(" ")[0] !== "Restool";
        if (this.isNewModule) {
            this.parseNewFormat(keyConfigCount);
        } else {
            this.parseLegacyFormat(keyConfigCount);
        }
    }

    // ---------------------------------------------------------------- 旧格式

    /**
     * 旧格式:"Restool <ver>"
     * header(128+4+4) → N×KEYS(tag+offset+count+params) → N×IDSS(tag+count+(id,offset)×)
     * → 记录流 [size][resType][id][u16 valueSize][values][u16 nameSize][name(含 NUL)]
     */
    private parseLegacyFormat(configCount: number): void {
        const data = this.data;
        // KEYS:记录 keyOffset(指向对应 IDSS 的文件偏移)→ keyParams
        const limitKeys = new Map<number, ResourceKeyParam[]>();
        let pos = VERSION_MAX_LEN + 8;
        for (let i = 0; i < configCount; i++) {
            ResourceUtils.checkTag(data, pos, "KEYS");
            const keyOffset = ResourceUtils.readU32(data, pos + 4);
            const keyCount = ResourceUtils.readU32(data, pos + 8);
            const params: ResourceKeyParam[] = [];
            let p = pos + 12;
            for (let j = 0; j < keyCount; j++) {
                params.push({ keyType: ResourceUtils.readI32(data, p), value: ResourceUtils.readI32(data, p + 4) });
                p += 8;
            }
            limitKeys.set(keyOffset, params);
            pos = p;
        }
        // IDSS:记录 记录流偏移 → (id, 所属 IDSS 偏移)
        const datas = new Map<number, { id: number; idSetOffset: number }>();
        for (let i = 0; i < configCount; i++) {
            const idSetOffset = pos;
            ResourceUtils.checkTag(data, pos, "IDSS");
            const idCount = ResourceUtils.readU32(data, pos + 4);
            let p = pos + 8;
            for (let j = 0; j < idCount; j++) {
                const id = ResourceUtils.readU32(data, p);
                const dataOffset = ResourceUtils.readU32(data, p + 4);
                datas.set(dataOffset, { id, idSetOffset });
                p += 8;
            }
            pos = p;
        }
        // 记录流
        while (pos < this.fileSize) {
            const recordStart = pos;
            const size = ResourceUtils.readU32(data, pos);
            const resType = ResourceUtils.resolveResType(ResourceUtils.readI32(data, pos + 4));
            const id = ResourceUtils.readU32(data, pos + 8);
            let p = pos + 12;
            const valueSize = ResourceUtils.readU16(data, p);
            p += 2;
            const values = data.subarray(p, p + valueSize);
            p += valueSize;
            const nameSize = ResourceUtils.readU16(data, p);
            p += 2;
            // nameSize 含尾部 NUL,去掉后解码(与 v1 readSubBytes(size-1) 一致)
            const name = ResourceUtils.bytes2String(data.subarray(p, p + nameSize));
            p += nameSize;
            const idData = datas.get(recordStart);
            if (!idData) {
                throw new PandaParseException(`ResourceIndexFile: legacy record at 0x${recordStart.toString(16)} has no matching IDSS entry`);
            }
            if (idData.id !== id) {
                throw new PandaParseException(`ResourceIndexFile: legacy record id mismatch at 0x${recordStart.toString(16)}`);
            }
            const keyParams = limitKeys.get(idData.idSetOffset) ?? [];
            this.items.push(new ResourceItem(name, id, resType, keyParams, values));
            pos = recordStart + size + 4; // size 不含首部 4 字节 size 字段本身
        }
    }

    // ---------------------------------------------------------------- 新格式

    /**
     * 新格式:"RestoolV2 <ver>"(restool IndexHeaderV2 三段式)
     * header(140) → keyCount×KEYS(tag+configId+count+params)
     * → IDSS(tag+length+typeCount+idCount,内含 ResType/ResIndex 索引)
     * → DATA(tag+length+idCount,内含 ResInfo:configId→数据池偏移)
     * → 数据池 [u16 len][bytes]
     */
    private parseNewFormat(keyCount: number): void {
        const data = this.data;
        const dataBlockOffset = ResourceUtils.readU32(data, VERSION_MAX_LEN + 8);
        // 第一段:keyConfigs(按 configId 索引)
        const keyConfigs = new Map<number, ResourceKeyParam[]>();
        let pos = VERSION_MAX_LEN + 12;
        for (let i = 0; i < keyCount; i++) {
            ResourceUtils.checkTag(data, pos, "KEYS");
            const configId = ResourceUtils.readU32(data, pos + 4);
            const paramCount = ResourceUtils.readU32(data, pos + 8);
            const params: ResourceKeyParam[] = [];
            let p = pos + 12;
            for (let j = 0; j < paramCount; j++) {
                params.push({ keyType: ResourceUtils.readI32(data, p), value: ResourceUtils.readI32(data, p + 4) });
                p += 8;
            }
            keyConfigs.set(configId, params);
            pos = p;
        }
        // 第二段:IDSS 资源索引
        ResourceUtils.checkTag(data, pos, "IDSS");
        const typeCount = ResourceUtils.readU32(data, pos + 8);
        const idCount = ResourceUtils.readU32(data, pos + 12);
        const resIndexList: ResourceResIndex[] = [];
        let p = pos + 16;
        for (let t = 0; t < typeCount; t++) {
            const resType = ResourceUtils.resolveResType(ResourceUtils.readI32(data, p));
            const count = ResourceUtils.readU32(data, p + 8);
            p += 12;
            for (let r = 0; r < count; r++) {
                const resId = ResourceUtils.readU32(data, p);
                const offset = ResourceUtils.readU32(data, p + 4);
                const nameLength = ResourceUtils.readU32(data, p + 8);
                p += 12;
                const name = ResourceUtils.bytes2String(data.subarray(p, p + nameLength));
                p += nameLength;
                resIndexList.push({ resId, offset, name, resType });
            }
        }
        // 第三段:DATA 值偏移表(ResInfo 按文件内绝对偏移寻址)
        ResourceUtils.checkTag(data, dataBlockOffset, "DATA");
        const dataIdCount = ResourceUtils.readU32(data, dataBlockOffset + 8);
        const resInfoMap = new Map<number, ResourceConfigOffset[]>();
        p = dataBlockOffset + 12;
        for (let i = 0; i < dataIdCount; i++) {
            const resId = ResourceUtils.readU32(data, p);
            const valueCount = ResourceUtils.readU32(data, p + 8);
            p += 12;
            const pairs: ResourceConfigOffset[] = [];
            for (let v = 0; v < valueCount; v++) {
                pairs.push({
                    configId: ResourceUtils.readU32(data, p),
                    dataOffset: ResourceUtils.readU32(data, p + 4),
                });
                p += 8;
            }
            resInfoMap.set(resId, pairs);
        }
        if (resIndexList.length !== idCount) {
            throw new PandaParseException(`ResourceIndexFile: IDSS resIndex count ${resIndexList.length} != idCount ${idCount}`);
        }
        // 数据池:每个资源 × 每个限定词配置一条值
        for (const resIndex of resIndexList) {
            const pairs = resInfoMap.get(resIndex.resId) ?? [];
            for (const pair of pairs) {
                const valueSize = ResourceUtils.readU16(data, pair.dataOffset);
                const values = data.subarray(pair.dataOffset + 2, pair.dataOffset + 2 + valueSize);
                const keyParams = keyConfigs.get(pair.configId) ?? [];
                this.items.push(new ResourceItem(resIndex.name, resIndex.resId, resIndex.resType, keyParams, values));
            }
        }
    }
}
