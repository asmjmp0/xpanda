import type { OpcodeInfo } from "./opcodes";
import { OPCODE_FLAG, LAST_INSTRUCTION_CODE, FORMAT_PARAM_SIZE } from "./opcodes";
import { PandaParseException } from "../PandaParseException";
import type { PandaMethod } from "../file/method/PandaMethod";
import { PandaString } from "../file/desc/PandaString";
import { PandaMethod as PandaMethodClass } from "../file/method/PandaMethod";
import { PandaLiteralArray } from "../file/literal/PandaLiteralArray";
import { PandaField } from "../file/field/PandaField";
import { PandaLiteral } from "../file/literal/PandaLiteral";
import { Offset } from "../file/desc/Offset";
import { PandaClassImportModule, PandaClassExportModule } from "../file/clazz/PandaClass";

/**
 * 统一的数据驱动指令模型,替代 Java 版约 200 个指令子类。
 * Java 版按类层次分发 handle,这里以 kind 字段等价表达。
 * @Author: jmp0
 */

export type InstructionKind =
    // doNothing 组
    | "nop" | "doNothing" | "throwIf" | "assert"
    // 跳转
    | "jumpDirect" | "jumpEqual" | "jumpNotEqual" | "jumpPlain"
    // 基础数据流
    | "mov" | "load" | "store" | "return" | "binaryOp" | "unary"
    // 调用
    | "call" | "superCall" | "superCallSpread" | "callRuntime" | "throw"
    // 定义
    | "defineFunc" | "defineClassWithBuffer" | "defineGetterSetterByValue"
    // 对象/数组创建
    | "createObject" | "createArray" | "newObjRange" | "newObjSpread"
    // 属性访问
    | "loadObjectBy" | "storeObject" | "storeByIndex" | "storeArraySpread"
    | "deleteObjProp" | "loadSuper" | "loadSuperObj" | "storeSuperObj"
    | "setObjectWithProto" | "copyDataProperties" | "copyRestArgs"
    // 全局记录
    | "storeObjectRecord" | "loadGlobal"
    // 模块
    | "storeModuleVar" | "loadModuleVar" | "loadExternalModuleVar"
    // 词法环境
    | "newLexEnv" | "storeLex" | "loadLex" | "popLexEnv"
    // 迭代器/异步/生成器
    | "getIterator" | "getNextPropName" | "async" | "generator" | "createGeneratorObj"
    // 未处理(触发 SimpleAnalysis 降级)
    | "unknown";

export const UNHANDLED_KINDS: ReadonlySet<InstructionKind> = new Set<InstructionKind>([
    "nop", "doNothing", "throwIf", "assert",
    "jumpDirect", "jumpEqual", "jumpNotEqual",
]);

// ---------------------------------------------------------------------------
// 指令参数
// ---------------------------------------------------------------------------

export class PandaInstructionIMM {
    constructor(readonly imm: number) {}
    toString(): string { return String(this.imm); }
}

export class PandaInstructionVReg {
    readonly index: number;
    readonly type: "VREG" | "PARAM";

    constructor(index: number, method: PandaMethod, forcedType?: "VREG" | "PARAM") {
        if (forcedType) {
            this.index = index;
            this.type = forcedType;
            return;
        }
        const numParams = method.methodCode!.numArgs;
        const numVRegs = method.methodCode!.numVregs;
        if (index > numParams + numVRegs) throw new PandaParseException("index over size!");
        if (index >= numVRegs) {
            this.index = index - numVRegs;
            this.type = "PARAM";
        } else {
            this.index = index;
            this.type = "VREG";
        }
    }

    toString(): string {
        if (this.type === "PARAM") {
            // func_name new.target this
            if (this.index < 3) return "panda_jmp0_reserved_param_p" + this.index;
            return "p" + (this.index - 3);
        }
        return "v" + this.index;
    }
}

export type IDType = "TYPE" | "METHOD" | "STRING" | "LITERALARRAY" | "FIELD";

export class PandaInstructionID {
    readonly type: IDType;
    readonly obj: Offset | null = null;

    constructor(opcode: OpcodeInfo, paramIndex: number, id: number, method: PandaMethod) {
        if (opcode.name === "defineclasswithbuffer" || opcode.name === "callruntime.definesendableclass") {
            if (paramIndex === 1) this.type = "METHOD";
            else if (paramIndex === 2) this.type = "LITERALARRAY";
            else throw new PandaParseException("paramIndex not matched");
        } else if (opcode.flags & OPCODE_FLAG.TYPE_ID) {
            this.type = "TYPE";
        } else if (opcode.flags & OPCODE_FLAG.METHOD_ID) {
            this.type = "METHOD";
        } else if (opcode.flags & OPCODE_FLAG.STRING_ID) {
            this.type = "STRING";
        } else if (opcode.flags & OPCODE_FLAG.LITERALARRAY_ID) {
            this.type = "LITERALARRAY";
        } else if (opcode.flags & OPCODE_FLAG.FIELD_ID) {
            this.type = "FIELD";
        } else {
            throw new PandaParseException("can not find id from the types enum");
        }
        const indexHeader = method.indexHeader;
        if (!indexHeader) return;
        switch (this.type) {
            case "TYPE":
                break; // fixme(与 Java 一致)
            case "FIELD": {
                const offset = indexHeader.pandaFields![id];
                this.obj = PandaField.create(method.getPandaFile()!, offset.getOffset());
                break;
            }
            case "METHOD": {
                const offset = indexHeader.pandaMethods[id];
                this.obj = PandaMethodClass.create(method.getPandaFile()!, offset.getOffset());
                break;
            }
            case "STRING": {
                const offset = indexHeader.pandaMethods[id];
                this.obj = PandaString.create(method.getPandaFile()!, offset.getOffset());
                break;
            }
            case "LITERALARRAY": {
                const offset = indexHeader.pandaMethods[id];
                this.obj = PandaLiteralArray.create(method.getPandaFile()!, offset.getOffset());
                break;
            }
        }
    }

