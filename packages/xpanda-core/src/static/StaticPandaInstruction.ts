import { PandaParseException } from "../PandaParseException";
import type { IPandaFile } from "../file/IPandaFile";
import { PandaClass } from "../file/clazz/PandaClass";
import { Offset } from "../file/desc/Offset";
import { PandaString } from "../file/desc/PandaString";
import { PandaField } from "../file/field/PandaField";
import { PandaMethod } from "../file/method/PandaMethod";
import { FORMAT_PARAM_SIZE, LAST_INSTRUCTION_CODE, OPCODE_FLAG, OPCODE_BY_CODE, type OpcodeInfo } from "./opcodes-static";
import { simpleClassName } from "./StaticNaming";

/** Static ArkTS method modifier. */
const ACC_STATIC = 0x0008;

/**
 * Registers of an ArkTS-Sta frame: `numVregs` local registers, followed by
 * `numArgs` parameter registers. Instance methods treat parameter 0 as `this`.
 */
export class StaticPandaVReg {
    readonly index: number;

    constructor(index: number, readonly method: PandaMethod) {
        this.index = index;
    }

    isParam(): boolean {
        return this.index >= this.method.methodCode!.numVregs;
    }

    paramIndex(): number {
        return this.index - this.method.methodCode!.numVregs;
    }

    toString(): string {
        const numVregs = this.method.methodCode!.numVregs;
        if (this.index < numVregs) return "v" + this.index;
        const param = this.index - numVregs;
        if ((this.method.accessFlag & ACC_STATIC) === 0) {
            return param === 0 ? "this" : "p" + (param - 1);
        }
        return "p" + param;
    }
}

export class StaticPandaIMM {
    constructor(readonly imm: number) {}
    toString(): string { return String(this.imm); }
}

/** The Panda accumulator used as an explicit call argument (call.acc family). */
export class StaticPandaACC {
    toString(): string { return "acc"; }
}

/** Encoded entity reference. The meaning depends on the opcode kind/flags. */
export class StaticPandaID {
    readonly kind: "METHOD" | "FIELD" | "TYPE" | "STRING" | "LITERALARRAY" | "UNKNOWN";
    readonly raw: number;
    readonly obj: Offset | null = null;

    constructor(opcode: OpcodeInfo, raw: number, method: PandaMethod) {
        this.raw = raw;
        if (opcode.flags & OPCODE_FLAG.STATIC_METHOD_ID || opcode.flags & OPCODE_FLAG.METHOD_ID) this.kind = "METHOD";
        else if (opcode.flags & OPCODE_FLAG.STATIC_FIELD_ID || opcode.flags & OPCODE_FLAG.FIELD_ID) this.kind = "FIELD";
        else if (opcode.flags & OPCODE_FLAG.TYPE_ID) this.kind = "TYPE";
        else if (opcode.flags & OPCODE_FLAG.STRING_ID) this.kind = "STRING";
        else if (opcode.flags & OPCODE_FLAG.LITERALARRAY_ID) this.kind = "LITERALARRAY";
        else this.kind = "UNKNOWN";

        const indexHeader = method.indexHeader;
        if (!indexHeader) return;
        try {
            switch (this.kind) {
                case "METHOD": {
                    const offset = indexHeader.pandaMethods[raw];
                    if (offset) {
                        const callee = PandaMethod.create(method.getPandaFile()!, offset.getOffset());
                        callee.resolve();
                        this.obj = callee;
                    }
                    break;
                }
                case "FIELD": {
                    const offset = indexHeader.pandaFields?.[raw];
                    if (offset) {
                        const field = PandaField.create(method.getPandaFile()!, offset.getOffset());
                        field.resolve();
                        this.obj = field;
                    }
                    break;
                }
                case "TYPE": {
                    const clazz = indexHeader.pandaClasses[raw];
                    if (clazz) this.obj = clazz;
                    break;
                }
                case "STRING": {
                    this.obj = PandaString.create(method.getPandaFile()!, raw);
                    break;
                }
                default:
                    break;
            }
        } catch {
            this.obj = null;
        }
    }

    toString(): string {
        if (this.obj) return this.obj.toString();
        return String(this.raw);
    }
}

