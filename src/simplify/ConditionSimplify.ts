import { Program } from "@babel/types";
import { ISimplify } from "./ISimplify";
import traverse, { NodePath } from "@babel/traverse";
import * as TYPE from "@babel/types";
import {
    collectAssignedNames,
    collectReadNames,
    isClassLike,
    isDeclarationValue,
    isFunctionLike,
    isPureExpression,
    isTempName,
    scanCapturedRead,
    tempReadBeforeWrite,
    walkNode,
} from "./AstUtils";
import { SyntaxRewriteSimplify } from "./SyntaxRewriteSimplify";


const {
    binaryExpression,
    expressionStatement,
    file,
    identifier,
    isArrayExpression,
    isAssignmentExpression,
    isBinaryExpression,
    isCallExpression,
    isConditionalExpression,
    isExpressionStatement,
    isIdentifier,
    isIfStatement,
    isLabeledStatement,
    isLogicalExpression,
    isMemberExpression,
    isNewExpression,
    isObjectExpression,
    isParenthesizedExpression,
    isReturnStatement,
    isSequenceExpression,
    isTryStatement,
    isUnaryExpression,
    isUpdateExpression,
    unaryExpression,
    isBlockStatement: isBlockStatementNode,
    isProgram: isProgramNode,
    isReferenced: isReferencedNode,
} = TYPE;

/**
 * 条件表达式清理。
 *
 * 编译器经常把 `&&` / `||` 的临时计算塞进 if 的 test 里:
 *
 *   if ((acc = JSON.stringify(p0), v6 = acc, v13 = acc, v13 !== null) && ...) { ... }
 *
 * 这里做几件安全的事(1/2 由末端的 foldMaterializedTestArtifacts 驱动,见下):
 *   1. 折叠 test 序列里的“调用结果物化链”:
 *        (acc = call(...), v3 = acc, acc === v2)
 *      → (v3 = call(...), v3 === v2)     [v3 之后不再读取时进一步折叠]
 *      → (call(...) === v2)
 *      并删除序列里只写不读的 `acc = 纯表达式` 残留(如 `A || !(acc = X !== Y, X !== Y)`);
 *   2. 删除 if 前一条对 test 的物化死赋值:`acc = !(v3 !== undefined); if (v3 !== undefined && ...)`,
 *      要求 test 对 acc 的每次读取之前都在 test 内部重新赋值过 acc;
 *   3. 删除 test 里只用于计算条件、且两个分支都会重新赋值 acc 的中间赋值;
 *   4. 把 test 中无条件求值的 SequenceExpression 前缀提升到 if 之前,
 *      让 TempVariableSimplify 在后续轮次里继续做复制传播/死存储消除。
 *
 * 只处理 if 的 test(以及其中 `&&`/`||` 的左侧),不处理循环:
 * 循环 test 每次迭代都会求值,提到循环外会改变语义。
 * HighLevelGrammarSimplify 会把尾部的 if/else return 合成为三元,
 * 其 test 同样是布尔上下文,因此三元 test 前的自取反链也在这里折叠。
 *
 * @Author: jmp0
 */

/**
 * 布尔 test 的折叠上下文。if 与 `return C ? A : B` 的三元 test 语义相同,
 * 末端清理需要同时处理:HighLevelGrammarSimplify 会把 if/else return 先合成三元,
 * 若只认 IfStatement,三元 test 里的物化链就会漏掉。
 */
interface TestFoldContext {
    path: NodePath<TYPE.Statement>;
    test: TYPE.Expression;
    consequent: TYPE.Statement[];
    alternate: TYPE.Statement[];
    scope: TYPE.Node;
}