    toString(): string {
        switch (this.type) {
            case "TYPE": return "";
            case "LITERALARRAY": return "array:" + (this.obj ? this.obj.toString() : "");
            default: return this.obj ? this.obj.toString() : "";
        }
    }
}

/** acc 占位参数(Java PandaInstructionACC) */
export class PandaInstructionACC {
    type: "OBJECT" | "STRING" | "BIGINT" | "NAN" | "HOLE" | "INFINITY" | "UNDEFINED" | "NULL" | "TRUE" | "FALSE" | "SYMBOL" | "THIS" | "GLOBAL" | "ARGUMENTS" = "OBJECT";
    obj: any = null;
    toString(): string {
        if (this.type === "GLOBAL") return "globalThis";
        if (this.obj === null) return "acc";
        if (this.type === "OBJECT") return this.obj.toString();
        return this.type.toLowerCase();
    }
}

// ---------------------------------------------------------------------------
// kind 名称表:opcode.name -> kind
// ---------------------------------------------------------------------------

function buildKindMap(): Map<string, InstructionKind> {
    const m = new Map<string, InstructionKind>();
    const put = (kind: InstructionKind, ...names: string[]) => { for (const n of names) m.set(n, kind); };

    put("nop", "nop");
    put("doNothing", "callruntime.topropertykey", "debugger");
    put("throwIf",
        "throw.notexists", "throw.patternnoncoercible", "throw.deletesuperproperty",
        "throw.constassignment", "throw.ifnotobject", "throw.undefinedifhole",
        "throw.ifthsupernotcorrectcall", "throw.ifsupernotcorrectcall");
    put("assert", "throw.undefinedifholewithname");

    put("jumpDirect", "jmp");
    put("jumpEqual", "jeqz");
    put("jumpNotEqual", "jnez");
    // 其余 jump-flag 指令(如 jstricteqz、jeqnull、jeq.v8 家族)在 Java 中同样没有注册 handle

    put("mov", "mov");
    put("store", "sta");
    put("return", "return", "returnundefined");
    put("binaryOp",
        "add2", "sub2", "mul2", "div2", "mod2",
        "eq", "noteq", "less", "lesseq", "greater", "greatereq",
        "shl2", "shr2", "ashr2", "and2", "or2", "xor2", "exp",
        "instanceof", "isin", "stricteq", "strictnoteq");
    put("unary", "typeof", "tonumber", "tonumeric", "neg", "not", "inc", "dec", "istrue", "isfalse");

    put("call", "callarg0", "callarg1", "callargs1", "callargs2", "callargs3",
        "callrange", "wide.callrange", "callthis0", "callthis1", "callthis2", "callthis3",
        "callthisrange", "wide.callthisrange", "apply",
        "callthis0withname", "callthis1withname", "callthis2withname", "callthis3withname",
        "callthisrangewithname", "wide.callthisrangewithname");
    put("superCall", "supercallthisrange", "supercallarrowrange",
        "wide.supercallthisrange", "wide.supercallarrowrange");
    put("superCallSpread", "supercallspread");
    put("callRuntime",
        "callruntime.callinit", "callruntime.isfalse", "callruntime.istrue",
        "callruntime.notifyconcurrentresult", "callruntime.definefieldbyindex", "callruntime.definefieldbyvalue");
    put("throw", "throw");

    put("defineFunc", "definefunc", "definemethod");
    put("defineClassWithBuffer", "defineclasswithbuffer", "callruntime.definesendableclass");
    put("defineGetterSetterByValue", "definegettersetterbyvalue");

    put("createObject", "createemptyobject", "createobjectwithbuffer", "createobjectwithexcludedkeys", "wide.createobjectwithexcludedkeys");
    put("createArray", "createemptyarray", "createarraywithbuffer");
    put("newObjRange", "newobjrange");
    put("newObjSpread", "newobjapply");

    put("loadObjectBy", "ldobjbyvalue", "ldobjbyname", "ldobjbyindex", "ldglobalvar", "dynamicimport");
    put("loadGlobal", "tryldglobalbyname");
    put("storeObject",
        "stobjbyvalue", "stobjbyname", "stobjbyindex",
        "stownbyvalue", "stownbyname", "stownbyvaluewithnameset",
        "stglobalvar", "trystglobalbyname",
        "definefieldname", "definepropertybyname",
        "callruntime.definefieldbyindex", "callruntime.definefieldbyvalue");
    put("storeByIndex", "stownbyindex", "wide.stownbyindex");
    put("storeArraySpread", "starrayspread");
    put("storeObjectRecord", "sttoglobalrecord", "stconsttoglobalrecord");
    put("deleteObjProp", "delobjprop");
    put("loadSuper", "ldsuperbyname");
    put("loadSuperObj", "ldsuperbyvalue");
    put("storeSuperObj", "stsuperbyname");
    put("setObjectWithProto", "setobjectwithproto");
    put("copyDataProperties", "copydataproperties");
    put("copyRestArgs", "copyrestargs", "wide.copyrestargs");

    put("storeModuleVar", "stmodulevar", "wide.stmodulevar");
    put("loadModuleVar", "ldlocalmodulevar", "wide.ldlocalmodulevar");
    put("loadExternalModuleVar",
        "ldexternalmodulevar", "wide.ldexternalmodulevar",
        "callruntime.ldlazymodulevar", "callruntime.wideldlazymodulevar",
        "callruntime.ldsendableexternalmodulevar", "callruntime.wideldsendableexternalmodulevar",
        "callruntime.ldlazysendablemodulevar", "callruntime.wideldlazysendablemodulevar",
        "getmodulenamespace", "wide.getmodulenamespace");

    put("newLexEnv", "newlexenv", "newlexenvwithname", "wide.newlexenv", "wide.newlexenvwithname",
        "callruntime.newsendableenv", "callruntime.widenewsendableenv");
    put("storeLex", "stlexvar", "wide.stlexvar", "callruntime.stsendablevar", "callruntime.widestsendablevar");
    put("loadLex", "ldlexvar", "wide.ldlexvar", "callruntime.ldsendablevar", "callruntime.wideldsendablevar");
    put("popLexEnv", "poplexenv");

    put("getIterator", "getiterator", "getpropiterator");
    put("getNextPropName", "getnextpropname");
    put("async", "asyncfunctionenter", "asyncfunctionresolve", "asyncfunctionreject", "asyncfunctionawaituncaught");
    put("generator", "suspendgenerator", "resumegenerator", "getresumemode");
    put("createGeneratorObj", "creategeneratorobj", "createiterresultobj");

    // load 家族(单独处理类型)
    put("load",
        "fldai", "ldai", "lda.str", "lda", "ldbigint",
        "ldfalse", "ldglobal", "ldhole", "ldinfinity", "ldnan", "ldnull",
        "ldthis", "ldtrue", "ldundefined", "ldnewtarget", "ldfunction", "ldsymbol",
        "getunmappedargs", "callruntime.ldsendableclass");

    return m;
}

