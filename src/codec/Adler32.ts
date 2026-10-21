/**
 * Adler32 校验(移植 Java java.util.zip.Adler32 的语义)
 */
export class Adler32 {
    private static readonly MOD = 65521;
    private s1 = 1;
    private s2 = 0;

    update(data: Uint8Array, offset: number, length: number): void {
        for (let i = offset; i < offset + length; i++) {
            this.s1 = (this.s1 + (data[i] & 0xff)) % Adler32.MOD;
            this.s2 = (this.s2 + this.s1) % Adler32.MOD;
        }
    }

    getValue(): number {
        return ((this.s2 << 16) | this.s1) >>> 0;
    }
}