export type StaticInstructionKind =
    | "nop"
    | "mov" | "load" | "store"
    | "binaryOp" | "unary" | "compare"
    | "jumpDirect" | "jumpEqual" | "jumpNotEqual"
    | "return" | "throw"
    | "call" | "newObj" | "initObj"
    | "newArray" | "arrayLoad" | "arrayStore" | "arrayLength"
    | "fieldLoad" | "fieldStore" | "staticFieldLoad" | "staticFieldStore"
    | "cast" | "instanceof" | "nullCheck" | "async"
    | "unknown";

type BinaryShape = "accReg" | "regReg" | "accImm" | "regRegImm" | "regReg3" | "regRegNew" | "inc";
interface BinarySpec { op: string; shape: BinaryShape }

const BINARY_SPECS: Record<string, BinarySpec> = {};

function addBinary(op: string, names: string[], shape: BinaryShape): void {
    for (const name of names) BINARY_SPECS[name] = { op, shape };
}
addBinary("+", ["add2", "add2.64"], "accReg");
addBinary("-", ["sub2", "sub2.64"], "accReg");
addBinary("*", ["mul2", "mul2.64"], "accReg");
addBinary("/", ["div2", "div2.64", "divu2", "divu2.64"], "accReg");
addBinary("%", ["mod2", "mod2.64", "modu2", "modu2.64"], "accReg");
addBinary("&", ["and2", "and2.64"], "accReg");
addBinary("|", ["or2", "or2.64"], "accReg");
addBinary("^", ["xor2", "xor2.64"], "accReg");
addBinary("<<", ["shl2", "shl2.64"], "accReg");
addBinary(">>>", ["shr2", "shr2.64"], "accReg");
addBinary(">>", ["ashr2", "ashr2.64"], "accReg");
addBinary("+", ["fadd2", "fadd2.64"], "accReg");
addBinary("-", ["fsub2", "fsub2.64"], "accReg");
addBinary("*", ["fmul2", "fmul2.64"], "accReg");
addBinary("/", ["fdiv2", "fdiv2.64"], "accReg");
addBinary("%", ["fmod2", "fmod2.64"], "accReg");
addBinary("+", ["add2v", "add2v.64"], "regReg");
addBinary("-", ["sub2v", "sub2v.64"], "regReg");
addBinary("*", ["mul2v", "mul2v.64"], "regReg");
addBinary("/", ["div2v", "div2v.64", "divu2v", "divu2v.64"], "regReg");
addBinary("%", ["mod2v", "mod2v.64", "modu2v", "modu2v.64"], "regReg");
addBinary("&", ["and2v", "and2v.64"], "regReg");
addBinary("|", ["or2v", "or2v.64"], "regReg");
addBinary("^", ["xor2v", "xor2v.64"], "regReg");
addBinary("<<", ["shl2v", "shl2v.64"], "regReg");
addBinary(">>>", ["shr2v", "shr2v.64"], "regReg");
addBinary(">>", ["ashr2v", "ashr2v.64"], "regReg");
addBinary("+", ["fadd2v", "fadd2v.64"], "regReg");
addBinary("-", ["fsub2v", "fsub2v.64"], "regReg");
addBinary("*", ["fmul2v", "fmul2v.64"], "regReg");
addBinary("/", ["fdiv2v", "fdiv2v.64"], "regReg");
addBinary("%", ["fmod2v", "fmod2v.64"], "regReg");
addBinary("+", ["addi"], "accImm");
addBinary("-", ["subi"], "accImm");
addBinary("*", ["muli"], "accImm");
addBinary("/", ["divi"], "accImm");
addBinary("%", ["modi"], "accImm");
addBinary("&", ["andi"], "accImm");
addBinary("|", ["ori"], "accImm");
addBinary("^", ["xori"], "accImm");
addBinary("<<", ["shli"], "accImm");
addBinary(">>>", ["shri"], "accImm");
addBinary(">>", ["ashri"], "accImm");
addBinary("+", ["addiv"], "regRegImm");
addBinary("-", ["subiv"], "regRegImm");
addBinary("*", ["muliv"], "regRegImm");
addBinary("/", ["diviv"], "regRegImm");
addBinary("%", ["modiv"], "regRegImm");
addBinary("&", ["andiv"], "regRegImm");
addBinary("|", ["oriv"], "regRegImm");
addBinary("^", ["xoriv"], "regRegImm");
addBinary("<<", ["shliv"], "regRegImm");
addBinary(">>>", ["shriv"], "regRegImm");
addBinary(">>", ["ashriv"], "regRegImm");
addBinary("+", ["add"], "regReg3");
addBinary("-", ["sub"], "regReg3");
addBinary("*", ["mul"], "regReg3");
addBinary("/", ["div"], "regReg3");
addBinary("%", ["mod"], "regReg3");
addBinary("&", ["and"], "regReg3");
addBinary("|", ["or"], "regReg3");
addBinary("^", ["xor"], "regReg3");
addBinary("<<", ["shl"], "regReg3");
addBinary(">>>", ["shr"], "regReg3");
addBinary(">>", ["ashr"], "regReg3");
addBinary("+", ["addv"], "regRegNew");
addBinary("-", ["subv"], "regRegNew");
addBinary("*", ["mulv"], "regRegNew");
addBinary("/", ["divv"], "regRegNew");
addBinary("%", ["modv"], "regRegNew");
addBinary("&", ["andv"], "regRegNew");
addBinary("|", ["orv"], "regRegNew");
addBinary("^", ["xorv"], "regRegNew");
addBinary("<<", ["shlv"], "regRegNew");
addBinary(">>>", ["shrv"], "regRegNew");
addBinary(">>", ["ashrv"], "regRegNew");