export const KIND_MAP: Map<string, InstructionKind> = buildKindMap();

// 二元运算符映射(Java BinaryOperationPandaInstruction.TYPE)
const BINARY_OPS: Record<string, string> = {
    add2: "+", sub2: "-", mul2: "*", div2: "/", mod2: "%",
    less: "<", lesseq: "<=", greater: ">", greatereq: ">=",
    eq: "==", noteq: "!=",
    instanceof: "instanceof", isin: "in",
    stricteq: "===", strictnoteq: "!==",
    shl2: "<<", shr2: ">>>", ashr2: ">>",
    and2: "&", or2: "|", xor2: "^", exp: "**",
};
const COMPARE_OPS = new Set(["<", "<=", ">", ">=", "==", "!=", "===", "!==", "instanceof", "in"]);

const UNARY_OPS: Record<string, string> = {
    typeof: "typeof", tonumber: "", tonumeric: "",
    neg: "-", not: "~", inc: "++", dec: "--",
    istrue: "!!", isfalse: "!",
};

const CALLRUNTIME_TYPES: Record<string, "NONE" | "CALL_INIT" | "IS_FALSE" | "IS_TRUE"> = {
    "callruntime.callinit": "CALL_INIT",
    "callruntime.isfalse": "IS_FALSE",
    "callruntime.istrue": "IS_TRUE",
};

// ---------------------------------------------------------------------------
// 指令
// ---------------------------------------------------------------------------

export interface DefineClassMethodDescription {
    protoMethodName: string;
    method: PandaMethod;
    paramSize: number;
}

export interface SendClassVariableDescription {
    variableName: string;
    variableValue: PandaLiteral;
}

export class PandaInstruction {
    readonly kind: InstructionKind;
    readonly params: any[];

    // 语义字段(按 kind 取用)
    readonly jumpKind: "direct" | "equal" | "notequal" | "plain" | null = null;
    readonly destinationPC = 0;
    // load
    readonly loadType: string = "OBJECT";
    readonly loadParam: any = null;
    readonly isSendAble = false;
    // mov/store
    readonly destObj: PandaInstructionVReg | null = null;
    readonly srcObj: PandaInstructionVReg | null = null;
    // binary/unary
    readonly op: string = "";
    readonly isCompareOp = false;
    // call
    readonly thisObj: any = null;
    readonly callParams: any[] = [];
    readonly apply = false;
    // callruntime
    readonly runtimeType: "NONE" | "CALL_INIT" | "IS_FALSE" | "IS_TRUE" = "NONE";
    // define
    readonly func: PandaMethod | null = null;
    readonly paramSize: number | null = null;
    readonly constructorMethod: PandaMethod | null = null;
    readonly constructorParamSize: number = 0;
    readonly protoReg: PandaInstructionVReg | null = null;
    readonly methodDescriptions: DefineClassMethodDescription[] = [];
    readonly staticMethodDescriptions: DefineClassMethodDescription[] = [];
    readonly isSendClass = false;
    readonly sendClassVariableDescriptions: SendClassVariableDescription[] = [];
    // create
    readonly objMap: Map<string, Offset> = new Map();
    readonly isExcludeObject = false;
    readonly excludeIndex: PandaInstructionIMM | null = null;
    readonly excludeFormObj: PandaInstructionVReg | null = null;
    readonly excludeObj: PandaInstructionVReg | null = null;
    readonly initArr: Offset[] | null = null;
    // new
    readonly objectVReg: PandaInstructionVReg | null = null;
    readonly paramsVReg: PandaInstructionVReg[] = [];
    readonly cotr: PandaInstructionVReg | null = null;
    // 属性访问
    readonly ldObj: any = null;
    readonly isGlobalLd = false;
    readonly isDynamicImport = false;
    readonly storeKeyObj: any = null;
    readonly storeKey: any = null;
    readonly arr: PandaInstructionVReg | null = null;
    readonly arrIndex: number | null = null;
    readonly recordType: "const" | "let" = "let";
    readonly superFuncName: string = "";
    readonly superProp: PandaString | null = null;
    readonly globalName: PandaString | null = null;
    // 模块
    readonly module: PandaClassImportModule | PandaClassExportModule | null = null;
    // 词法
    readonly lexLevel = 0;
    readonly lexIndex = 0;
    readonly lexImm = 0;
    // 迭代器/异步/生成器
    readonly isPropIterator = false;
    readonly iteratorReg: PandaInstructionVReg | null = null;
    readonly asyncType: string = "";
    readonly generatorType: string = "";
    readonly yieldReg: PandaInstructionVReg | null = null;
    // getter/setter
    readonly getterReg: PandaInstructionVReg | null = null;
    readonly setterReg: PandaInstructionVReg | null = null;
    // assert
    readonly typeString: PandaString | null = null;

