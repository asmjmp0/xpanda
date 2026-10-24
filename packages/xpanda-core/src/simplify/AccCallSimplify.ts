import { Program } from "@babel/types";
import * as TYPE from "@babel/types";
import { ISimplify } from "./ISimplify";
import { collectAssignedNames, collectIdentifierNames, isNodeEqual, isPureExpression, isTempName, walkNode } from "./AstUtils";


const {
    assignmentExpression,
    callExpression,
    expressionStatement,
    identifier,
    isAssignmentExpression,
    isCallExpression,
    isExpression,
    isExpressionStatement,
    isIdentifier,
    isMemberExpression,
    isReturnStatement,
    isSequenceExpression,
    isStringLiteral,
    isUnaryExpression,
    memberExpression,
    returnStatement,
    unaryExpression,
} = TYPE;

/**
 * 还原 ArkCompiler 通过累加器调用方法的字节码形态。
 *
 * 编译器调用 `recv.method(args)` 时会先把接收者保存到临时变量,再经 acc 装载方法:
 *
 *   v8 = acc;
 *   acc = acc.then;
 *   acc.call(v8, callback);
 *
 * 等价于 `v8.then(callback)`。调用结果也可能被存进其他寄存器
 * (`v0 = acc.call(v8, args)`),同样还原成 `v8.then(args)` 并保留目标变量。
 * 接收者还可能持有同一表达式的克隆(`acc = X.p; v8 = X.p; acc = acc.m; acc.call(v8)`),
 * 两次紧邻的纯求值结果相同,同样还原成 `X.p.m(...)`。
 * 这里在语句层面识别该形态并直接还原成成员调用,
 * 避免优化器在 `acc = acc.method` 这种自引用赋值上停住。
 *
 * @Author: jmp0
 * @Email: jmp0@qq.com
 */
export class AccCallSimplify implements ISimplify {
    private static isAcc(node: TYPE.Node | null | undefined): boolean {
        return isIdentifier(node) && node.name === "acc";
    }

    /** 匹配 `acc = acc.prop` / `acc = acc["prop"]`,返回属性名。 */
    private matchMethodLoad(stmt: TYPE.Statement): string | null {
        if (!isExpressionStatement(stmt) || !isAssignmentExpression(stmt.expression)) return null;
        const assign = stmt.expression;
        if (assign.operator !== "=" || !AccCallSimplify.isAcc(assign.left)) return null;
        if (!isMemberExpression(assign.right) || !AccCallSimplify.isAcc(assign.right.object)) return null;
        const property = assign.right.property;
        if (!assign.right.computed && isIdentifier(property)) return property.name;
        if (assign.right.computed && isStringLiteral(property) && /^[A-Za-z_$][\w$]*$/.test(property.value)) {
            return property.value;
        }
        return null;
    }