const UNARY_NAMES: Record<string, string> = {
    neg: "-", "neg.64": "-", fneg: "-", "fneg.64": "-",
    not: "~", "not.64": "~",
};

const CONVERSION_NAMES = new Set([
    "i32tof32", "i32tof64", "u32tof32", "u32tof64", "i64tof32", "i64tof64",
    "u64tof32", "u64tof64", "f32tof64", "f32toi32", "f32toi64", "f32tou32",
    "f32tou64", "f64toi32", "f64toi64", "f64tou32", "f64tou64", "f64tof32",
    "i32tou1", "i64tou1", "u32tou1", "u64tou1", "i32toi64", "i32toi16",
    "i32tou16", "i32toi8", "i32tou8", "i64toi32", "u32toi64", "u32toi16",
    "u32tou16", "u32toi8", "u32tou8", "u64toi32", "u64tou32",
]);

const CONDITION_JUMPS: Record<string, { op: string; withReg: boolean; nullCheck?: boolean }> = {
    jeq: { op: "===", withReg: true },
    jne: { op: "!==", withReg: true },
    jlt: { op: "<", withReg: true },
    jgt: { op: ">", withReg: true },
    jle: { op: "<=", withReg: true },
    jge: { op: ">=", withReg: true },
    "jeq.obj": { op: "===", withReg: true },
    "jne.obj": { op: "!==", withReg: true },
    "jeqz.obj": { op: "===", withReg: false, nullCheck: true },
    "jnez.obj": { op: "!==", withReg: false, nullCheck: true },
    jltz: { op: "<", withReg: false },
    jgtz: { op: ">", withReg: false },
    jlez: { op: "<=", withReg: false },
    jgez: { op: ">=", withReg: false },
};

/**
 * One ArkTS-Sta bytecode instruction.
 *
 * The semantic fields mirror the dynamic PandaInstruction model closely enough
 * for the shared structured-analysis/simplify pipeline; the actual AST shapes
 * are produced by StaticPandaDecompilerMethodHandler.
 *
 * @Author: jmp0
 */
export class StaticPandaInstruction {
    readonly kind: StaticInstructionKind;
    readonly params: any[];
    readonly jumpKind: "direct" | "equal" | "notequal" | null = null;
    readonly destinationPC = 0;

    // mov / load / store
    readonly destObj: StaticPandaVReg | null = null;
    readonly srcObj: StaticPandaVReg | null = null;
    readonly loadType: "OBJECT" | "IMM" | "FLOAT" | "STRING" | "NULL" | "TYPE" = "OBJECT";
    readonly loadParam: any = null;