    constructor(readonly pc: number, readonly opcode: OpcodeInfo, param: Uint8Array, method: PandaMethod) {
        this.params = parseParamByFormat(opcode, param, method);
        this.kind = classifyKind(opcode);

        // jeq / jne / jstricteq / jnstricteq 家族在 Java 中未实现(JEQ_V8 等构造器直接抛异常)
        if (this.kind === "jumpPlain"
            && (opcode.name === "jeq" || opcode.name === "jne" || opcode.name === "jstricteq" || opcode.name === "jnstricteq")) {
            throw new PandaParseException(opcode.name + "PandaInstruction not implemented");
        }

        switch (this.kind) {
            case "jumpDirect":
            case "jumpEqual":
            case "jumpNotEqual":
            case "jumpPlain": {
                const jumpKind = this.kind === "jumpDirect" ? "direct"
                    : this.kind === "jumpEqual" ? "equal"
                        : this.kind === "jumpNotEqual" ? "notequal" : "plain";
                (this as any).jumpKind = jumpKind;
                (this as any).destinationPC = computeDestinationPC(pc, this.params);
                break;
            }
            case "load": this.initLoad(opcode, method); break;
            case "store": (this as any).destObj = this.params[0] as PandaInstructionVReg; break;
            case "mov": {
                (this as any).destObj = this.params[0];
                (this as any).srcObj = this.params[1];
                break;
            }
            case "binaryOp": {
                const base = baseName(opcode.name);
                (this as any).op = BINARY_OPS[base];
                (this as any).isCompareOp = COMPARE_OPS.has(BINARY_OPS[base]);
                break;
            }
            case "unary": (this as any).op = UNARY_OPS[baseName(opcode.name)]; break;
            case "call": this.initCall(opcode, method); break;
            case "superCall": this.initSuperCall(method); break;
            case "superCallSpread": (this as any).arr = this.params[1]; break;
            case "callRuntime": (this as any).runtimeType = CALLRUNTIME_TYPES[opcode.name] ?? "NONE"; break;
            case "throw": break;
            case "defineFunc": {
                (this as any).func = (this.params[1] as PandaInstructionID).obj as PandaMethod;
                (this as any).paramSize = (this.params[2] as PandaInstructionIMM).imm;
                break;
            }
            case "defineClassWithBuffer": this.initDefineClass(opcode); break;
            case "defineGetterSetterByValue": {
                (this as any).destObj = this.params[0];
                (this as any).srcObj = this.params[1]; // prop
                (this as any).getterReg = this.params[2];
                (this as any).setterReg = this.params[3];
                break;
            }
            case "createObject": this.initCreateObject(opcode); break;
            case "createArray": {
                if (opcode.name === "createemptyarray") {
                    (this as any).initArr = null;
                } else {
                    const id = this.params[1] as PandaInstructionID;
                    (this as any).initArr = (id.obj as PandaLiteralArray).getLiterals();
                }
                break;
            }
            case "newObjRange": {
                const argSize = (this.params[1] as PandaInstructionIMM).imm;
                (this as any).objectVReg = this.params[2];
                const arr: PandaInstructionVReg[] = [];
                for (let i = 0; i < argSize - 1; i++) {
                    arr.push(new PandaInstructionVReg((this.params[2] as PandaInstructionVReg).index + i + 1, method, "VREG"));
                }
                (this as any).paramsVReg = arr;
                break;
            }
            case "newObjSpread": (this as any).cotr = this.params[1]; break;
            case "loadObjectBy": this.initLoadObjectBy(opcode); break;
            case "storeObject": this.initStoreObject(opcode); break;
            case "storeByIndex": {
                if (opcode.name === "wide.stownbyindex") {
                    (this as any).arr = this.params[0];
                    (this as any).arrIndex = (this.params[1] as PandaInstructionIMM).imm;
                } else {
                    (this as any).arr = this.params[1];
                    (this as any).arrIndex = (this.params[2] as PandaInstructionIMM).imm;
                }
                break;
            }
            case "storeArraySpread": {
                (this as any).destObj = this.params[0];
                (this as any).srcObj = this.params[1]; // index reg
                break;
            }
            case "storeObjectRecord": {
                (this as any).recordType = opcode.name === "stconsttoglobalrecord" ? "const" : "let";
                (this as any).storeKey = this.params[1];
                break;
            }
            case "deleteObjProp": (this as any).destObj = this.params[0]; break;
            case "loadSuper": (this as any).superFuncName = ((this.params[1] as PandaInstructionID).obj as PandaString).content; break;
            case "loadSuperObj": (this as any).destObj = this.params[1]; break;
            case "storeSuperObj": {
                (this as any).superProp = (this.params[1] as PandaInstructionID).obj as PandaString;
                (this as any).destObj = this.params[2];
                break;
            }
            case "setObjectWithProto": (this as any).protoReg = this.params[1]; break;
            case "copyDataProperties": (this as any).destObj = this.params[0]; break;
            case "storeModuleVar":
            case "loadModuleVar": {
                const index = (this.params[0] as PandaInstructionIMM).imm;
                const moduleData = method.getParent()?.pandaClassModuleData;
                if (!moduleData) throw new PandaParseException("method has no module data for " + opcode.name);
                (this as any).module = moduleData.exports[index];
                break;
            }
            case "loadExternalModuleVar": this.initLoadExternalModuleVar(opcode, method); break;
            case "loadGlobal": (this as any).globalName = ((this.params[1] as PandaInstructionID).obj as PandaString); break;
            case "newLexEnv": {
                (this as any).lexImm = (this.params[0] as PandaInstructionIMM).imm;
                // 注意 wide 变体的名字是 callruntime.widenewsendableenv,不以前者开头
                (this as any).isSendAble = opcode.name === "callruntime.newsendableenv"
                    || opcode.name === "callruntime.widenewsendableenv";
                break;
            }
            case "storeLex":
            case "loadLex": {
                (this as any).lexLevel = (this.params[0] as PandaInstructionIMM).imm;
                (this as any).lexIndex = (this.params[1] as PandaInstructionIMM).imm;
                (this as any).isSendAble = opcode.name.startsWith("callruntime.");
                break;
            }
            case "popLexEnv": break;
            case "getIterator": (this as any).isPropIterator = opcode.name === "getpropiterator"; break;
            case "getNextPropName": (this as any).iteratorReg = this.params[0]; break;
            case "async": (this as any).asyncType = opcode.name; break;
            case "generator": (this as any).generatorType = opcode.name; break;
            case "createGeneratorObj": {
                if (opcode.name === "createiterresultobj") (this as any).yieldReg = this.params[1];
                break;
            }
            case "assert": (this as any).typeString = (this.params[0] as PandaInstructionID).obj as PandaString; break;
            default:
                break;
        }
    }

