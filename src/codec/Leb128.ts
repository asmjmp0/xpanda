/**
 * LEB128 编解码(移植自 Java jmp0.abc.codec.Leb128,保持 32 位有符号运算语义)
 * @Author: jmp0
 */
export class Leb128 {
    private _unsignedInteger = 0;
    private _size = 0;
    private _signedResult = 0;
    constructor(private readonly bs: Uint8Array) {}

    get unsignedInteger(): number { return this._unsignedInteger; }
    get size(): number { return this._size; }
    get signedResult(): number { return this._signedResult; }

    decode2UnsignedInteger(offset: number): void {
        // 使用 JS 的 32 位有符号运算,与 Java int 语义一致
        let result = 0;
        let cur: number;
        let count = 0;
        let idx = 0;
        do {
            cur = this.bs[offset + idx++] & 0xff;
            result |= (cur & 0x7f) << (count * 7);
            count++;
        } while (((cur & 0x80) === 0x80) && count < 5);
        if (result === -1) {
            this._unsignedInteger = 0xffffffff;
            this._size = 5;
            return;
        }
        this._unsignedInteger = result >>> 0;
        this._size = count;
    }

    decode2Integer(offset: number): void {
        let result = 0;
        let cur: number;
        let count = 0;
        let signBits = -1;
        let idx = 0;
        do {
            cur = this.bs[offset + idx++] & 0xff;
            result |= (cur & 0x7f) << (count * 7);
            signBits <<= 7;
            count++;
        } while (((cur & 0x80) === 0x80) && count < 5);

        // 需要时进行符号扩展
        if (((signBits >> 1) & result) !== 0) {
            result |= signBits;
        }
        this._signedResult = result | 0;
        this._size = count;
    }

    static writeUnsignedLeb128(value: number): Uint8Array {
        const out: number[] = [];
        for (let remaining = value >>> 7; remaining !== 0; remaining >>>= 7) {
            out.push((value & 127) | 0x80);
            value = remaining;
        }
        out.push(value & 127);
        return Uint8Array.from(out, (x) => x & 0xff);
    }

    static writeSignedLeb128(value: number): Uint8Array {
        const out: number[] = [];
        let remaining = value >> 7;
        let hasMore = true;
        const end = ((value & -2147483648) === 0) ? 0 : -1;
        while (hasMore) {
            hasMore = (remaining !== end) || ((remaining & 1) !== ((value >> 6) & 1));
            out.push(((value & 0x7f) | (hasMore ? 0x80 : 0)) & 0xff);
            value = remaining;
            remaining >>= 7;
        }
        return Uint8Array.from(out);
    }
}