    // arithmetic
    readonly op = "";
    readonly binaryShape: BinaryShape | null = null;

    // calls
    readonly callMethod: PandaMethod | null = null;
    readonly callArgs: StaticPandaVReg[] = [];
    readonly callThis: StaticPandaVReg | null = null;
    readonly callKind: "static" | "virtual" | "named" | "any" | "init" = "static";
    readonly callName: string | null = null;

    // fields
    readonly field: PandaField | null = null;
    readonly fieldName: string | null = null;
    readonly fieldClassName: string | null = null;
    readonly fieldIsStatic = false;

    // arrays
    readonly arrayReg: StaticPandaVReg | null = null;
    readonly arrayIndexReg: StaticPandaVReg | null = null;
    readonly arrayIndexImm: StaticPandaIMM | null = null;
    readonly valueReg: StaticPandaVReg | null = null;

    // type operations
    readonly typeClass: PandaClass | null = null;
    /** `newobj` + following constructor call pair (destination = new Type(args)). */
    newInit: StaticPandaInstruction | null = null;
    /** This instruction was folded into the preceding `newobj`. */
    skip = false;

    // conditional jumps
    readonly condition: { op: string; operand: StaticPandaVReg | null; nullCheck: boolean } | null = null;

    constructor(readonly pc: number, readonly opcode: OpcodeInfo, param: Uint8Array, readonly method: PandaMethod) {
        this.params = parseParams(opcode, param, method);
        this.kind = classifyStaticKind(opcode);
        const name = opcode.name;

        if (this.kind === "jumpDirect" || this.kind === "jumpEqual" || this.kind === "jumpNotEqual") {
            const jumpKind = this.kind === "jumpDirect" ? "direct"
                : this.kind === "jumpEqual" ? "equal" : "notequal";
            (this as any).jumpKind = jumpKind;
            (this as any).destinationPC = computeDestinationPC(pc, this.params);
        }

        if (name === "jmp") {
            // handled by jump kind
        } else if (name === "jeqz") {
            (this as any).condition = null;
        } else if (name === "jnez") {
            (this as any).condition = null;
        } else if (CONDITION_JUMPS[name]) {
            const spec = CONDITION_JUMPS[name];
            (this as any).condition = {
                op: spec.op,
                operand: spec.withReg ? this.params[0] as StaticPandaVReg : null,
                nullCheck: spec.nullCheck === true,
            };
        } else if (this.kind === "mov") {
            this.initMov(name);
        } else if (this.kind === "load") {
            this.initLoad(name);
        } else if (this.kind === "store") {
            (this as any).destObj = this.params[0];
        } else if (this.kind === "binaryOp") {
            const spec = BINARY_SPECS[name];
            if (spec) {
                (this as any).op = spec.op;
                (this as any).binaryShape = spec.shape;
            }
        } else if (this.kind === "unary") {
            (this as any).op = UNARY_NAMES[name] ?? "";
        } else if (this.kind === "call") {
            this.initCall(name, opcode);
        } else if (this.kind === "initObj") {
            this.initCall(name, opcode);
            (this as any).callKind = "init";
        } else if (this.kind === "newObj") {
            (this as any).destObj = this.params[0];
            (this as any).typeClass = resolveTypeClass(opcode, this.params, method);
        } else if (this.kind === "newArray") {
            (this as any).destObj = this.params[0];
            (this as any).arrayIndexReg = this.params[1];
            (this as any).typeClass = resolveTypeClass(opcode, this.params, method);
        } else if (this.kind === "arrayLoad") {
            (this as any).arrayReg = this.params[0];
        } else if (this.kind === "arrayStore") {
            (this as any).arrayReg = this.params[0];
            (this as any).arrayIndexReg = this.params[1];
        } else if (this.kind === "arrayLength") {
            (this as any).arrayReg = this.params[0];
        } else if (this.kind === "fieldLoad" || this.kind === "fieldStore"
            || this.kind === "staticFieldLoad" || this.kind === "staticFieldStore") {
            this.initField(name, opcode);
        } else if (this.kind === "cast") {
            (this as any).typeClass = resolveTypeClass(opcode, this.params, method);
        } else if (this.kind === "instanceof") {
            (this as any).typeClass = resolveTypeClass(opcode, this.params, method);
        } else if (this.kind === "compare") {
            (this as any).op = name;
        }
    }

