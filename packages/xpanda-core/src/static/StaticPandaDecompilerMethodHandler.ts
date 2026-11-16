import * as t from "@babel/types";
import { NodeFactory } from "../ast/NodeFactory";
import { NodeUtils } from "../ast/NodeUtils";
import type { PandaIRCFG } from "../disasm/PandaIRCFG";
import { PandaDecompilerMethodHandler, type Handle } from "../decompiler/MethodHandler";
import { SimpleAnalysis } from "../decompiler/SimpleAnalysis";
import { StructureAnalysis } from "../decompiler/StructureAnalysis";
import type { PandaMethod } from "../file/method/PandaMethod";
import { PandaString } from "../file/desc/PandaString";
import type { StaticPandaLexical } from "./StaticPandaLexical";
import {
    protoParamCount,
    StaticPandaACC,
    StaticPandaID,
    StaticPandaIMM,
    StaticPandaInstruction,
    StaticPandaVReg,
} from "./StaticPandaInstruction";
import { sanitizeIdentifier, simpleClassName } from "./StaticNaming";

const ACC_STATIC = 0x0008;

/**
 * AST builder for ArkTS-Sta methods. It reuses the dynamic handler's statement
 * insertion / block dispatch infrastructure and the shared StructureAnalysis +
 * SimpleAnalysis + SimplifyExport pipeline, while implementing the static ISA's
 * own instruction semantics.
 *
 * @Author: jmp0
 */
export class StaticPandaDecompilerMethodHandler extends PandaDecompilerMethodHandler {
    protected getHandles(): Record<string, Handle> {
        return STATIC_HANDLES as unknown as Record<string, Handle>;
    }

    /** Decompile one method into a function declaration. */
    decompileMethod(method: PandaMethod, lexical: StaticPandaLexical, overrideName?: string): t.FunctionDeclaration {
        const factory = NodeFactory;
        const block = factory.blockStatementNode();
        const cfg = lexical.getPandaIRCFG(method) as unknown as PandaIRCFG;
        this.insertStaticPreamble(method, block);
        this.withFunctionBody(block, () => {
            try {
                new StructureAnalysis(cfg, cfg.getEntryBlock(), cfg.getLastBlock())
                    .analysis(this, lexical as any, block);
            } catch {
                new SimpleAnalysis(cfg).analysis(this, lexical as any, block);
            }
        });
        const params: t.Identifier[] = [];
        for (let i = 0; i < declaredParamCount(method); i++) params.push(t.identifier("p" + i));
        return t.functionDeclaration(t.identifier(overrideName ?? sanitizeIdentifier(method.name.content)), params, block);
    }

    private insertStaticPreamble(method: PandaMethod, block: t.BlockStatement): void {
        const factory = NodeFactory;
        const declarators: t.VariableDeclarator[] = [];
        const numVregs = method.methodCode!.numVregs;
        for (let i = 0; i < numVregs; i++) {
            declarators.push(factory.variableDeclaratorNode(factory.identifierNode("v" + i) as t.LVal, null));
        }
        declarators.push(factory.variableDeclaratorNode(factory.identifierNode("acc") as t.LVal, null));
        const declaration = factory.variableDeclarationNode(declarators, "let");
        NodeUtils.insertNodeToBody(declaration as any, block);
    }
}

function declaredParamCount(method: PandaMethod): number {
    const protoParams = protoParamCount(method);
    if (protoParams > 0) return protoParams;
    const numArgs = method.methodCode?.numArgs ?? 0;
    return Math.max(0, numArgs - (isStaticMethod(method) ? 0 : 1));
}

function isStaticMethod(method: PandaMethod): boolean {
    return (method.accessFlag & ACC_STATIC) !== 0;
}

function ident(value: StaticPandaVReg | StaticPandaACC): t.Expression {
    if (value instanceof StaticPandaACC) return t.identifier("acc");
    const name = value.toString();
    // The instance parameter renders as `this`; keep a real ThisExpression so
    // scope-aware passes (and the lambda inliner) can recognize it.
    return name === "this" ? t.thisExpression() : t.identifier(name);
}

function emitAssignment(left: t.LVal | t.OptionalMemberExpression, right: t.Expression, node: any): void {
    const factory = NodeFactory;
    NodeUtils.insertNodeToBody(
        factory.expressionStatementNode(factory.assignmentExpressionNode("=", left, right) as any) as any,
        node);
}

