/**
 * MUTF8 编解码(移植自 Java jmp0.abc.codec.MUTF8)
 * @Author: jmp0
 */
import { PandaParseException } from "../PandaParseException";

export class MUTF8 {
    /** 解码 MUTF-8 字节序列,遇到 0x00 终止。size 为 UTF-16 code unit 数量 */
    static decode(input: Uint8Array, inIndex: number, size: number): string {
        let s = 0;
        let index = inIndex;
        const out: number[] = new Array(size);
        while (true) {
            const a = input[index++] & 0xff;
            if (a === 0) {
                return String.fromCharCode.apply(null, out.slice(0, s) as unknown as number[]);
            }
            if (a < 0x80) {
                out[s++] = a;
            } else if ((a & 0xe0) === 0xc0) {
                const b = input[index++] & 0xff;
                if ((b & 0xc0) !== 0x80) throw new PandaParseException("bad second byte");
                out[s++] = ((a & 0x1f) << 6) | (b & 0x3f);
            } else if ((a & 0xf0) === 0xe0) {
                const b = input[index++] & 0xff;
                const c = input[index++] & 0xff;
                if (((b & 0xc0) !== 0x80) || ((c & 0xc0) !== 0x80)) throw new PandaParseException("bad second or third byte");
                out[s++] = ((a & 0x0f) << 12) | ((b & 0x3f) << 6) | (c & 0x3f);
            } else {
                throw new PandaParseException("bad byte");
            }
        }
    }

    static encodeInto(dst: Uint8Array, offset: number, s: string): number {
        const length = s.length;
        let idx = offset;
        for (let i = 0; i < length; i++) {
            const ch = s.charCodeAt(i);
            if (ch !== 0 && ch <= 127) {
                dst[idx++] = ch;
            } else if (ch <= 2047) {
                dst[idx++] = 0xc0 | (0x1f & (ch >> 6));
                dst[idx++] = 0x80 | (0x3f & ch);
            } else {
                dst[idx++] = 0xe0 | (0x0f & (ch >> 12));
                dst[idx++] = 0x80 | (0x3f & (ch >> 6));
                dst[idx++] = 0x80 | (0x3f & ch);
            }
        }
        return idx - offset;
    }

    static encode(s: string): Uint8Array {
        const byteCount = MUTF8.countBytes(s);
        const result = new Uint8Array(byteCount);
        MUTF8.encodeInto(result, 0, s);
        return result;
    }

    private static countBytes(s: string): number {
        let result = 0;
        for (let i = 0; i < s.length; i++) {
            const ch = s.charCodeAt(i);
            if (ch !== 0 && ch <= 127) result++;
            else if (ch <= 2047) result += 2;
            else result += 3;
        }
        return result;
    }
}