    private initMov(name: string): void {
        if (name === "mov.null" || name === "ets.movnullvalue") {
            (this as any).destObj = this.params[0];
            (this as any).loadType = "NULL";
            return;
        }
        (this as any).destObj = this.params[0];
        if (name === "movi" || name === "movi.64") {
            (this as any).loadType = "IMM";
            (this as any).loadParam = this.params[1];
            return;
        }
        if (name === "fmovi" || name === "fmovi.64") {
            (this as any).loadType = "FLOAT";
            (this as any).loadParam = this.params[1];
            return;
        }
        (this as any).srcObj = this.params[1];
    }

    private initLoad(name: string): void {
        const param = this.params[0];
        if (name === "lda.null" || name === "ets.ldnullvalue") {
            (this as any).loadType = "NULL";
            return;
        }
        if (name === "lda.str") {
            (this as any).loadType = "STRING";
            (this as any).loadParam = param;
            return;
        }
        if (name === "ldai" || name === "ldai.64" || name === "ldai.dyn") {
            (this as any).loadType = "IMM";
            (this as any).loadParam = param;
            return;
        }
        if (name === "fldai" || name === "fldai.64" || name === "fldai.dyn") {
            (this as any).loadType = "FLOAT";
            (this as any).loadParam = param;
            return;
        }
        if (name === "lda.type") {
            (this as any).loadType = "TYPE";
            (this as any).loadParam = param;
            return;
        }
        (this as any).loadType = "OBJECT";
        (this as any).loadParam = param;
    }

    private initCall(name: string, opcode: OpcodeInfo): void {
        const id = this.params[this.params.length - 1] as StaticPandaID;
        const method = id && id.kind === "METHOD" ? id.obj as PandaMethod : null;
        (this as any).callMethod = method;
        const declaredArgs = method ? protoParamCount(method) : -1;
        let regs = this.params.filter((p) => p instanceof StaticPandaVReg) as StaticPandaVReg[];

        // Range forms pass the arguments in consecutive registers starting at
        // the single source operand.
        const isRange = name === "call.range" || name === "call.virt.range" || name === "initobj.range";
        if (isRange && regs.length === 1 && declaredArgs >= 0) {
            const base = regs[0];
            let count = declaredArgs;
            if (name === "call.virt.range") count += 1;
            else if (name === "call.range" && method && !isStaticMethod(method)) count += 1;
            const expanded: StaticPandaVReg[] = [];
            for (let i = 0; i < count; i++) expanded.push(new StaticPandaVReg(base.index + i, this.method));
            regs = expanded;
        }
        const accPos = this.params.find((p) => p instanceof StaticPandaIMM) as StaticPandaIMM | undefined;

        const argsFor = (): any[] => {
            if (!accPos) return regs.slice();
            const pos = accPos.imm;
            const result: any[] = [];
            for (let i = 0; i < regs.length + 1; i++) {
                if (i < pos) result.push(regs[i]);
                else if (i === pos) result.push(new StaticPandaACC());
                else result.push(regs[i - 1]);
            }
            return result;
        };

        if (name.startsWith("call.virt")) {
            (this as any).callKind = "virtual";
            const args = declaredArgs >= 0 ? argsFor().slice(0, declaredArgs + 1) : argsFor();
            (this as any).callThis = args[0] ?? null;
            (this as any).callArgs = args.slice(1);
            return;
        }
        if (name.startsWith("ets.call.name")) {
            (this as any).callKind = "named";
            const args = declaredArgs >= 0 ? argsFor().slice(0, declaredArgs + 1) : argsFor();
            (this as any).callThis = args[0] ?? null;
            const named = id && id.obj instanceof PandaMethod ? (id.obj as PandaMethod).name.content : null;
            (this as any).callName = named;
            (this as any).callArgs = args.slice(1);
            return;
        }
        if (name.startsWith("any.call")) {
            (this as any).callKind = "any";
            const args = argsFor();
            (this as any).callThis = regs[0] ?? null;
            (this as any).callArgs = args.slice(1);
            return;
        }
        if (name.startsWith("initobj")) {
            (this as any).callKind = "init";
            (this as any).callThis = null;
            const args = declaredArgs >= 0 ? argsFor().slice(0, declaredArgs) : argsFor();
            (this as any).callArgs = args;
            return;
        }
        // `call` / `call.acc` are direct calls. When the resolved callee is an
        // instance method the first supplied value is its `this` (the compiler
        // devirtualizes instance calls into this form).
        if (method && !isStaticMethod(method)) {
            (this as any).callKind = "virtual";
            const args = declaredArgs >= 0 ? argsFor().slice(0, declaredArgs + 1) : argsFor();
            (this as any).callThis = args[0] ?? null;
            (this as any).callArgs = args.slice(1);
            return;
        }
        (this as any).callKind = "static";
        const args = declaredArgs >= 0 ? argsFor().slice(0, declaredArgs) : argsFor();
        (this as any).callArgs = args;
    }

