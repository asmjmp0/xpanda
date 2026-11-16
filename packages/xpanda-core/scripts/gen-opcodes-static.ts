/**
 * Generates the ArkTS-Sta (static core + ets plugin) opcode table
 * src/static/opcodes-static.ts.
 *
 * The static ISA is combined from two reference YAML files, mirroring the
 * runtime's isa/combine.rb + isa/isapi.rb opcode assignment:
 *   - public prefixes/instructions keep their explicit opcode_idx;
 *   - the `ets` plugin prefix gets the highest free byte (0xff);
 *   - plugin instructions get the lowest free secondary index in order.
 *
 * @Author: jmp0
 */
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

interface InstructionItem {
    sig: string;
    opcode_idx?: number[];
    format: string[];
    prefix?: string;
    properties?: string[];
}
interface GroupItem {
    title: string;
    properties?: string[];
    instructions: InstructionItem[];
}
interface PrefixItem { name: string; opcode_idx?: number }
interface IsaBean {
    version: string;
    prefixes: PrefixItem[];
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

/** Parse the operand list of a signature ("v1:out:any" / "imm:i32" / "string_id"). */
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

/** Parse the encoded operand layout from the format string (no opcode/prefix tokens). */
function parseFormatOperands(formatString: string): { kind: "v" | "imm" | "id"; bits: number }[] {
    const tokens = formatString.split("_");
    const result: { kind: "v" | "imm" | "id"; bits: number }[] = [];
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
            result.push({ kind: match[1] as "v" | "imm" | "id", bits });
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
    return type === "i8" || type === "i16" || type === "i32" || type === "i64";
}

function immIsFloat(type: string): boolean {
    return type === "f32" || type === "f64";
}

function buildOperandLayout(ins: { sig: string }, formatString: string, idShift: boolean): OperandDesc[] {
    let sigOperands = parseSigOperands(ins.sig);
    // `id_shift`: the signature lists the entity id first, but the encoding
    // stores it after the register/immediate operands (e.g. `call` / `initobj`).
    if (idShift && sigOperands.length > 1) sigOperands = [...sigOperands.slice(1), sigOperands[0]];
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
            if (v.startsWith("v") || v.startsWith("imm") || v.startsWith("id")) {
                const paramSize = parseInt(format[idx + 1]);
                size += paramSize / 8;
                enumName += v.replace(/\d+$/, "").toUpperCase() + paramSize;
                idx += 2;
            } else if (v.startsWith("none")) {
                enumName += "NONE";
                idx += 1;
            } else {
                throw new Error("format not support: " + v);
            }
        }
    }
    if (enumName.startsWith("_")) enumName = enumName.substring(1);
    return { enumName, size: Math.trunc(size) };
}

/** Merge a plugin ISA into the core ISA (isa/combine.rb). */
function mergeIsa(core: IsaBean, plugin: IsaBean): IsaBean {
    const merged: IsaBean = {
        version: core.version,
        prefixes: [...core.prefixes, ...(plugin.prefixes ?? [])],
        properties: [...core.properties],
        groups: core.groups.map((g) => ({ ...g, instructions: g.instructions.slice() })),
    };
    const seen = new Set(merged.properties.map((p) => p.tag));
    for (const p of plugin.properties ?? []) {
        if (!seen.has(p.tag)) merged.properties.push(p);
        seen.add(p.tag);
    }
    merged.groups.push(...plugin.groups);
    return merged;
}

/**
 * Assign missing opcode indices like the runtime's OpcodeAssigner: explicit
 * indices reserve their slot, private instructions take the lowest free index
 * inside their prefix, private prefixes take the highest free byte.
 */
function assignOpcodes(bean: IsaBean): void {
    const allBytes = Array.from({ length: 256 }, (_, i) => i);
    const usedPrefixBytes = new Set<number>();
    for (const p of bean.prefixes) {
        if (p.opcode_idx !== undefined) usedPrefixBytes.add(p.opcode_idx);
    }
    for (const p of bean.prefixes) {
        if (p.opcode_idx === undefined) {
            const free = allBytes.filter((b) => !usedPrefixBytes.has(b));
            if (free.length === 0) throw new Error("no free prefix byte");
            p.opcode_idx = free[free.length - 1];
            usedPrefixBytes.add(p.opcode_idx);
        }
    }

    const used = new Map<string, Set<number>>();
    const slotOf = (prefix: string | undefined) => prefix ?? "";
    for (const group of bean.groups) {
        for (const ins of group.instructions) {
            const key = slotOf(ins.prefix);
            if (!used.has(key)) used.set(key, new Set());
            for (const idx of ins.opcode_idx ?? []) used.get(key)!.add(idx);
        }
    }
    for (const group of bean.groups) {
        for (const ins of group.instructions) {
            if (ins.opcode_idx !== undefined) continue;
            const occupied = used.get(slotOf(ins.prefix))!;
            let next = 0;
            while (occupied.has(next)) next++;
            occupied.add(next);
            ins.opcode_idx = new Array(ins.format.length).fill(next);
        }
    }
}