    private initLoad(opcode: OpcodeInfo, _method: PandaMethod): void {
        const name = opcode.name;
        let type = "OBJECT";
        let param: any = null;
        if (name === "lda.str") { type = "STRING"; param = this.params[0]; }
        else if (name === "ldai") { type = "OBJECT"; param = this.params[0]; }
        else if (name === "fldai") { type = "OBJECT"; param = this.params[0]; }
        else if (name === "ldbigint") { type = "BIGINT"; param = this.params[0]; }
        else if (name === "ldtrue") type = "TRUE";
        else if (name === "ldfalse") type = "FALSE";
        else if (name === "ldnull") type = "NULL";
        else if (name === "ldundefined") type = "UNDEFINED";
        else if (name === "ldhole") type = "HOLE";
        else if (name === "ldnan") type = "NAN";
        else if (name === "ldinfinity") type = "INFINITY";
        else if (name === "ldsymbol") type = "SYMBOL";
        else if (name === "ldthis") type = "THIS";
        else if (name === "ldglobal") type = "GLOBAL";
        else if (name === "getunmappedargs") type = "ARGUMENTS";
        else if (name === "lda") { type = "OBJECT"; param = this.params[0]; }
        (this as any).loadType = type;
        (this as any).loadParam = param;
        (this as any).isSendAble = name === "callruntime.ldsendableclass";
    }

    /** load 的 Java selfToString 等价实现 */
    loadSelfToString(): string {
        if (this.isSendAble) return "this";
        const type = this.loadType;
        if (type === "BIGINT" || type === "STRING") return ((this.loadParam as PandaInstructionID).obj as PandaString).content;
        if (type === "NAN") return "NaN";
        if (type === "INFINITY") return "Infinity";
        if (type === "GLOBAL") return "globalThis";
        if (type !== "OBJECT") return type.toLowerCase();
        return this.loadParam ? this.loadParam.toString() : "arguments";
    }