    private initField(name: string, opcode: OpcodeInfo): void {
        const id = this.params.find((p) => p instanceof StaticPandaID) as StaticPandaID | undefined;
        const field = id && id.obj instanceof PandaField ? id.obj as PandaField : null;
        (this as any).field = field;
        (this as any).fieldName = field
            ? field.getName()
            : (id && id.obj instanceof PandaString ? (id.obj as PandaString).content : null);
        const clazz = field?.pandaClass ?? null;
        (this as any).fieldClassName = clazz ? simpleClassName(clazz.getClassName()) : null;
        (this as any).fieldIsStatic = name.startsWith("ldstatic") || name.startsWith("ststatic");
        const regs = this.params.filter((p) => p instanceof StaticPandaVReg) as StaticPandaVReg[];
        if (this.fieldIsStatic) {
            return;
        }
        if (name.startsWith("any.ldbyname.v")) {
            (this as any).destObj = regs[0] ?? null;
            (this as any).srcObj = regs[1] ?? null;
        } else if (name.startsWith("any.ldbyname")) {
            (this as any).srcObj = regs[0] ?? null;
        } else if (name.startsWith("any.stbyname.v")) {
            (this as any).valueReg = regs[0] ?? null;
            (this as any).srcObj = regs[1] ?? null;
        } else if (name.startsWith("any.stbyname")) {
            (this as any).srcObj = regs[0] ?? null;
        } else if (name.startsWith("ldobj.v")) {
            (this as any).destObj = regs[0] ?? null;
            (this as any).srcObj = regs[1] ?? null;
        } else if (name.startsWith("stobj.v")) {
            (this as any).valueReg = regs[0] ?? null;
            (this as any).srcObj = regs[1] ?? null;
        } else if (name.startsWith("ldobj")) {
            (this as any).srcObj = regs[0] ?? null;
        } else if (name.startsWith("stobj")) {
            (this as any).srcObj = regs[0] ?? null;
        } else if (name.startsWith("ets.ldobj.name.v")) {
            (this as any).destObj = regs[0] ?? null;
            (this as any).srcObj = regs[1] ?? null;
        } else if (name.startsWith("ets.ldobj.name")) {
            (this as any).srcObj = regs[0] ?? null;
        } else if (name.startsWith("ets.stobj.name.v")) {
            (this as any).valueReg = regs[0] ?? null;
            (this as any).srcObj = regs[1] ?? null;
        } else if (name.startsWith("ets.stobj.name")) {
            (this as any).srcObj = regs[0] ?? null;
        }
    }

    isJump(): boolean { return (this.opcode.flags & OPCODE_FLAG.JUMP) !== 0; }
    isConditional(): boolean { return (this.opcode.flags & OPCODE_FLAG.CONDITIONAL) !== 0; }
    isReturnIns(): boolean { return (this.opcode.flags & OPCODE_FLAG.RETURN) !== 0; }
    isThrowIns(): boolean { return this.opcode.name === "throw"; }
    isTerminator(): boolean { return this.isJump() || this.isReturnIns() || this.isThrowIns(); }

