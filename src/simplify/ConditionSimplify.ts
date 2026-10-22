import { Program } from "@babel/types";
import { ISimplify } from "./ISimplify";
import traverse, { NodePath } from "@babel/traverse";
import * as TYPE from "@babel/types";
import { collectAssignedNames, collectReadNames, isPureExpression, isTempName, scanCapturedRead, tempReadBeforeWrite } from "./AstUtils";
import { SyntaxRewriteSimplify } from "./SyntaxRewriteSimplify";

/**
 * 条件表达式清理。
 *
 * 编译器经常把 `&&` / `||` 的临时计算塞进 if 的 test 里:
 *
 *   if ((acc = JSON.stringify(p0), v6 = acc, v13 = acc, v13 !== null) && ...) { ... }
 *
 * 这里做两件安全的事:
 *   1. 删除 `acc = !(...)` 这类只作为临时计算、且两个分支都会重新赋值 acc 的中间赋值;
 *   2. 把 test 中无条件求值的 SequenceExpression 前缀提升到 if 之前,
 *      让 TempVariableSimplify 在后续轮次里继续做复制传播/死存储消除。
 *
 * 只处理 if 的 test(以及其中 `&&`/`||` 的左侧),不处理循环:
 * 循环 test 每次迭代都会求值,提到循环外会改变语义。
 * HighLevelGrammarSimplify 会把尾部的 if/else return 合成为三元,
 * 其 test 同样是布尔上下文,因此三元 test 前的自取反链也在这里折叠。
 *
 * @Author: jmp0
 */
export class ConditionSimplify implements ISimplify {
    simplify(node: Program): boolean {
        let changed = false;
        traverse(TYPE.file(node), {
            IfStatement: (path) => {
                // insertBefore 需要 if 位于语句列表中(块或 Program);
                // 单条语句形式(if (a) if (b) ...)不处理,避免改变结构。
                const parent = path.parentPath;
                if (!parent || (!parent.isBlockStatement() && !parent.isProgram())) return;
                if (this.foldNegationChain(path)) changed = true;
                if (this.removeScratchAssignments(path)) changed = true;
                if (this.hoistTestPrefix(path)) changed = true;
            },
            ReturnStatement: (path) => {
                // HighLevelGrammarSimplify 会把 `if (X) return A; else return B;` 合成
                // `return X ? A : B`,三元的 test 也是布尔上下文,自取反链要能继续折叠。
                const argument = path.node.argument;
                if (!argument || !TYPE.isConditionalExpression(argument)) return;
                if (this.foldNegationChain(path)) changed = true;
            },
        });
        return changed;
    }

    /**
     * 折叠紧邻布尔上下文消费点的连续自取反链:
     * `X = !X; X = !X; if (X)` → `if (X)`,`X = !X; X = !X; return X ? A : B` → `return X ? A : B`。
     * 编译器按分支极性生成取反指令,偶数条取反是恒等操作;奇数条则把消费点的极性翻转。
     * 删除后 X 的值从 ToBoolean(E) 恢复为 E,因此要求之后在覆盖前不再读取(X 是
     * 函数级累加器,现有模式要求"仅模式内使用"对它永远不成立),也没有被闭包捕获。
     * "之后"按执行流收集:当前列表尾部 + 祖先各级的后续语句(循环整体保守纳入)。
     */
    private foldNegationChain(stmtPath: NodePath<TYPE.Statement>): boolean {
        const parent = stmtPath.parentPath;
        if (!parent || (!parent.isBlockStatement() && !parent.isProgram())) return false;
        const list = parent.node.body;
        const stmtIndex = list.indexOf(stmtPath.node);
        if (stmtIndex < 0) return false;

        // 只有布尔上下文消费点才能安全删除取反链(ToBoolean 对原始值和布尔值等价)
        const consumer = this.booleanTestConsumer(stmtPath.node);
        if (!consumer) return false;
        const name = this.tempTestName(consumer.test);
        if (name === null || !isTempName(name)) return false;

        // 向前数连续的 `X = !X`
        let count = 0;
        while (stmtIndex - 1 - count >= 0 && this.isSelfNegation(list[stmtIndex - 1 - count], name)) count++;
        if (count === 0) return false;

        const fnParent = stmtPath.getFunctionParent();
        const scope: TYPE.Node = fnParent ? fnParent.node : stmtPath.scope.path.node;
        if (scanCapturedRead(scope, null, new Set([name]), new Set(), false)) return false;
        const tails = this.collectStatementsAfter(stmtPath);
        if (tempReadBeforeWrite(tails, 0, name)) return false;

        // 用官方 path API 删除链语句:从后往前删,避免索引偏移。
        // 注意不能用 getSibling(它取的是"父节点所在数组"的兄弟,不是块内语句)。
        for (let j = stmtIndex - 1; j >= stmtIndex - count; j--) {
            const sibling = (parent.get("body") as NodePath[])[j];
            if (sibling) sibling.remove();
        }
        // 奇数条取反时,消费点读到的值多翻了一次极性,需要翻转条件
        if (count % 2 === 1) consumer.setTest(ConditionSimplify.invertTest(consumer.test));
        return true;
    }