    private initCall(opcode: OpcodeInfo, method: PandaMethod): void {
        const name = opcode.name;
        if (name === "callarg0") {
            (this as any).thisObj = null;
            (this as any).callParams = [];
        } else if (name === "callarg1" || name === "callargs1") {
            (this as any).thisObj = null;
            (this as any).callParams = [this.params[1]];
        } else if (name === "callargs2") {
            (this as any).thisObj = null;
            (this as any).callParams = [this.params[1], this.params[2]];
        } else if (name === "callargs3") {
            (this as any).thisObj = null;
            (this as any).callParams = [this.params[1], this.params[2], this.params[3]];
        } else if (name === "callrange") {
            (this as any).thisObj = null;
            const size = (this.params[1] as PandaInstructionIMM).imm;
            const base = this.params[2] as PandaInstructionVReg;
            (this as any).callParams = rangeVRegs(method, base.index, size);
        } else if (name === "wide.callrange") {
            // 格式 PREF_IMM16_V8:操作数为 [size, base]
            (this as any).thisObj = null;
            const size = (this.params[0] as PandaInstructionIMM).imm;
            const base = this.params[1] as PandaInstructionVReg;
            (this as any).callParams = rangeVRegs(method, base.index, size);
        } else if (name === "callthis0") {
            (this as any).thisObj = this.params[1];
            (this as any).callParams = [];
        } else if (name === "callthis1") {
            (this as any).thisObj = this.params[1];
            (this as any).callParams = [this.params[2]];
        } else if (name === "callthis2") {
            (this as any).thisObj = this.params[1];
            (this as any).callParams = [this.params[2], this.params[3]];
        } else if (name === "callthis3") {
            (this as any).thisObj = this.params[1];
            (this as any).callParams = [this.params[2], this.params[3], this.params[4]];
        } else if (name === "callthisrange") {
            // 格式 IMM8_IMM8_V8:操作数为 [ic, size, this],size 为实参个数(regs 从 thisObj+1 开始)
            const thisObj = this.params[2] as PandaInstructionVReg;
            (this as any).thisObj = thisObj;
            const size = (this.params[1] as PandaInstructionIMM).imm;
            (this as any).callParams = rangeVRegs(method, thisObj.index + 1, size);
        } else if (name === "wide.callthisrange") {
            // 格式 PREF_IMM16_V8:操作数为 [size, this]
            const thisObj = this.params[1] as PandaInstructionVReg;
            (this as any).thisObj = thisObj;
            const size = (this.params[0] as PandaInstructionIMM).imm;
            (this as any).callParams = rangeVRegs(method, thisObj.index + 1, size);
        } else if (name === "apply") {
            (this as any).thisObj = this.params[1];
            (this as any).callParams = [this.params[2]];
            (this as any).apply = true;
        } else if (name === "callthis0withname") {
            // withname 系列:运行时语义与对应无 name 版本一致(acc=函数对象,v=this),
            // string_id 仅供运行时 IC/报错信息使用,不影响反编译输出。
            // 格式 IMM8_ID16_V8:操作数为 [ic, name, this]
            (this as any).thisObj = this.params[2];
            (this as any).callParams = [];
        } else if (name === "callthis1withname") {
            // 格式 IMM8_ID16_V8_V8:操作数为 [ic, name, this, a0]
            (this as any).thisObj = this.params[2];
            (this as any).callParams = [this.params[3]];
        } else if (name === "callthis2withname") {
            // 格式 IMM8_ID16_V8_V8_V8:操作数为 [ic, name, this, a0, a1]
            (this as any).thisObj = this.params[2];
            (this as any).callParams = [this.params[3], this.params[4]];
        } else if (name === "callthis3withname") {
            // 格式 IMM8_ID16_V8_V8_V8_V8:操作数为 [ic, name, this, a0, a1, a2]
            (this as any).thisObj = this.params[2];
            (this as any).callParams = [this.params[3], this.params[4], this.params[5]];
        } else if (name === "callthisrangewithname") {
            // 格式 IMM8_IMM8_ID16_V8:操作数为 [ic, size, name, this],size 为实参个数
            const thisObj = this.params[3] as PandaInstructionVReg;
            (this as any).thisObj = thisObj;
            const size = (this.params[1] as PandaInstructionIMM).imm;
            (this as any).callParams = rangeVRegs(method, thisObj.index + 1, size);
        } else if (name === "wide.callthisrangewithname") {
            // 格式 PREF_IMM16_ID16_V8:操作数为 [size, name, this]
            const thisObj = this.params[2] as PandaInstructionVReg;
            (this as any).thisObj = thisObj;
            const size = (this.params[0] as PandaInstructionIMM).imm;
            (this as any).callParams = rangeVRegs(method, thisObj.index + 1, size);
        }
    }

    private initSuperCall(method: PandaMethod): void {
        const name = this.opcode.name;
        let argNum: number;
        let base: PandaInstructionVReg;
        if (name === "supercallthisrange" || name === "supercallarrowrange") {
            argNum = (this.params[1] as PandaInstructionIMM).imm;
            base = this.params[2];
        } else {
            argNum = (this.params[0] as PandaInstructionIMM).imm;
            base = this.params[1];
        }
        const regs: PandaInstructionVReg[] = [];
        for (let i = 0; i < argNum; i++) {
            regs.push(new PandaInstructionVReg(base.index + i, method, "VREG"));
        }
        (this as any).callParams = regs;
    }

