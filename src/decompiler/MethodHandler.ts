import { CodeGenerator } from "../codegen/CodeGenerator";
import type { PandaIRBasicBlock } from "../disasm/PandaIRBasicBlock";
import type { PandaLexical } from "../disasm/PandaLexical";
import { PandaInstruction, PandaInstructionID, PandaInstructionIMM, PandaInstructionVReg } from "../disasm/PandaInstruction";
import { StructureAnalysis } from "./StructureAnalysis";
import { SimpleAnalysis } from "./SimpleAnalysis";
import { PandaDecompileException } from "../PandaParseException";
import { ENTRY_FUNCTION_MAIN } from "../file/PandaFile";
import type { PandaMethod } from "../file/method/PandaMethod";
import { PandaString } from "../file/desc/PandaString";
import { PandaLiteral } from "../file/literal/PandaLiteral";
import { PandaMethod as PandaMethodClass } from "../file/method/PandaMethod";
import { LiteralTag } from "../file/desc/enums";

/**
 * 方法反编译处理器:指令分发 + 各指令 handle(移植自 Java PandaDecompilerMethodHandler 与 ins 包)
 * @Author: jmp0
 */
export class PandaDecompilerMethodHandler {
    private incNum = 0;
    readonly codeGenerator: CodeGenerator;

    constructor(codeGenerator: CodeGenerator) {
        this.codeGenerator = codeGenerator;
    }

    getNextID(): number {
        return this.incNum++;
    }

    /**
     * 复位生成名计数器。
     * `panda_jmp0_reserved_class_N` / `reserved_anonymous_N` 只在一个类的输出内可见,
     * 按类复位后单类输出与处理顺序、是否并行无关(多线程反编译依赖该确定性)。
     */
    reset(): void {
        this.incNum = 0;
    }

    getCodeGenerator(): CodeGenerator {
        return this.codeGenerator;
    }

    handleBlock(block: PandaIRBasicBlock, pandaLexical: PandaLexical, node: any): void {
        for (const instruction of block.pandaInstructions) {
            const handle = HANDLES[instruction.kind];
            if (!handle || instruction.kind === "unknown") {
                throw new PandaDecompileException(instruction.opcode.name + " not handled!");
            }
            const stop = handle(instruction, block, this, pandaLexical, node);
            if (stop) return;
        }
    }

    insertFunctionPreamble(method: PandaMethod, pandaLexical: PandaLexical, node: any): void {
        const codeGenerator = this.codeGenerator;
        const factory = codeGenerator.getNodeFactory();
        const numVRegs = method.methodCode!.numVregs;
        const arrayObject = codeGenerator.arrayObject();
        for (let i = 0; i < numVRegs; i++) {
            const name = "v" + i;
            const type = pandaLexical.getTypeInfo(method, name);
            let declarator;
            if (!type) {
                declarator = factory.variableDeclaratorNode(factory.identifierNode(name) as any, null);
            } else {
                declarator = factory.variableDeclaratorNode(factory.identifierNode(name, type) as any, null);
            }
            codeGenerator.addToArray(arrayObject, declarator);
        }
        codeGenerator.addToArray(arrayObject, factory.variableDeclaratorNode(factory.identifierNode("acc") as any, null));
        for (let i = 0; i < 3; i++) {
            codeGenerator.addToArray(arrayObject, factory.variableDeclaratorNode(factory.identifierNode("panda_jmp0_reserved_param_p" + i) as any, null));
        }
        const variableDeclarationNode = factory.variableDeclarationNode(arrayObject as any, "let");
        codeGenerator.getNodeUtils().insertNodeToBody(variableDeclarationNode as any, node);
        const assignment = factory.assignmentExpressionNode("=", factory.identifierNode("panda_jmp0_reserved_param_p2") as any, factory.thisExpressionNode());
        codeGenerator.getNodeUtils().insertNodeToBody(factory.expressionStatementNode(assignment as any) as any, node);
    }

    private isNumeric(str: string): boolean {
        return /^\d+$/.test(str);
    }

    decompileFunction(inner: PandaMethod, pandaLexical: PandaLexical): any {
        const codeGenerator = this.codeGenerator;
        const factory = codeGenerator.getNodeFactory();
        const numArgs = inner.methodCode!.numArgs - 3;
        const params = codeGenerator.arrayObject();
        for (let i = 0; i < numArgs; i++) {
            codeGenerator.addToArray(params, factory.identifierNode("p" + i));
        }
        const block = factory.blockStatementNode();
        if (!pandaLexical.has(inner)) {
            // 词法分析阶段失败的方法(如 jeq/jne 家族指令未实现):输出占位函数体,避免整个类反编译失败
            factory.addComment(block, " xpanda: method body unavailable (disassembly failed) ");
        } else {
            const pandaIRCFG = pandaLexical.getPandaIRCFG(inner);
            this.insertFunctionPreamble(inner, pandaLexical, block);
            try {
                new StructureAnalysis(pandaIRCFG, pandaIRCFG.getEntryBlock(), pandaIRCFG.getLastBlock()).analysis(this, pandaLexical, block);
            } catch (e) {
                new SimpleAnalysis(pandaIRCFG).analysis(this, pandaLexical, block);
            }
        }
        const name = inner.name.content;
        if (name.startsWith("#") || this.isNumeric(name)) return factory.functionExpressionNode(null, params as any, block);
        if (name === "default") {
            return factory.functionExpressionNode(factory.identifierNode("panda_jmp0_reserved_" + name) as any, params as any, block);
        }
        return factory.functionExpressionNode(factory.identifierNode(name) as any, params as any, block);
    }
}