export class ConditionSimplify implements ISimplify {
    simplify(node: Program): boolean {
        let changed = false;
        traverse(file(node), {
            noScope: true,
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
                if (!argument || !isConditionalExpression(argument)) return;
                if (this.foldNegationChain(path)) changed = true;
            },
        });
        return changed;
    }

    /**
     * 供流水线末端调用(NullishCoalescingSimplify 之后):折叠条件物化残留。
     *
     *   acc = !(v3 !== undefined);
     *   if (v3 !== undefined && (acc = call(...), v3 = acc, acc === v2)) ...
     * → if (v3 !== undefined && call(...) === v2) ...
     *
     * 必须放在定点迭代之后:`acc = 比较表达式` 这类只写不读的元素可能是
     * nullish 物化链等后续 pass 的模式输入(ContentFilterRuntimeStore 回归),
     * 只有在所有消费它的 pass 跑完之后,真正无消费的残留才可以删除。
     */
    static foldMaterializedTestArtifacts(node: Program): boolean {
        const pass = new ConditionSimplify();
        let changed = false;
        traverse(file(node), {
            noScope: true,
            IfStatement: (path) => {
                const parent = path.parentPath;
                if (!parent || (!parent.isBlockStatement() && !parent.isProgram())) return;
                const ctx = pass.contextForIf(path);
                if (pass.foldTestSequenceChains(ctx)) changed = true;
                // 连续多条 `X = 纯表达式; Y = 纯表达式; if (...)` 需要逐条删除
                for (let i = 0; i < 8; i++) {
                    if (!pass.removeDeadConditionStatement(ctx)) break;
                    changed = true;
                }
            },
            ReturnStatement: (path) => {
                const argument = path.node.argument;
                if (!isConditionalExpression(argument)) return;
                const ctx = pass.contextForConditional(path, argument);
                if (pass.foldTestSequenceChains(ctx)) changed = true;
                for (let i = 0; i < 8; i++) {
                    if (!pass.removeDeadConditionStatement(ctx)) break;
                    changed = true;
                }
            },
        });
        return changed;
    }

    /** 最近的函数节点;不在函数内时返回 Program(替代 path.scope.path.node,后者需要 scope 爬取)。 */
    private static enclosingScopeNode(path: NodePath<any>): TYPE.Node {
        const fn = path.getFunctionParent();
        if (fn) return fn.node;
        const program = path.findParent((p) => p.isProgram());
        return program ? program.node : path.findParent(() => true)?.node ?? (path as any).node;
    }

    private contextForIf(path: NodePath<TYPE.IfStatement>): TestFoldContext {
        return {
            path,
            test: path.node.test,
            consequent: this.branchStatements(path.node.consequent),
            alternate: path.node.alternate ? this.branchStatements(path.node.alternate) : [],
            scope: ConditionSimplify.enclosingScopeNode(path),
        };
    }

    private contextForConditional(
        path: NodePath<TYPE.ReturnStatement>,
        node: TYPE.ConditionalExpression,
    ): TestFoldContext {
        return {
            path,
            test: node.test,
            consequent: [expressionStatement(node.consequent)],
            alternate: [expressionStatement(node.alternate)],
            scope: ConditionSimplify.enclosingScopeNode(path),
        };
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
        const scope: TYPE.Node = fnParent ? fnParent.node : ConditionSimplify.enclosingScopeNode(stmtPath);
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
        if (isIfStatement(stmt)) {
            return { test: stmt.test, setTest: (expr) => { stmt.test = expr; } };
        }
        if (isReturnStatement(stmt) && stmt.argument && isConditionalExpression(stmt.argument)) {
            const conditional = stmt.argument;
            return { test: conditional.test, setTest: (expr) => { conditional.test = expr; } };
        }
        return null;
    }

    /** test 形如 `X` 或 `!X` 时返回 X;其他形态无法确定链对应的临时变量。 */
    private tempTestName(test: TYPE.Expression): string | null {
        if (isIdentifier(test)) return test.name;
        if (isUnaryExpression(test) && test.operator === "!" && isIdentifier(test.argument)) {
            return test.argument.name;
        }
        return null;
    }

    private static invertTest(node: TYPE.Expression): TYPE.Expression {
        if (isUnaryExpression(node) && node.operator === "!") return node.argument;
        if (isBinaryExpression(node)) {
            const inverse = SyntaxRewriteSimplify.binaryInvert(node);
            if (inverse != null) {
                return binaryExpression(inverse, node.left as TYPE.Expression, node.right as TYPE.Expression);
            }
        }
        return unaryExpression("!", node);
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
        return isExpressionStatement(stmt)
            && isAssignmentExpression(stmt.expression)
            && stmt.expression.operator === "="
            && isIdentifier(stmt.expression.left)
            && stmt.expression.left.name === name
            && isUnaryExpression(stmt.expression.right)
            && stmt.expression.right.operator === "!"
            && isIdentifier(stmt.expression.right.argument)
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

        // 只用到父节点,不需要 NodePath/scope:用纯 AST 遍历收集待删除的下标
        walkNode(ifNode.test, (assign, parent) => {
            if (!isAssignmentExpression(assign)) return true;
            if (assign.operator !== "=" || !isIdentifier(assign.left)) return true;
            const name = assign.left.name;
            if (!isTempName(name) || !overwrittenOnBothPaths.has(name) || branchReads.has(name)) return true;
            if (!isPureExpression(assign.right)) return true;
            if (!parent || !isSequenceExpression(parent)) return true;
            const sequence = parent as TYPE.SequenceExpression;
            const expressions = sequence.expressions as TYPE.Expression[];
            const index = expressions.indexOf(assign as TYPE.Expression);
            // 只删除中间表达式,最后一个表达式的值就是条件,不能删
            if (index < 0 || index === expressions.length - 1) return true;

            const pos = order.indexOf(assign);
            if (pos < 0) return true;
            for (let i = pos + 1; i < order.length; i++) {
                if (collectReadNames(order[i]).has(name)) return true;
            }

            let indices = removals.get(sequence);
            if (!indices) {
                indices = [];
                removals.set(sequence, indices);
            }
            indices.push(index);
            return true;
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

    // ---------------------------------------------------------- test 序列物化链折叠

    /**
     * 规则A:删除 if 前一条对 test 的物化死赋值:
     *   acc = !(v3 !== undefined);
     *   if (v3 !== undefined && (acc = ..., ...)) ...
     * callruntime.isfalse 物化的取反值只喂给 jnez,从不被真正消费。要求:test
     * 按求值顺序对 name 的每次读取之前都存在 test 内部的写入;name 未被闭包
     * 捕获;语句之后(含循环回边)先写后读。
     */
    private removeDeadConditionStatement(ctx: TestFoldContext): boolean {
        const path = ctx.path;
        const parent = path.parentPath;
        if (!parent || (!parent.isBlockStatement() && !parent.isProgram())) return false;
        const list = parent.node.body;
        const index = list.indexOf(path.node);
        if (index <= 0) return false;
        const prev = list[index - 1];
        if (!isExpressionStatement(prev) || !isAssignmentExpression(prev.expression)) return false;
        const assign = prev.expression;
        if (assign.operator !== "=" || !isIdentifier(assign.left)) return false;
        const name = assign.left.name;
        // 函数/类表达式的值经 callee 调用消费时 isReferenced 不可见(v4(...)),
        // 无法证明值已死,一律不删
        if (!isTempName(name) || !isPureExpression(assign.right) || isDeclarationValue(assign.right)) return false;

        // test 含条件表达式时求值顺序分支化,保守放弃
        let sawConditional = false;
        walkNode(ctx.test, (n) => {
            if (sawConditional) return false;
            if (isFunctionLike(n) || isClassLike(n)) return false;
            if (isConditionalExpression(n)) sawConditional = true;
            return !sawConditional;
        });
        if (sawConditional) return false;

        // test 在读取 name 之前一定重写过它,语句里的旧值才不可观察
        if (this.readsNameBeforeWriteAfterAnchor(ctx.test, ctx.path.node, name, ctx.path.node, true, false).readBefore) {
            return false;
        }
        // 分支在 test 之后执行:若 test 在该路径上没有重写 name,分支读到的是语句里的旧值
        if (this.branchReadsBeforeWrite(ctx.consequent, name)
            && !this.testWritesOnTakenPath(ctx.test, name, true)) return false;
        if (ctx.alternate.length > 0 && this.branchReadsBeforeWrite(ctx.alternate, name)
            && !this.testWritesOnTakenPath(ctx.test, name, false)) return false;

        const fnParent = path.getFunctionParent();
        const scope: TYPE.Node = fnParent ? fnParent.node : ConditionSimplify.enclosingScopeNode(path);
        if (scanCapturedRead(scope, null, new Set([name]), new Set(), false)) return false;
        if (!this.nameDeadAfterStatement(path, name)) return false;
        (parent.get("body") as NodePath[])[index - 1].remove();
        return true;
    }

    /**
     * 对 if 的 test 反复应用序列折叠规则,直到不动点:
     *   B: (X = E, ..., Y = X, ...读X...) → (..., Y = E, ...读X改读Y...),删除 X = E
     *   C: (Y = E, E'读Y一次) 且 Y 之后不可观察 → (E'中Y替换为E),删除 Y = E
     *   1: (X = 纯表达式, ...) 且 X 之后不可观察 → 直接删除该元素
     * 每步只应用一处,靠外层循环收敛;上限防止意外不收敛。
     */
    private foldTestSequenceChains(ctx: TestFoldContext): boolean {
        let changed = false;
        for (let round = 0; round < 24; round++) {
            if (!this.applyOneSequenceFold(ctx)) break;
            changed = true;
        }
        return changed;
    }

    private applyOneSequenceFold(ctx: TestFoldContext): boolean {
        const sequences: TYPE.SequenceExpression[] = [];
        walkNode(ctx.test, (n) => {
            if (isFunctionLike(n) || isClassLike(n)) return false;
            if (isSequenceExpression(n)) sequences.push(n);
            return true;
        });
        for (const seq of sequences) {
            if (this.foldAliasChainInSequence(seq, ctx)) return true;
        }
        for (const seq of sequences) {
            if (this.foldDeadAssignCompare(seq, ctx)) return true;
        }
        for (const seq of sequences) {
            if (this.dropDeadSaveElement(seq, ctx)) return true;
        }
        return false;
    }

    /**
     * 规则B:调用结果经 acc 中转再存入临时变量的物化链。
     *   (acc = call(...), v3 = acc, acc === v2)
     * → (v3 = call(...), v3 === v2)
     * 前提:X 的赋值元素与 `Y = X` 之间没有对 X 的读写;之后只读不写 X(读取全部改写为 Y);
     * E 不读 X(删除 X 的赋值后 E 里的 X 会变成更旧的值);X/Y 未被闭包捕获;
     * X 的值在本语句之后不可观察(尾部 + 回边前缀都先写后读)。
     */
    private foldAliasChainInSequence(seq: TYPE.SequenceExpression, ctx: TestFoldContext): boolean {
        const elements = seq.expressions;
        const scope = ctx.scope;
        for (let j = 1; j < elements.length; j++) {
            const copy = elements[j];
            if (!isAssignmentExpression(copy) || copy.operator !== "=") continue;
            if (!isIdentifier(copy.left) || !isIdentifier(copy.right)) continue;
            const yName = copy.left.name;
            const xName = copy.right.name;
            if (!isTempName(xName) || !isTempName(yName) || xName === yName) continue;

            // 向前找 X 的赋值元素;途中出现对 X 的其他读写即放弃
            let i = -1;
            let yWrittenBetween = false;
            for (let k = j - 1; k >= 0; k--) {
                const e = elements[k];
                if (isAssignmentExpression(e) && e.operator === "="
                    && isIdentifier(e.left) && e.left.name === xName) {
                    if (collectReadNames(e).has(xName)) break; // X = ...X... 自引用,不能搬
                    i = k;
                    break;
                }
                if (collectReadNames(e).has(xName) || collectAssignedNames(e).has(xName)) break;
                if (collectAssignedNames(e).has(yName)) yWrittenBetween = true;
            }
            if (i < 0) continue;
            // i 与 j 之间写 Y 会让搬移后的 E 读到新 Y,语义改变
            if (yWrittenBetween) continue;
            const value = (elements[i] as TYPE.AssignmentExpression).right;
            if (collectReadNames(value).has(xName)) continue;
            // X 的 callee 调用读取对 isReferenced 不可见,函数/类值无法证明已死,不搬
            if (isDeclarationValue(value)) continue;

            // j 之后:X 只读不写(读取即将改写为 Y)
            let blocked = false;
            for (let k = j + 1; k < elements.length; k++) {
                if (collectAssignedNames(elements[k]).has(xName)) { blocked = true; break; }
            }
            if (blocked) continue;
            if (scanCapturedRead(scope, null, new Set([xName]), new Set(), false)) continue;
            const last = elements[elements.length - 1];
            if (this.testReadsNameAfter(ctx.test, last, xName)) continue;
            if (!this.nameDeadAfterStatement(ctx.path, xName)) continue;
            if (this.branchDependsOnValue(ctx, xName, elements[i])) continue;

            for (let k = j + 1; k < elements.length; k++) {
                this.replaceIdentifierReads(elements[k], xName, identifier(yName));
            }
            copy.right = value;
            elements.splice(i, 1);
            return true;
        }
        return false;
    }

    /**
     * 规则C:`(Y = E, E'读Y恰好一次, ...)` 且 Y 在本语句之后不可观察
     * → 把 E' 里的那次读取替换为 E 节点本身(搬移,不复制),删除 `Y = E`。
     * E 允许不纯(调用只求值一次,位置不变),也允许读取 Y(替换点读到的
     * 本来就是 E 的值,而 E 里的 Y 仍是旧值,求值顺序一致)。
     */
    private foldDeadAssignCompare(seq: TYPE.SequenceExpression, ctx: TestFoldContext): boolean {
        const elements = seq.expressions;
        const scope = ctx.scope;
        for (let i = 0; i < elements.length - 1; i++) {
            const assign = elements[i];
            if (!isAssignmentExpression(assign) || assign.operator !== "=") continue;
            if (!isIdentifier(assign.left)) continue;
            const yName = assign.left.name;
            if (!isTempName(yName)) continue;
            const next = elements[i + 1];
            if (this.countIdentifierReads(next, yName) !== 1) continue;
            let blocked = false;
            for (let k = i + 2; k < elements.length; k++) {
                if (collectReadNames(elements[k]).has(yName) || collectAssignedNames(elements[k]).has(yName)) {
                    blocked = true;
                    break;
                }
            }
            if (blocked) continue;
            if (scanCapturedRead(scope, null, new Set([yName]), new Set(), false)) continue;
            if (this.testReadsNameAfter(ctx.test, next, yName)) continue;
            if (!this.nameDeadAfterStatement(ctx.path, yName)) continue;
            // 分支里的读取发生在整条 test 之后:若 test 在该路径上一定重写了
            // yName,分支读到的是新值,删除这里的赋值不会影响它。
            if (this.branchDependsOnValue(ctx, yName, assign)) continue;
            const site = this.findIdentifierRead(next, yName);
            if (!site) continue;
            if (site.index >= 0) {
                (site.container[site.key] as TYPE.Expression[])[site.index] = assign.right;
            } else {
                site.container[site.key] = assign.right;
            }
            elements.splice(i, 1);
            return true;
        }
        return false;
    }

    /**
     * 规则1:删除 test 序列里只写不读的 `X = 纯表达式` 元素(不能是最后一个元素,
     * 最后一个元素的值就是条件)。典型残留:`A || !(acc = p0.name !== T, p0.name !== T)`
     * 里的 `acc = ...`,删除后 `!` 下的比较可被 test 归一化反转为 `===`。
     */
    private dropDeadSaveElement(seq: TYPE.SequenceExpression, ctx: TestFoldContext): boolean {
        const elements = seq.expressions;
        const scope = ctx.scope;
        for (let i = 0; i < elements.length - 1; i++) {
            const assign = elements[i];
            if (!isAssignmentExpression(assign) || assign.operator !== "=") continue;
            if (!isIdentifier(assign.left)) continue;
            const xName = assign.left.name;
            if (!isTempName(xName)) continue;
            // 函数/类表达式的值经 callee 调用消费时 isReferenced 不可见,无法证明已死
            if (!isPureExpression(assign.right) || isDeclarationValue(assign.right)) continue;
            if (this.readsNameBeforeWriteAfterAnchor(ctx.test, assign, xName, assign, false, false).readBefore) continue;
            if (scanCapturedRead(scope, null, new Set([xName]), new Set(), false)) continue;
            if (!this.nameDeadAfterStatement(ctx.path, xName)) continue;
            // 消费分支在尾部之前执行:分支里“确定写入前读取 X”则保留该元素,
            // 除非 test 在该分支路径上一定会重写 X(此时分支读到的是新值)。
            if (this.branchDependsOnValue(ctx, xName, assign)) continue;
            elements.splice(i, 1);
            return true;
        }
        return false;
    }

    /**
     * 语句序列路径上,name 是否在“确定写入”之前被读取。
     * if 的两个分支互斥,写入只覆盖本分支,需要按路径递归检查
     * (如 else-if 链里某分支 `acc = ...; return acc` 属于先写后读,是安全的)。
     */
    private branchReadsBeforeWrite(stmts: TYPE.Statement[], name: string): boolean {
        for (const stmt of stmts) {
            if (this.definitelyWrites(stmt, name)) return false;
            if (isIfStatement(stmt)) {
                if (collectReadNames(stmt.test).has(name)) return true;
                if (this.branchReadsBeforeWrite(this.branchStatements(stmt.consequent), name)) return true;
                if (stmt.alternate && this.branchReadsBeforeWrite(this.branchStatements(stmt.alternate), name)) return true;
                continue;
            }
            if (collectReadNames(stmt).has(name)) return true;
        }
        return false;
    }

    private branchStatements(stmt: TYPE.Statement): TYPE.Statement[] {
        return isBlockStatementNode(stmt) ? stmt.body : [stmt];
    }

    /**
     * 分支是否依赖被删除的旧值。skip 是即将删除/搬移的赋值节点,
     * 它自己的写入不能算作“test 在分支前重写了 name”。
     */
    private branchDependsOnValue(ctx: TestFoldContext, name: string, skip: TYPE.Node): boolean {
        if (this.branchReadsBeforeWrite(ctx.consequent, name)
            && !this.testWritesAfterAnchor(ctx.test, skip, name, true, skip)) return true;
        if (ctx.alternate.length > 0
            && this.branchReadsBeforeWrite(ctx.alternate, name)
            && !this.testWritesAfterAnchor(ctx.test, skip, name, false, skip)) return true;
        return false;
    }

    /**
     * 从 anchor(通常是序列里的 `X = E` 元素)之后开始,判断是否在再次写入 name
     * 之前读取了它。短路/条件表达式按可能执行路径合并;写入出现在可能被跳过的
     * 分支里时不算“之后一定写过”,因此不会误删仍被读取的保存。
     */
    private readsNameBeforeWriteAfterAnchor(
        node: TYPE.Expression,
        anchor: TYPE.Node,
        name: string,
        skip: TYPE.Node,
        started: boolean,
        written: boolean,
    ): { readBefore: boolean; started: boolean; written: boolean } {
        if (node === skip) return { readBefore: false, started, written };
        if (node === anchor) return { readBefore: false, started: true, written: false };
        const value = node as unknown as { expression?: TYPE.Expression };
        if (isParenthesizedExpression(node)) {
            return this.readsNameBeforeWriteAfterAnchor(value.expression as TYPE.Expression, anchor, name, skip, started, written);
        }
        if (isSequenceExpression(node)) {
            let readBefore = false;
            let st = started;
            let wr = written;
            for (const expression of node.expressions as TYPE.Expression[]) {
                const result = this.readsNameBeforeWriteAfterAnchor(expression, anchor, name, skip, st, wr);
                readBefore = readBefore || result.readBefore;
                st = result.started;
                wr = result.written;
            }
            return { readBefore, started: st, written: wr };
        }
        if (isLogicalExpression(node)) {
            const left = this.readsNameBeforeWriteAfterAnchor(node.left as TYPE.Expression, anchor, name, skip, started, written);
            const right = this.readsNameBeforeWriteAfterAnchor(node.right as TYPE.Expression, anchor, name, skip, left.started, left.written);
            // 右侧可能短路不执行,节点之后只有左侧的写入是确定的
            return { readBefore: left.readBefore || right.readBefore, started: left.started || right.started, written: left.written };
        }
        if (isConditionalExpression(node)) {
            const test = this.readsNameBeforeWriteAfterAnchor(node.test, anchor, name, skip, started, written);
            const consequent = this.readsNameBeforeWriteAfterAnchor(node.consequent, anchor, name, skip, test.started, test.written);
            const alternate = this.readsNameBeforeWriteAfterAnchor(node.alternate, anchor, name, skip, test.started, test.written);
            return {
                readBefore: test.readBefore || consequent.readBefore || alternate.readBefore,
                started: test.started || consequent.started || alternate.started,
                written: test.written,
            };
        }
        if (isUnaryExpression(node)) {
            return this.readsNameBeforeWriteAfterAnchor(node.argument as TYPE.Expression, anchor, name, skip, started, written);
        }
        if (isBinaryExpression(node)) {
            const left = this.readsNameBeforeWriteAfterAnchor(node.left as unknown as TYPE.Expression, anchor, name, skip, started, written);
            const right = this.readsNameBeforeWriteAfterAnchor(node.right as unknown as TYPE.Expression, anchor, name, skip, left.started, left.written);
            return { readBefore: left.readBefore || right.readBefore, started: right.started, written: right.written };
        }
        if (isAssignmentExpression(node)) {
            const readsLeft = isIdentifier(node.left)
                ? (node.operator !== "=" && node.left.name === name)
                : collectReadNames(node.left).has(name);
            const right = this.readsNameBeforeWriteAfterAnchor(node.right, anchor, name, skip, started, written);
            const writes = right.started && isIdentifier(node.left) && node.left.name === name;
            return {
                readBefore: (right.started && readsLeft && !right.written) || right.readBefore,
                started: right.started,
                written: right.written || writes,
            };
        }
        if (this.containsNode(node, anchor)) {
            // 未展开的结构里含 anchor:保守认为可能先读后写
            return { readBefore: true, started: true, written };
        }
        // 未展开的结构(对象/模板/数组等)里可能有条件写入,保守不把它当成
        // “之后一定写过”;读取仍按出现处理,宁可少删也不误删。
        const readBefore = started && !written && collectReadNames(node).has(name);
        return { readBefore, started, written };
    }

    /** root 子树中是否包含 target(不进入函数/类体)。 */
    private containsNode(root: TYPE.Node | null | undefined, target: TYPE.Node): boolean {
        let found = false;
        walkNode(root, (n) => {
            if (found) return false;
            if (isFunctionLike(n) || isClassLike(n)) return false;
            if (n === target) {
                found = true;
                return false;
            }
            return true;
        });
        return found;
    }

    /**
     * 在 anchor 之后、按 truthy/falsy 路径求值时,name 是否一定会被写入。
     * 只能统计 anchor 之后的位置:同一 test 里 anchor 之前的写入会被 anchor 自己覆盖,
     * 不能用来证明“分支读到的是新值”。
     */
    private testWritesAfterAnchor(
        node: TYPE.Expression,
        anchor: TYPE.Node,
        name: string,
        truthy: boolean,
        skip: TYPE.Node,
    ): boolean {
        if (node === anchor || node === skip) return false;
        if (isSequenceExpression(node)) {
            const expressions = node.expressions as TYPE.Expression[];
            const index = expressions.findIndex((e) => this.containsNode(e, anchor));
            if (index < 0) return false;
            if (this.testWritesAfterAnchor(expressions[index], anchor, name, truthy, skip)) return true;
            for (let k = index + 1; k < expressions.length; k++) {
                if (this.testWritesOnTakenPath(expressions[k], name, true, skip)) return true;
            }
            return false;
        }
        if (isLogicalExpression(node)) {
            const left = node.left as TYPE.Expression;
            const right = node.right as TYPE.Expression;
            if (this.containsNode(left, anchor)) {
                if (this.testWritesAfterAnchor(left, anchor, name, truthy, skip)) return true;
                // 右侧只在特定路径上求值:必须确保该路径一定执行
                if (node.operator === "&&" && truthy) return this.testWritesOnTakenPath(right, name, true, skip);
                if (node.operator === "||" && !truthy) return this.testWritesOnTakenPath(right, name, false, skip);
                return false;
            }
            if (this.containsNode(right, anchor)) {
                return this.testWritesAfterAnchor(right, anchor, name, truthy, skip);
            }
            return false;
        }
        if (isUnaryExpression(node) && node.operator === "!") {
            return this.testWritesAfterAnchor(node.argument as TYPE.Expression, anchor, name, !truthy, skip);
        }
        if (isConditionalExpression(node)) {
            if (this.containsNode(node.test, anchor)) {
                if (this.testWritesAfterAnchor(node.test, anchor, name, true, skip)) return true;
                return this.testWritesOnTakenPath(node.consequent, name, truthy, skip)
                    && this.testWritesOnTakenPath(node.alternate, name, truthy, skip);
            }
            if (truthy && this.containsNode(node.consequent, anchor)) {
                return this.testWritesAfterAnchor(node.consequent, anchor, name, true, skip);
            }
            if (!truthy && this.containsNode(node.alternate, anchor)) {
                return this.testWritesAfterAnchor(node.alternate, anchor, name, false, skip);
            }
            return false;
        }
        if (isAssignmentExpression(node)) {
            return this.containsNode(node.right, anchor)
                ? this.testWritesAfterAnchor(node.right, anchor, name, truthy, skip)
                : false;
        }
        if (isBinaryExpression(node)) {
            const left = node.left as unknown as TYPE.Expression;
            const right = node.right as unknown as TYPE.Expression;
            if (this.containsNode(left, anchor)) {
                return this.testWritesAfterAnchor(left, anchor, name, truthy, skip)
                    || this.testWritesOnTakenPath(right, name, true, skip);
            }
            if (this.containsNode(right, anchor)) {
                return this.testWritesAfterAnchor(right, anchor, name, truthy, skip);
            }
            return false;
        }
        if (isMemberExpression(node)) {
            if (this.containsNode(node.object, anchor)) {
                return this.testWritesAfterAnchor(node.object as TYPE.Expression, anchor, name, truthy, skip)
                    || (node.computed && this.testWritesOnTakenPath(node.property as unknown as TYPE.Expression, name, true, skip));
            }
            return node.computed
                ? this.testWritesAfterAnchor(node.property as unknown as TYPE.Expression, anchor, name, truthy, skip)
                : false;
        }
        if (isCallExpression(node) || isNewExpression(node)) {
            const parts: TYPE.Expression[] = [node.callee as TYPE.Expression];
            for (const arg of node.arguments) parts.push(arg as TYPE.Expression);
            const index = parts.findIndex((part) => this.containsNode(part, anchor));
            if (index < 0) return false;
            if (this.testWritesAfterAnchor(parts[index], anchor, name, truthy, skip)) return true;
            for (let k = index + 1; k < parts.length; k++) {
                if (this.testWritesOnTakenPath(parts[k], name, true, skip)) return true;
            }
            return false;
        }
        if (isUnaryExpression(node)) {
            return this.testWritesAfterAnchor(node.argument as TYPE.Expression, anchor, name, truthy, skip);
        }
        return false;
    }

    /**
     * test 按 truthy(或 falsy)路径求值时,name 是否一定会被写入(skip 节点除外)。
     * 路径分析只覆盖短路/条件表达式;其它节点保守返回 false。
     */
    private testWritesOnTakenPath(
        test: TYPE.Expression,
        name: string,
        truthy: boolean,
        skip?: TYPE.Node,
    ): boolean {
        if (skip && test === skip) return false;
        if (isSequenceExpression(test)) {
            return test.expressions.some((e) => this.testWritesOnTakenPath(e as TYPE.Expression, name, true, skip));
        }
        if (isAssignmentExpression(test)) {
            const writesLeft = isIdentifier(test.left) && test.left.name === name;
            return writesLeft || this.testWritesOnTakenPath(test.right, name, true, skip);
        }
        if (isUpdateExpression(test)) {
            return isIdentifier(test.argument) && test.argument.name === name;
        }
        if (isUnaryExpression(test) && test.operator === "!") {
            return this.testWritesOnTakenPath(test.argument as TYPE.Expression, name, !truthy, skip);
        }
        if (isLogicalExpression(test)) {
            const left = test.left as TYPE.Expression;
            const right = test.right as TYPE.Expression;
            if (test.operator === "&&") {
                // truthy:两边都执行;falsy:左侧为假时右侧短路
                return truthy
                    ? this.testWritesOnTakenPath(left, name, true, skip) || this.testWritesOnTakenPath(right, name, true, skip)
                    : this.testWritesOnTakenPath(left, name, false, skip);
            }
            // truthy:左侧为真时右侧短路;falsy:两边都执行
            return truthy
                ? this.testWritesOnTakenPath(left, name, true, skip)
                : this.testWritesOnTakenPath(left, name, false, skip) || this.testWritesOnTakenPath(right, name, false, skip);
        }
        if (isConditionalExpression(test)) {
            return this.testWritesOnTakenPath(test.consequent, name, truthy, skip)
                && this.testWritesOnTakenPath(test.alternate, name, truthy, skip);
        }
        return false;
    }

    /** 求值顺序上 fromNode 之后是否读取了 name;拿不到位置时保守按读取处理。 */
    private testReadsNameAfter(test: TYPE.Expression, fromNode: TYPE.Node, name: string): boolean {
        const order = this.evaluationOrder(test);
        // flatten 只压叶子节点,复合元素(二元/调用等)本身不在 order 里,
        // 用元素子树在求值序中的最大位置作为锚点
        const inner = new Set<TYPE.Node>();
        walkNode(fromNode, (n) => {
            inner.add(n);
            return !isFunctionLike(n) && !isClassLike(n);
        });
        let pos = -1;
        for (let i = 0; i < order.length; i++) {
            if (inner.has(order[i])) pos = i;
        }
        if (pos < 0) return true;
        for (let i = pos + 1; i < order.length; i++) {
            if (collectReadNames(order[i]).has(name)) return true;
        }
        return false;
    }

    /** 语句之后(含循环回边前缀)name 是否在确定写入前被读取;是则值仍可观察。 */
    private nameDeadAfterStatement(path: NodePath<TYPE.Statement>, name: string): boolean {
        for (const segment of this.collectTailSegments(path)) {
            if (tempReadBeforeWrite(segment, 0, name)) return false;
        }
        return true;
    }

    /**
     * 语句之后按执行序可能读到的位置,分成若干线性段;每段独立做“先读后写”检查。
     * 内层循环的回边用“循环体开头到当前语句之前”的前缀表示(下轮迭代该前缀
     * 先于任何后续读取执行);循环 test/update 作为尾段;外层循环保守整环纳入。
     */
    private collectTailSegments(stmtPath: NodePath<TYPE.Statement>): TYPE.Statement[][] {
        const segments: TYPE.Statement[][] = [];
        const self = stmtPath.node;
        let child: NodePath = stmtPath;
        let cur: NodePath | null = stmtPath.parentPath;
        let innermostLoopHandled = false;
        while (cur) {
            if (cur.isBlockStatement() || cur.isProgram()) {
                const body = cur.node.body;
                const idx = body.indexOf(child.node as TYPE.Statement);
                if (idx >= 0) segments.push(body.slice(idx + 1));
            } else if (cur.isWhileStatement() || cur.isForStatement()
                || cur.isForInStatement() || cur.isForOfStatement()) {
                if (!innermostLoopHandled) {
                    innermostLoopHandled = true;
                    const loopTestStmts: TYPE.Statement[] = [];
                    if (cur.isForStatement()) {
                        if (cur.node.test) loopTestStmts.push(expressionStatement(cur.node.test));
                        if (cur.node.update) loopTestStmts.push(expressionStatement(cur.node.update));
                    } else if (cur.isWhileStatement() && cur.node.test) {
                        loopTestStmts.push(expressionStatement(cur.node.test));
                    }
                    segments.push(loopTestStmts);
                    const body = cur.node.body;
                    if (isBlockStatementNode(body)) {
                        const idx = body.body.findIndex((s) => this.statementContains(s, self));
                        if (idx > 0) segments.push(body.body.slice(0, idx));
                    }
                } else {
                    segments.push([cur.node]);
                }
            } else if (cur.isDoWhileStatement()) {
                // do-while 的 body 会重新执行,保守整环纳入
                segments.push([cur.node]);
                innermostLoopHandled = true;
            } else if (cur.isSwitchStatement()) {
                const cases = cur.node.cases;
                const caseIndex = cases.findIndex((c) => c.consequent.includes(child.node as TYPE.Statement));
                if (caseIndex >= 0) {
                    for (let s = caseIndex; s < cases.length; s++) segments.push(cases[s].consequent);
                }
            }
            if (cur.isFunction() || cur.isProgram()) break;
            child = cur;
            cur = cur.parentPath;
        }
        return segments;
    }

    private statementContains(stmt: TYPE.Statement, target: TYPE.Node): boolean {
        let found = false;
        walkNode(stmt, (n) => {
            if (found) return false;
            if (n === target) {
                found = true;
                return false;
            }
            return !isFunctionLike(n) && !isClassLike(n);
        });
        return found;
    }

    /** 统计节点内标识符 name 的读取次数(跳过嵌套函数/类)。 */
    private countIdentifierReads(node: TYPE.Node, name: string): number {
        let count = 0;
        walkNode(node, (n, parent) => {
            if (isFunctionLike(n) || isClassLike(n)) return false;
            if (isIdentifier(n) && n.name === name && parent && isReferencedNode(n, parent)) count++;
            return true;
        });
        return count;
    }

    /** 找到节点内标识符 name 的第一处读取,返回其所在容器与位置,便于原地替换。 */
    private findIdentifierRead(
        node: TYPE.Node,
        name: string,
    ): { container: { [key: string]: any }; key: string; index: number } | null {
        let site: { container: { [key: string]: any }; key: string; index: number } | null = null;
        const visit = (current: TYPE.Node, parent: TYPE.Node | null, key: string | null): boolean => {
            if (site) return false;
            if (isFunctionLike(current) || isClassLike(current)) return false;
            if (isIdentifier(current) && current.name === name && parent && key !== null
                && isReferencedNode(current, parent)) {
                const holder = parent as { [key: string]: any };
                const slot = holder[key];
                // 键可能对应数组(expressions/arguments 等),记录元素下标
                const index = Array.isArray(slot) ? slot.indexOf(current) : -1;
                site = { container: holder, key, index };
                return false;
            }
            return true;
        };
        walkNode(node, visit as any);
        return site;
    }

    /** 原地把节点内标识符 name 的所有读取替换为 replacement(跳过嵌套函数/类)。 */
    private replaceIdentifierReads(node: TYPE.Node, name: string, replacement: TYPE.Identifier): void {
        const visit = (current: TYPE.Node, parent: TYPE.Node | null, key: string | null): boolean => {
            if (isFunctionLike(current) || isClassLike(current)) return false;
            if (isIdentifier(current) && current.name === name && parent && key !== null
                && isReferencedNode(current, parent)) {
                const holder = parent as { [key: string]: any };
                const slot = holder[key];
                if (Array.isArray(slot)) {
                    slot[slot.indexOf(current)] = identifier(replacement.name);
                } else {
                    holder[key] = identifier(replacement.name);
                }
                return false;
            }
            return true;
        };
        walkNode(node, visit as any);
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
        while (isParenthesizedExpression(expr)) expr = (expr as any).expression;
        if (isSequenceExpression(expr)) {
            if (!unconditional) return expr;
            const expressions = expr.expressions as TYPE.Expression[];
            if (expressions.length <= 1) return expressions[0] ?? expr;
            for (let i = 0; i < expressions.length - 1; i++) {
                out.push(expressionStatement(expressions[i]));
            }
            return this.extractUnconditionalPrefix(expressions[expressions.length - 1], out, unconditional);
        }
        if (isLogicalExpression(expr)) {
            // 左侧一定求值;右侧只在左侧满足条件时求值,不能提前。
            expr.left = this.extractUnconditionalPrefix(expr.left as TYPE.Expression, out, unconditional);
            expr.right = this.extractUnconditionalPrefix(expr.right as TYPE.Expression, out, false);
            return expr;
        }
        if (isConditionalExpression(expr)) {
            // test 一定求值,consequent/alternate 不一定。
            expr.test = this.extractUnconditionalPrefix(expr.test, out, unconditional);
            return expr;
        }
        if (isUnaryExpression(expr) && expr.operator !== "delete") {
            expr.argument = this.extractUnconditionalPrefix(expr.argument as TYPE.Expression, out, unconditional);
            return expr;
        }
        if (isParenthesizedExpression(expr)) {
            const node = expr as any;
            node.expression = this.extractUnconditionalPrefix(node.expression, out, unconditional);
            return node;
        }
        return expr;
    }

    /** 判断语句是否在所有执行路径上都会给 name 赋新值(用于确认 test 中的临时赋值一定被覆盖)。 */
    private definitelyWrites(stmt: TYPE.Statement | null | undefined, name: string): boolean {
        if (!stmt) return false;
        if (isBlockStatementNode(stmt) || isProgramNode(stmt)) {
            return stmt.body.some((child) => this.definitelyWrites(child, name));
        }
        if (isExpressionStatement(stmt)) return this.definitelyWritesExpression(stmt.expression, name);
        if (isIfStatement(stmt)) {
            return this.definitelyWrites(stmt.consequent, name)
                && this.definitelyWrites(stmt.alternate, name);
        }
        if (isLabeledStatement(stmt)) return this.definitelyWrites(stmt.body, name);
        if (isTryStatement(stmt)) {
            // finally 一定会执行;没有 finally 时保守处理
            return stmt.finalizer != null && this.definitelyWrites(stmt.finalizer, name);
        }
        return false;
    }

    private definitelyWritesExpression(expr: TYPE.Expression, name: string): boolean {
        if (isAssignmentExpression(expr)) {
            if (isIdentifier(expr.left) && expr.left.name === name) return true;
            return this.definitelyWritesExpression(expr.right, name);
        }
        if (isUpdateExpression(expr)) {
            return isIdentifier(expr.argument) && expr.argument.name === name;
        }
        if (isSequenceExpression(expr)) {
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
        if (isSequenceExpression(node)) {
            for (const expression of node.expressions) this.flatten(expression as TYPE.Expression, out);
            return;
        }
        if (isLogicalExpression(node)) {
            this.flatten(node.left as TYPE.Expression, out);
            this.flatten(node.right as TYPE.Expression, out);
            return;
        }
        if (isConditionalExpression(node)) {
            this.flatten(node.test, out);
            this.flatten(node.consequent, out);
            this.flatten(node.alternate, out);
            return;
        }
        if (isAssignmentExpression(node)) {
            // 赋值语句本身在 RHS 之后生效
            this.flatten(node.right, out);
            out.push(node);
            return;
        }
        if (isCallExpression(node) || isNewExpression(node)) {
            this.flatten(node.callee as TYPE.Expression, out);
            for (const argument of node.arguments) this.flatten(argument as TYPE.Expression, out);
            return;
        }
        if (isBinaryExpression(node)) {
            this.flatten(node.left as TYPE.Expression, out);
            this.flatten(node.right as TYPE.Expression, out);
            return;
        }
        if (isUnaryExpression(node)) {
            this.flatten(node.argument as TYPE.Expression, out);
            out.push(node);
            return;
        }
        if (isMemberExpression(node)) {
            this.flatten(node.object as TYPE.Expression, out);
            if (node.computed) this.flatten(node.property as TYPE.Expression, out);
            out.push(node);
            return;
        }
        if (isArrayExpression(node)) {
            for (const element of node.elements) this.flatten(element as TYPE.Expression, out);
            out.push(node);
            return;
        }
        if (isObjectExpression(node)) {
            for (const property of node.properties) this.flatten(property as TYPE.Node, out);
            out.push(node);
            return;
        }
        out.push(node);
    }
}