    /**
     * 取出语句里的布尔上下文 test:if 的 test、return 三元表达式的 test。
     * 只有这两类位置允许删除自取反链,其他位置(普通表达式/赋值)读到的值类型会变。
     */
    private booleanTestConsumer(stmt: TYPE.Statement):
        { test: TYPE.Expression; setTest: (expr: TYPE.Expression) => void } | null {
        if (TYPE.isIfStatement(stmt)) {
            return { test: stmt.test, setTest: (expr) => { stmt.test = expr; } };
        }
        if (TYPE.isReturnStatement(stmt) && stmt.argument && TYPE.isConditionalExpression(stmt.argument)) {
            const conditional = stmt.argument;
            return { test: conditional.test, setTest: (expr) => { conditional.test = expr; } };
        }
        return null;
    }

    /** test 形如 `X` 或 `!X` 时返回 X;其他形态无法确定链对应的临时变量。 */
    private tempTestName(test: TYPE.Expression): string | null {
        if (TYPE.isIdentifier(test)) return test.name;
        if (TYPE.isUnaryExpression(test) && test.operator === "!" && TYPE.isIdentifier(test.argument)) {
            return test.argument.name;
        }
        return null;
    }

    private static invertTest(node: TYPE.Expression): TYPE.Expression {
        if (TYPE.isUnaryExpression(node) && node.operator === "!") return node.argument;
        if (TYPE.isBinaryExpression(node)) {
            const inverse = SyntaxRewriteSimplify.binaryInvert(node);
            if (inverse != null) {
                return TYPE.binaryExpression(inverse, node.left as TYPE.Expression, node.right as TYPE.Expression);
            }
        }
        return TYPE.unaryExpression("!", node);
    }

    /**
     * 收集语句之后按执行流可能执行到的语句(顺序即执行序):
     * 当前列表的尾部 → 逐级祖先块的尾部;祖先为循环时整个循环保守纳入(回边);
     * 祖先为 switch 时纳入后续 case(fallthrough);到达函数/Program 边界即止。
     */
    private collectStatementsAfter(stmtPath: NodePath<TYPE.Statement>): TYPE.Statement[] {
        const out: TYPE.Statement[] = [];
        let child: NodePath = stmtPath;
        let cur: NodePath | null = stmtPath.parentPath;
        while (cur) {
            if (cur.isBlockStatement() || cur.isProgram()) {
                const body = cur.node.body;
                const idx = body.indexOf(child.node as TYPE.Statement);
                if (idx < 0) break;
                out.push(...body.slice(idx + 1));
            } else if (cur.isWhileStatement() || cur.isDoWhileStatement() || cur.isForStatement()
                || cur.isForInStatement() || cur.isForOfStatement()) {
                out.push(cur.node);
            } else if (cur.isSwitchStatement()) {
                const cases = cur.node.cases;
                const caseIndex = cases.findIndex((c) => c.consequent.includes(child.node as TYPE.Statement));
                if (caseIndex >= 0) {
                    for (let s = caseIndex; s < cases.length; s++) out.push(...cases[s].consequent);
                }
            }
            if (cur.isFunction() || cur.isProgram()) break;
            child = cur;
            cur = cur.parentPath;
        }
        return out;
    }

    private isSelfNegation(stmt: TYPE.Statement, name: string): boolean {
        return TYPE.isExpressionStatement(stmt)
            && TYPE.isAssignmentExpression(stmt.expression)
            && stmt.expression.operator === "="
            && TYPE.isIdentifier(stmt.expression.left)
            && stmt.expression.left.name === name
            && TYPE.isUnaryExpression(stmt.expression.right)
            && stmt.expression.right.operator === "!"
            && TYPE.isIdentifier(stmt.expression.right.argument)
            && stmt.expression.right.argument.name === name;
    }