// ---------------------------------------------------------------------------
// handle 工具
// ---------------------------------------------------------------------------

type Handle = (
    instruction: PandaInstruction,
    block: PandaIRBasicBlock,
    methodHandler: PandaDecompilerMethodHandler,
    pandaLexical: PandaLexical,
    node: any,
) => boolean; // true = STOP

function assignAcc(methodHandler: PandaDecompilerMethodHandler, right: any, node: any, left: any = "acc"): void {
    const factory = methodHandler.getCodeGenerator().getNodeFactory();
    const utils = methodHandler.getCodeGenerator().getNodeUtils();
    const assignment = factory.assignmentExpressionNode("=", left === "acc" ? factory.identifierNode("acc") as any : left, right);
    utils.insertNodeToBody(factory.expressionStatementNode(assignment as any) as any, node);
}

// ---------------------------------------------------------------------------
// 各指令 handle(与 Java ins/*Handle 一一对应)
// ---------------------------------------------------------------------------

const HANDLES: Record<string, Handle> = {
    // ------------------------------------------------ 赋值/加载/存储
    mov: (ins, _b, mh, _l, node) => {
        const factory = mh.getCodeGenerator().getNodeFactory();
        assignAcc(mh, factory.identifierNode(ins.srcObj!.toString()) as any, node, factory.identifierNode(ins.destObj!.toString()) as any);
        return false;
    },
    store: (ins, _b, mh, _l, node) => {
        const factory = mh.getCodeGenerator().getNodeFactory();
        assignAcc(mh, factory.identifierNode("acc") as any, node, factory.identifierNode(ins.destObj!.toString()) as any);
        return false;
    },
    load: (ins, _b, mh, _l, node) => {
        const factory = mh.getCodeGenerator().getNodeFactory();
        let loadNode: any;
        if (ins.isSendAble && ins.opcode.name === "callruntime.ldsendableclass") {
            loadNode = factory.identifierNode("panda_jmp0_reserved_sendable_class");
        } else if (ins.loadType === "STRING") {
            loadNode = factory.stringLiteralNode(ins.loadSelfToString());
        } else if (ins.loadType === "FALSE") {
            loadNode = factory.booleanLiteralNode(false);
        } else if (ins.loadType === "TRUE") {
            loadNode = factory.booleanLiteralNode(true);
        } else if (ins.loadType === "NULL") {
            loadNode = factory.nullLiteralNode();
        } else if (ins.loadParam instanceof PandaInstructionIMM) {
            loadNode = factory.numberLiteralNode(ins.loadParam.imm);
        } else if (ins.loadType === "OBJECT" && ins.loadParam) {
            loadNode = factory.identifierNode(ins.loadParam.toString());
        } else {
            loadNode = factory.identifierNode(ins.loadSelfToString());
        }
        assignAcc(mh, loadNode, node);
        return false;
    },
    // ------------------------------------------------ 运算
    binaryOp: (ins, _b, mh, _l, node) => {
        const factory = mh.getCodeGenerator().getNodeFactory();
        const binary = factory.binaryExpressionNode(ins.op as any, factory.identifierNode(ins.params[1].toString()) as any, factory.identifierNode("acc") as any);
        assignAcc(mh, binary, node);
        return false;
    },
    unary: (ins, _b, mh, _l, node) => {
        const factory = mh.getCodeGenerator().getNodeFactory();
        const utils = mh.getCodeGenerator().getNodeUtils();
        const op = ins.op;
        if (op === "") {
            // do nothing
        } else if (op === "!!") {
            let unaryObject = factory.unaryExpressionNode("!", factory.identifierNode("acc") as any);
            unaryObject = factory.unaryExpressionNode("!", unaryObject as any);
            assignAcc(mh, unaryObject, node);
        } else if (op === "--" || op === "++") {
            const binary = factory.binaryExpressionNode(op.substring(1) as any, factory.identifierNode("acc") as any, factory.numberLiteralNode(1));
            assignAcc(mh, binary, node);
        } else {
            const unaryObject = factory.unaryExpressionNode(op as any, factory.identifierNode("acc") as any);
            assignAcc(mh, unaryObject, node);
        }
        void utils;
        return false;
    },
    // ------------------------------------------------ 调用
    call: (ins, _b, mh, _l, node) => {
        const codeGenerator = mh.getCodeGenerator();
        const factory = codeGenerator.getNodeFactory();
        const utils = codeGenerator.getNodeUtils();
        const arrayObject = codeGenerator.arrayObject();
        if (ins.thisObj) codeGenerator.addToArray(arrayObject, factory.identifierNode(ins.thisObj.toString()));
        if (ins.apply) {
            codeGenerator.addToArray(arrayObject, factory.spreadElementNode(factory.identifierNode(ins.callParams[0].toString()) as any) as any);
        } else {
            for (const param of ins.callParams) {
                codeGenerator.addToArray(arrayObject, factory.identifierNode(param.toString()));
            }
        }
        let calleeNode: any;
        if (!ins.thisObj) calleeNode = factory.identifierNode("acc");
        else calleeNode = factory.memberExpressionNode(factory.identifierNode("acc") as any, factory.identifierNode("call") as any, false);
        const callExpressionNode = factory.callExpressionNode(calleeNode as any, arrayObject as any);
        utils.setReturnTypeCall(callExpressionNode);
        assignAcc(mh, callExpressionNode, node);
        return false;
    },
    superCall: (ins, _b, mh, _l, node) => {
        const codeGenerator = mh.getCodeGenerator();
        const factory = codeGenerator.getNodeFactory();
        const arrayObject = codeGenerator.arrayObject();
        for (const vReg of ins.callParams) {
            codeGenerator.addToArray(arrayObject, factory.identifierNode(vReg.toString()));
        }
        const call = factory.callExpressionNode(factory.superNode() as any, arrayObject as any);
        assignAcc(mh, call, node);
        return false;
    },
    superCallSpread: (ins, _b, mh, _l, node) => {
        const codeGenerator = mh.getCodeGenerator();
        const factory = codeGenerator.getNodeFactory();
        const spread = factory.spreadElementNode(factory.identifierNode(ins.arr!.toString()) as any);
        const arrayObject = codeGenerator.arrayObject();
        codeGenerator.addToArray(arrayObject, spread);
        const call = factory.callExpressionNode(factory.superNode() as any, arrayObject as any);
        assignAcc(mh, call, node);
        return false;
    },
    callRuntime: (ins, _b, mh, _l, node) => {
        const codeGenerator = mh.getCodeGenerator();
        const factory = codeGenerator.getNodeFactory();
        const utils = codeGenerator.getNodeUtils();
        if (ins.runtimeType === "CALL_INIT") {
            const member = factory.memberExpressionNode(factory.identifierNode("acc") as any, factory.identifierNode("call") as any, false);
            const arrayObject = codeGenerator.arrayObject();
            codeGenerator.addToArray(arrayObject, factory.identifierNode("panda_jmp0_reserved_param_p2"));
            const call = factory.callExpressionNode(member as any, arrayObject as any);
            utils.insertNodeToBody(factory.expressionStatementNode(call as any) as any, node);
        } else if (ins.runtimeType === "IS_FALSE") {
            const unary = factory.unaryExpressionNode("!", factory.identifierNode("acc") as any);
            const assignment = factory.assignmentExpressionNode("=", factory.identifierNode("acc") as any, unary as any);
            utils.insertNodeToBody(factory.expressionStatementNode(assignment as any) as any, node);
        }
        return false;
    },
    // ------------------------------------------------ 定义
    defineFunc: (ins, _b, mh, l, node) => {
        const func = mh.decompileFunction(ins.func!, l);
        assignAcc(mh, func, node);
        return false;
    },
    defineClassWithBuffer: (ins, _b, mh, l, node) => {
        const codeGenerator = mh.getCodeGenerator();
        const factory = codeGenerator.getNodeFactory();
        let className = ins.constructorMethod!.name.content;
        if (className.startsWith("#")) {
            className = "panda_jmp0_reserved_anonymous_" + mh.getNextID();
        } else {
            className = "panda_jmp0_reserved_class_" + mh.getNextID();
        }
        const classId = factory.identifierNode(className);
        const superClass = factory.identifierNode(ins.protoReg!.toString());
        const functionExp = mh.decompileFunction(ins.constructorMethod!, l);
        const constructorMethodNode = factory.classMethodNode(factory.identifierNode("constructor") as any, functionExp, "constructor", false, false);
        const bodyArray = codeGenerator.arrayObject();
        if (ins.isSendClass) {
            for (const sv of ins.sendClassVariableDescriptions) {
                const literal = sv.variableValue;
                let valueObject: any = null;
                switch (literal.tag) {
                    case LiteralTag.DOUBLE:
                    case LiteralTag.FLOAT:
                    case LiteralTag.INTEGER:
                        valueObject = factory.numberLiteralNode(literal.getValue());
                        break;
                    default:
                        throw new PandaDecompileException(LiteralTag[literal.tag] + " not support!");
                }
                codeGenerator.addToArray(bodyArray, factory.classPropertyNode(factory.identifierNode(sv.variableName) as any, valueObject));
            }
        }
        codeGenerator.addToArray(bodyArray, constructorMethodNode);
        for (const desc of ins.methodDescriptions) {
            const methodNode = mh.decompileFunction(desc.method, l);
            codeGenerator.addToArray(bodyArray, factory.classMethodNode(factory.identifierNode(desc.protoMethodName) as any, methodNode, "method", false, false));
        }
        for (const desc of ins.staticMethodDescriptions) {
            const methodNode = mh.decompileFunction(desc.method, l);
            codeGenerator.addToArray(bodyArray, factory.classMethodNode(factory.identifierNode(desc.protoMethodName) as any, methodNode, "method", false, true));
        }
        const body = factory.classBodyNode(bodyArray as any);
        const clazz = factory.classExpressionNode(classId as any, superClass as any, body);
        assignAcc(mh, clazz, node);
        return false;
    },
    defineGetterSetterByValue: (ins, _b, mh, _l, node) => {
        const codeGenerator = mh.getCodeGenerator();
        const factory = codeGenerator.getNodeFactory();
        const utils = codeGenerator.getNodeUtils();
        const objIdentifier = factory.identifierNode(ins.params[0].toString());
        const propIdentifier = factory.identifierNode(ins.params[1].toString());
        const getIdentifier = factory.identifierNode(ins.params[2].toString());
        const setIdentifier = factory.identifierNode(ins.params[3].toString());
        const getterMember = factory.memberExpressionNode(objIdentifier as any, factory.identifierNode("__defineGetter__") as any);
        const setterMember = factory.memberExpressionNode(objIdentifier as any, factory.identifierNode("__defineSetter__") as any);
        const getArr = codeGenerator.arrayObject();
        codeGenerator.addToArray(getArr, propIdentifier);
        codeGenerator.addToArray(getArr, getIdentifier);
        const setArr = codeGenerator.arrayObject();
        codeGenerator.addToArray(setArr, propIdentifier);
        codeGenerator.addToArray(setArr, setIdentifier);
        utils.insertNodeToBody(factory.expressionStatementNode(factory.callExpressionNode(getterMember as any, getArr as any) as any) as any, node);
        utils.insertNodeToBody(factory.expressionStatementNode(factory.callExpressionNode(setterMember as any, setArr as any) as any) as any, node);
        return false;
    },
    // ------------------------------------------------ 对象/数组
    createObject: (ins, _b, mh, l, node) => {
        const codeGenerator = mh.getCodeGenerator();
        const factory = codeGenerator.getNodeFactory();
        if (ins.isExcludeObject) {
            const arrayObject = codeGenerator.arrayObject();
            codeGenerator.addToArray(arrayObject, factory.identifierNode(ins.excludeFormObj!.toString()));
            codeGenerator.addToArray(arrayObject, factory.identifierNode(ins.excludeObj!.toString()));
            codeGenerator.addToArray(arrayObject, factory.numberLiteralNode(ins.excludeIndex!.imm));
            const call = factory.callExpressionNode(factory.identifierNode("panda_create_exclude_object_polyfill") as any, arrayObject as any);
            assignAcc(mh, call, node);
            return false;
        }
        const props = codeGenerator.arrayObject();
        for (const [key, value] of ins.objMap) {
            if (value instanceof PandaString) {
                codeGenerator.addToArray(props, factory.objectPropertyNode(factory.stringLiteralNode(key) as any, factory.stringLiteralNode(value.content) as any));
            } else if (value instanceof PandaLiteral) {
                const tag = value.tag;
                if (tag === LiteralTag.INTEGER || tag === LiteralTag.FLOAT || tag === LiteralTag.DOUBLE) {
                    codeGenerator.addToArray(props, factory.objectPropertyNode(factory.stringLiteralNode(key) as any, factory.numberLiteralNode(value.getValue())));
                } else if (value.toString() === "true" || value.toString() === "false") {
                    codeGenerator.addToArray(props, factory.objectPropertyNode(factory.stringLiteralNode(key) as any, factory.booleanLiteralNode(value.toString() === "true") as any));
                } else {
                    codeGenerator.addToArray(props, factory.objectPropertyNode(factory.stringLiteralNode(key) as any, factory.identifierNode(value.toString()) as any));
                }
            } else if (value instanceof PandaMethodClass) {
                codeGenerator.addToArray(props, factory.objectPropertyNode(factory.stringLiteralNode(key) as any, mh.decompileFunction(value, l)));
            } else {
                codeGenerator.addToArray(props, factory.objectPropertyNode(factory.stringLiteralNode(key) as any, factory.identifierNode(value.toString()) as any));
            }
        }
        const objNode = factory.objectExpressionNode(props as any);
        assignAcc(mh, objNode, node);
        return false;
    },
    createArray: (ins, _b, mh, _l, node) => {
        const codeGenerator = mh.getCodeGenerator();
        const factory = codeGenerator.getNodeFactory();
        const arrayObject = codeGenerator.arrayObject();
        if (ins.initArr) {
            for (const offset of ins.initArr) {
                if (offset instanceof PandaLiteral) {
                    const tag = offset.tag;
                    if (tag === LiteralTag.INTEGER || tag === LiteralTag.FLOAT || tag === LiteralTag.DOUBLE) {
                        codeGenerator.addToArray(arrayObject, factory.numberLiteralNode(offset.getValue()));
                    } else if (tag === LiteralTag.STRING) {
                        codeGenerator.addToArray(arrayObject, factory.stringLiteralNode(offset.toString()));
                    } else {
                        codeGenerator.addToArray(arrayObject, factory.identifierNode(offset.toString()));
                    }
                } else if (offset instanceof PandaString) {
                    codeGenerator.addToArray(arrayObject, factory.stringLiteralNode(offset.content));
                } else {
                    codeGenerator.addToArray(arrayObject, factory.identifierNode(offset.toString()));
                }
            }
        }
        const arrayExpressionNode = factory.arrayExpressionNode(arrayObject as any);
        assignAcc(mh, arrayExpressionNode, node);
        return false;
    },
    newObjRange: (ins, _b, mh, _l, node) => {
        const codeGenerator = mh.getCodeGenerator();
        const factory = codeGenerator.getNodeFactory();
        const objNode = factory.identifierNode(ins.objectVReg!.toString());
        const params = codeGenerator.arrayObject();
        for (const v of ins.paramsVReg) {
            codeGenerator.addToArray(params, factory.identifierNode(v.toString()));
        }
        const newObj = factory.newExpressionNode(objNode as any, params as any);
        assignAcc(mh, newObj, node);
        return false;
    },
    newObjSpread: (ins, _b, mh, _l, node) => {
        const codeGenerator = mh.getCodeGenerator();
        const factory = codeGenerator.getNodeFactory();
        const spread = factory.spreadElementNode(factory.identifierNode("acc") as any);
        const arrayObject = codeGenerator.arrayObject();
        codeGenerator.addToArray(arrayObject, spread);
        const newExpressionNode = factory.newExpressionNode(factory.identifierNode(ins.cotr!.toString()) as any, arrayObject as any);
        assignAcc(mh, newExpressionNode, node);
        return false;
    },
    // ------------------------------------------------ 属性访问
    loadObjectBy: (ins, _b, mh, _l, node) => {
        const codeGenerator = mh.getCodeGenerator();
        const factory = codeGenerator.getNodeFactory();
        let memberExpressionNode: any;
        if (ins.isDynamicImport) {
            memberExpressionNode = factory.dynamicImportExpressionNode(undefined as any);
        } else if (ins.isGlobalLd) {
            if (ins.ldObj instanceof PandaInstructionID && ins.ldObj.type === "STRING") {
                memberExpressionNode = factory.memberExpressionNode(factory.identifierNode("globalThis") as any, factory.stringLiteralNode((ins.ldObj.obj as PandaString).content) as any, true);
            } else {
                memberExpressionNode = factory.memberExpressionNode(factory.identifierNode("globalThis") as any, factory.identifierNode(ins.ldObj.toString()) as any, true);
            }
        } else if (ins.ldObj instanceof PandaInstructionVReg) {
            memberExpressionNode = factory.memberExpressionNode(factory.identifierNode(ins.ldObj.toString()) as any, factory.identifierNode("acc") as any, true);
        } else if (ins.ldObj instanceof PandaInstructionID && ins.ldObj.type === "STRING") {
            memberExpressionNode = factory.memberExpressionNode(factory.identifierNode("acc") as any, factory.stringLiteralNode((ins.ldObj.obj as PandaString).content) as any, true);
        } else {
            memberExpressionNode = factory.memberExpressionNode(factory.identifierNode("acc") as any, factory.identifierNode(ins.ldObj.toString()) as any, true);
        }
        assignAcc(mh, memberExpressionNode, node);
        return false;
    },
    storeObject: (ins, _b, mh, _l, node) => {
        const codeGenerator = mh.getCodeGenerator();
        const factory = codeGenerator.getNodeFactory();
        let memberExpressionNode: any;
        if (ins.storeKey instanceof PandaInstructionID && ins.storeKey.type === "STRING") {
            memberExpressionNode = factory.memberExpressionNode(factory.identifierNode(ins.storeKeyObj.toString()) as any, factory.stringLiteralNode((ins.storeKey.obj as PandaString).content) as any, true);
        } else if (ins.storeKey instanceof PandaInstructionIMM) {
            memberExpressionNode = factory.memberExpressionNode(factory.identifierNode(ins.storeKeyObj.toString()) as any, factory.numberLiteralNode(ins.storeKey.imm) as any, true);
        } else {
            memberExpressionNode = factory.memberExpressionNode(factory.identifierNode(ins.storeKeyObj.toString()) as any, factory.identifierNode(ins.storeKey.toString()) as any, true);
        }
        assignAcc(mh, factory.identifierNode("acc") as any, node, memberExpressionNode);
        return false;
    },
    storeByIndex: (ins, _b, mh, _l, node) => {
        const codeGenerator = mh.getCodeGenerator();
        const factory = codeGenerator.getNodeFactory();
        const member = factory.memberExpressionNode(factory.identifierNode(ins.arr!.toString()) as any, factory.numberLiteralNode(ins.arrIndex!) as any, true);
        assignAcc(mh, factory.identifierNode("acc") as any, node, member);
        return false;
    },
    storeArraySpread: (ins, _b, mh, _l, node) => {
        const codeGenerator = mh.getCodeGenerator();
        const factory = codeGenerator.getNodeFactory();
        // acc = dest.splice(index,0,...acc)
        const member = factory.memberExpressionNode(factory.identifierNode(ins.destObj!.toString()) as any, factory.identifierNode("splice") as any);
        const arrayObject = codeGenerator.arrayObject();
        codeGenerator.addToArray(arrayObject, factory.identifierNode(ins.srcObj!.toString()));
        codeGenerator.addToArray(arrayObject, factory.numberLiteralNode(0));
        codeGenerator.addToArray(arrayObject, factory.spreadElementNode(factory.identifierNode("acc") as any));
        const call = factory.callExpressionNode(member as any, arrayObject as any);
        assignAcc(mh, call, node);
        return false;
    },
    deleteObjProp: (ins, _b, mh, _l, node) => {
        const codeGenerator = mh.getCodeGenerator();
        const factory = codeGenerator.getNodeFactory();
        const utils = codeGenerator.getNodeUtils();
        const member = factory.memberExpressionNode(factory.identifierNode(ins.destObj!.toString()) as any, factory.identifierNode("acc") as any, true);
        const unary = factory.unaryExpressionNode("delete", member as any);
        utils.insertNodeToBody(factory.expressionStatementNode(unary as any) as any, node);
        return false;
    },
    loadSuper: (ins, _b, mh, _l, node) => {
        const factory = mh.getCodeGenerator().getNodeFactory();
        const member = factory.memberExpressionNode(factory.superNode() as any, factory.identifierNode(ins.superFuncName) as any);
        assignAcc(mh, member, node);
        return false;
    },
    loadSuperObj: (ins, _b, mh, _l, node) => {
        const factory = mh.getCodeGenerator().getNodeFactory();
        let member = factory.memberExpressionNode(factory.superNode() as any, factory.identifierNode(ins.destObj!.toString()) as any, true);
        member = factory.memberExpressionNode(member as any, factory.identifierNode("acc") as any, true);
        assignAcc(mh, member, node);
        return false;
    },
    storeSuperObj: (ins, _b, mh, _l, node) => {
        const factory = mh.getCodeGenerator().getNodeFactory();
        let member = factory.memberExpressionNode(factory.superNode() as any, factory.identifierNode(ins.destObj!.toString()) as any, true);
        member = factory.memberExpressionNode(member as any, factory.stringLiteralNode(ins.superProp!.content) as any, true);
        assignAcc(mh, factory.identifierNode("acc") as any, node, member);
        return false;
    },
    setObjectWithProto: (ins, _b, mh, _l, node) => {
        const codeGenerator = mh.getCodeGenerator();
        const factory = codeGenerator.getNodeFactory();
        const utils = codeGenerator.getNodeUtils();
        const member = factory.memberExpressionNode(factory.identifierNode("Object") as any, factory.identifierNode("setPrototypeOf") as any);
        const arrayObject = codeGenerator.arrayObject();
        codeGenerator.addToArray(arrayObject, factory.identifierNode("acc"));
        codeGenerator.addToArray(arrayObject, factory.identifierNode(ins.protoReg!.toString()));
        const call = factory.callExpressionNode(member as any, arrayObject as any);
        utils.insertNodeToBody(factory.expressionStatementNode(call as any) as any, node);
        return false;
    },
    copyDataProperties: (ins, _b, mh, _l, node) => {
        const codeGenerator = mh.getCodeGenerator();
        const factory = codeGenerator.getNodeFactory();
        const utils = codeGenerator.getNodeUtils();
        const member = factory.memberExpressionNode(factory.identifierNode("Object") as any, factory.identifierNode("assign") as any);
        const arrayObject = codeGenerator.arrayObject();
        codeGenerator.addToArray(arrayObject, factory.objectExpressionNode(codeGenerator.arrayObject() as any));
        codeGenerator.addToArray(arrayObject, factory.identifierNode("acc"));
        const call = factory.callExpressionNode(member as any, arrayObject as any);
        assignAcc(mh, call, node, factory.identifierNode(ins.destObj!.toString()) as any);
        void utils;
        return false;
    },
    // ------------------------------------------------ 全局/模块
    storeObjectRecord: (ins, _b, mh, _l, node) => {
        const codeGenerator = mh.getCodeGenerator();
        const factory = codeGenerator.getNodeFactory();
        const utils = codeGenerator.getNodeUtils();
        const kind = ins.recordType;
        const name = (ins.storeKey as PandaInstructionID).obj as PandaString;
        const declarator = factory.variableDeclaratorNode(factory.identifierNode(name.content) as any, factory.identifierNode("acc") as any);
        const array = codeGenerator.arrayObject();
        codeGenerator.addToArray(array, declarator);
        utils.insertNodeToBody(factory.variableDeclarationNode(array as any, kind as any) as any, node);
        return false;
    },
    loadGlobal: (ins, _b, mh, _l, node) => {
        const factory = mh.getCodeGenerator().getNodeFactory();
        assignAcc(mh, factory.identifierNode(ins.globalName!.content) as any, node);
        return false;
    },
    storeModuleVar: (ins, _b, mh, _l, node) => {
        const codeGenerator = mh.getCodeGenerator();
        const factory = codeGenerator.getNodeFactory();
        const utils = codeGenerator.getNodeUtils();
        const localName = (ins.module as any).localName;
        const assignment = factory.assignmentExpressionNode("=", factory.identifierNode(localName) as any, factory.identifierNode("acc") as any);
        utils.insertNodeToBody(factory.expressionStatementNode(assignment as any) as any, node);
        return false;
    },
    loadModuleVar: (ins, _b, mh, _l, node) => {
        const factory = mh.getCodeGenerator().getNodeFactory();
        assignAcc(mh, factory.identifierNode((ins.module as any).localName) as any, node);
        return false;
    },
    loadExternalModuleVar: (ins, _b, mh, _l, node) => {
        const factory = mh.getCodeGenerator().getNodeFactory();
        assignAcc(mh, factory.identifierNode((ins.module as any).localName) as any, node);
        return false;
    },
    // ------------------------------------------------ 词法环境
    newLexEnv: (ins, block, mh, l, node) => {
        const codeGenerator = mh.getCodeGenerator();
        const factory = codeGenerator.getNodeFactory();
        const utils = codeGenerator.getNodeUtils();
        const nowLevel = l.getLevel(block.getParent(), ins.pc);
        let name = ins.isSendAble ? "sendable" : "local";
        name += "_" + nowLevel + "_";
        const arrayObject = codeGenerator.arrayObject();
        for (let i = 0; i < ins.lexImm; i++) {
            codeGenerator.addToArray(arrayObject, factory.variableDeclaratorNode(factory.identifierNode(name + i) as any, null));
        }
        const variableDeclarationNode = factory.variableDeclarationNode(arrayObject as any, "let");
        utils.insertNodeToBody(factory.expressionStatementNode(factory.identifierNode("panda_jmp0_reserved_lex_begin") as any) as any, node);
        utils.insertNodeToBody(variableDeclarationNode as any, node);
        return false;
    },
    storeLex: (ins, block, mh, l, node) => {
        const factory = mh.getCodeGenerator().getNodeFactory();
        let name = ins.isSendAble ? "sendable" : "local";
        const nowLevel = l.getLevel(block.getParent(), ins.pc) - ins.lexLevel - 1;
        name += "_" + nowLevel + "_";
        const assignment = factory.assignmentExpressionNode("=", factory.identifierNode(name + ins.lexIndex) as any, factory.identifierNode("acc") as any);
        mh.getCodeGenerator().getNodeUtils().insertNodeToBody(factory.expressionStatementNode(assignment as any) as any, node);
        return false;
    },
    loadLex: (ins, block, mh, l, node) => {
        const factory = mh.getCodeGenerator().getNodeFactory();
        const currentLevel = l.getLevel(block.getParent(), ins.pc);
        const type = l.getTypeInfo(block.getParent(), ins.toSignature(currentLevel));
        let name = ins.isSendAble ? "sendable" : "local";
        const nowLevel = currentLevel - ins.lexLevel - 1;
        name += "_" + nowLevel + "_";
        const assignment = factory.assignmentExpressionNode("=", factory.identifierNode("acc") as any, factory.identifierNode(name + ins.lexIndex, type) as any);
        mh.getCodeGenerator().getNodeUtils().insertNodeToBody(factory.expressionStatementNode(assignment as any) as any, node);
        return false;
    },
    popLexEnv: (_ins, _b, mh, _l, node) => {
        mh.getCodeGenerator().getNodeUtils().covert2SingleBlock(node);
        return false;
    },
    // ------------------------------------------------ 迭代器/异步/生成器
    getIterator: (ins, _b, mh, _l, node) => {
        const codeGenerator = mh.getCodeGenerator();
        const factory = codeGenerator.getNodeFactory();
        const utils = codeGenerator.getNodeUtils();
        const dest = ins.isPropIterator
            ? factory.parse("acc = Object.keys(acc)[Symbol.iterator]()")
            : factory.parse("acc = acc[Symbol.iterator]()");
        utils.insertToProgram(dest, node);
        return false;
    },
    getNextPropName: (ins, _b, mh, _l, node) => {
        const codeGenerator = mh.getCodeGenerator();
        const factory = codeGenerator.getNodeFactory();
        const utils = codeGenerator.getNodeUtils();
        let member = factory.memberExpressionNode(factory.identifierNode(ins.iteratorReg!.toString()) as any, factory.identifierNode("next") as any, false);
        const call = factory.callExpressionNode(member as any, codeGenerator.arrayObject() as any);
        member = factory.memberExpressionNode(call as any, factory.identifierNode("value") as any, false);
        assignAcc(mh, member, node);
        return false;
    },
    async: (ins, _b, mh, _l, node) => {
        const codeGenerator = mh.getCodeGenerator();
        const factory = codeGenerator.getNodeFactory();
        const utils = codeGenerator.getNodeUtils();
        if (ins.asyncType === "asyncfunctionenter") {
            utils.setIsAsyncBlock(node);
            return true; // STOP
        } else if (ins.asyncType === "asyncfunctionawaituncaught") {
            const awaitNode = factory.awaitExpressionNode(factory.identifierNode("acc") as any);
            const assignment = factory.assignmentExpressionNode("=", factory.identifierNode(ins.params[0].toString()) as any, awaitNode as any);
            utils.insertNodeToBody(factory.expressionStatementNode(assignment as any) as any, node);
        }
        return false;
    },
    generator: (ins) => {
        if (ins.generatorType === "getresumemode") return true; // STOP
        return false;
    },
    createGeneratorObj: (ins, _b, mh, _l, node) => {
        const codeGenerator = mh.getCodeGenerator();
        const factory = codeGenerator.getNodeFactory();
        const utils = codeGenerator.getNodeUtils();
        if (ins.opcode.name === "creategeneratorobj") {
            utils.setIsGeneratorBlock(node);
            return false;
        } else if (ins.opcode.name === "createiterresultobj") {
            const reg = ins.yieldReg!;
            const yieldExpressionNode = factory.yieldExpressionNode(factory.identifierNode(reg.toString()) as any);
            utils.insertNodeToBody(factory.expressionStatementNode(yieldExpressionNode as any) as any, node);
            return false;
        }
        return false;
    },
    // ------------------------------------------------ 其他
    return: (ins, block, mh, _l, node) => {
        if (block.getParent().name.content === ENTRY_FUNCTION_MAIN) return false;
        const factory = mh.getCodeGenerator().getNodeFactory();
        let returnStatementNode: any;
        if (ins.opcode.name === "returnundefined") {
            returnStatementNode = factory.returnStatementNode(null as any);
        } else {
            returnStatementNode = factory.returnStatementNode(factory.identifierNode("acc") as any);
        }
        mh.getCodeGenerator().getNodeUtils().insertNodeToBody(returnStatementNode as any, node);
        return false;
    },
    copyRestArgs: (ins, _b, mh, _l, node) => {
        const codeGenerator = mh.getCodeGenerator();
        const factory = codeGenerator.getNodeFactory();
        const index = (ins.params[0] as PandaInstructionIMM).imm;
        const member = factory.memberExpressionNode(factory.identifierNode("arguments") as any, factory.numberLiteralNode(index) as any, true);
        const spread = factory.spreadElementNode(member as any);
        const arrayObject = codeGenerator.arrayObject();
        codeGenerator.addToArray(arrayObject, spread);
        const arrayExpressionNode = factory.arrayExpressionNode(arrayObject as any);
        assignAcc(mh, arrayExpressionNode, node);
        return false;
    },
    throw: (ins, _b, mh, _l, node) => {
        const factory = mh.getCodeGenerator().getNodeFactory();
        const throwStatementNode = factory.throwStatementNode(factory.identifierNode("acc") as any);
        mh.getCodeGenerator().getNodeUtils().insertNodeToBody(throwStatementNode as any, node);
        void ins;
        return false;
    },
    // doNothing 组
    nop: () => false,
    doNothing: () => false,
    throwIf: () => false,
    assert: () => false,
    jumpEqual: () => false,
    jumpNotEqual: () => false,
    jumpDirect: () => false,
};