function loadBean(file: string): IsaBean {
    return yaml.load(fs.readFileSync(file, "utf8")) as IsaBean;
}

function main(): void {
    const corePath = path.join(__dirname, "..", "resources", "isa-static.yaml");
    const pluginPath = path.join(__dirname, "..", "resources", "isa-static-ets.yaml");
    const bean = mergeIsa(loadBean(corePath), loadBean(pluginPath));
    assignOpcodes(bean);

    const flagNames: string[] = bean.properties.map((p) => p.tag);
    flagNames.push("acc_none");
    flagNames.push("acc_read");
    flagNames.push("acc_write");
    const flagMap = new Map<string, number>();
    let flagIdx = 0;
    for (const tag of flagNames) {
        if (!flagMap.has(tag)) flagMap.set(tag, 1 << flagIdx++);
    }

    const prefixMap = new Map<string, number>();
    for (const p of bean.prefixes) prefixMap.set(p.name, p.opcode_idx!);

    const formatSet = new Set<string>();
    for (const g of bean.groups) for (const ins of g.instructions) for (const f of ins.format) formatSet.add(f);
    const formatMap = new Map<string, FormatDesc>();
    for (const f of formatSet) {
        const fd = genFormatDesc(f);
        const existing = formatMap.get(fd.enumName);
        if (existing && existing.size !== fd.size) {
            throw new Error(`format name collision '${fd.enumName}': ${existing.size} vs ${fd.size} bytes`);
        }
        if (!existing) formatMap.set(fd.enumName, fd);
    }

    const instructions: InsDesc[] = [];
    for (const group of bean.groups) {
        const groupProps = group.properties ?? [];
        for (const ins of group.instructions) {
            const name = ins.sig.split(" ")[0];
            const flagsArr = ins.properties ?? [];
            const idShift = groupProps.includes("id_shift") || flagsArr.includes("id_shift");
            let flags = 0;
            for (const prop of groupProps) flags |= flagMap.get(prop) ?? 0;
            for (const prop of flagsArr) flags |= flagMap.get(prop) ?? 0;
            for (let i = 0; i < ins.format.length; i++) {
                const idx = ins.opcode_idx![i];
                let opcode = idx;
                if (ins.prefix) {
                    const value = prefixMap.get(ins.prefix);
                    if (value === undefined) throw new Error("unknown prefix " + ins.prefix);
                    opcode = (opcode << 8) | value;
                }
                const formatStr = ins.format[i];
                const fd = genFormatDesc(formatStr);
                instructions.push({
                    name,
                    code: opcode,
                    format: fd.enumName,
                    flags,
                    operands: buildOperandLayout(ins, formatStr, idShift),
                });
            }
        }
    }

    const lines: string[] = [];
    lines.push("/**");
    lines.push(" * This file is generated by scripts/gen-opcodes-static.ts from");
    lines.push(" * resources/isa-static.yaml + resources/isa-static-ets.yaml. DO NOT EDIT BY HAND!!!");
    lines.push(" * Supported ArkTS-Sta bytecode version: " + bean.version);
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
    lines.push("export const FORMAT_PARAM_SIZE: Record<string, number> = {");
    for (const [name, fd] of formatMap.entries()) {
        lines.push("    " + JSON.stringify(fd.enumName) + ": " + fd.size + ",");
    }
    lines.push("};");
    lines.push("");
    lines.push("export interface OpcodeOperand {");
    lines.push("    name: string;");
    lines.push("    kind: 'v' | 'imm' | 'id';");
    lines.push("    bits: number;");
    lines.push("    signed: boolean;");
    lines.push("    float: boolean;");
    lines.push("}");
    lines.push("");
    lines.push("export interface OpcodeInfo {");
    lines.push("    name: string;");
    lines.push("    code: number;");
    lines.push("    format: string;");
    lines.push("    flags: number;");
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
    lines.push("/** First primary opcode byte that introduces a prefixed instruction. */");
    const minPrefix = Math.min(...bean.prefixes.map((p) => p.opcode_idx!));
    lines.push("export const LAST_INSTRUCTION_CODE = " + minPrefix + ";");
    lines.push("");

    const outPath = path.join(__dirname, "..", "src", "static", "opcodes-static.ts");
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, lines.join("\n"));
    console.log("generated " + outPath + " (" + instructions.length + " opcodes, version " + bean.version + ")");
}

main();