    /**
     * 删除 test 里只用于计算条件、且两个分支都会重新赋值的临时变量赋值。
     * 例如:
     *   if ((v = x, acc = !(v !== null), v !== null) && ...) { acc = v } else { acc = "" }
     * 中的 `acc = !(v !== null)` 可以安全删除。
     */
    private removeScratchAssignments(path: NodePath<TYPE.IfStatement>): boolean {
        const ifNode = path.node;
        if (!ifNode.alternate) return false;

        const consequentWrites = new Set<string>();
        collectAssignedNames(ifNode.consequent, consequentWrites);
        const alternateWrites = new Set<string>();
        collectAssignedNames(ifNode.alternate, alternateWrites);
        const overwrittenOnBothPaths = new Set<string>();
        for (const name of consequentWrites) {
            if (!alternateWrites.has(name)) continue;
            if (this.definitelyWrites(ifNode.consequent, name) && this.definitelyWrites(ifNode.alternate, name)) {
                overwrittenOnBothPaths.add(name);
            }
        }
        if (overwrittenOnBothPaths.size === 0) return false;

        const branchReads = new Set<string>();
        for (const name of collectReadNames(ifNode.consequent)) branchReads.add(name);
        for (const name of collectReadNames(ifNode.alternate)) branchReads.add(name);

        const order = this.evaluationOrder(ifNode.test);
        const removals = new Map<TYPE.SequenceExpression, number[]>();

        const testPath = path.get("test") as NodePath<TYPE.Expression>;
        testPath.traverse({
            AssignmentExpression: (assignPath) => {
                const assign = assignPath.node;
                if (assign.operator !== "=" || !TYPE.isIdentifier(assign.left)) return;
                const name = assign.left.name;
                if (!isTempName(name) || !overwrittenOnBothPaths.has(name) || branchReads.has(name)) return;
                if (!isPureExpression(assign.right)) return;

                const parent = assignPath.parentPath;
                if (!parent || !parent.isSequenceExpression()) return;
                const expressions = parent.node.expressions as TYPE.Expression[];
                const index = expressions.indexOf(assign);
                // 只删除中间表达式,最后一个表达式的值就是条件,不能删
                if (index < 0 || index === expressions.length - 1) return;

                const pos = order.indexOf(assign);
                if (pos < 0) return;
                for (let i = pos + 1; i < order.length; i++) {
                    if (collectReadNames(order[i]).has(name)) return;
                }

                let indices = removals.get(parent.node);
                if (!indices) {
                    indices = [];
                    removals.set(parent.node, indices);
                }
                indices.push(index);
            },
        });

        let changed = false;
        for (const [sequence, indices] of removals) {
            indices.sort((a, b) => b - a);
            for (const index of indices) {
                sequence.expressions.splice(index, 1);
                changed = true;
            }
        }
        return changed;
    }

    private hoistTestPrefix(path: NodePath<TYPE.IfStatement>): boolean {
        const hoisted: TYPE.Statement[] = [];
        const test = this.extractUnconditionalPrefix(path.node.test, hoisted, true);
        if (hoisted.length === 0) return false;

        path.node.test = test;
        path.insertBefore(hoisted);
        return true;
    }

    /**
     * @param expr 当前表达式
     * @param out 收集需要提前执行的语句
     * @param unconditional 该表达式是否一定会被求值
     */
    private extractUnconditionalPrefix(
        expr: TYPE.Expression,
        out: TYPE.Statement[],
        unconditional: boolean,
    ): TYPE.Expression {
        while (TYPE.isParenthesizedExpression(expr)) expr = (expr as any).expression;
        if (TYPE.isSequenceExpression(expr)) {
            if (!unconditional) return expr;
            const expressions = expr.expressions as TYPE.Expression[];
            if (expressions.length <= 1) return expressions[0] ?? expr;
            for (let i = 0; i < expressions.length - 1; i++) {
                out.push(TYPE.expressionStatement(expressions[i]));
            }
            return this.extractUnconditionalPrefix(expressions[expressions.length - 1], out, unconditional);
        }
        if (TYPE.isLogicalExpression(expr)) {
            // 左侧一定求值;右侧只在左侧满足条件时求值,不能提前。
            expr.left = this.extractUnconditionalPrefix(expr.left as TYPE.Expression, out, unconditional);
            expr.right = this.extractUnconditionalPrefix(expr.right as TYPE.Expression, out, false);
            return expr;
        }
        if (TYPE.isConditionalExpression(expr)) {
            // test 一定求值,consequent/alternate 不一定。
            expr.test = this.extractUnconditionalPrefix(expr.test, out, unconditional);
            return expr;
        }
        if (TYPE.isUnaryExpression(expr) && expr.operator !== "delete") {
            expr.argument = this.extractUnconditionalPrefix(expr.argument as TYPE.Expression, out, unconditional);
            return expr;
        }
        if (TYPE.isParenthesizedExpression(expr)) {
            const node = expr as any;
            node.expression = this.extractUnconditionalPrefix(node.expression, out, unconditional);
            return node;
        }
        return expr;
    }

