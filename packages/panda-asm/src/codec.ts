/**
 * Panda file 二进制编解码工具:
 *   - uleb128 读写
 *   - String 实体编码(uleb(utf16Length << 1 | isAscii) + MUTF8 + NUL)
 * @Author: jmp0
 */

/** uleb128 编码后的字节数 */
export function ulebSize(value: number): number {
    let v = value >>> 0;
    let size = 1;
    while (v >= 0x80) {
        v >>>= 7;
        size++;
    }
    return size;
}

/** uleb128 编码 */
export function writeUleb128(value: number): Uint8Array {
    const out = new Uint8Array(ulebSize(value));
    let v = value >>> 0;
    let i = 0;
    while (v >= 0x80) {
        out[i++] = (v & 0x7f) | 0x80;
        v >>>= 7;
    }
    out[i] = v;
    return out;
}

/** uleb128 解码 */
export function readUleb128(bytes: Uint8Array, offset: number): { value: number; size: number } {
    let result = 0;
    let shift = 0;
    let size = 0;
    while (true) {
        const b = bytes[offset + size] & 0xff;
        result |= (b & 0x7f) << shift;
        size++;
        if ((b & 0x80) === 0) break;
        shift += 7;
        if (size >= 5) break;
    }
    return { value: result >>> 0, size };
}

/** MUTF-8(CESU-8 兼容)编码,与 Panda 的 MUTF8 语义一致 */
export function encodeMutf8(text: string): Uint8Array {
    const out: number[] = [];
    for (let i = 0; i < text.length; i++) {
        const ch = text.charCodeAt(i);
        if (ch !== 0 && ch <= 0x7f) {
            out.push(ch);
        } else if (ch <= 0x7ff) {
            out.push(0xc0 | (ch >> 6), 0x80 | (ch & 0x3f));
        } else {
            out.push(0xe0 | (ch >> 12), 0x80 | ((ch >> 6) & 0x3f), 0x80 | (ch & 0x3f));
        }
    }
    return Uint8Array.from(out);
}

/**
 * 编码一个 String 实体:
 *   uleb128((utf16Length << 1) | isAscii) + mutf8 bytes + 0x00
 */
export function encodeStringEntity(text: string): Uint8Array {
    const mutf8 = encodeMutf8(text);
    let isAscii = 1;
    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) > 0x7f) {
            isAscii = 0;
            break;
        }
    }
    const lengthPrefix = writeUleb128((text.length << 1) | isAscii);
    const out = new Uint8Array(lengthPrefix.length + mutf8.length + 1);
    out.set(lengthPrefix, 0);
    out.set(mutf8, lengthPrefix.length);
    out[out.length - 1] = 0;
    return out;
}

/** 拼接若干字节数组 */
export function concatBytes(parts: Uint8Array[]): Uint8Array {
    let total = 0;
    for (const part of parts) total += part.length;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}
