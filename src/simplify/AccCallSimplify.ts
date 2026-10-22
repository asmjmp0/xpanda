import { Program } from "@babel/types";
import * as TYPE from "@babel/types";
import traverse from "@babel/traverse";
import { ISimplify } from "./ISimplify";
import { collectAssignedNames, collectIdentifierNames, isTempName } from "./AstUtils";

/**
 * 还原 ArkCompiler 通过累加器调用方法的字节码形态。
 *
 * 编译器调用 `recv.method(args)` 时会先把接收者保存到临时变量,再经 acc 装载方法:
 *
 *   v8 = acc;
 *   acc = acc.then;
 *   acc.call(v8, callback);
 *
 * 等价于 `v8.then(callback)`。这里在语句层面识别该形态并直接还原成成员调用,
 * 避免优化器在 `acc = acc.method` 这种自引用赋值上停住。
 *
 * @Author: jmp0
 * @Email: jmp0@qq.com
 */
export class AccCallSimplify implements ISimplify {
    private static isAcc(node: TYPE.Node | null | undefined): boolean {
        return TYPE.isIdentifier(node) && node.name === "acc";
    }

    /** 匹配 `acc = acc.prop` / `acc = acc["prop"]`,返回属性名。 */
    private matchMethodLoad(stmt: TYPE.Statement): string | null {
        if (!TYPE.isExpressionStatement(stmt) || !TYPE.isAssignmentExpression(stmt.expression)) return null;
        const assign = stmt.expression;
        if (assign.operator !== "=" || !AccCallSimplify.isAcc(assign.left)) return null;
        if (!TYPE.isMemberExpression(assign.right) || !AccCallSimplify.isAcc(assign.right.object)) return null;
        const property = assign.right.property;
        if (!assign.right.computed && TYPE.isIdentifier(property)) return property.name;
        if (assign.right.computed && TYPE.isStringLiteral(property) && /^[A-Za-z_$][\w$]*$/.test(property.value)) {
            return property.value;
        }
        return null;
    }

    /** 匹配 `acc.call(recv, ...)` 及其赋值/返回包装。 */
    private matchAccCall(stmt: TYPE.Statement): {
        mode: "assign" | "expr" | "return";
        receiver: TYPE.Expression;
        args: TYPE.CallExpression["arguments"];
    } | null {
        let call: TYPE.Node | null = null;
        let mode: "assign" | "expr" | "return" = "expr";
        if (TYPE.isReturnStatement(stmt) && stmt.argument) {
            call = stmt.argument;
            mode = "return";
        } else if (TYPE.isExpressionStatement(stmt)) {
            const expr = stmt.expression;
            if (TYPE.isAssignmentExpression(expr) && expr.operator === "=" && AccCallSimplify.isAcc(expr.left)) {
                call = expr.right;
                mode = "assign";
            } else {
                call = expr;
            }
        }
        if (!call || !TYPE.isCallExpression(call)) return null;
        const callee = call.callee;
        if (!TYPE.isMemberExpression(callee) || callee.computed) return null;
        if (!TYPE.isIdentifier(callee.property) || callee.property.name !== "call") return null;
        if (!AccCallSimplify.isAcc(callee.object)) return null;
        if (call.arguments.length === 0) return null;
        const [receiver, ...args] = call.arguments;
        if (!TYPE.isExpression(receiver)) return null;
        return { mode, receiver, args: args as TYPE.CallExpression["arguments"] };
    }

    private matchReceiverAssign(stmt: TYPE.Statement, name: string): boolean {
        return TYPE.isExpressionStatement(stmt)
            && TYPE.isAssignmentExpression(stmt.expression)
            && stmt.expression.operator === "="
            && TYPE.isIdentifier(stmt.expression.left)
            && stmt.expression.left.name === name
            && AccCallSimplify.isAcc(stmt.expression.right);
    }

    /**
     * 在 list 中寻找 `recv = acc; acc = acc.prop; acc.call(recv, ...)`。
     * 返回 recv 的名字;找不到或不安全时返回 null。
     */
    private matchPattern(list: TYPE.Statement[], loadIndex: number): string | null {
        const stmt = list[loadIndex];
        const method = this.matchMethodLoad(stmt);
        if (method === null) return null;
        const call = this.matchAccCall(list[loadIndex + 1]);
        if (!call || !TYPE.isIdentifier(call.receiver)) return null;
        const receiverName = call.receiver.name;
        if (!isTempName(receiverName)) return null;
        // 参数里若读取 acc,原语句读到的可能是刚装载的方法;改写后会读成旧值。
        if (call.args.some((arg) => collectIdentifierNames(arg as TYPE.Node).has("acc"))) return null;

        // 向前找到 `recv = acc`,并确认期间 acc 没有被改写。
        for (let i = loadIndex - 1; i >= 0; i--) {
            const previous = list[i];
            const writes = collectAssignedNames(previous);
            if (writes.has("acc")) return null;
            if (writes.has(receiverName)) {
                return this.matchReceiverAssign(previous, receiverName) ? receiverName : null;
            }
        }
        return null;
    }

    private rewrite(list: TYPE.Statement[], loadIndex: number, receiverName: string): void {
        const method = this.matchMethodLoad(list[loadIndex])!;
        const call = this.matchAccCall(list[loadIndex + 1])!;
        const member = TYPE.memberExpression(TYPE.identifier(receiverName), TYPE.identifier(method), false);
        const newCall = TYPE.callExpression(member, call.args);
        if (call.mode === "assign") {
            list[loadIndex + 1] = TYPE.expressionStatement(
                TYPE.assignmentExpression("=", TYPE.identifier("acc"), newCall));
        } else if (call.mode === "return") {
            list[loadIndex + 1] = TYPE.returnStatement(newCall);
        } else {
            list[loadIndex + 1] = TYPE.expressionStatement(newCall);
        }
        list.splice(loadIndex, 1);
    }

    private simplifyBody(list: TYPE.Statement[]): boolean {
        let changed = false;
        for (let i = list.length - 2; i >= 0; i--) {
            const receiverName = this.matchPattern(list, i);
            if (receiverName === null) continue;
            this.rewrite(list, i, receiverName);
            changed = true;
        }
        return changed;
    }

    simplify(node: Program): boolean {
        const bodies: TYPE.Statement[][] = [];
        traverse(TYPE.file(node), {
            Program: (path) => { bodies.push(path.node.body); },
            BlockStatement: (path) => { bodies.push(path.node.body); },
        });
        let changed = false;
        for (const body of bodies) {
            if (this.simplifyBody(body)) changed = true;
        }
        return changed;
    }
}