function memberOf(object: t.Expression, key: string): t.MemberExpression {
    if (key.startsWith("#") && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key.substring(1))) {
        return t.memberExpression(object, t.privateName(t.identifier(key.substring(1))));
    }
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) {
        return t.memberExpression(object, t.identifier(key));
    }
    return t.memberExpression(object, t.stringLiteral(key), true);
}

function staticFieldOwner(ins: StaticPandaInstruction): string | null {
    const owner = ins.fieldClassName;
    if (!owner) return null;
    if (owner === "ETSGLOBAL" || owner.startsWith("partial-")) return null;
    return sanitizeIdentifier(owner);
}

function stringOf(value: StaticPandaID): string | null {
    if (value.obj instanceof PandaString) return value.obj.content;
    return null;
}

function callArgsOf(ins: StaticPandaInstruction): t.Expression[] {
    return ins.callArgs.map((arg: any) => arg instanceof StaticPandaVReg ? ident(arg) : arg instanceof StaticPandaACC ? t.identifier("acc") : t.identifier(String(arg)));
}

function methodBaseName(method: PandaMethod | null): string {
    if (!method) return "unknownMethod";
    return sanitizeIdentifier(method.name.content);
}

function propertyName(methodName: string): string | null {
    if (methodName.startsWith("%%get-")) return methodName.substring(6);
    if (methodName.startsWith("%%set-")) return methodName.substring(6);
    return null;
}