    instructionSize(): number {
        const opcodeSize = this.opcode.code >= LAST_INSTRUCTION_CODE ? 2 : 1;
        return opcodeSize + (FORMAT_PARAM_SIZE[this.opcode.format] ?? 0);
    }

    getPC(): number { return this.pc; }
    getFormat(): string { return this.opcode.format; }

    toString(): string {
        const parts = this.params.map((p) => p.toString());
        let s = this.pc + ":" + this.opcode.name + " || " + parts.join(", ");
        if (this.jumpKind) s += " [label_" + this.destinationPC + "]";
        return s;
    }
}

function classifyStaticKind(opcode: OpcodeInfo): StaticInstructionKind {
    const name = opcode.name;
    if (name === "nop") return "nop";
    if (opcode.flags & OPCODE_FLAG.JUMP) {
        if (name === "jmp") return "jumpDirect";
        if (name === "jeqz") return "jumpEqual";
        return "jumpNotEqual";
    }
    if (name === "mov" || name === "mov.64" || name === "mov.obj" || name === "mov.null"
        || name === "movi" || name === "movi.64" || name === "fmovi" || name === "fmovi.64"
        || name === "mov.dyn") return "mov";
    // Array ops before the accumulator load/store families (`ldarr` starts with
    // `lda`, `starr` with `sta`).
    if (name.startsWith("ldarr") || name.startsWith("ldarru") || name.startsWith("fldarr")) return "arrayLoad";
    if (name.startsWith("starr") || name.startsWith("fstarr")) return "arrayStore";
    if (name === "sta" || name === "sta.64" || name === "sta.obj" || name === "sta.dyn") return "store";
    if (name.startsWith("lda") || name.startsWith("ldai") || name.startsWith("fldai")) return "load";
    if (name === "throw") return "throw";
    if (opcode.flags & OPCODE_FLAG.RETURN) return "return";
    if (name.startsWith("newobj")) return "newObj";
    if (name.startsWith("initobj")) return "initObj";
    if (name === "newarr") return "newArray";
    if (name === "lenarr") return "arrayLength";
    if (name.startsWith("ldobj") || name.startsWith("ldstatic") || name.startsWith("ets.ldobj")
        || name === "any.ldbyname" || name === "any.ldbyname.v") return "fieldLoad";
    if (name.startsWith("stobj") || name.startsWith("ststatic") || name.startsWith("ets.stobj.name")
        || name === "any.stbyname" || name === "any.stbyname.v") return "fieldStore";
    if (name === "any.ldbyidx" || name === "any.ldbyval") return "arrayLoad";
    if (name === "any.stbyidx" || name === "any.stbyval") return "arrayStore";
    if (name === "checkcast" || name === "checkcast.nonnull") return "cast";
    if (name === "isinstance" || name === "any.isinstance") return "instanceof";
    if (name === "ets.nullcheck") return "nullCheck";
    if (name.startsWith("ets.async")) return "async";
    if (name.startsWith("cmp") || name.startsWith("ucmp") || name.startsWith("fcmp")) return "compare";
    if (BINARY_SPECS[name] || name === "inci") return "binaryOp";
    if (UNARY_NAMES[name] || CONVERSION_NAMES.has(name)) return "unary";
    if (opcode.flags & (OPCODE_FLAG.CALL | OPCODE_FLAG.CALL_VIRT | OPCODE_FLAG.ANY_CALL)) return "call";
    if (name.startsWith("ets.call.name")) return "call";
    if (name === "ets.istrue" || name === "ets.equals" || name === "ets.strictequals"
        || name === "ets.typeof" || name === "ets.isnullvalue") return "unary";
    if (name === "ets.movnullvalue") return "mov";
    if (name === "ets.ldnullvalue") return "load";
    return "unknown";
}

