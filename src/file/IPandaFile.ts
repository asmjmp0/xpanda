import { Leb128 } from "../codec/Leb128";
import type { Header } from "./desc/Header";
import type { IndexHeader } from "./desc/IndexHeader";
import type { Offset } from "./desc/Offset";

/**
 * PandaFile 上下文接口,用于打破循环依赖。
 * @Author: jmp0
 */
export interface IPandaFile {
    readonly data: Uint8Array;
    readonly leb128: Leb128;
    readonly header: Header;
    readonly indexHeaders: IndexHeader[];
    resolveOffset(ptr: number): unknown | undefined;
    addOffset(ptr: number, obj: unknown): void;
    resolveIndexHeaderByOffset(offset: Offset): IndexHeader | null;
}
