/**
 * 汇编器测试:
 *   1. 常用指令的编码字节;
 *   2. 对 md5.abc / class.abc / aes.abc 的每条指令做 "解码 → 按精确变体重新汇编 → 逐字节比较";
 *   3. prefixed 指令与文本汇编。
 * @Author: jmp0
 */
import * as fs from "fs";
import * as path from "path";
import { assemble, assembleInstruction, decodeInstructions, instructionSize, PandaFile } from "../src";
import { OPCODE_BY_CODE } from "../src/disasm/opcodes";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error("ASSERT FAILED: " + message);
}

function hex(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString("hex");
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

function loadSample(fileName: string): PandaFile {
    const file = path.join(__dirname, "resources", fileName);
    return new PandaFile(new Uint8Array(fs.readFileSync(file)));
}

// ---------------------------------------------------------------- 1. basic encodings
function testBasicEncodings(): void {
    assert(hex(assemble("nop")) === "d5", "nop");
    assert(hex(assemble("ldai 1")) === "6201000000", "ldai 1");
    assert(hex(assemble("sta v0")) === "6100", "sta v0");
    // 寄存器 < 16 时优先使用 4-bit 变体(v1 在高 4 位,v2 在低 4 位)
    assert(hex(assemble("mov v0, v1")) === "4410", "mov v0, v1");
    assert(hex(assemble("lda.str 12")) === "3e0c00", "lda.str 12");
    assert(hex(assemble("jmp -4")) === "4dfc", "jmp -4");
    // 两个 4-bit 立即数:第一个在低 4 位,第二个在高 4 位
    assert(hex(assemble("ldlexvar 0, 2")) === "3c20", "ldlexvar 0, 2");
    // 指定变体后强制使用 8-bit 寄存器编码
    assert(hex(assembleInstruction("mov", [0, 1], { format: "V8_V8" })) === "450001", "mov v8 变体");
    // 按参数名传操作数
    assert(hex(assembleInstruction("sta", { v: 3 })) === "6103", "sta by name");
}

// ---------------------------------------------------------------- 2. round-trip samples
function roundTripSample(fileName: string): number {
    const pandaFile = loadSample(fileName);
    let count = 0;
    for (const indexHeader of pandaFile.indexHeaders) {
        for (const clazz of indexHeader.pandaClasses) {
            if (clazz.classExternal) continue;
            for (const method of clazz.pandaMethods.values()) {
                const code = method.methodCode;
                if (!code) continue;
                const decoded = decodeInstructions(code.instructions);
                for (const instruction of decoded) {
                    const encoded = assembleInstruction(instruction.opcode.name, instruction.operands, {
                        format: instruction.opcode.format,
                    });
                    const original = code.instructions.subarray(instruction.pc, instruction.pc + instruction.size);
                    if (!bytesEqual(encoded, original)) {
                        throw new Error(`${fileName}:${clazz.getClassName()}::${method.name.content} pc ${instruction.pc} `
                            + `'${instruction.opcode.name}' (${instruction.opcode.format}) expected ${hex(original)} got ${hex(encoded)}`);
                    }
                    if (instruction.size !== instructionSize(instruction.opcode)) {
                        throw new Error(`size mismatch for '${instruction.opcode.name}'`);
                    }
                    count++;
                }
            }
        }
    }
    assert(count > 0, `${fileName}: no instructions decoded`);
    return count;
}

// ---------------------------------------------------------------- 3. prefix + text
function testPrefixedAndText(): void {
    // wide.newlexenv imm16(prefixed: 2 字节指令头)
    const wide = assembleInstruction("wide.newlexenv", [3]);
    const decoded = decodeInstructions(wide);
    assert(decoded.length === 1 && decoded[0].opcode.name === "wide.newlexenv", "prefixed decode round-trip");
    assert(decoded[0].size === wide.length, "prefixed instruction size");

    const text = assemble("nop\nldai 1;\nsta v0");
    assert(hex(text) === "d562010000006100", "text assembler");
    void OPCODE_BY_CODE;
}

function main(): void {
    testBasicEncodings();
    testPrefixedAndText();
    const md5Count = roundTripSample("md5.abc");
    const classCount = roundTripSample("class.abc");
    const aesCount = roundTripSample("aes.abc");
    console.log(`[assembler] round-trip ok (md5 ${md5Count}, class ${classCount}, aes ${aesCount} instructions)`);
    console.log("[assembler] all tests passed");
}

main();