    /** 判断语句是否在所有执行路径上都会给 name 赋新值(用于确认 test 中的临时赋值一定被覆盖)。 */
    private definitelyWrites(stmt: TYPE.Statement | null | undefined, name: string): boolean {
        if (!stmt) return false;
        if (TYPE.isBlockStatement(stmt) || TYPE.isProgram(stmt)) {
            return stmt.body.some((child) => this.definitelyWrites(child, name));
        }
        if (TYPE.isExpressionStatement(stmt)) return this.definitelyWritesExpression(stmt.expression, name);
        if (TYPE.isIfStatement(stmt)) {
            return this.definitelyWrites(stmt.consequent, name)
                && this.definitelyWrites(stmt.alternate, name);
        }
        if (TYPE.isLabeledStatement(stmt)) return this.definitelyWrites(stmt.body, name);
        if (TYPE.isTryStatement(stmt)) {
            // finally 一定会执行;没有 finally 时保守处理
            return stmt.finalizer != null && this.definitelyWrites(stmt.finalizer, name);
        }
        return false;
    }

    private definitelyWritesExpression(expr: TYPE.Expression, name: string): boolean {
        if (TYPE.isAssignmentExpression(expr)) {
            if (TYPE.isIdentifier(expr.left) && expr.left.name === name) return true;
            return this.definitelyWritesExpression(expr.right, name);
        }
        if (TYPE.isUpdateExpression(expr)) {
            return TYPE.isIdentifier(expr.argument) && expr.argument.name === name;
        }
        if (TYPE.isSequenceExpression(expr)) {
            return expr.expressions.some((child) => this.definitelyWritesExpression(child as TYPE.Expression, name));
        }
        return false;
    }

    /** 按求值顺序展开表达式,用于判断某个赋值之后是否还读取了同名变量。 */
    private evaluationOrder(node: TYPE.Expression): TYPE.Node[] {
        const out: TYPE.Node[] = [];
        this.flatten(node, out);
        return out;
    }

    private flatten(node: TYPE.Node | null | undefined, out: TYPE.Node[]): void {
        if (!node || typeof (node as any).type !== "string") return;
        if (TYPE.isSequenceExpression(node)) {
            for (const expression of node.expressions) this.flatten(expression as TYPE.Expression, out);
            return;
        }
        if (TYPE.isLogicalExpression(node)) {
            this.flatten(node.left as TYPE.Expression, out);
            this.flatten(node.right as TYPE.Expression, out);
            return;
        }
        if (TYPE.isConditionalExpression(node)) {
            this.flatten(node.test, out);
            this.flatten(node.consequent, out);
            this.flatten(node.alternate, out);
            return;
        }
        if (TYPE.isAssignmentExpression(node)) {
            // 赋值语句本身在 RHS 之后生效
            this.flatten(node.right, out);
            out.push(node);
            return;
        }
        if (TYPE.isCallExpression(node) || TYPE.isNewExpression(node)) {
            this.flatten(node.callee as TYPE.Expression, out);
            for (const argument of node.arguments) this.flatten(argument as TYPE.Expression, out);
            return;
        }
        if (TYPE.isBinaryExpression(node)) {
            this.flatten(node.left as TYPE.Expression, out);
            this.flatten(node.right as TYPE.Expression, out);
            return;
        }
        if (TYPE.isUnaryExpression(node)) {
            this.flatten(node.argument as TYPE.Expression, out);
            out.push(node);
            return;
        }
        if (TYPE.isMemberExpression(node)) {
            this.flatten(node.object as TYPE.Expression, out);
            if (node.computed) this.flatten(node.property as TYPE.Expression, out);
            out.push(node);
            return;
        }
        if (TYPE.isArrayExpression(node)) {
            for (const element of node.elements) this.flatten(element as TYPE.Expression, out);
            out.push(node);
            return;
        }
        if (TYPE.isObjectExpression(node)) {
            for (const property of node.properties) this.flatten(property as TYPE.Node, out);
            out.push(node);
            return;
        }
        out.push(node);
    }
}
