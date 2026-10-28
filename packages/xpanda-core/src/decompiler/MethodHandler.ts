import { NodeFactory } from "../ast/NodeFactory";
import { NodeUtils } from "../ast/NodeUtils";
import type { PandaIRBasicBlock } from "../disasm/PandaIRBasicBlock";
import type { PandaLexical } from "../disasm/PandaLexical";
import { PandaInstruction, PandaInstructionID, PandaInstructionIMM, PandaInstructionVReg } from "../disasm/PandaInstruction";
import { StructureAnalysis } from "./StructureAnalysis";
import { SimpleAnalysis } from "./SimpleAnalysis";
import {
    applyFinallyPlans,
    buildFinallyPlans,
    buildFinallyRoles,
    createFinallyMarker,
    createFinallyMarkerExpression,
    FinallyPlan,
    FinallyRoleInfo,
    FinallyStructure,
    stripFinallyMarkers,
} from "./TryFinally";
import { PandaDecompileException } from "../PandaParseException";
import { isTempName } from "../simplify/AstUtils";
import { ENTRY_FUNCTION_MAIN } from "../file/PandaFile";
import type { PandaMethod } from "../file/method/PandaMethod";
import { PandaString } from "../file/desc/PandaString";
import { Offset } from "../file/desc/Offset";
import { PandaLiteral } from "../file/literal/PandaLiteral";
import { PandaMethod as PandaMethodClass } from "../file/method/PandaMethod";
import { LiteralTag } from "../file/desc/enums";

/**
 * 方法反编译处理器:指令分发 + 各指令 handle(移植自 Java PandaDecompilerMethodHandler 与 ins 包)
 * @Author: jmp0
 */
export class PandaDecompilerMethodHandler {
    private incNum = 0;
    /** 当前正在反编译的方法的 finally 标记角色;嵌套方法会临时切换 */
    private finallyRoles: Map<number, FinallyRoleInfo> | null = null;
    /**
     * 语句 → 来源基本块起始 pc。区域归约会把字节码结构打散,但每条 emit 出来的
     * 语句仍能回指它的块;applyFinallyPlans 用它按 pc 范围判断语句归属。
     * 只在本次反编译内使用(不进入最终 JSON)。
     */
    private readonly statementBlockPC = new WeakMap<object, number>();
    /**
     * 语句 → 产生它的**指令** pc(同一条指令可能产出多条语句)。
     * finally 的「已内联到出口前」形态要按指令定位 cleanup 副本(见 TryFinally 的
     * eager 布局),块级 pc 太粗。
     */
    private readonly statementInstructionPC = new WeakMap<object, number>();
    /** 结构化分析产出的 try 语句 → try 表里该 try 保护范围的结束 pc */
    private readonly tryBodyEndPC = new WeakMap<object, number>();