    private initDefineClass(opcode: OpcodeInfo): void {
        (this as any).constructorMethod = (this.params[1] as PandaInstructionID).obj as PandaMethod;
        (this as any).constructorParamSize = (this.params[3] as PandaInstructionIMM).imm;
        (this as any).protoReg = this.params[4];
        const literalArray = (this.params[2] as PandaInstructionID).obj as PandaLiteralArray;
        const literals = literalArray.getLiterals();
        (this as any).isSendClass = opcode.name === "callruntime.definesendableclass";
        let methodNum: number;
        let allMethodNum: number;
        if (this.isSendClass) {
            methodNum = (literals[literals.length - 2] as PandaLiteral).getValue();
            allMethodNum = Math.trunc((literals.length - 2) / 3);
        } else {
            methodNum = (literals[literals.length - 1] as PandaLiteral).getValue();
            allMethodNum = Math.trunc((literals.length - 1) / 3);
        }
        const methods: DefineClassMethodDescription[] = [];
        const statics: DefineClassMethodDescription[] = [];
        for (let i = 0; i < allMethodNum; i++) {
            const name = (literals[i * 3] as PandaString).content;
            const m = literals[i * 3 + 1] as PandaMethod;
            const paramSize = (literals[i * 3 + 2] as PandaLiteral).getValue();
            if (i < methodNum) methods.push({ protoMethodName: name, method: m, paramSize });
            else statics.push({ protoMethodName: name, method: m, paramSize });
        }
        (this as any).methodDescriptions = methods;
        (this as any).staticMethodDescriptions = statics;
        if (this.isSendClass) {
            const initLiterals = ((literals[literals.length - 1]) as PandaLiteralArray).getLiterals();
            const initSize = (initLiterals[initLiterals.length - 1] as PandaLiteral).getValue();
            const vars: SendClassVariableDescription[] = [];
            for (let i = 0; i < initSize; i++) {
                vars.push({
                    variableName: (initLiterals[i * 2] as PandaString).content,
                    variableValue: initLiterals[i * 2 + 1] as PandaLiteral,
                });
            }
            (this as any).sendClassVariableDescriptions = vars;
        }
    }

    private initCreateObject(opcode: OpcodeInfo): void {
        if (opcode.name === "createemptyobject") return;
        if (opcode.name === "createobjectwithexcludedkeys" || opcode.name === "wide.createobjectwithexcludedkeys") {
            (this as any).isExcludeObject = true;
            (this as any).excludeIndex = this.params[0];
            (this as any).excludeFormObj = this.params[1];
            (this as any).excludeObj = this.params[2];
            return;
        }
        const id = this.params[1] as PandaInstructionID;
        const literalArray = id.obj as PandaLiteralArray;
        const literals = literalArray.getLiterals();
        for (let i = 0; i < literals.length; i += 2) {
            const objName = (literals[i] as PandaString).content;
            const obj = literals[i + 1];
            if (obj instanceof PandaMethodClass) i++;
            this.objMap.set(objName, obj);
        }
    }

    private initLoadObjectBy(opcode: OpcodeInfo): void {
        if (opcode.name === "dynamicimport") {
            (this as any).isDynamicImport = true;
            (this as any).ldObj = null;
            return;
        }
        (this as any).ldObj = this.params[1];
        (this as any).isGlobalLd = opcode.name === "ldglobalvar";
    }

    private initStoreObject(opcode: OpcodeInfo): void {
        const name = opcode.name;
        if (name === "stobjbyname" || name === "stownbyname"
            || name === "definefieldname" || name === "definepropertybyname"
            || name === "callruntime.definefieldbyindex" || name === "callruntime.definefieldbyvalue") {
            (this as any).storeKeyObj = this.params[2];
            (this as any).storeKey = this.params[1];
            return;
        }
        if (name === "stglobalvar" || name === "trystglobalbyname") {
            const acc = new PandaInstructionACC();
            acc.type = "GLOBAL";
            (this as any).storeKeyObj = acc;
            (this as any).storeKey = this.params[1];
            return;
        }
        (this as any).storeKeyObj = this.params[1];
        (this as any).storeKey = this.params[2];
    }

    private initLoadExternalModuleVar(opcode: OpcodeInfo, method: PandaMethod): void {
        const index = (this.params[0] as PandaInstructionIMM).imm;
        const moduleData = method.getParent()?.pandaClassModuleData;
        if (!moduleData) throw new PandaParseException("method has no module data for " + opcode.name);
        if (opcode.name === "getmodulenamespace" || opcode.name === "wide.getmodulenamespace") {
            const path = moduleData.requestedModules![index];
            (this as any).module = moduleData.getPandaClassImportModuleByPath(path.toString());
        } else {
            (this as any).module = moduleData.imports[index];
        }
    }

    /** loadLex 的签名(用于类型推断);传入当前层级时以“绝对目标层级”为 key,避免兄弟作用域同名冲突 */
    toSignature(baseLevel?: number): string {
        const name = this.isSendAble ? "sendable" : "local";
        const level = baseLevel === undefined ? this.lexLevel : baseLevel - this.lexLevel - 1;
        return name + "_" + level + "_" + this.lexIndex;
    }

    getPC(): number { return this.pc; }
    getFormat(): string { return this.opcode.format; }

    isJump(): boolean { return (this.opcode.flags & OPCODE_FLAG.JUMP) !== 0; }
    isConditional(): boolean { return (this.opcode.flags & OPCODE_FLAG.CONDITIONAL) !== 0; }
    isReturnIns(): boolean { return (this.opcode.flags & OPCODE_FLAG.RETURN) !== 0; }
    isThrowIns(): boolean { return this.opcode.name === "throw"; }
    isTerminator(): boolean { return this.isJump() || this.isReturnIns() || this.isThrowIns(); }
    instructionSize(): number {
        const opcodeSize = this.opcode.code >= LAST_INSTRUCTION_CODE_CONST ? 2 : 1;
        return opcodeSize + (FORMAT_SIZE[this.opcode.format] ?? 0);
    }