const STATIC_HANDLES: Record<string, (ins: StaticPandaInstruction, block: any, mh: StaticPandaDecompilerMethodHandler, _l: any, node: any) => boolean> = {
    nop: () => false,
    mov: (ins, _b, _mh, _l, node) => {
        const factory = NodeFactory;
        const dest = ins.destObj ? ident(ins.destObj) : t.identifier("acc");
        if (ins.loadType === "NULL") {
            emitAssignment(dest as t.LVal, factory.nullLiteralNode() as any, node);
        } else if (ins.loadType === "IMM" || ins.loadType === "FLOAT") {
            const imm = ins.loadParam as StaticPandaIMM;
            emitAssignment(dest as t.LVal, factory.numberLiteralNode(imm ? imm.imm : 0) as any, node);
        } else if (ins.srcObj) {
            emitAssignment(dest as t.LVal, ident(ins.srcObj) as any, node);
        }
        return false;
    },
    store: (ins, _b, _mh, _l, node) => {
        if (ins.destObj) emitAssignment(ident(ins.destObj) as t.LVal, t.identifier("acc"), node);
        return false;
    },
    load: (ins, _b, _mh, _l, node) => {
        const factory = NodeFactory;
        let value: t.Expression;
        if (ins.loadType === "STRING") {
            const str = ins.loadParam instanceof StaticPandaID ? stringOf(ins.loadParam) : null;
            value = factory.stringLiteralNode(str ?? "") as any;
        } else if (ins.loadType === "IMM" || ins.loadType === "FLOAT") {
            const imm = ins.loadParam as StaticPandaIMM;
            value = factory.numberLiteralNode(imm ? imm.imm : 0) as any;
        } else if (ins.loadType === "NULL") {
            value = factory.nullLiteralNode() as any;
        } else if (ins.loadType === "TYPE") {
            const id = ins.loadParam as StaticPandaID;
            const clazz = id && id.obj && typeof (id.obj as any).getClassName === "function"
                ? id.obj as unknown as { getClassName(): string }
                : null;
            const name = clazz ? simpleClassName(clazz.getClassName()) : "unknown";
            value = t.identifier(sanitizeIdentifier(name));
        } else if (ins.loadParam instanceof StaticPandaVReg) {
            value = ident(ins.loadParam);
        } else {
            value = t.identifier("undefined");
        }
        emitAssignment(t.identifier("acc") as t.LVal, value, node);
        return false;
    },
    binaryOp: (ins, _b, _mh, _l, node) => {
        const factory = NodeFactory;
        const name = ins.opcode.name;
        if (name === "inci") {
            const v = ins.params[0] as StaticPandaVReg;
            const imm = ins.params[1] as StaticPandaIMM;
            const sum = factory.binaryExpressionNode("+", ident(v) as any, factory.numberLiteralNode(imm.imm) as any);
            emitAssignment(ident(v) as t.LVal, sum as any, node);
            return false;
        }
        if (!ins.binaryShape) return false;
        const param = (index: number): StaticPandaVReg | StaticPandaIMM => ins.params[index];
        switch (ins.binaryShape) {
            case "accReg": {
                const right = ident(param(0) as StaticPandaVReg);
                const expr = factory.binaryExpressionNode(ins.op as any, t.identifier("acc"), right as any);
                emitAssignment(t.identifier("acc") as t.LVal, expr as any, node);
                break;
            }
            case "regReg": {
                const v1 = param(0) as StaticPandaVReg;
                const v2 = param(1) as StaticPandaVReg;
                const expr = factory.binaryExpressionNode(ins.op as any, ident(v1) as any, ident(v2) as any);
                emitAssignment(ident(v1) as t.LVal, expr as any, node);
                break;
            }
            case "accImm": {
                const imm = param(0) as StaticPandaIMM;
                const expr = factory.binaryExpressionNode(ins.op as any, t.identifier("acc"), factory.numberLiteralNode(imm.imm) as any);
                emitAssignment(t.identifier("acc") as t.LVal, expr as any, node);
                break;
            }
            case "regRegImm": {
                const v1 = param(0) as StaticPandaVReg;
                const v2 = param(1) as StaticPandaVReg;
                const imm = param(2) as StaticPandaIMM;
                const expr = factory.binaryExpressionNode(ins.op as any, ident(v2) as any, factory.numberLiteralNode(imm.imm) as any);
                emitAssignment(ident(v1) as t.LVal, expr as any, node);
                break;
            }
            case "regReg3": {
                const v1 = param(0) as StaticPandaVReg;
                const v2 = param(1) as StaticPandaVReg;
                const expr = factory.binaryExpressionNode(ins.op as any, ident(v1) as any, ident(v2) as any);
                emitAssignment(t.identifier("acc") as t.LVal, expr as any, node);
                break;
            }
            case "regRegNew": {
                const v1 = param(0) as StaticPandaVReg;
                const v2 = param(1) as StaticPandaVReg;
                const expr = factory.binaryExpressionNode(ins.op as any, ident(v1) as any, ident(v2) as any);
                emitAssignment(ident(v1) as t.LVal, expr as any, node);
                break;
            }
            default:
                break;
        }
        return false;
    },
    unary: (ins, _b, _mh, _l, node) => {
        const factory = NodeFactory;
        const name = ins.opcode.name;
        let expr: t.Expression | null = null;
        if (name === "ets.istrue") {
            const v = ins.params[0] as StaticPandaVReg;
            expr = t.unaryExpression("!", t.unaryExpression("!", ident(v)));
        } else if (name === "ets.equals" || name === "ets.strictequals") {
            const v1 = ins.params[0] as StaticPandaVReg;
            const v2 = ins.params[1] as StaticPandaVReg;
            expr = t.binaryExpression(name === "ets.equals" ? "==" : "===", ident(v1), ident(v2));
        } else if (name === "ets.typeof") {
            const v = ins.params[0] as StaticPandaVReg;
            expr = t.unaryExpression("typeof", ident(v));
        } else if (name === "ets.isnullvalue") {
            expr = t.binaryExpression("==", t.identifier("acc"), t.nullLiteral());
        } else if (ins.op) {
            expr = t.unaryExpression(ins.op as any, t.identifier("acc"));
        }
        if (expr) emitAssignment(t.identifier("acc") as t.LVal, expr, node);
        return false;
    },
    compare: (ins, _b, _mh, _l, node) => {
        const v = ins.params[0] as StaticPandaVReg;
        if (!v) return false;
        const acc = t.identifier("acc");
        const cond = t.conditionalExpression(
            t.binaryExpression("<", acc, ident(v)),
            t.numericLiteral(-1),
            t.conditionalExpression(
                t.binaryExpression(">", t.identifier("acc"), ident(v)),
                t.numericLiteral(1),
                t.numericLiteral(0)),
        );
        emitAssignment(t.identifier("acc") as t.LVal, cond, node);
        return false;
    },
    jumpDirect: () => false,
    jumpEqual: () => false,
    jumpNotEqual: (ins, _b, _mh, _l, node) => {
        if (!ins.condition) return false;
        const factory = NodeFactory;
        const right = ins.condition.operand
            ? ident(ins.condition.operand)
            : (ins.condition.nullCheck ? factory.nullLiteralNode() as any : factory.numberLiteralNode(0) as any);
        const expr = factory.binaryExpressionNode(ins.condition.op as any, t.identifier("acc"), right as any);
        emitAssignment(t.identifier("acc") as t.LVal, expr as any, node);
        return false;
    },
    return: (ins, _b, _mh, _l, node) => {
        const factory = NodeFactory;
        const value = ins.opcode.name === "return.void" ? null : t.identifier("acc");
        NodeUtils.insertNodeToBody(factory.returnStatementNode(value as any) as any, node);
        return true;
    },
    throw: (ins, _b, _mh, _l, node) => {
        const value = ins.params[0] instanceof StaticPandaVReg ? ident(ins.params[0]) : t.identifier("acc");
        NodeUtils.insertNodeToBody(t.throwStatement(value), node);
        return true;
    },
    call: (ins, _b, _mh, _l, node) => {
        if (ins.opcode.name.startsWith("ets.call.name")) {
            const callee = ins.callThis
                ? memberOf(ins.callThis instanceof StaticPandaACC ? t.identifier("acc") : ident(ins.callThis), ins.callName ?? "unknownMethod")
                : t.identifier(ins.callName ?? "unknownMethod");
            emitAssignment(t.identifier("acc") as t.LVal, t.callExpression(callee, callArgsOf(ins)), node);
            return false;
        }
        if (ins.callKind === "init") {
            const owner = simpleClassName(ins.callMethod?.getParent()?.getClassName() ?? "Object");
            emitAssignment(t.identifier("acc") as t.LVal,
                t.newExpression(t.identifier(sanitizeIdentifier(owner)), callArgsOf(ins)), node);
            return false;
        }
        if (ins.callKind === "virtual" || ins.callKind === "named") {
            const receiver = ins.callThis instanceof StaticPandaACC
                ? t.identifier("acc")
                : (ins.callThis ? ident(ins.callThis) : t.identifier("acc"));
            const name = ins.callKind === "named" ? (ins.callName ?? "unknownMethod") : methodBaseName(ins.callMethod);
            // Static ArkTS function values are `FunctionN`/`LambdaN` objects invoked
            // through `invokeN(...)`; source-level is a plain call.
            const owner = simpleClassName(ins.callMethod?.getParent()?.getClassName() ?? "");
            if (/^invoke\d+$/.test(name) && /^(Function|Lambda)\d+$/.test(owner)) {
                emitAssignment(t.identifier("acc") as t.LVal,
                    t.callExpression(receiver, callArgsOf(ins)), node);
                return false;
            }
            if (ins.callKind === "virtual" && ins.callMethod?.name.content === "<ctor>") {
                // A direct instance call to a constructor from another constructor:
                // source-level `super(...)`. Calls to the Object constructor are
                // omitted because the rendered class has no explicit base class.
                const owner = ins.callMethod.getParent()?.getClassName() ?? "";
                if (simpleClassName(owner) !== "Object") {
                    emitAssignment(t.identifier("acc") as t.LVal,
                        t.callExpression(t.super(), callArgsOf(ins)), node);
                }
                return false;
            }
            const prop = propertyName(name);
            if (prop !== null && name.startsWith("%%get-")) {
                emitAssignment(t.identifier("acc") as t.LVal, memberOf(receiver, prop), node);
                return false;
            }
            if (prop !== null && name.startsWith("%%set-")) {
                const args = callArgsOf(ins);
                emitAssignment(memberOf(receiver, prop) as any, args[0] ?? t.identifier("undefined"), node);
                return false;
            }
            const callee = memberOf(receiver, name);
            emitAssignment(t.identifier("acc") as t.LVal, t.callExpression(callee, callArgsOf(ins)), node);
            return false;
        }
        if (ins.callKind === "any") {
            const callee = ins.callThis
                ? (ins.callThis instanceof StaticPandaACC ? t.identifier("acc") : ident(ins.callThis))
                : t.identifier("acc");
            emitAssignment(t.identifier("acc") as t.LVal, t.callExpression(callee, callArgsOf(ins)), node);
            return false;
        }
        let callee: t.Expression = t.identifier(methodBaseName(ins.callMethod));
        // `Lstd/core/Promise.resolve/reject/...` are static natives; qualify them
        // so they cannot be shadowed by a surrounding `resolve`/`reject` binding
        // (common after inlining a Promise executor).
        const ownerName = simpleClassName(ins.callMethod?.getParent()?.getClassName() ?? "");
        if (ownerName === "Promise") {
            callee = memberOf(t.identifier("Promise"), methodBaseName(ins.callMethod));
        }
        emitAssignment(t.identifier("acc") as t.LVal, t.callExpression(callee, callArgsOf(ins)), node);
        return false;
    },
    newObj: (ins, _b, _mh, _l, node) => {
        if (!ins.destObj) return false;
        const init = ins.newInit;
        const owner = simpleClassName((init?.callMethod?.getParent() ?? ins.typeClass)?.getClassName() ?? "Object");
        const args = init ? callArgsOf(init) : [];
        emitAssignment(ident(ins.destObj) as t.LVal,
            t.newExpression(t.identifier(sanitizeIdentifier(owner)), args), node);
        return false;
    },
    initObj: (ins, _b, _mh, _l, node) => {
        const owner = simpleClassName(ins.callMethod?.getParent()?.getClassName() ?? "Object");
        emitAssignment(t.identifier("acc") as t.LVal,
            t.newExpression(t.identifier(sanitizeIdentifier(owner)), callArgsOf(ins)), node);
        return false;
    },
    newArray: (ins, _b, _mh, _l, node) => {
        if (!ins.destObj) return false;
        const length = ins.arrayIndexReg ? ident(ins.arrayIndexReg) : t.numericLiteral(0);
        emitAssignment(ident(ins.destObj) as t.LVal,
            t.newExpression(t.identifier("Array"), [length]), node);
        return false;
    },
    arrayLoad: (ins, _b, _mh, _l, node) => {
        if (!ins.arrayReg) return false;
        const member = t.memberExpression(ident(ins.arrayReg), t.identifier("acc"), true);
        emitAssignment(t.identifier("acc") as t.LVal, member, node);
        return false;
    },
    arrayStore: (ins, _b, _mh, _l, node) => {
        if (!ins.arrayReg) return false;
        const key = ins.arrayIndexReg ? ident(ins.arrayIndexReg) : t.identifier("acc");
        const member = t.memberExpression(ident(ins.arrayReg), key as any, true);
        emitAssignment(member as any, t.identifier("acc"), node);
        return false;
    },
    arrayLength: (ins, _b, _mh, _l, node) => {
        if (!ins.arrayReg) return false;
        emitAssignment(t.identifier("acc") as t.LVal,
            t.memberExpression(ident(ins.arrayReg), t.identifier("length")), node);
        return false;
    },
    fieldLoad: (ins, _b, _mh, _l, node) => {
        const fieldName = ins.fieldName ?? "unknownField";
        const dest = ins.destObj ? ident(ins.destObj) : t.identifier("acc");
        if (ins.fieldIsStatic) {
            const owner = staticFieldOwner(ins);
            const value = owner ? memberOf(t.identifier(owner), fieldName) : t.identifier(fieldName);
            emitAssignment(dest as t.LVal, value, node);
        } else {
            const src = ins.srcObj ? ident(ins.srcObj) : t.identifier("acc");
            emitAssignment(dest as t.LVal, memberOf(src, fieldName), node);
        }
        return false;
    },
    fieldStore: (ins, _b, _mh, _l, node) => {
        const fieldName = ins.fieldName ?? "unknownField";
        const value = ins.valueReg ? ident(ins.valueReg) : t.identifier("acc");
        if (ins.fieldIsStatic) {
            const owner = staticFieldOwner(ins);
            const member = owner ? memberOf(t.identifier(owner), fieldName) : t.identifier(fieldName);
            emitAssignment(member as any, value, node);
        } else {
            const src = ins.srcObj ? ident(ins.srcObj) : t.identifier("acc");
            emitAssignment(memberOf(src, fieldName) as any, value, node);
        }
        return false;
    },
    cast: () => false,
    nullCheck: () => false,
    instanceof: (ins, _b, _mh, _l, node) => {
        const owner = simpleClassName(ins.typeClass?.getClassName() ?? "Object");
        emitAssignment(t.identifier("acc") as t.LVal,
            t.binaryExpression("instanceof", t.identifier("acc"), t.identifier(sanitizeIdentifier(owner))), node);
        return false;
    },
    async: (ins, _b, _mh, _l, node) => {
        const v = ins.params[0] instanceof StaticPandaVReg ? ident(ins.params[0]) : t.identifier("acc");
        if (ins.opcode.name.endsWith(".await")) {
            emitAssignment(t.identifier("acc") as t.LVal, t.awaitExpression(v), node);
        } else if (ins.opcode.name.endsWith(".unpack")) {
            emitAssignment(t.identifier("acc") as t.LVal, v, node);
        }
        return false;
    },
};
