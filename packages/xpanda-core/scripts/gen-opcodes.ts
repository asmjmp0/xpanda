/**
 * 从 isa.yaml 生成操作码表 src/disasm/opcodes.ts
 * 移植自 Java opcode_gen 子项目 (jmp0.abc.opcode_gen.PandaIsaParser)
 *
 * @Author: jmp0
 */
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

interface InstructionItem {
    sig: string;
    opcode_idx: number[];
    format: string[];
    prefix?: string;
    properties?: string[];
}
interface GroupItem {
    title: string;
    properties?: string[];
    instructions: InstructionItem[];
}
interface IsaBean {
    version: string;
    prefixes: { name: string; opcode_idx: number }[];
    properties: { tag: string; description: string }[];
    groups: GroupItem[];
}

interface FormatDesc { enumName: string; size: number }
interface InsDesc { name: string; code: number; format: string; flags: number }

// 与 Java 生成逻辑一致:解析格式字符串得到格式枚举名与参数字节数
function genFormatDesc(formatString: string): FormatDesc {
    const format = formatString.split("_");
    let idx = 0;
    let size = 0;
    let enumName = "";
    while (idx < format.length) {
        const v = format[idx];
        if (v === "op") {
            idx += 1;
        } else if (v === "pref") {
            idx += 2;
            enumName += "PREF";
        } else {
            enumName += "_";
            if (v.startsWith("v")) {
                const paramSize = parseInt(format[idx + 1]);
                size += paramSize / 8;
                enumName += "V" + paramSize;
                idx += 2;
            } else if (v.startsWith("imm")) {
                const paramSize = parseInt(format[idx + 1]);
                size += paramSize / 8;
                enumName += "IMM" + paramSize;
                idx += 2;
            } else if (v.startsWith("id")) {
                const paramSize = parseInt(format[idx + 1]);
                size += paramSize / 8;
                enumName += "ID" + paramSize;
                idx += 2;
            } else if (v.startsWith("none")) {
                enumName += "NONE";
                idx += 1;
            } else {
                console.error("format not support: " + v);
                idx += 1;
            }
        }
    }
    if (enumName.startsWith("_")) enumName = enumName.substring(1);
    return { enumName, size: Math.trunc(size) };
}

function main() {
    const yamlPath = path.join(__dirname, "..", "resources", "isa.yaml");
    const bean = yaml.load(fs.readFileSync(yamlPath, "utf8")) as IsaBean;

    // parse flag
    const flagNames: string[] = bean.properties.map((p) => p.tag);
    flagNames.push("acc_none");
    flagNames.push("acc_read");
    flagNames.push("acc_write");
    const flagMap = new Map<string, number>();
    let flagIdx = 0;
    for (const tag of flagNames) {
        flagMap.set(tag, 1 << flagIdx++);
    }

    // parse prefix
    const prefixMap = new Map<string, number>();
    for (const p of bean.prefixes) prefixMap.set(p.name, p.opcode_idx);

    // parse format
    const formatSet = new Set<string>();
    for (const g of bean.groups) for (const ins of g.instructions) for (const f of ins.format) formatSet.add(f);
    const formatMap = new Map<string, FormatDesc>();
    for (const f of formatSet) formatMap.set(f, genFormatDesc(f));

    // parse instructions
    const instructions: InsDesc[] = [];
    for (const group of bean.groups) {
        const groupProps = group.properties ?? [];
        for (const ins of group.instructions) {
            const name = ins.sig.split(" ")[0];
            const flagsArr = ins.properties ?? [];
            let flags = 0;
            for (const prop of groupProps) flags |= flagMap.get(prop) ?? 0;
            for (const prop of flagsArr) flags |= flagMap.get(prop) ?? 0;
            for (let i = 0; i < ins.opcode_idx.length; i++) {
                let opcode = ins.opcode_idx[i];
                const formatStr = ins.format[i];
                const fd = formatMap.get(formatStr)!;
                if (ins.prefix) {
                    const value = prefixMap.get(ins.prefix);
                    if (value === undefined) throw new Error("unknown prefix " + ins.prefix);
                    opcode = (opcode << 8) | value;
                }
                instructions.push({ name, code: opcode, format: fd.enumName, flags });
            }
        }
    }

    // lastInstruction: 与 Java 一致,即 callruntime.notifyconcurrentresult(pref.none)
    const last = instructions.find((i) => i.name === "callruntime.notifyconcurrentresult" && i.format === "PREF_NONE");
    if (!last) throw new Error("callruntime.notifyconcurrentresult not found");

    const lines: string[] = [];
    lines.push("/**");
    lines.push(" * 本文件由 scripts/gen-opcodes.ts 依据 resources/isa.yaml 生成,请勿手工修改!!!");
    lines.push(" * 重新生成: npm run gen:opcodes");
    lines.push(" * 支持的字节码版本: " + bean.version);
    lines.push(" */");
    lines.push("");
    lines.push("export const BYTECODE_VERSION = '" + bean.version + "';");
    lines.push("");
    lines.push("export const OPCODE_FLAG = {");
    for (const [tag, value] of flagMap.entries()) {
        lines.push("    " + tag.toUpperCase() + ": 0x" + value.toString(16).toUpperCase() + ",");
    }
    lines.push("} as const;");
    lines.push("");
    lines.push("export type OpcodeFlag = number;");
    lines.push("");
    lines.push("/** 格式名 -> 指令参数字节数(不含 opcode 本身) */");
    lines.push("export const FORMAT_PARAM_SIZE: Record<string, number> = {");
    for (const [name, fd] of formatMap.entries()) {
        lines.push("    " + JSON.stringify(fd.enumName) + ": " + fd.size + ",");
    }
    lines.push("};");
    lines.push("");
    lines.push("export interface OpcodeInfo {");
    lines.push("    /** 指令名,如 'mov'、'wide.callrange' */");
    lines.push("    name: string;");
    lines.push("    /** 操作码,前缀指令为 (idx << 8) | prefixByte */");
    lines.push("    code: number;");
    lines.push("    /** 格式枚举名,如 'IMM8_V8'、'PREF_IMM16_V8' */");
    lines.push("    format: string;");
    lines.push("    flags: number;");
    lines.push("}");
    lines.push("");
    lines.push("export const OPCODES: OpcodeInfo[] = [");
    for (const ins of instructions) {
        lines.push("    { name: " + JSON.stringify(ins.name) + ", code: " + ins.code + ", format: " + JSON.stringify(ins.format) + ", flags: 0x" + ins.flags.toString(16).toUpperCase() + " },");
    }
    lines.push("];");
    lines.push("");
    lines.push("export const OPCODE_BY_CODE = new Map<number, OpcodeInfo>();");
    lines.push("for (const op of OPCODES) OPCODE_BY_CODE.set(op.code, op);");
    lines.push("");
    lines.push("/** 与 Java getLastInstruction() 对齐:首字节 >= 该值时读取第二个字节组成前缀指令 */");
    lines.push("export const LAST_INSTRUCTION_CODE = " + last.code + ";");
    lines.push("");

    const outPath = path.join(__dirname, "..", "src", "disasm", "opcodes.ts");
    fs.writeFileSync(outPath, lines.join("\n"));
    console.log("generated " + outPath + " (" + instructions.length + " opcodes, version " + bean.version + ")");
}

main();
