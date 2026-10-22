import { Program } from "@babel/types";
import { ISimplify } from "./ISimplify";
import traverse, { NodePath } from "@babel/traverse";
import * as TYPE from "@babel/types";
import { collectAssignedNames, collectReadNames, isPureExpression, isTempName } from "./AstUtils";

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
                if (this.removeScratchAssignments(path)) changed = true;
                if (this.hoistTestPrefix(path)) changed = true;
            },
        });
        return changed;
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