    toString(): string {
        const ret = this.pc + ":" + this.opcode.name + " || ";
        const head = (this.opcode.flags & OPCODE_FLAG.ACC_WRITE) ? ret + "acc = " : ret;
        const parts = this.params.map((p) => p.toString());
        let s = head + parts.join(", ");
        if (this.jumpKind) s += " [label_" + this.destinationPC + "]";
        return s;
    }
}

// 避免循环依赖的延迟引用
const LAST_INSTRUCTION_CODE_CONST = LAST_INSTRUCTION_CODE;
const FORMAT_SIZE = FORMAT_PARAM_SIZE;

function baseName(name: string): string {
    const idx = name.indexOf(".");
    return idx === -1 ? name : name.substring(0, idx);
}

function rangeVRegs(method: PandaMethod, startIndex: number, size: number): PandaInstructionVReg[] {
    const regs: PandaInstructionVReg[] = [];
    for (let i = 0; i < size; i++) {
        regs.push(new PandaInstructionVReg(startIndex + i, method, "VREG"));
    }
    return regs;
}

function computeDestinationPC(pc: number, params: any[]): number {
    // 跳转偏移是最后一个 IMM 参数(有符号)
    for (let i = params.length - 1; i >= 0; i--) {
        const p = params[i];
        if (p instanceof PandaInstructionIMM) return pc + p.imm;
    }
    throw new PandaParseException("jump instruction has no imm offset");
}

function classifyKind(opcode: OpcodeInfo): InstructionKind {
    if (opcode.flags & OPCODE_FLAG.JUMP) {
        if (opcode.name === "jmp") return "jumpDirect";
        if (opcode.name === "jeqz") return "jumpEqual";
        if (opcode.name === "jnez") return "jumpNotEqual";
        return "jumpPlain";
    }
    const kind = KIND_MAP.get(opcode.name);
    return kind ?? "unknown";
}

/** 按格式解析指令参数(移植自 Java PandaInstruction.parseParamByFormat) */
function parseParamByFormat(opcode: OpcodeInfo, param: Uint8Array, method: PandaMethod): any[] {
    const dv = new DataView(param.buffer, param.byteOffset, param.byteLength);
    const list: any[] = [];
    const realName = opcode.format.replace("PREF_", "");
    // 指令集里只有跳转偏移和 ldai 的立即数是 i8/i16/i32,其余 imm 均为 u8/u16/u32
    // (参考 isa.yaml 与 reference 运行时 READ_INST_* 的无符号读取)
    const signedImm = (opcode.flags & OPCODE_FLAG.JUMP) !== 0 || opcode.name === "ldai";
    let index = 0;
    let bits = 0;
    let paramIndex = 0;
    const typeArr = realName.split("_");
    for (const s of typeArr) {
        switch (s) {
            case "NONE": {
                paramIndex++;
                break;
            }
            case "IMM4": {
                const temp = (dv.getInt8(index) >> bits) & 0xf;
                list.push(new PandaInstructionIMM(temp));
                bits += 4;
                paramIndex++;
                break;
            }
            case "IMM8": {
                if (bits !== 0) throw new PandaParseException("bits should equal to zero.");
                list.push(new PandaInstructionIMM(signedImm ? dv.getInt8(index) : dv.getUint8(index)));
                index++;
                paramIndex++;
                break;
            }
            case "IMM16": {
                if (bits !== 0) throw new PandaParseException("bits should equal to zero.");
                list.push(new PandaInstructionIMM(signedImm ? dv.getInt16(index, true) : dv.getUint16(index, true)));
                index += 2;
                paramIndex++;
                break;
            }
            case "IMM32": {
                if (bits !== 0) throw new PandaParseException("bits should equal to zero.");
                list.push(new PandaInstructionIMM(signedImm ? dv.getInt32(index, true) : dv.getUint32(index, true)));
                index += 4;
                paramIndex++;
                break;
            }
            case "IMM64": {
                if (bits !== 0) throw new PandaParseException("bits should equal to zero.");
                list.push(new PandaInstructionIMM(dv.getFloat64(index, true)));
                index += 8;
                paramIndex++;
                break;
            }
            case "V4": {
                const temp = dv.getInt8(index) >> bits;
                list.push(new PandaInstructionVReg(temp & 0xf, method));
                bits += 4;
                paramIndex++;
                break;
            }
            case "V8": {
                if (bits !== 0) throw new PandaParseException("bits should equal to zero.");
                list.push(new PandaInstructionVReg(dv.getUint8(index), method));
                index++;
                paramIndex++;
                break;
            }
            case "V16": {
                if (bits !== 0) throw new PandaParseException("bits should equal to zero.");
                list.push(new PandaInstructionVReg(dv.getUint16(index, true), method));
                index += 2;
                paramIndex++;
                break;
            }
            case "ID16": {
                if (bits !== 0) throw new PandaParseException("bits should equal to zero.");
                const value = dv.getUint16(index, true);
                list.push(new PandaInstructionID(opcode, paramIndex, value, method));
                index += 2;
                paramIndex++;
                break;
            }
            case "ID32": {
                if (bits !== 0) throw new PandaParseException("bits should equal to zero.");
                list.push(new PandaInstructionID(opcode, paramIndex, dv.getInt32(index, true), method));
                index += 4;
                paramIndex++;
                break;
            }
            default:
                throw new PandaParseException("format param type not recognized " + s);
        }
        if (bits === 8) {
            index++;
            bits = 0;
        }
    }
    return list;
}
