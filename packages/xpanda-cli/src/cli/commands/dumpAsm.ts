/**
 * `xpanda dump-asm`: disassemble every class of an abc / hap to .asm files.
 * @Author: jmp0
 */
import * as fs from "fs";
import * as path from "path";
import { HapFile, PandaClass, PandaFile } from "xpanda-core";
import { saveClassFile } from "../../io";
import { takeValue } from "../args";
import { fail } from "../help";
import { isHapInput, readInputBytes } from "../input";

interface AsmOptions {
    outDir: string;
    stdout: boolean;
}

/** Disassemble one class: one section per method with header info + CFG blocks/instructions. */
function dumpClassAsm(pandaClass: PandaClass): string {
    const builder: string[] = [];
    builder.push("// class: " + pandaClass.name.content + "\n");
    builder.push("// methods: " + pandaClass.pandaMethods.size + "\n");
    for (const method of pandaClass.pandaMethods.values()) {
        builder.push("\n.function " + method.name.content + "\n");
        if (method.methodExternal || !method.methodCode) {
            builder.push("  (external)\n");
            continue;
        }
        const code = method.methodCode;
        builder.push(`  // vregs: ${code.numVregs}, args: ${code.numArgs}, code: ${code.codeSize} bytes, tries: ${code.triesSize}\n`);
        try {
            const cfg = method.disAssemble();
            if (cfg) builder.push(cfg.toString());
        } catch (e) {
            // A single method failing (e.g. unknown opcode) must not abort the whole class.
            builder.push("  // disassembly failed: " + e + "\n");
        }
    }
    return builder.join("");
}

/** Disassemble every class of one abc, writing .asm files to classOutDir; returns stdout segments. */
function dumpAsmAbcData(data: Uint8Array, options: AsmOptions, classOutDir: string): string[] {
    const pandaFile = new PandaFile(data);
    const classes = pandaFile.getAllClasses();
    if (!options.stdout) fs.mkdirSync(classOutDir, { recursive: true });
    console.error(`classes: ${classes.length}`);
    const outputs: string[] = [];
    for (const clazz of classes) {
        const text = dumpClassAsm(clazz);
        if (text.length === 0) continue;
        if (options.stdout) {
            outputs.push("\n/***************************" + clazz.name.content + "*************************************/\n" + text);
        } else {
            saveClassFile(classOutDir, clazz, text, ".asm");
            console.log("written: " + clazz.name.content);
        }
    }
    return outputs;
}

/** Disassemble every .abc entry of a hap. */
function dumpAsmHap(data: Uint8Array, options: AsmOptions): string[] {
    const hap = new HapFile(data);
    const abcEntries = hap.getAbcEntries();
    if (abcEntries.length === 0) throw new Error("hap: no .abc entry found");
    const allOutputs: string[] = [];
    for (const entry of abcEntries) {
        // ets/modules.abc → outDir/ets/modules/<class path>.asm
        const classOutDir = path.join(options.outDir, entry.name.replace(/\.abc$/i, ""));
        console.error(`hap: dump-asm ${entry.name} (${entry.uncompressedSize} bytes)`);
        allOutputs.push(...dumpAsmAbcData(entry.read(), options, classOutDir));
    }
    return allOutputs;
}

export function runDumpAsm(args: string[]): void {
    if (args.length < 1) fail("dump-asm: missing <file.abc|file.hap> file argument", "dump-asm");
    const input = args[0];
    let outDir = "out";
    let stdout = false;
    for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        if (arg === "-o") {
            const parsed = takeValue(args, i, arg, "dump-asm");
            outDir = parsed.value;
            i = parsed.index;
        } else if (arg === "--stdout") {
            stdout = true;
        } else {
            fail(`unknown argument: ${arg}`, "dump-asm");
        }
    }
    const data = readInputBytes(input);
    const options: AsmOptions = { outDir, stdout };
    const outputs = isHapInput(input, data)
        ? dumpAsmHap(data, options)
        : dumpAsmAbcData(data, options, outDir);
    if (stdout) console.log(outputs.map((out) => out + "\n").join(""));
}
