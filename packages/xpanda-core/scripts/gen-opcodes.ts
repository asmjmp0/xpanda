/**
 * Generates the opcode table src/disasm/opcodes.ts from isa.yaml.
 * Ported from the Java opcode_gen subproject (jmp0.abc.opcode_gen.PandaIsaParser)
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
interface InsDesc {
    name: string;
    code: number;
    format: string;
    flags: number;
    operands: OperandDesc[];
}
interface OperandDesc {
    name: string;
    kind: "v" | "imm" | "id";
    bits: number;
    signed: boolean;
    float: boolean;
}
interface SigOperand { name: string; type: string }
interface FormatOperand { kind: "v" | "imm" | "id"; bits: number }

/** 解析 sig 的操作数列表(按签名顺序);类型如 "v1:out:any" / "imm:i32" / "string_id" */
function parseSigOperands(sig: string): SigOperand[] {
    const space = sig.indexOf(" ");
    if (space < 0) return [];
    const rest = sig.substring(space + 1).trim();
    if (rest.length === 0) return [];
    return rest.split(",").map((part) => part.trim()).filter((part) => part.length > 0).map((part) => {
        const colon = part.indexOf(":");
        if (colon < 0) return { name: part, type: "" };
        return { name: part.substring(0, colon), type: part.substring(colon + 1) };
    });
}

/** 解析 format 的操作数编码布局(按编码顺序,不含 opcode/prefix/none) */
function parseFormatOperands(formatString: string): FormatOperand[] {
    const tokens = formatString.split("_");
    const result: FormatOperand[] = [];
    let idx = 0;
    while (idx < tokens.length) {
        const token = tokens[idx];
        if (token === "op" || token === "pref" || token === "none") {
            idx++;
            continue;
        }
        const match = /^(v|imm|id)\d*$/.exec(token);
        if (match) {
            const bits = parseInt(tokens[idx + 1], 10);
            if (!Number.isFinite(bits)) throw new Error(`format '${formatString}': missing width after '${token}'`);
            result.push({ kind: match[1] as FormatOperand["kind"], bits });
            idx += 2;
            continue;
        }
        throw new Error(`format '${formatString}': unsupported token '${token}'`);
    }
    return result;
}

function sigOperandKind(operand: SigOperand): "v" | "imm" | "id" {
    if (/^v\d*$/.test(operand.name)) return "v";
    if (/^imm\d*$/.test(operand.name)) return "imm";
    if (operand.name === "id" || operand.name.endsWith("_id")) return "id";
    throw new Error(`sig operand '${operand.name}' is not v/imm/id`);
}

function immIsSigned(type: string): boolean {
    return type === "i8" || type === "i16" || type === "i32";
}

function immIsFloat(type: string): boolean {
    return type === "f32" || type === "f64";
}

/** 把 sig 与 format 的操作数按位置合并成编码布局(两者顺序必须一致) */
function buildOperandLayout(ins: { sig: string }, formatString: string): OperandDesc[] {
    const sigOperands = parseSigOperands(ins.sig);
    const formatOperands = parseFormatOperands(formatString);
    if (sigOperands.length !== formatOperands.length) {
        throw new Error(`${ins.sig}: sig/format operand count mismatch for '${formatString}'`);
    }
    return formatOperands.map((formatOperand, index) => {
        const sigOperand = sigOperands[index];
        const kind = sigOperandKind(sigOperand);
        if (kind !== formatOperand.kind) {
            throw new Error(`${ins.sig}: operand ${index} kind mismatch ('${kind}' vs '${formatOperand.kind}')`);
        }
        return {
            name: sigOperand.name,
            kind,
            bits: formatOperand.bits,
            signed: kind === "imm" && immIsSigned(sigOperand.type),
            float: kind === "imm" && immIsFloat(sigOperand.type),
        };
    });
}