    /** 匹配 `acc.call(recv, ...)` 及其赋值/返回包装;赋值目标可以是任意左值(结果存进哪个寄存器都支持)。
     *  调用外层允许有前缀一元运算(如 `v0 = !acc.call(v0, p0)`),wrappers 记录由外到内的运算符,
     *  改写后再按原顺序包回去。 */
    private matchAccCall(stmt: TYPE.Statement): {
        mode: "assign" | "expr" | "return";
        /** assign 模式下的赋值左值(acc / 其他变量 / 成员);expr/return 为 null */
        target: TYPE.Identifier | TYPE.MemberExpression | null;
        /** assign 模式下的赋值运算符(= += -= 等) */
        operator: string;
        receiver: TYPE.Expression;
        args: TYPE.CallExpression["arguments"];
        /** 调用外层的前缀一元运算符(由外到内),改写后需要重新包上 */
        wrappers: TYPE.UnaryExpression["operator"][];
    } | null {
        let call: TYPE.Node | null = null;
        let target: TYPE.Identifier | TYPE.MemberExpression | null = null;
        let operator = "=";
        let mode: "assign" | "expr" | "return" = "expr";
        if (isReturnStatement(stmt) && stmt.argument) {
            call = stmt.argument;
            mode = "return";
        } else if (isExpressionStatement(stmt)) {
            const expr = stmt.expression;
            if (isAssignmentExpression(expr)
                && (isIdentifier(expr.left) || isMemberExpression(expr.left))) {
                call = expr.right;
                target = expr.left;
                operator = expr.operator;
                mode = "assign";
            } else {
                call = expr;
            }
        }
        // 剥掉外层前缀一元运算(!、void、typeof 等;delete 需要左值引用,不剥)
        const wrappers: TYPE.UnaryExpression["operator"][] = [];
        while (isUnaryExpression(call) && call.prefix && call.operator !== "delete") {
            wrappers.push(call.operator);
            call = call.argument;
        }
        if (!call || !isCallExpression(call)) return null;
        const callee = call.callee;
        if (!isMemberExpression(callee) || callee.computed) return null;
        if (!isIdentifier(callee.property) || callee.property.name !== "call") return null;
        if (!AccCallSimplify.isAcc(callee.object)) return null;
        if (call.arguments.length === 0) return null;
        const [receiver, ...args] = call.arguments;
        if (!isExpression(receiver)) return null;
        return { mode, target, operator, receiver, args: args as TYPE.CallExpression["arguments"], wrappers };
    }

    /** `X = X` 的纯空操作(不改变任何绑定,可安全越过)。 */
    private isSelfAssignStatement(stmt: TYPE.Statement, name: string): boolean {
        return isExpressionStatement(stmt)
            && isAssignmentExpression(stmt.expression)
            && stmt.expression.operator === "="
            && isIdentifier(stmt.expression.left)
            && stmt.expression.left.name === name
            && isIdentifier(stmt.expression.right)
            && stmt.expression.right.name === name;
    }

    private matchReceiverAssign(stmt: TYPE.Statement, name: string): boolean {
        return isExpressionStatement(stmt)
            && isAssignmentExpression(stmt.expression)
            && stmt.expression.operator === "="
            && isIdentifier(stmt.expression.left)
            && stmt.expression.left.name === name
            && AccCallSimplify.isAcc(stmt.expression.right);
    }

    /**
     * 克隆变体识别:`acc = M; recv = M';` 紧邻,M 为纯表达式且 M' 与其结构相同。
     * M' 是 TempVariableSimplify 按 isCopyable(成员访问链可克隆)约定克隆出来的,
     * 两次紧邻求值结果相同,方法装载改接 recv 等价。
     */
    private isCloneOfAccValue(accStmt: TYPE.Statement, recvStmt: TYPE.Statement): boolean {
        if (!isExpressionStatement(accStmt) || !isAssignmentExpression(accStmt.expression)) return false;
        const accAssign = accStmt.expression;
        if (!AccCallSimplify.isAcc(accAssign.left)) return false;
        const value = accAssign.right;
        if (!isPureExpression(value)) return false;
        if (!isExpressionStatement(recvStmt) || !isAssignmentExpression(recvStmt.expression)) return false;
        const recvAssign = recvStmt.expression;
        if (recvAssign.operator !== "=" || !isIdentifier(recvAssign.left)) return false;
        return isNodeEqual(recvAssign.right, value);
    }

