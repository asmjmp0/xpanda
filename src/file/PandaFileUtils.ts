/**
 * 字节读取工具(移植自 Java jmp0.abc.file.PandaFileUtils)
 * Java 使用 32 位有符号 int 读取后:
 *  - 值为 -1(0xffffffff)时返回 0xffffffff(无符号最大值)
 *  - 否则与 0x0FFFFFFF(28 位)掩码
 * @Author: jmp0
 */
export class PandaFileUtils {
    static readSubBytes(bytes: Uint8Array, index: number, len: number): Uint8Array {
        return bytes.subarray(index, index + len);
    }

    static bytes2UnsignedInteger(bytes: Uint8Array, index: number): number {
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const value = dv.getInt32(index, true);
        if (value === -1) return 0xffffffff;
        return value & 0x0fffffff;
    }

    static bytes2Uint16(bytes: Uint8Array, index: number): number {
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        return dv.getInt16(index, true);
    }

    /** 读取 4 字节小端偏移值(与 readOffset(...).getOffset() 等价) */
    static readOffsetValue(pandaFile: { data: Uint8Array }, index: number): number {
        const dv = new DataView(pandaFile.data.buffer, pandaFile.data.byteOffset, pandaFile.data.byteLength);
        const value = dv.getInt32(index, true);
        return value === -1 ? 0xffffffff : value & 0x0fffffff;
    }
}