// Mirrors the Java generation logic: parse the format string into a format enum name and parameter byte count
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
                instructions.push({
                    name,
                    code: opcode,
                    format: fd.enumName,
                    flags,
                    operands: buildOperandLayout(ins, formatStr),
                });
            }
        }
    }

    // lastInstruction: same as Java, i.e. callruntime.notifyconcurrentresult (pref.none)
    const last = instructions.find((i) => i.name === "callruntime.notifyconcurrentresult" && i.format === "PREF_NONE");
    if (!last) throw new Error("callruntime.notifyconcurrentresult not found");

    const lines: string[] = [];
    lines.push("/**");
    lines.push(" * This file is generated by scripts/gen-opcodes.ts from resources/isa.yaml. DO NOT EDIT BY HAND!!!");
    lines.push(" * Regenerate with: yarn gen:opcodes");
    lines.push(" * Supported bytecode version: " + bean.version);
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
    lines.push("/** Format name -> instruction parameter byte count (excluding the opcode itself) */");
    lines.push("export const FORMAT_PARAM_SIZE: Record<string, number> = {");
    for (const [name, fd] of formatMap.entries()) {
        lines.push("    " + JSON.stringify(fd.enumName) + ": " + fd.size + ",");
    }
    lines.push("};");
    lines.push("");
    lines.push("export interface OpcodeOperand {");
    lines.push("    /** Operand name from the instruction signature (e.g. 'v1', 'imm', 'string_id') */");
    lines.push("    name: string;");
    lines.push("    /** Operand kind: register / immediate / entity id */");
    lines.push("    kind: 'v' | 'imm' | 'id';");
    lines.push("    /** Encoded width in bits */");
    lines.push("    bits: number;");
    lines.push("    /** Immediate is signed (i8/i16/i32) */");
    lines.push("    signed: boolean;");
    lines.push("    /** Immediate is an IEEE-754 float (f64) */");
    lines.push("    float: boolean;");
    lines.push("}");
    lines.push("");
    lines.push("export interface OpcodeInfo {");
    lines.push("    /** Instruction name, e.g. 'mov', 'wide.callrange' */");
    lines.push("    name: string;");
    lines.push("    /** Opcode; prefixed instructions encode as (idx << 8) | prefixByte */");
    lines.push("    code: number;");
    lines.push("    /** Format enum name, e.g. 'IMM8_V8', 'PREF_IMM16_V8' */");
    lines.push("    format: string;");
    lines.push("    flags: number;");
    lines.push("    /** Operand layout in encoding order */");
    lines.push("    operands: OpcodeOperand[];");
    lines.push("}");
    lines.push("");
    lines.push("export const OPCODES: OpcodeInfo[] = [");
    for (const ins of instructions) {
        const operands = ins.operands.map((o) => {
            return "{ name: " + JSON.stringify(o.name) + ", kind: " + JSON.stringify(o.kind)
                + ", bits: " + o.bits + ", signed: " + o.signed + ", float: " + o.float + " }";
        }).join(", ");
        lines.push("    { name: " + JSON.stringify(ins.name) + ", code: " + ins.code + ", format: " + JSON.stringify(ins.format) + ", flags: 0x" + ins.flags.toString(16).toUpperCase() + ", operands: [" + operands + "] },");
    }
    lines.push("];");
    lines.push("");
    lines.push("export const OPCODE_BY_CODE = new Map<number, OpcodeInfo>();");
    lines.push("for (const op of OPCODES) OPCODE_BY_CODE.set(op.code, op);");
    lines.push("");
    lines.push("/** Aligned with Java getLastInstruction(): when the first byte >= this value, read a second byte to form a prefixed instruction */");
    lines.push("export const LAST_INSTRUCTION_CODE = " + last.code + ";");
    lines.push("");

    const outPath = path.join(__dirname, "..", "src", "disasm", "opcodes.ts");
    fs.writeFileSync(outPath, lines.join("\n"));
    console.log("generated " + outPath + " (" + instructions.length + " opcodes, version " + bean.version + ")");
}

main();
