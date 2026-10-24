import type { IPandaFile } from "../IPandaFile";
import { HEADER_SIZE } from "./Header";

/**
 * 文件内偏移基类(移植自 Java jmp0.abc.file.desc.Offset)
 * @Author: jmp0
 */
export class Offset {
    readonly offsetValue: number;
    protected pandaFile: IPandaFile | null;

    constructor(pandaFile: IPandaFile | null, offset: number | null) {
        this.pandaFile = pandaFile;
        this.offsetValue = offset === null ? 0xffffffff : offset;
    }

    static nullOffset(): Offset {
        return new Offset(null, null);
    }

    isValid(): boolean {
        if (!this.pandaFile) return false;
        return this.offsetValue <= this.pandaFile.header.fileSize
            && this.offsetValue > HEADER_SIZE;
    }

    isExternal(): boolean {
        if (!this.pandaFile) return false;
        const begin = this.pandaFile.header.foreignOff;
        const end = begin + this.pandaFile.header.foreignSize;
        return this.offsetValue >= begin && this.offsetValue < end;
    }

    getOffset(): number {
        return this.offsetValue;
    }

    getPandaFile(): IPandaFile | null {
        return this.pandaFile;
    }
}
