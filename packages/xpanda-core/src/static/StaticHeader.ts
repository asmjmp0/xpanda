import { PandaFileUtils } from "../file/PandaFileUtils";
import { PandaParseException } from "../PandaParseException";

/**
 * ArkTS-Sta (static runtime, libarkfile) file header.
 *
 * Unlike the dynamic ArkTS/Panda header this one carries three extra fields
 * before `num_classes` (see reference static_core/libarkfile/file.h):
 *   quickenedFlag, numClasses, classIdxOff, numExportTable, exportTableOff, ...
 * making the header 72 bytes instead of 60.
 *
 * @Author: jmp0
 */
export const STATIC_HEADER_SIZE = 18 * 4;

export const STATIC_MAGIC = "PANDA\0\0\0";

export class StaticHeader {
    readonly magic: Uint8Array;
    readonly checksum: number;
    readonly version: Uint8Array;
    readonly fileSize: number;
    readonly foreignOff: number;
    readonly foreignSize: number;
    readonly quickenedFlag: number;
    readonly numClasses: number;
    readonly classIdxOff: number;
    readonly numExportTable: number;
    readonly exportTableOff: number;
    readonly numLnps: number;
    readonly lnpIdxOff: number;
    readonly numLiteralArrays: number;
    readonly literalArrayIdxOff: number;
    readonly numIndexes: number;
    readonly indexSectionOff: number;

    /** Runtime-kind marker used by the static parser/decompiler. */
    readonly isStatic = true;
    /** Bytes before the first table/entity, used by Offset.isValid(). */
    readonly headerSize = STATIC_HEADER_SIZE;

    constructor(data: Uint8Array, index: number) {
        const bs = PandaFileUtils.readSubBytes(data, index, STATIC_HEADER_SIZE);
        this.magic = PandaFileUtils.readSubBytes(bs, 0, 8);
        for (let i = 0; i < STATIC_MAGIC.length; i++) {
            if (this.magic[i] !== STATIC_MAGIC.charCodeAt(i)) {
                throw new PandaParseException("static abc magic not matched!");
            }
        }
        this.checksum = PandaFileUtils.bytes2UnsignedInteger(bs, 8);
        this.version = PandaFileUtils.readSubBytes(bs, 12, 4);
        this.fileSize = PandaFileUtils.bytes2UnsignedInteger(bs, 16);
        this.foreignOff = PandaFileUtils.bytes2UnsignedInteger(bs, 20);
        this.foreignSize = PandaFileUtils.bytes2UnsignedInteger(bs, 24);
        this.quickenedFlag = PandaFileUtils.bytes2UnsignedInteger(bs, 28);
        this.numClasses = PandaFileUtils.bytes2UnsignedInteger(bs, 32);
        this.classIdxOff = PandaFileUtils.bytes2UnsignedInteger(bs, 36);
        this.numExportTable = PandaFileUtils.bytes2UnsignedInteger(bs, 40);
        this.exportTableOff = PandaFileUtils.bytes2UnsignedInteger(bs, 44);
        this.numLnps = PandaFileUtils.bytes2UnsignedInteger(bs, 48);
        this.lnpIdxOff = PandaFileUtils.bytes2UnsignedInteger(bs, 52);
        this.numLiteralArrays = PandaFileUtils.bytes2UnsignedInteger(bs, 56);
        this.literalArrayIdxOff = PandaFileUtils.bytes2UnsignedInteger(bs, 60);
        this.numIndexes = PandaFileUtils.bytes2UnsignedInteger(bs, 64);
        this.indexSectionOff = PandaFileUtils.bytes2UnsignedInteger(bs, 68);
    }

    versionString(): string {
        return Array.from(this.version).join(".");
    }
}

/**
 * Recognize an ArkTS-Sta abc. Mirrors the dynamic runtime's GetFileType():
 *   version[1] == FILE_TYPE_STATIC_FLAG (1), or OLD_STATIC_VERSION 0.0.0.6.
 * The dynamic versions are 11.x/12.x/13.x/24.x, so this does not collide.
 */
export function isStaticAbcVersion(version: Uint8Array): boolean {
    return (version[0] === 0 && version[1] === 1) || (version[0] === 0 && version[1] === 0 && version[2] === 0 && version[3] === 6);
}