    recordTryBodyEnd(tryNode: object, endPC: number): void {
        this.tryBodyEndPC.set(tryNode, endPC);
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

    handleBlock(block: PandaIRBasicBlock, pandaLexical: PandaLexical, node: any): void {
        const body: unknown[] | null = Array.isArray(node?.body) ? node.body : null;
        const before = body ? new Set<object>(body as object[]) : null;
        const roleInfo = this.finallyRoles?.get(block.getStartPC());
        if (roleInfo) {
            // try 正常完成块只有寄存器恢复和 hole 哨兵赋值,整体丢弃
            if (roleInfo.role === "suppress") return;
            if (node.type === "BlockStatement" || node.type === "Program") {
                const marker = createFinallyMarker(roleInfo.plan, roleInfo.role);
                if (roleInfo.role === "start") roleInfo.plan.startMarker = marker;
                else if (roleInfo.role === "cleanup") roleInfo.plan.cleanupMarker = marker;
                else if (roleInfo.role === "guard") roleInfo.plan.guardMarker = marker;
                else if (roleInfo.role === "end") roleInfo.plan.endMarker = marker;
                NodeUtils.insertNodeToBody(marker as any, node);
            } else if (node.type === "SequenceExpression") {
                // 该角色的块被结构化进条件 test 的求值区(例如 try 首块正好是可选链比较,
                // cleanup 首块正好是 `sentinel === undefined` 比较):test 序列里放不了语句,
                // 这里放表达式标记,由 applyFinallyPlans 提升到“包含它的语句”。
                const marker = createFinallyMarkerExpression(roleInfo.plan, roleInfo.role);
                if (roleInfo.role === "start") roleInfo.plan.startExpr = marker;
                else if (roleInfo.role === "cleanup") roleInfo.plan.cleanupExpr = marker;
                else if (roleInfo.role === "guard") roleInfo.plan.guardExpr = marker;
                else if (roleInfo.role === "end") roleInfo.plan.endExpr = marker;
                NodeUtils.insertToSequenceExpression(marker, node);
            }
        }
        let stopped = false;
        for (const instruction of block.pandaInstructions) {
            const handle = HANDLES[instruction.kind];
            if (!handle || instruction.kind === "unknown") {
                throw new PandaDecompileException(instruction.opcode.name + " not handled!");
            }
            const instructionBefore = body ? new Set<object>(body as object[]) : null;
            if (handle(instruction, block, this, pandaLexical, node)) {
                if (instructionBefore) {
                    for (const statement of body as any[]) {
                        if (statement && typeof statement === "object" && !instructionBefore.has(statement)) {
                            this.statementInstructionPC.set(statement, instruction.pc);
                        }
                    }
                }
                stopped = true;
                break;
            }
            if (instructionBefore) {
                for (const statement of body as any[]) {
                    if (statement && typeof statement === "object" && !instructionBefore.has(statement)) {
                        this.statementInstructionPC.set(statement, instruction.pc);
                    }
                }
            }
        }
        if (body && before) {
            for (const statement of body) {
                if (statement && typeof statement === "object" && !before.has(statement)) {
                    this.statementBlockPC.set(statement, block.getStartPC());
                }
            }
        }
        if (stopped) return;
    }

    insertFunctionPreamble(method: PandaMethod, pandaLexical: PandaLexical, node: any): void {
        const factory = NodeFactory;
        const numVRegs = method.methodCode!.numVregs;
        const arrayObject = [];
        for (let i = 0; i < numVRegs; i++) {
            const name = "v" + i;
            const type = pandaLexical.getTypeInfo(method, name);
            let declarator;
            if (!type) {
                declarator = factory.variableDeclaratorNode(factory.identifierNode(name) as any, null);
            } else {
                declarator = factory.variableDeclaratorNode(factory.identifierNode(name, type) as any, null);
            }
            arrayObject.push(declarator);
        }
        arrayObject.push(factory.variableDeclaratorNode(factory.identifierNode("acc") as any, null));
        for (let i = 0; i < 3; i++) {
            arrayObject.push(factory.variableDeclaratorNode(factory.identifierNode("panda_jmp0_reserved_param_p" + i) as any, null));
        }
        const variableDeclarationNode = factory.variableDeclarationNode(arrayObject as any, "let");
        NodeUtils.insertNodeToBody(variableDeclarationNode as any, node);
        const assignment = factory.assignmentExpressionNode("=", factory.identifierNode("panda_jmp0_reserved_param_p2") as any, factory.thisExpressionNode());
        NodeUtils.insertNodeToBody(factory.expressionStatementNode(assignment as any) as any, node);
    }

    private isNumeric(str: string): boolean {
        return /^\d+$/.test(str);
    }

    decompileFunction(inner: PandaMethod, pandaLexical: PandaLexical): any {
        const factory = NodeFactory;
        const numArgs = inner.methodCode!.numArgs - 3;
        const params = [];
        for (let i = 0; i < numArgs; i++) {
            params.push(factory.identifierNode("p" + i));
        }
        const block = factory.blockStatementNode();
        if (!pandaLexical.has(inner)) {
            // 词法分析阶段失败的方法(如 jeq/jne 家族指令未实现):输出占位函数体,避免整个类反编译失败
            factory.addComment(block, " xpanda: method body unavailable (disassembly failed) ");
        } else {
            const pandaIRCFG = pandaLexical.getPandaIRCFG(inner);
            this.insertFunctionPreamble(inner, pandaLexical, block);
            // ArkTS 13 的 finally 落点不在区域图里:结构化成功后在 AST 上补 try/finally
            const savedRoles = this.finallyRoles;
            const plans: FinallyPlan[] = buildFinallyPlans(pandaIRCFG);
            const structures: FinallyStructure[] = plans.map((plan) => ({
                planId: plan.id,
                tryStartPC: plan.startPC,
                tryEndPC: plan.endPC,
                cleanupStartPC: plan.cleanupStartPC,
                guardStartPC: plan.guardStartPC,
                guardEndPC: plan.guardEndPC,
            }));
            this.finallyRoles = buildFinallyRoles(plans);
            let structured = false;
            try {
                new StructureAnalysis(pandaIRCFG, pandaIRCFG.getEntryBlock(), pandaIRCFG.getLastBlock()).analysis(this, pandaLexical, block);
                structured = true;
            } catch (e) {
                // 降级路径不再插 finally 标记,保持 SimpleAnalysis 原有输出
                this.finallyRoles = null;
                new SimpleAnalysis(pandaIRCFG).analysis(this, pandaLexical, block);
            } finally {
                this.finallyRoles = savedRoles;
            }
            if (structured) {
                applyFinallyPlans(block, plans, {
                    structures,
                    statementPC: this.statementBlockPC,
                    statementInstructionPC: this.statementInstructionPC,
                    tryBodyEndPC: this.tryBodyEndPC,
                });
            }
            else stripFinallyMarkers(block);
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
    const factory = NodeFactory;
    const utils = NodeUtils;
    const assignment = factory.assignmentExpressionNode("=", left === "acc" ? factory.identifierNode("acc") as any : left, right);
    utils.insertNodeToBody(factory.expressionStatementNode(assignment as any) as any, node);
}

/**
 * 对象/数组缓冲区兜底字面量转表达式。缓冲区里除数值/字符串/布尔外还可能有
 * 编译器标记:鸿蒙资源对象($r)的 id 字段是 LiteralTag.ACCESSOR,toString()
 * 为 "accessor:0",直接当标识符输出会生成非法 JS(id 由紧随其后的
 * __defineGetter__("id", ...) 配合 __getResourceId__ 在运行时解析)。
 * 只有 toString() 能按原样构成合法表达式(null/true/false 或合法标识符)时
 * 才输出标识符,否则输出 undefined 占位。
 */
function fallbackLiteralExpression(factory: typeof NodeFactory, value: Offset): any {
    const name = value.toString();
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
        return factory.identifierNode(name);
    }
    return factory.identifierNode("undefined");
}

// ---------------------------------------------------------------------------
// 各指令 handle(与 Java ins/*Handle 一一对应)
// ---------------------------------------------------------------------------

const HANDLES: Record<string, Handle> = {
    // ------------------------------------------------ 赋值/加载/存储
    mov: (ins, _b, mh, _l, node) => {
        const factory = NodeFactory;
        assignAcc(mh, factory.identifierNode(ins.srcObj!.toString()) as any, node, factory.identifierNode(ins.destObj!.toString()) as any);
        return false;
    },
    store: (ins, _b, mh, _l, node) => {
        const factory = NodeFactory;
        assignAcc(mh, factory.identifierNode("acc") as any, node, factory.identifierNode(ins.destObj!.toString()) as any);
        return false;
    },
    load: (ins, _b, mh, _l, node) => {
        const factory = NodeFactory;
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
        const factory = NodeFactory;
        const binary = factory.binaryExpressionNode(ins.op as any, factory.identifierNode(ins.params[1].toString()) as any, factory.identifierNode("acc") as any);
        assignAcc(mh, binary, node);
        return false;
    },
    unary: (ins, _b, mh, _l, node) => {
        const factory = NodeFactory;
        const utils = NodeUtils;
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
        const factory = NodeFactory;
        const utils = NodeUtils;
        const arrayObject = [];
        if (ins.thisObj) arrayObject.push(factory.identifierNode(ins.thisObj.toString()));
        if (ins.apply) {
            arrayObject.push(factory.spreadElementNode(factory.identifierNode(ins.callParams[0].toString()) as any) as any);
        } else {
            for (const param of ins.callParams) {
                arrayObject.push(factory.identifierNode(param.toString()));
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
        const factory = NodeFactory;
        const arrayObject = [];
        for (const vReg of ins.callParams) {
            arrayObject.push(factory.identifierNode(vReg.toString()));
        }
        const call = factory.callExpressionNode(factory.superNode() as any, arrayObject as any);
        assignAcc(mh, call, node);
        return false;
    },
    superCallSpread: (ins, _b, mh, _l, node) => {
        const factory = NodeFactory;
        const spread = factory.spreadElementNode(factory.identifierNode(ins.arr!.toString()) as any);
        const arrayObject = [];
        arrayObject.push(spread);
        const call = factory.callExpressionNode(factory.superNode() as any, arrayObject as any);
        assignAcc(mh, call, node);
        return false;
    },
    superCallForwardAllArgs: (_ins, _b, mh, _l, node) => {
        // callruntime.supercallforwardallargs v(func):运行时把当前帧的全部实参
        // (startIdx=0..numArgs)连同 newTarget 一起转发给父类构造器
        // (参考 arkcompiler RuntimeStubs::RuntimeSuperCallForwardAllArgs),
        // 源码语义等价于 super(...arguments)
        const factory = NodeFactory;
        const arrayObject = [];
        arrayObject.push(factory.spreadElementNode(factory.identifierNode("arguments") as any) as any);
        const call = factory.callExpressionNode(factory.superNode() as any, arrayObject as any);
        assignAcc(mh, call, node);
        return false;
    },
    callRuntime: (ins, _b, mh, _l, node) => {
        const factory = NodeFactory;
        const utils = NodeUtils;
        if (ins.runtimeType === "CALL_INIT") {
            const member = factory.memberExpressionNode(factory.identifierNode("acc") as any, factory.identifierNode("call") as any, false);
            const arrayObject = [];
            arrayObject.push(factory.identifierNode("panda_jmp0_reserved_param_p2"));
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
        const factory = NodeFactory;
        let className = ins.constructorMethod!.name.content;
        // 类构造器记录名 `#~@0=#GamePage`:最后一个 '#' 之后是源码类名,直接用作
        // 类表达式名——模块级类折叠、静态初始化、registerNamedRoute 这类"没有模块名
        // 赋值、只靠闭包读 lexenv 槽"的页面类都需要这个可读名字。取不到合法标识符
        // (含 acc/vN/local_* 等临时名)时退回保留名。部分工具链的记录名不带 '#'
        // 前缀(如 `newWindowWebViewClient`),名字本身是合法标识符时同样直接使用。
        const sharp = className.lastIndexOf("#");
        const sourceName = sharp >= 0 ? className.slice(sharp + 1) : "";
        if (sourceName.length > 0 && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(sourceName) && !isTempName(sourceName)) {
            className = sourceName;
        } else if (sharp < 0 && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(className) && !isTempName(className)) {
            // 记录名整体就是合法源码标识符:保持原样
        } else if (className.startsWith("#")) {
            className = "panda_jmp0_reserved_anonymous_" + mh.getNextID();
        } else {
            className = "panda_jmp0_reserved_class_" + mh.getNextID();
        }
        const classId = factory.identifierNode(className);
        const superClass = factory.identifierNode(ins.protoReg!.toString());
        const functionExp = mh.decompileFunction(ins.constructorMethod!, l);
        const constructorMethodNode = factory.classMethodNode(factory.identifierNode("constructor") as any, functionExp, "constructor", false, false);
        const bodyArray = [];
        if (ins.isSendClass) {
            for (const sv of ins.sendClassVariableDescriptions) {
                // sendable class 字面量尾部的嵌套 literal 是「字段名 + SharedFieldType 位掩码」
                // (NUMBER=1/STRING=2/BOOLEAN=4/SENDABLE=8/BIG_INT=16/GENERIC=32/NULL=64/UNDEFINED=128),
                // 掩码描述的是字段类型而不是初始值(真实赋值在构造器/static_initializer 里),
                // 这里还原成无初始化的类字段,避免输出 `handler = 32;` 这类伪代码。
                bodyArray.push(factory.classPropertyNode(factory.identifierNode(sv.variableName) as any, null));
            }
        }
        bodyArray.push(constructorMethodNode);
        for (const desc of ins.methodDescriptions) {
            const methodNode = mh.decompileFunction(desc.method, l);
            bodyArray.push(factory.classMethodNode(factory.identifierNode(desc.protoMethodName) as any, methodNode, "method", false, false));
        }
        for (const desc of ins.staticMethodDescriptions) {
            const methodNode = mh.decompileFunction(desc.method, l);
            bodyArray.push(factory.classMethodNode(factory.identifierNode(desc.protoMethodName) as any, methodNode, "method", false, true));
        }
        const body = factory.classBodyNode(bodyArray as any);
        // sendable 类带 `@Sendable` 装饰器(ArkTS 源码语义;由 definesendableclass 指令决定,
        // 构造器里的 "use sendable" 只是编译器标记)
        const decorators = ins.isSendClass ? [factory.decoratorNode(factory.identifierNode("Sendable"))] : null;
        const clazz = factory.classExpressionNode(classId as any, superClass as any, body, decorators);
        assignAcc(mh, clazz, node);
        return false;
    },
    defineGetterSetterByValue: (ins, _b, mh, _l, node) => {
        const factory = NodeFactory;
        const utils = NodeUtils;
        const objIdentifier = factory.identifierNode(ins.params[0].toString());
        const propIdentifier = factory.identifierNode(ins.params[1].toString());
        const getIdentifier = factory.identifierNode(ins.params[2].toString());
        const setIdentifier = factory.identifierNode(ins.params[3].toString());
        const getterMember = factory.memberExpressionNode(objIdentifier as any, factory.identifierNode("__defineGetter__") as any);
        const setterMember = factory.memberExpressionNode(objIdentifier as any, factory.identifierNode("__defineSetter__") as any);
        const getArr = [];
        getArr.push(propIdentifier);
        getArr.push(getIdentifier);
        const setArr = [];
        setArr.push(propIdentifier);
        setArr.push(setIdentifier);
        utils.insertNodeToBody(factory.expressionStatementNode(factory.callExpressionNode(getterMember as any, getArr as any) as any) as any, node);
        utils.insertNodeToBody(factory.expressionStatementNode(factory.callExpressionNode(setterMember as any, setArr as any) as any) as any, node);
        return false;
    },
    // ------------------------------------------------ 对象/数组
    createObject: (ins, _b, mh, l, node) => {
        const factory = NodeFactory;
        if (ins.isExcludeObject) {
            const arrayObject = [];
            arrayObject.push(factory.identifierNode(ins.excludeFormObj!.toString()));
            arrayObject.push(factory.identifierNode(ins.excludeObj!.toString()));
            arrayObject.push(factory.numberLiteralNode(ins.excludeIndex!.imm));
            const call = factory.callExpressionNode(factory.identifierNode("panda_create_exclude_object_polyfill") as any, arrayObject as any);
            assignAcc(mh, call, node);
            return false;
        }
        const props = [];
        for (const [key, value] of ins.objMap) {
            if (value instanceof PandaString) {
                props.push(factory.objectPropertyNode(factory.stringLiteralNode(key) as any, factory.stringLiteralNode(value.content) as any));
            } else if (value instanceof PandaLiteral) {
                const tag = value.tag;
                if (tag === LiteralTag.INTEGER || tag === LiteralTag.FLOAT || tag === LiteralTag.DOUBLE) {
                    props.push(factory.objectPropertyNode(factory.stringLiteralNode(key) as any, factory.numberLiteralNode(value.getValue())));
                } else if (value.toString() === "true" || value.toString() === "false") {
                    props.push(factory.objectPropertyNode(factory.stringLiteralNode(key) as any, factory.booleanLiteralNode(value.toString() === "true") as any));
                } else {
                    props.push(factory.objectPropertyNode(factory.stringLiteralNode(key) as any, fallbackLiteralExpression(factory, value)));
                }
            } else if (value instanceof PandaMethodClass) {
                props.push(factory.objectPropertyNode(factory.stringLiteralNode(key) as any, mh.decompileFunction(value, l)));
            } else {
                props.push(factory.objectPropertyNode(factory.stringLiteralNode(key) as any, fallbackLiteralExpression(factory, value)));
            }
        }
        const objNode = factory.objectExpressionNode(props as any);
        assignAcc(mh, objNode, node);
        return false;
    },
    createArray: (ins, _b, mh, _l, node) => {
        const factory = NodeFactory;
        const arrayObject = [];
        if (ins.initArr) {
            for (const offset of ins.initArr) {
                if (offset instanceof PandaLiteral) {
                    const tag = offset.tag;
                    if (tag === LiteralTag.INTEGER || tag === LiteralTag.FLOAT || tag === LiteralTag.DOUBLE) {
                        arrayObject.push(factory.numberLiteralNode(offset.getValue()));
                    } else if (tag === LiteralTag.STRING) {
                        arrayObject.push(factory.stringLiteralNode(offset.toString()));
                    } else {
                        arrayObject.push(fallbackLiteralExpression(factory, offset));
                    }
                } else if (offset instanceof PandaString) {
                    arrayObject.push(factory.stringLiteralNode(offset.content));
                } else {
                    arrayObject.push(fallbackLiteralExpression(factory, offset));
                }
            }
        }
        const arrayExpressionNode = factory.arrayExpressionNode(arrayObject as any);
        assignAcc(mh, arrayExpressionNode, node);
        return false;
    },
    newObjRange: (ins, _b, mh, _l, node) => {
        const factory = NodeFactory;
        const objNode = factory.identifierNode(ins.objectVReg!.toString());
        const params = [];
        for (const v of ins.paramsVReg) {
            params.push(factory.identifierNode(v.toString()));
        }
        const newObj = factory.newExpressionNode(objNode as any, params as any);
        assignAcc(mh, newObj, node);
        return false;
    },
    newObjSpread: (ins, _b, mh, _l, node) => {
        const factory = NodeFactory;
        const spread = factory.spreadElementNode(factory.identifierNode("acc") as any);
        const arrayObject = [];
        arrayObject.push(spread);
        const newExpressionNode = factory.newExpressionNode(factory.identifierNode(ins.cotr!.toString()) as any, arrayObject as any);
        assignAcc(mh, newExpressionNode, node);
        return false;
    },
    // ------------------------------------------------ 属性访问
    loadObjectBy: (ins, _b, mh, _l, node) => {
        const factory = NodeFactory;
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
        const factory = NodeFactory;
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
        const factory = NodeFactory;
        const member = factory.memberExpressionNode(factory.identifierNode(ins.arr!.toString()) as any, factory.numberLiteralNode(ins.arrIndex!) as any, true);
        assignAcc(mh, factory.identifierNode("acc") as any, node, member);
        return false;
    },
    storeArraySpread: (ins, _b, mh, _l, node) => {
        const factory = NodeFactory;
        // acc = dest.splice(index,0,...acc)
        const member = factory.memberExpressionNode(factory.identifierNode(ins.destObj!.toString()) as any, factory.identifierNode("splice") as any);
        const arrayObject = [];
        arrayObject.push(factory.identifierNode(ins.srcObj!.toString()));
        arrayObject.push(factory.numberLiteralNode(0));
        arrayObject.push(factory.spreadElementNode(factory.identifierNode("acc") as any));
        const call = factory.callExpressionNode(member as any, arrayObject as any);
        assignAcc(mh, call, node);
        return false;
    },
    deleteObjProp: (ins, _b, mh, _l, node) => {
        const factory = NodeFactory;
        const utils = NodeUtils;
        const member = factory.memberExpressionNode(factory.identifierNode(ins.destObj!.toString()) as any, factory.identifierNode("acc") as any, true);
        const unary = factory.unaryExpressionNode("delete", member as any);
        utils.insertNodeToBody(factory.expressionStatementNode(unary as any) as any, node);
        return false;
    },
    loadSuper: (ins, _b, mh, _l, node) => {
        const factory = NodeFactory;
        const member = factory.memberExpressionNode(factory.superNode() as any, factory.identifierNode(ins.superFuncName) as any);
        assignAcc(mh, member, node);
        return false;
    },
    loadSuperObj: (ins, _b, mh, _l, node) => {
        const factory = NodeFactory;
        let member = factory.memberExpressionNode(factory.superNode() as any, factory.identifierNode(ins.destObj!.toString()) as any, true);
        member = factory.memberExpressionNode(member as any, factory.identifierNode("acc") as any, true);
        assignAcc(mh, member, node);
        return false;
    },
    storeSuperObj: (ins, _b, mh, _l, node) => {
        const factory = NodeFactory;
        let member = factory.memberExpressionNode(factory.superNode() as any, factory.identifierNode(ins.destObj!.toString()) as any, true);
        member = factory.memberExpressionNode(member as any, factory.stringLiteralNode(ins.superProp!.content) as any, true);
        assignAcc(mh, factory.identifierNode("acc") as any, node, member);
        return false;
    },
    setObjectWithProto: (ins, _b, mh, _l, node) => {
        const factory = NodeFactory;
        const utils = NodeUtils;
        const member = factory.memberExpressionNode(factory.identifierNode("Object") as any, factory.identifierNode("setPrototypeOf") as any);
        const arrayObject = [];
        arrayObject.push(factory.identifierNode("acc"));
        arrayObject.push(factory.identifierNode(ins.protoReg!.toString()));
        const call = factory.callExpressionNode(member as any, arrayObject as any);
        utils.insertNodeToBody(factory.expressionStatementNode(call as any) as any, node);
        return false;
    },
    copyDataProperties: (ins, _b, mh, _l, node) => {
        const factory = NodeFactory;
        const utils = NodeUtils;
        const member = factory.memberExpressionNode(factory.identifierNode("Object") as any, factory.identifierNode("assign") as any);
        const arrayObject = [];
        arrayObject.push(factory.objectExpressionNode([] as any));
        arrayObject.push(factory.identifierNode("acc"));
        const call = factory.callExpressionNode(member as any, arrayObject as any);
        assignAcc(mh, call, node, factory.identifierNode(ins.destObj!.toString()) as any);
        void utils;
        return false;
    },
    // ------------------------------------------------ 全局/模块
    storeObjectRecord: (ins, _b, mh, _l, node) => {
        const factory = NodeFactory;
        const utils = NodeUtils;
        const kind = ins.recordType;
        const name = (ins.storeKey as PandaInstructionID).obj as PandaString;
        const declarator = factory.variableDeclaratorNode(factory.identifierNode(name.content) as any, factory.identifierNode("acc") as any);
        const array = [];
        array.push(declarator);
        utils.insertNodeToBody(factory.variableDeclarationNode(array as any, kind as any) as any, node);
        return false;
    },
    loadGlobal: (ins, _b, mh, _l, node) => {
        const factory = NodeFactory;
        assignAcc(mh, factory.identifierNode(ins.globalName!.content) as any, node);
        return false;
    },
    storeModuleVar: (ins, _b, mh, _l, node) => {
        const factory = NodeFactory;
        const utils = NodeUtils;
        const localName = (ins.module as any).localName;
        const assignment = factory.assignmentExpressionNode("=", factory.identifierNode(localName) as any, factory.identifierNode("acc") as any);
        utils.insertNodeToBody(factory.expressionStatementNode(assignment as any) as any, node);
        return false;
    },
    loadModuleVar: (ins, _b, mh, _l, node) => {
        const factory = NodeFactory;
        assignAcc(mh, factory.identifierNode((ins.module as any).localName) as any, node);
        return false;
    },
    loadExternalModuleVar: (ins, _b, mh, _l, node) => {
        const factory = NodeFactory;
        assignAcc(mh, factory.identifierNode((ins.module as any).localName) as any, node);
        return false;
    },
    // ------------------------------------------------ 词法环境
    newLexEnv: (ins, block, mh, l, node) => {
        const factory = NodeFactory;
        const utils = NodeUtils;
        // 环境实例的唯一前缀(同层级连续出现的多个环境带 `_2`/`_3` 后缀)
        const prefix = l.getLexPrefix(block.getParent(), ins.pc)
            ?? (ins.isSendAble ? "sendable" : "local") + "_" + l.getLevel(block.getParent(), ins.pc);
        const arrayObject = [];
        for (let i = 0; i < ins.lexImm; i++) {
            arrayObject.push(factory.variableDeclaratorNode(factory.identifierNode(prefix + "_" + i) as any, null));
        }
        const variableDeclarationNode = factory.variableDeclarationNode(arrayObject as any, "let");
        utils.insertNodeToBody(factory.expressionStatementNode(factory.identifierNode("panda_jmp0_reserved_lex_begin") as any) as any, node);
        utils.insertNodeToBody(variableDeclarationNode as any, node);
        return false;
    },
    storeLex: (ins, block, mh, l, node) => {
        const factory = NodeFactory;
        const method = block.getParent();
        const prefix = l.getLexPrefix(method, ins.pc)
            ?? (ins.isSendAble ? "sendable" : "local") + "_" + (l.getLevel(method, ins.pc) - ins.lexLevel - 1);
        const name = prefix + "_" + ins.lexIndex;
        const assignment = factory.assignmentExpressionNode("=", factory.identifierNode(name) as any, factory.identifierNode("acc") as any);
        NodeUtils.insertNodeToBody(factory.expressionStatementNode(assignment as any) as any, node);
        return false;
    },
    loadLex: (ins, block, mh, l, node) => {
        const factory = NodeFactory;
        const method = block.getParent();
        const prefix = l.getLexPrefix(method, ins.pc)
            ?? (ins.isSendAble ? "sendable" : "local") + "_" + (l.getLevel(method, ins.pc) - ins.lexLevel - 1);
        const name = prefix + "_" + ins.lexIndex;
        const type = l.getTypeInfo(method, name);
        const assignment = factory.assignmentExpressionNode("=", factory.identifierNode("acc") as any, factory.identifierNode(name, type) as any);
        NodeUtils.insertNodeToBody(factory.expressionStatementNode(assignment as any) as any, node);
        return false;
    },
    popLexEnv: (_ins, _b, mh, _l, node) => {
        // poplexenv 只负责关闭词法作用域(把块里后续语句收进嵌套块)。
        // 结构化归约也可能把它放进条件 test 的 SequenceExpression,那里没有语句块
        // 可切;环境名本身按实例唯一,跳过即可,否则 node.body 未定义会抛
        // TypeError 让整个方法降级 SimpleAnalysis。
        if (node.type === "BlockStatement" || node.type === "Program") {
            NodeUtils.covert2SingleBlock(node);
        }
        return false;
    },
    // ------------------------------------------------ 迭代器/异步/生成器
    getIterator: (ins, _b, mh, _l, node) => {
        const factory = NodeFactory;
        const utils = NodeUtils;
        const dest = ins.isPropIterator
            ? factory.parse("acc = Object.keys(acc)[Symbol.iterator]()")
            : factory.parse("acc = acc[Symbol.iterator]()");
        utils.insertToProgram(dest, node);
        return false;
    },
    getNextPropName: (ins, _b, mh, _l, node) => {
        const factory = NodeFactory;
        const utils = NodeUtils;
        let member = factory.memberExpressionNode(factory.identifierNode(ins.iteratorReg!.toString()) as any, factory.identifierNode("next") as any, false);
        const call = factory.callExpressionNode(member as any, [] as any);
        member = factory.memberExpressionNode(call as any, factory.identifierNode("value") as any, false);
        assignAcc(mh, member, node);
        return false;
    },
    async: (ins, _b, mh, _l, node) => {
        const factory = NodeFactory;
        const utils = NodeUtils;
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
        const factory = NodeFactory;
        const utils = NodeUtils;
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
        const factory = NodeFactory;
        let returnStatementNode: any;
        if (ins.opcode.name === "returnundefined") {
            returnStatementNode = factory.returnStatementNode(null as any);
        } else {
            returnStatementNode = factory.returnStatementNode(factory.identifierNode("acc") as any);
        }
        NodeUtils.insertNodeToBody(returnStatementNode as any, node);
        return false;
    },
    copyRestArgs: (ins, _b, mh, _l, node) => {
        const factory = NodeFactory;
        const index = (ins.params[0] as PandaInstructionIMM).imm;
        const member = factory.memberExpressionNode(factory.identifierNode("arguments") as any, factory.numberLiteralNode(index) as any, true);
        const spread = factory.spreadElementNode(member as any);
        const arrayObject = [];
        arrayObject.push(spread);
        const arrayExpressionNode = factory.arrayExpressionNode(arrayObject as any);
        assignAcc(mh, arrayExpressionNode, node);
        return false;
    },
    throw: (ins, _b, mh, _l, node) => {
        const factory = NodeFactory;
        const throwStatementNode = factory.throwStatementNode(factory.identifierNode("acc") as any);
        NodeUtils.insertNodeToBody(throwStatementNode as any, node);
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