    /**
     * 在 list 中寻找 `recv = acc; acc = acc.prop; acc.call(recv, ...)`。
     * 另接受复制传播克隆的变体:`acc = M; recv = M'; acc = acc.prop; acc.call(recv, ...)` ——
     * M 是纯表达式且 M' 与其结构相同,recv 持有的值与 acc 相同,方法等价于 recv.prop。
     * 返回 recv 的名字;找不到或不安全时返回 null。
     */
    private matchPattern(list: TYPE.Statement[], loadIndex: number): string | null {
        const stmt = list[loadIndex];
        const method = this.matchMethodLoad(stmt);
        if (method === null) return null;
        const call = this.matchAccCall(list[loadIndex + 1]);
        if (!call || !isIdentifier(call.receiver)) return null;
        const receiverName = call.receiver.name;
        if (!isTempName(receiverName)) return null;
        // 参数里若读取 acc,原语句读到的可能是刚装载的方法;改写后会读成旧值。
        if (call.args.some((arg) => collectIdentifierNames(arg as TYPE.Node).has("acc"))) return null;

        // 向前找到 `recv = acc`(或等价克隆),并确认期间 acc 没有被改写。
        for (let i = loadIndex - 1; i >= 0; i--) {
            const previous = list[i];
            const writes = collectAssignedNames(previous);
            // `acc = acc` 是空操作,不能当作“acc 被改写”而阻断接收者回找。
            if (this.isSelfAssignStatement(previous, "acc")) continue;
            if (writes.has("acc")) return null;
            if (writes.has(receiverName)) {
                if (this.matchReceiverAssign(previous, receiverName)) return receiverName;
                // 克隆变体:`acc = M; recv = M';` 紧邻时,recv 的值与 acc 相同
                if (i >= 1 && this.isCloneOfAccValue(list[i - 1], previous)) return receiverName;
                return null;
            }
        }
        return null;
    }

    private rewrite(list: TYPE.Statement[], loadIndex: number, receiverName: string): void {
        const method = this.matchMethodLoad(list[loadIndex])!;
        const call = this.matchAccCall(list[loadIndex + 1])!;
        const member = memberExpression(identifier(receiverName), identifier(method), false);
        let newCall: TYPE.Expression = callExpression(member, call.args);
        for (let i = call.wrappers.length - 1; i >= 0; i--) {
            newCall = unaryExpression(call.wrappers[i], newCall);
        }
        if (call.mode === "assign") {
            // 目标可能是 acc,也可能是其他变量/成员/复合赋值(字节码把结果存进哪个寄存器就还原成哪个)
            list[loadIndex + 1] = expressionStatement(
                assignmentExpression(call.operator, call.target ?? identifier("acc"), newCall));
        } else if (call.mode === "return") {
            list[loadIndex + 1] = returnStatement(newCall);
        } else {
            list[loadIndex + 1] = expressionStatement(newCall);
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
        // 只需要语句列表:用纯 AST 遍历收集,避免为整棵树建立 NodePath
        const bodies: TYPE.Statement[][] = [];
        walkNode(node, (n) => {
            if (n.type === "Program" || n.type === "BlockStatement") {
                bodies.push(n.body as TYPE.Statement[]);
            }
            return true;
        });
        let changed = false;
        for (const body of bodies) {
            if (this.simplifyBody(body)) changed = true;
        }
        return changed;
    }

    /**
     * 处理只存在于表达式里的方法装载链:条件被结构化分析放进一条 SequenceExpression,
     * 不在任何语句列表中,常规 simplify 扫不到:
     *   (acc = acc.prop, v = acc, ..., acc = acc.call(recv, args))
     * → (acc = recv.prop(args), ...)
     * 用临时 ExpressionStatement 包装后复用语句层面的匹配,再写回表达式数组。
     *
     * 放在流水线末端、ConditionSimplify.foldMaterializedTestArtifacts 之前调用:
     * 此时序列里的 acc/接收者临时变量都已完成复制传播,提前处理会留下
     * `X = acc` / `acc = X.test(...)` 这类中间形态,后续轮次的别名传播可能读错版本。
     */
    static simplifySequences(node: Program): boolean {
        const pass = new AccCallSimplify();
        const sequences: TYPE.SequenceExpression[] = [];
        walkNode(node, (n) => {
            if (isSequenceExpression(n)) sequences.push(n);
            return true;
        });
        let changed = false;
        for (const seq of sequences) {
            if (seq.expressions.length < 2) continue;
            const stmts = seq.expressions.map((e) => expressionStatement(e as TYPE.Expression));
            if (!pass.simplifyBody(stmts)) continue;
            seq.expressions = stmts.map((s) => (s as TYPE.ExpressionStatement).expression) as TYPE.Expression[];
            changed = true;
        }
        return changed;
    }
}
