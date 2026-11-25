import type { PandaField } from "../file/field/PandaField";
import type { PandaMethod } from "../file/method/PandaMethod";
import { PandaFile } from "../file/PandaFile";
import { StaticPandaFile } from "../static/StaticPandaFile";
import { StaticPandaDisAssembler } from "../static/StaticPandaDisAssembler";
import { PandaInstructionID } from "../disasm/PandaInstruction";
import { StaticPandaID } from "../static/StaticPandaInstruction";
import { PandaLiteralArray } from "../file/literal/PandaLiteralArray";
import { PandaClass as PandaClassEntity } from "../file/clazz/PandaClass";
import { PandaMethod as PandaMethodEntity } from "../file/method/PandaMethod";
import { PandaField as PandaFieldEntity } from "../file/field/PandaField";
import { PandaString } from "../file/desc/PandaString";
import { readableClassName } from "./SymbolIndex";

/**
 * Cross-reference index for dynamic Panda and ArkTS-Sta abc files.
 *
 * The index disassembles every method once and records entity references
 * (method/field/class/string) together with the referencing class, method and
 * pc. Both runtimes expose entity ids through their instruction operands; the
 * two instruction models are normalized here.
 *
 * @Author: jmp0
 */

export type XrefTargetType = "class" | "method" | "field" | "string";
export type XrefKind = "call" | "new" | "define" | "ref" | "field-read" | "field-write" | "class-ref" | "string";

export interface Xref {
    targetType: XrefTargetType;
    targetName: string;
    /** Declaring class of a method/field target, when resolvable. */
    targetOwner?: string;
    fromClass: string;
    fromMethod: string;
    fromPC: number;
    opcode: string;
    kind: XrefKind;
}

export interface XrefQuery {
    targetType: XrefTargetType;
    target: string;
    /** Owner class for method/field targets (mangled or demangled). */
    ownerClass?: string;
    offset?: number;
    limit?: number;
}

export interface XrefQueryResult {
    total: number;
    offset: number;
    limit: number;
    matches: Xref[];
}

/** Resolve a target's owner class name once, tolerating external/foreign records. */
function methodOwner(method: PandaMethod): string | undefined {
    let owner = method.getParent();
    if (!owner) {
        try {
            method.resolve();
        } catch {
            // foreign/external method without a resolvable class index
        }
        owner = method.getParent();
    }
    return owner ? owner.getClassName() : undefined;
}

function fieldOwner(field: PandaField): string | undefined {
    let owner = field.getParent();
    if (!owner) {
        try {
            field.resolve();
        } catch {
            // static primitive/foreign field without a resolvable class index
        }
        owner = field.getParent();
    }
    return owner ? owner.getClassName() : undefined;
}

function fieldKind(opcode: string): XrefKind {
    if (opcode.startsWith("st") || opcode.includes(".st") || opcode.includes("stobj") || opcode.includes("stbyname")) {
        return "field-write";
    }
    return "field-read";
}

function isPropertyOpcode(opcode: string): boolean {
    return opcode.includes("objbyname") || opcode.includes("objbyvalue") || opcode.includes("field");
}

function methodKind(kind: string, opcode: string): XrefKind {
    if (kind === "define" || opcode.startsWith("define")) return "define";
    if (kind === "new" || opcode.startsWith("newobj") || opcode.startsWith("initobj")) return "new";
    if (kind === "call" || kind === "superCall" || opcode.startsWith("call") || opcode.startsWith("supercall")) return "call";
    return "ref";
}

function classKind(opcode: string): XrefKind {
    return opcode.startsWith("newobj") || opcode === "lda.type" || opcode.startsWith("cast")
        || opcode === "instanceof" ? "class-ref" : "ref";
}

function sameClassName(a: string | undefined, b: string | undefined): boolean {
    if (!a || !b) return false;
    return a === b || readableClassName(a) === readableClassName(b);
}

export class XrefIndex {
    private readonly refs: Xref[] = [];
    private readonly callers = new Map<string, Xref[]>();
    private readonly callees = new Map<string, Xref[]>();
    private readonly failures: string[] = [];