function parseParams(opcode: OpcodeInfo, param: Uint8Array, method: PandaMethod): any[] {
    const dv = new DataView(param.buffer, param.byteOffset, param.byteLength);
    const list: any[] = [];
    let index = 0;
    for (const operand of opcode.operands) {
        const bits = operand.bits;
        if (operand.kind === "v") {
            if (bits === 4) {
                const byte = dv.getUint8(index);
                // Static ArkTS-Sta packs the first 4-bit operand in the low
                // nibble (BytecodeInst::Read<OFFSET> shifts by OFFSET % 8).
                const shift = list.length % 2 === 0 ? 0 : 4;
                list.push(new StaticPandaVReg((byte >> shift) & 0xf, method));
                if (shift === 4) index++;
            } else if (bits === 8) {
                list.push(new StaticPandaVReg(dv.getUint8(index), method));
                index++;
            } else if (bits === 16) {
                list.push(new StaticPandaVReg(dv.getUint16(index, true), method));
                index += 2;
            } else {
                throw new PandaParseException("unsupported vreg width " + bits);
            }
        } else if (operand.kind === "imm") {
            if (bits === 4) {
                const byte = dv.getUint8(index);
                const shift = list.length % 2 === 0 ? 0 : 4;
                let nibble = (byte >> shift) & 0xf;
                // 4-bit immediates are two's-complement when the signature type
                // is signed (e.g. `inci v, -1` is encoded as 0xf).
                if (operand.signed && (nibble & 0x8) !== 0) nibble -= 16;
                list.push(new StaticPandaIMM(nibble));
                if (shift === 4) index++;
            } else if (bits === 8) {
                list.push(new StaticPandaIMM(operand.signed ? dv.getInt8(index) : dv.getUint8(index)));
                index++;
            } else if (bits === 16) {
                list.push(new StaticPandaIMM(operand.signed ? dv.getInt16(index, true) : dv.getUint16(index, true)));
                index += 2;
            } else if (bits === 32) {
                if (operand.float) {
                    list.push(new StaticPandaIMM(dv.getFloat32(index, true)));
                } else {
                    list.push(new StaticPandaIMM(operand.signed ? dv.getInt32(index, true) : dv.getUint32(index, true)));
                }
                index += 4;
            } else if (bits === 64) {
                list.push(new StaticPandaIMM(operand.float ? dv.getFloat64(index, true) : Number(dv.getBigInt64(index, true))));
                index += 8;
            } else {
                throw new PandaParseException("unsupported imm width " + bits);
            }
        } else {
            const raw = bits === 16 ? dv.getUint16(index, true) : dv.getUint32(index, true);
            index += bits / 8;
            list.push(new StaticPandaID(opcode, raw, method));
        }
    }
    return list;
}

function computeDestinationPC(pc: number, params: any[]): number {
    for (let i = params.length - 1; i >= 0; i--) {
        if (params[i] instanceof StaticPandaIMM) return pc + params[i].imm;
    }
    throw new PandaParseException("jump instruction has no imm offset");
}

function isStaticMethod(method: PandaMethod): boolean {
    return (method.accessFlag & ACC_STATIC) !== 0;
}

/** Number of params declared by the prototype (including `this` for instance methods). */
export function protoParamCount(method: PandaMethod): number {
    return method.pandaProto ? method.pandaProto.pandaRawTypes.length - 1 : 0;
}

function resolveTypeClass(opcode: OpcodeInfo, params: any[], method: PandaMethod): PandaClass | null {
    const id = params.find((p) => p instanceof StaticPandaID) as StaticPandaID | undefined;
    if (!id || !(id.obj instanceof PandaClass)) return null;
    return id.obj as PandaClass;
}

export function decodeStaticInstruction(pc: number, bytes: Uint8Array, method: PandaMethod): { instruction: StaticPandaInstruction | null; nextPC: number } {
    let cursor = pc;
    let primary = bytes[cursor++] & 0xff;
    if (primary >= LAST_INSTRUCTION_CODE) {
        const secondary = bytes[cursor++] & 0xff;
        primary = primary | (secondary << 8);
    }
    const opcode = OPCODE_BY_CODE.get(primary);
    if (!opcode) {
        return { instruction: null, nextPC: cursor };
    }
    const paramSize = FORMAT_PARAM_SIZE[opcode.format] ?? 0;
    const instruction = new StaticPandaInstruction(pc, opcode, bytes.subarray(cursor, cursor + paramSize), method);
    return { instruction, nextPC: cursor + paramSize };
}
