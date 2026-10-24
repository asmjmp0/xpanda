import { PandaParseException } from "../../PandaParseException";
import { PandaFileUtils } from "../PandaFileUtils";

export const MAGIC_PANDA = "PANDA\0\0\0";
export const HEADER_SIZE = 12 * 4 + 8 + 4;

/**
 * Panda 文件头(移植自 Java jmp0.abc.file.desc.Header)
 *
 * struct Header {
 *     std::array<uint8_t, 8> magic;
 *     uint32_t checksum;
 *     std::array<uint8_t, 4> version;
 *     uint32_t file_size;
 *     uint32_t foreign_off;
 *     uint32_t foreign_size;
 *     uint32_t num_classes;
 *     uint32_t class_idx_off;
 *     uint32_t num_lnps;
 *     uint32_t lnp_idx_off;
 *     uint32_t num_literalarrays;
 *     uint32_t literalarray_idx_off;
 *     uint32_t num_indexes;
 *     uint32_t index_section_off;
 * };
 *
 * @Author: jmp0
 */
export class Header {
    readonly magic: Uint8Array;
    readonly checksum: number;
    readonly version: Uint8Array;
    readonly fileSize: number;
    readonly foreignOff: number;
    readonly foreignSize: number;
    readonly numClasses: number;
    readonly classIdxOff: number;
    readonly numLnps: number;
    readonly lnpIdxOff: number;
    readonly numLiteralArrays: number;
    readonly literalArrayIdxOff: number;
    readonly numIndexes: number;
    readonly indexSectionOff: number;

    constructor(data: Uint8Array, index: number) {
        const bs = PandaFileUtils.readSubBytes(data, index, HEADER_SIZE);
        let nowIndex = 0;
        this.magic = PandaFileUtils.readSubBytes(bs, nowIndex, 8);
        // magic 逐字节比较(latin1 单字节编码,等价原 Buffer.toString("latin1") 比较)
        for (let i = 0; i < MAGIC_PANDA.length; i++) {
            if (this.magic[i] !== MAGIC_PANDA.charCodeAt(i)) {
                throw new PandaParseException("magic not matched!");
            }
        }
        nowIndex += 8;
        const dv = new DataView(bs.buffer, bs.byteOffset, bs.byteLength);
        this.checksum = PandaFileUtils.bytes2UnsignedInteger(bs, nowIndex); nowIndex += 4;
        this.version = PandaFileUtils.readSubBytes(bs, nowIndex, 4); nowIndex += 4;
        this.fileSize = PandaFileUtils.bytes2UnsignedInteger(bs, nowIndex); nowIndex += 4;
        this.foreignOff = PandaFileUtils.bytes2UnsignedInteger(bs, nowIndex); nowIndex += 4;
        this.foreignSize = PandaFileUtils.bytes2UnsignedInteger(bs, nowIndex); nowIndex += 4;
        this.numClasses = PandaFileUtils.bytes2UnsignedInteger(bs, nowIndex); nowIndex += 4;
        this.classIdxOff = PandaFileUtils.bytes2UnsignedInteger(bs, nowIndex); nowIndex += 4;
        this.numLnps = PandaFileUtils.bytes2UnsignedInteger(bs, nowIndex); nowIndex += 4;
        this.lnpIdxOff = PandaFileUtils.bytes2UnsignedInteger(bs, nowIndex); nowIndex += 4;
        this.numLiteralArrays = PandaFileUtils.bytes2UnsignedInteger(bs, nowIndex); nowIndex += 4;
        this.literalArrayIdxOff = PandaFileUtils.bytes2UnsignedInteger(bs, nowIndex); nowIndex += 4;
        this.numIndexes = PandaFileUtils.bytes2UnsignedInteger(bs, nowIndex); nowIndex += 4;
        this.indexSectionOff = PandaFileUtils.bytes2UnsignedInteger(bs, nowIndex); nowIndex += 4;
        void dv;
    }

    versionString(): string {
        return Array.from(this.version).join(".");
    }

    toByteArray(): Uint8Array {
        const buffer = new Uint8Array(HEADER_SIZE);
        const dv = new DataView(buffer.buffer);
        buffer.set(this.magic, 0);
        let idx = 8;
        const put = (v: number) => { dv.setInt32(idx, v | 0, true); idx += 4; };
        put(this.checksum | 0);
        buffer.set(this.version, idx); idx += 4;
        put(this.fileSize | 0);
        put(this.foreignOff | 0);
        put(this.foreignSize | 0);
        put(this.numClasses | 0);
        put(this.classIdxOff | 0);
        put(this.numLnps | 0);
        put(this.lnpIdxOff | 0);
        put(this.numLiteralArrays | 0);
        put(this.literalArrayIdxOff | 0);
        put(this.numIndexes | 0);
        put(this.indexSectionOff | 0);
        return buffer;
    }
}