    private constructor(file: PandaFile | StaticPandaFile) {
        const isStatic = file instanceof StaticPandaFile;
        for (const clazz of file.getAllClasses()) {
            for (const method of clazz.pandaMethods.values()) {
                if (!method.methodCode) continue;
                let cfg;
                try {
                    cfg = isStatic
                        ? StaticPandaDisAssembler.disAssembly(method)
                        : method.disAssemble();
                } catch {
                    this.failures.push(clazz.getClassName() + "#" + method.getName().content);
                    continue;
                }
                if (!cfg) {
                    this.failures.push(clazz.getClassName() + "#" + method.getName().content);
                    continue;
                }
                const fromClass = clazz.getClassName();
                const fromMethod = method.getName().content;
                for (const block of cfg.pandaIRBasicBlocks) {
                    for (const instruction of block.pandaInstructions as any[]) {
                        const seen = new Set<string>();
                        const pc = typeof instruction.pc === "number" ? instruction.pc : -1;
                        const opcode = instruction.opcode?.name ?? "";
                        const emit = (targetType: XrefTargetType, targetName: string,
                            targetOwner: string | undefined, kind: XrefKind): void => {
                            if (!targetName) return;
                            const key = targetType + "\u0000" + (targetOwner ?? "") + "\u0000"
                                + targetName + "\u0000" + kind;
                            if (seen.has(key)) return;
                            seen.add(key);
                            const ref: Xref = {
                                targetType,
                                targetName,
                                targetOwner,
                                fromClass,
                                fromMethod,
                                fromPC: pc,
                                opcode,
                                kind,
                            };
                            this.refs.push(ref);
                            if (targetType === "method" && (kind === "call" || kind === "new")) {
                                const sourceKey = fromClass + "\u0000" + fromMethod;
                                const targetKey = (targetOwner ?? "") + "\u0000" + targetName;
                                const calleeList = this.callees.get(sourceKey) ?? [];
                                calleeList.push(ref);
                                this.callees.set(sourceKey, calleeList);
                                const callerList = this.callers.get(targetKey) ?? [];
                                callerList.push(ref);
                                this.callers.set(targetKey, callerList);
                            }
                        };

                        if (isStatic) {
                            this.collectStatic(instruction, emit);
                        } else {
                            this.collectDynamic(instruction, emit);
                        }
                    }
                }
            }
        }
    }

    static build(file: PandaFile | StaticPandaFile): XrefIndex {
        return new XrefIndex(file);
    }

    get xrefCount(): number {
        return this.refs.length;
    }

    get failureCount(): number {
        return this.failures.length;
    }

    get failedMethods(): readonly string[] {
        return this.failures;
    }

    referencesTo(targetType: XrefTargetType, target: string, ownerClass?: string): Xref[] {
        const owner = ownerClass ? readableClassName(ownerClass) : undefined;
        return this.refs.filter((ref) => {
            if (ref.targetType !== targetType) return false;
            if (targetType === "class") {
                if (!sameClassName(ref.targetName, target)) return false;
            } else if (targetType === "string") {
                if (ref.targetName !== target) return false;
            } else {
                if (ref.targetName !== target) return false;
                if (owner && !sameClassName(ref.targetOwner, owner)) return false;
            }
            return true;
        });
    }

    query(request: XrefQuery): XrefQueryResult {
        const matches = this.referencesTo(request.targetType, request.target, request.ownerClass);
        const offset = Math.max(0, request.offset ?? 0);
        const limit = Math.max(1, request.limit ?? 50);
        return {
            total: matches.length,
            offset,
            limit,
            matches: matches.slice(offset, offset + limit),
        };
    }

    /** Methods called by `ownerClass#methodName`. */
    calleesOf(ownerClass: string, methodName: string): Xref[] {
        const sourceKey = ownerClass + "\u0000" + methodName;
        return this.callees.get(sourceKey) ?? [];
    }

    /** Methods that call `ownerClass#methodName`. */
    callersOf(ownerClass: string | undefined, methodName: string): Xref[] {
        if (ownerClass) {
            return this.callers.get(ownerClass + "\u0000" + methodName) ?? [];
        }
        const result: Xref[] = [];
        for (const [key, list] of this.callers) {
            if (key.substring(key.indexOf("\u0000") + 1) === methodName) result.push(...list);
        }
        return result;
    }

    private collectDynamic(instruction: any, emit: (
        targetType: XrefTargetType, targetName: string, targetOwner: string | undefined, kind: XrefKind) => void): void {
        const opcode: string = instruction.opcode?.name ?? "";
        const instructionKind: string = instruction.kind ?? "";
        for (const param of instruction.params ?? []) {
            if (!(param instanceof PandaInstructionID)) continue;
            if (param.type === "STRING") {
                const value = param.obj instanceof PandaString ? param.obj.content : null;
                if (!value) continue;
                if (opcode === "lda.str" || instruction.loadType === "STRING") {
                    emit("string", value, undefined, "string");
                } else if (isPropertyOpcode(opcode)) {
                    // Dynamic field access carries the property name as a string id
                    // (there is no resolved PandaField operand for ldbyname/stbyname).
                    emit("field", value, undefined, fieldKind(opcode));
                }
                continue;
            }
            this.emitId(param.obj, opcode, instructionKind, emit);
        }
        if (instruction.func) {
            emit("method", instruction.func.getName().content, methodOwner(instruction.func), "define");
        }
        if (instruction.constructorMethod) {
            emit("method", instruction.constructorMethod.getName().content,
                methodOwner(instruction.constructorMethod), "new");
        }
        for (const desc of instruction.methodDescriptions ?? []) {
            emit("method", desc.method.getName().content, methodOwner(desc.method), "define");
        }
        for (const desc of instruction.staticMethodDescriptions ?? []) {
            emit("method", desc.method.getName().content, methodOwner(desc.method), "define");
        }
        for (const literal of instruction.initArr ?? []) {
            this.emitLiteral(literal, emit, 0);
        }
        if (instruction.loadType === "STRING" && instruction.loadParam instanceof PandaInstructionID) {
            const obj = instruction.loadParam.obj;
            if (obj instanceof PandaString) emit("string", obj.content, undefined, "string");
        }
        if (instruction.superProp instanceof PandaString) {
            emit("string", instruction.superProp.content, undefined, "string");
        }
        if (instruction.globalName instanceof PandaString) {
            emit("string", instruction.globalName.content, undefined, "string");
        }
        if (instruction.typeString instanceof PandaString) {
            emit("string", instruction.typeString.content, undefined, "string");
        }
    }

    private collectStatic(instruction: any, emit: (
        targetType: XrefTargetType, targetName: string, targetOwner: string | undefined, kind: XrefKind) => void): void {
        const opcode: string = instruction.opcode?.name ?? "";
        const instructionKind: string = instruction.kind ?? "";
        for (const param of instruction.params ?? []) {
            if (!(param instanceof StaticPandaID)) continue;
            this.emitId(param.obj, opcode, instructionKind, emit);
        }
        if (instruction.callMethod) {
            emit("method", instruction.callMethod.getName().content,
                methodOwner(instruction.callMethod), methodKind(instructionKind, opcode));
        }
        if (instruction.field) {
            emit("field", instruction.field.getName(), fieldOwner(instruction.field), fieldKind(opcode));
        } else if (instruction.fieldName) {
            emit("field", instruction.fieldName, instruction.fieldClassName ?? undefined, fieldKind(opcode));
        }
        if (instruction.typeClass) {
            emit("class", instruction.typeClass.getClassName(), undefined, classKind(opcode));
        }
        if (instruction.loadType === "STRING" && instruction.loadParam instanceof StaticPandaID) {
            const obj = instruction.loadParam.obj;
            if (obj instanceof PandaString) emit("string", obj.content, undefined, "string");
        }
        if (instruction.callName) {
            emit("string", instruction.callName, undefined, "string");
        }
    }

    private emitId(obj: any, opcode: string, instructionKind: string, emit: (
        targetType: XrefTargetType, targetName: string, targetOwner: string | undefined, kind: XrefKind) => void): void {
        if (!obj) return;
        if (obj instanceof PandaMethodEntity) {
            emit("method", obj.getName().content, methodOwner(obj), methodKind(instructionKind, opcode));
        } else if (obj instanceof PandaFieldEntity) {
            emit("field", obj.getName(), fieldOwner(obj), fieldKind(opcode));
        } else if (obj instanceof PandaClassEntity) {
            emit("class", obj.getClassName(), undefined, classKind(opcode));
        } else if (obj instanceof PandaString) {
            emit("string", obj.content, undefined, "string");
        } else if (obj instanceof PandaLiteralArray) {
            for (const literal of obj.getLiterals()) this.emitLiteral(literal, emit, 0);
        }
    }

    private emitLiteral(literal: any, emit: (
        targetType: XrefTargetType, targetName: string, targetOwner: string | undefined, kind: XrefKind) => void,
        depth: number): void {
        if (!literal || depth > 3) return;
        if (literal instanceof PandaLiteralArray) {
            for (const child of literal.getLiterals()) this.emitLiteral(child, emit, depth + 1);
            return;
        }
        this.emitId(literal, "", "", emit);
    }
}
