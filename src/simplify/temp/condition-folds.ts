import * as TYPE from "@babel/types";
import {
    isAssignmentExpression,
    isBlockStatement,
    isReferenced,
    isContinueStatement,
    isDoWhileStatement,
    isExpressionStatement,
    isIdentifier,
    isIfStatement,
    isLogicalExpression,
    isReturnStatement,
    isUnaryExpression,
    identifier as identifierBuilder,
    logicalExpression,
    unaryExpression,
} from "@babel/types";
import {
    collectAssignedNames,
    collectIdentifierNames,
    collectReadNames,
    isClassLike,
    isDeclarationValue,
    isFunctionLike,
    isPureExpression,
    isTempName,
    replaceNodeInTree,
    walkNode,
} from "../AstUtils";
import { TempVariablePass } from "./base";
import { FunctionContext } from "./types";
import {
    branchReadsNameBeforeWrite,
    countReadsInNode,
    hasDeferredSelfReference,
    isFirstEvaluatedOccurrence,
    negateExpression,
} from "./queries";
import { removeRefs } from "./context";

/**
 * 布尔物化/条件赋值折叠:
 *   - do-while 末尾赋值搬进 test
 *   - 布尔三目物化链 `X = E; Y = X; X = !X; X = X ? Y : F` -> `X = E && F`
 *   - 自取反链与 if test 的条件搬移
 *
 * @Author: jmp0
 */
export class ConditionFolds extends TempVariablePass {

    /**
     * `do { ...; X = E; } while (!X)` -> `do { ... } while (!E)`。
     *
     * 编译器把循环条件物化成 `X = !CALL` 放在 body 末尾、再用 `!X` 跳转。
     * 赋值是 body 最后一条语句,把 E 搬进 test 的求值点完全相同;前提是:
     *   - X 是未被闭包捕获的临时变量,且 E 不写 X;
     *   - body 内没有 continue(continue 会跳过末尾赋值直接进入 test);
     *   - 循环结束后 X 的旧值已死(ctx.liveAfter 不再包含 X)。
     */
    foldDoWhileTestAssignments(stmts: TYPE.Statement[], ctx: FunctionContext): void {
        for (const stmt of stmts) {
            if (isDoWhileStatement(stmt)) this.foldSingleDoWhileTest(stmt, ctx);
            this.foldDoWhileTestChildren(stmt, ctx);
        }
    }
    private foldDoWhileTestChildren(stmt: TYPE.Statement, ctx: FunctionContext): void {
        switch (stmt.type) {
            case "BlockStatement":
                this.foldDoWhileTestAssignments(stmt.body, ctx);
                break;
            case "IfStatement":
                this.foldDoWhileTestChildren(stmt.consequent, ctx);
                if (stmt.alternate) this.foldDoWhileTestChildren(stmt.alternate, ctx);
                break;
            case "WhileStatement":
            case "DoWhileStatement":
            case "ForStatement":
            case "ForInStatement":
            case "ForOfStatement":
            case "LabeledStatement":
                this.foldDoWhileTestChildren(stmt.body, ctx);
                break;
            case "TryStatement":
                this.foldDoWhileTestAssignments(stmt.block.body, ctx);
                if (stmt.handler) this.foldDoWhileTestAssignments(stmt.handler.body.body, ctx);
                if (stmt.finalizer) this.foldDoWhileTestAssignments(stmt.finalizer.body, ctx);
                break;
            case "SwitchStatement":
                for (const c of stmt.cases) this.foldDoWhileTestAssignments(c.consequent, ctx);
                break;
            default:
                break;
        }
    }
    private foldSingleDoWhileTest(stmt: TYPE.DoWhileStatement, ctx: FunctionContext): boolean {
        const body = stmt.body;
        if (!isBlockStatement(body) || body.body.length < 2) return false;
        const last = body.body[body.body.length - 1];
        if (!isExpressionStatement(last) || !isAssignmentExpression(last.expression)) return false;
        const assign = last.expression;
        if (assign.operator !== "=" || !isIdentifier(assign.left)) return false;
        const name = assign.left.name;
        if (!isTempName(name)) return false;
        const info = ctx.infos.get(name);
        if (!info || info.captured) return false;
        if (collectAssignedNames(assign.right).has(name)) return false;

        const test = stmt.test;
        let testNegated: boolean;
        if (isIdentifier(test) && test.name === name) {
            testNegated = false;
        } else if (isUnaryExpression(test) && test.operator === "!"
            && isIdentifier(test.argument) && test.argument.name === name) {
            testNegated = true;
        } else {
            return false;
        }

        // continue 会跳过末尾赋值直接求值 test,此时 test 读到的是旧值
        let hasContinue = false;
        walkNode(body, (node) => {
            if (isContinueStatement(node)) {
                hasContinue = true;
                return false;
            }
            return true;
        });
        if (hasContinue) return false;

        // 循环之后 X 的旧值必须已死,否则删掉末尾赋值会改变后续读取
        const liveAfter = ctx.liveAfter.get(stmt);
        if (!liveAfter || liveAfter.has(name)) return false;

        body.body.pop();
        let newTest: TYPE.Expression = testNegated ? unaryExpression("!", assign.right) : assign.right;
        // !(!E) -> E
        if (isUnaryExpression(newTest) && newTest.operator === "!"
            && isUnaryExpression(newTest.argument) && newTest.argument.operator === "!") {
            newTest = newTest.argument.argument;
        }
        removeRefs(test, ctx);
        stmt.test = newTest;
        this.changed = true;
        return true;
    }
    /**
     * 折叠布尔三目刚展开出来的别名链:
     *   X = E; Y = X && F; ...   ->   Y = E && F; ...
     * 仅当 X 是未被捕获的临时变量、E 不读取 X、且 X 在本条语句之后已死。
     * 重复应用后 `v16 = !A; v15 = v16 && !B; ...` 会收敛成一条逻辑表达式,
     * 再交给 cleanupConditionAssignments 搬进紧随其后的 if test。
     */
    foldBooleanAliasAssignments(stmts: TYPE.Statement[], ctx: FunctionContext): void {
        let folded = true;
        while (folded) {
            folded = false;
            for (let i = 0; i + 1 < stmts.length; i++) {
                if (this.tryFoldBooleanMaterialization(stmts, i, ctx)) {
                    folded = true;
                    break;
                }
                if (!this.tryFoldBooleanAlias(stmts, i, ctx)) continue;
                folded = true;
                break;
            }
        }
        // 折叠后可能留下只写不读的临时赋值(如循环前的 `acc = false`),
        // 删除它们后 removeUnusedDeclarations 才能清掉对应声明。
        for (let i = stmts.length - 1; i >= 0; i--) {
            const stmt = stmts[i];
            if (!isExpressionStatement(stmt) || !isAssignmentExpression(stmt.expression)) continue;
            const assign = stmt.expression;
            if (assign.operator !== "=" || !isIdentifier(assign.left)) continue;
            const name = assign.left.name;
            if (!isTempName(name) || isDeclarationValue(assign.right) || !isPureExpression(assign.right)) continue;
            const info = ctx.infos.get(name);
            if (!info || info.captured || info.refs.size !== 0) continue;
            stmts.splice(i, 1);
            this.changed = true;
        }
        for (const stmt of stmts) this.foldBooleanAliasChildren(stmt, ctx);
    }
    /**
     * 布尔三目物化链:
     *   X = E; Y = X; X = !X; X = X ? Y : F   ->   X = E && F
     * 逐值等价:E 为假时原式得到 Y(=E),新式短路返回 E;E 为真时原式取 F,
     * 新式继续求值 F。要求 Y 之后已死、F 不读取 X/Y。
     */
    private tryFoldBooleanMaterialization(stmts: TYPE.Statement[], i: number, ctx: FunctionContext): boolean {
        if (i + 3 >= stmts.length) return false;
        const s1 = stmts[i];
        const s2 = stmts[i + 1];
        const s3 = stmts[i + 2];
        const s4 = stmts[i + 3];
        if (!isExpressionStatement(s1) || !isAssignmentExpression(s1.expression)) return false;
        if (!isExpressionStatement(s2) || !isAssignmentExpression(s2.expression)) return false;
        if (!isExpressionStatement(s3) || !isAssignmentExpression(s3.expression)) return false;
        if (!isExpressionStatement(s4) || !isAssignmentExpression(s4.expression)) return false;
        const a = s1.expression;
        const b = s2.expression;
        const c = s3.expression;
        const d = s4.expression;
        if (a.operator !== "=" || !isIdentifier(a.left)) return false;
        if (b.operator !== "=" || !isIdentifier(b.left) || !isIdentifier(b.right)) return false;
        if (c.operator !== "=" || !isIdentifier(c.left)) return false;
        if (d.operator !== "=" || !isIdentifier(d.left)) return false;
        const name = a.left.name;
        if (!isTempName(name) || !isTempName(b.left.name)) return false;
        if (b.right.name !== name || c.left.name !== name || d.left.name !== name) return false;
        if (!isUnaryExpression(c.right) || c.right.operator !== "!"
            || !isIdentifier(c.right.argument) || c.right.argument.name !== name) return false;
        if (!TYPE.isConditionalExpression(d.right)) return false;
        const conditional = d.right;
        if (!isIdentifier(conditional.test) || conditional.test.name !== name) return false;
        if (!isIdentifier(conditional.consequent) || conditional.consequent.name !== b.left.name) return false;
        const fallback = conditional.alternate as TYPE.Expression;
        if (collectReadNames(fallback).has(name) || collectReadNames(fallback).has(b.left.name)) return false;

        const info = ctx.infos.get(name);
        const aliasInfo = ctx.infos.get(b.left.name);
        if (!info || info.captured || !aliasInfo || aliasInfo.captured) return false;
        if (isDeclarationValue(a.right) || collectReadNames(a.right).has(name)) return false;
        // 别名变量 Y 在这次物化之后不能再被读取。
        const liveAfter = ctx.liveAfter.get(s4);
        if (liveAfter && liveAfter.has(b.left.name)) return false;

        removeRefs(b.right, ctx);
        removeRefs(c.right, ctx);
        removeRefs(conditional.test, ctx);
        removeRefs(conditional.consequent, ctx);
        a.right = logicalExpression("&&", a.right, fallback);
        stmts.splice(i + 1, 3);
        this.changed = true;
        return true;
    }
    private tryFoldBooleanAlias(stmts: TYPE.Statement[], i: number, ctx: FunctionContext): boolean {
        const first = stmts[i];
        const second = stmts[i + 1];
        if (!isExpressionStatement(first) || !isAssignmentExpression(first.expression)) return false;
        if (!isExpressionStatement(second) || !isAssignmentExpression(second.expression)) return false;
        const a = first.expression;
        const b = second.expression;
        if (a.operator !== "=" || !isIdentifier(a.left)) return false;
        if (b.operator !== "=" || !isIdentifier(b.left)) return false;
        const xName = a.left.name;
        const yName = b.left.name;
        if (!isTempName(xName) || !isTempName(yName)) return false;
        const aInfo = ctx.infos.get(xName);
        const bInfo = ctx.infos.get(yName);
        if (!aInfo || aInfo.captured || !bInfo || bInfo.captured) return false;
        if (isDeclarationValue(a.right)) return false;
        // E 必须只读取旧值一次;这里要求它完全不读 X,避免搬移后读取到更旧的值。
        if (collectReadNames(a.right).has(xName)) return false;

        const rhs = b.right;
        if (!isLogicalExpression(rhs)) return false;
        if (!isIdentifier(rhs.left) || rhs.left.name !== xName) return false;
        if (countReadsInNode(rhs, xName) !== 1) return false;
        // X 的值在这次使用之后不能再被读取(闭包读取已由 captured 排除)。
        const liveAfter = ctx.liveAfter.get(second);
        if (liveAfter && liveAfter.has(xName)) return false;

        removeRefs(rhs.left, ctx);
        rhs.left = a.right as TYPE.Expression;
        stmts.splice(i, 1);
        this.changed = true;
        return true;
    }
    private foldBooleanAliasChildren(stmt: TYPE.Statement, ctx: FunctionContext): void {
        switch (stmt.type) {
            case "BlockStatement":
                this.foldBooleanAliasAssignments(stmt.body, ctx);
                break;
            case "IfStatement":
                if (isBlockStatement(stmt.consequent)) this.foldBooleanAliasAssignments(stmt.consequent.body, ctx);
                else this.foldBooleanAliasChildren(stmt.consequent, ctx);
                if (stmt.alternate) {
                    if (isBlockStatement(stmt.alternate)) this.foldBooleanAliasAssignments(stmt.alternate.body, ctx);
                    else this.foldBooleanAliasChildren(stmt.alternate, ctx);
                }
                break;
            case "WhileStatement":
            case "DoWhileStatement":
            case "ForStatement":
            case "ForInStatement":
            case "ForOfStatement":
            case "LabeledStatement":
                if (isBlockStatement(stmt.body)) this.foldBooleanAliasAssignments(stmt.body.body, ctx);
                else this.foldBooleanAliasChildren(stmt.body, ctx);
                break;
            case "TryStatement":
                this.foldBooleanAliasAssignments(stmt.block.body, ctx);
                if (stmt.handler) this.foldBooleanAliasAssignments(stmt.handler.body.body, ctx);
                if (stmt.finalizer) this.foldBooleanAliasAssignments(stmt.finalizer.body, ctx);
                break;
            case "SwitchStatement":
                for (const c of stmt.cases) this.foldBooleanAliasAssignments(c.consequent, ctx);
                break;
            default:
                break;
        }
    }
    /**
     * 折叠 HighLevelGrammarSimplify 之后才暴露的自取反物化链:
     *
     *   X = E; X = !X; X = !X && B ? C : D  ->  X = E && B ? C : D
     *   Y = X; X = !X; Z = X ? A : B        ->  Z = !Y ? A : B
     *
     * 编译器为 `callruntime.isfalse` 生成的取反既可能留在 if test 里,也会在
     * 短路条件被合成为独立赋值后留在语句序列里。前一条赋值给出 X 的旧值 E,
     * 把紧随赋值/return 里唯一一次 X 读取替换成 E(取反位置直接消掉一层),
     * 再删除自取反语句;旧值已死时连同 `X = E` 一起删除。
     */
    private foldNegatedSelfAssignments(stmts: TYPE.Statement[], ctx: FunctionContext): void {
        for (let i = 1; i + 1 < stmts.length; i++) {
            const negStmt = stmts[i];
            if (!isExpressionStatement(negStmt) || !isAssignmentExpression(negStmt.expression)) continue;
            const neg = negStmt.expression;
            if (neg.operator !== "=" || !isIdentifier(neg.left)
                || !isUnaryExpression(neg.right) || neg.right.operator !== "!"
                || !isIdentifier(neg.right.argument) || neg.right.argument.name !== neg.left.name) continue;
            const name = neg.left.name;
            if (!isTempName(name)) continue;
            const info = ctx.infos.get(name);
            if (!info || info.captured) continue;

            // 旧值来源:紧邻的 `X = E`,或 `Y = X` 之后的别名值 Y。
            const prev = stmts[i - 1];
            let sourceValue: TYPE.Expression | null = null;
            let sourceStatement: TYPE.Statement | null = null;
            if (isExpressionStatement(prev) && isAssignmentExpression(prev.expression)) {
                const prevAssign = prev.expression;
                if (prevAssign.operator === "=" && isIdentifier(prevAssign.left)) {
                    if (prevAssign.left.name === name) {
                        if (isDeclarationValue(prevAssign.right)) continue;
                        sourceValue = prevAssign.right;
                        sourceStatement = prev;
                    } else if (isIdentifier(prevAssign.right) && prevAssign.right.name === name) {
                        sourceValue = identifierBuilder(prevAssign.left.name);
                    }
                }
            }
            if (!sourceValue) continue;
            if (collectReadNames(sourceValue).has(name)) continue;

            // 下一条语句消费 X:只允许一次读取,且必须是该表达式最先求值的位置,
            // 这样把旧值搬进来不会越过任何写入/副作用。
            const next = stmts[i + 1];
            let nextRoot: TYPE.Expression | null = null;
            if (isExpressionStatement(next)) {
                const nextExpr = next.expression;
                // 简单赋值语句先求值右值再写左值,左值不是读取;把 X 的读取定位在右值里,
                // 否则 isFirstEvaluatedOccurrence 会把赋值目标当成第一个求值节点。
                nextRoot = isAssignmentExpression(nextExpr) && nextExpr.operator === "=" && isIdentifier(nextExpr.left)
                    ? nextExpr.right
                    : nextExpr;
            } else if (isReturnStatement(next) && next.argument) {
                nextRoot = next.argument;
            }
            if (!nextRoot || countReadsInNode(nextRoot, name) !== 1) continue;

            let ref: TYPE.Identifier | null = null;
            let refParent: TYPE.Node | null = null;
            walkNode(nextRoot, (node, parent) => {
                if (isFunctionLike(node) || isClassLike(node)) return false;
                if (isIdentifier(node) && node.name === name && parent && isReferenced(node, parent)) {
                    ref = node;
                    refParent = parent;
                    return false;
                }
                return true;
            });
            if (!ref) continue;
            if (!isFirstEvaluatedOccurrence(nextRoot, ref)) {
                // 成员左值赋值(`this.hasStreams = !acc`)的读取在右值里,但
                // firstEvaluatedChild 会先走左值(this -> null)而失败。
                // 旧值是纯表达式时,搬到非首个求值位置不改变副作用顺序,
                // 只要求语句内的写入不命中右值读取的名字(对齐 canDeferTestValue
                // 的纯值分支,按整条语句保守判断)。
                if (!isPureExpression(sourceValue)) continue;
                const assigned = collectAssignedNames(next);
                let collides = false;
                for (const dep of collectIdentifierNames(sourceValue)) {
                    if (assigned.has(dep)) { collides = true; break; }
                }
                if (collides) continue;
            }

            const nextWritesName = isExpressionStatement(next) && isAssignmentExpression(next.expression)
                && next.expression.operator === "=" && isIdentifier(next.expression.left)
                && next.expression.left.name === name;
            if (!nextWritesName) {
                const liveAfter = ctx.liveAfter.get(next);
                if (!liveAfter || liveAfter.has(name)) continue;
            }

            // `!X` 位置直接用旧值 E;裸 X 位置用 !E(negateExpression 会消掉 E 自带的 !)。
            const target: TYPE.Node = refParent && isUnaryExpression(refParent)
                && refParent.operator === "!" && refParent.argument === ref ? refParent : ref;
            const replacement = target === ref ? negateExpression(sourceValue) : sourceValue;
            if (nextRoot === target) {
                if (isExpressionStatement(next)) {
                    if (isAssignmentExpression(next.expression) && next.expression.right === nextRoot) {
                        next.expression.right = replacement;
                    } else {
                        next.expression = replacement;
                    }
                } else {
                    (next as TYPE.ReturnStatement).argument = replacement;
                }
            } else if (!replaceNodeInTree(nextRoot, target, replacement)) {
                continue;
            }
            removeRefs(ref, ctx);
            removeRefs(neg.right, ctx);

            // 旧值在 next 之后已死,且 E 已经搬进 next,可以连同旧赋值一起删除。
            const removeSource = sourceStatement !== null
                && (nextWritesName || !ctx.liveAfter.get(next)?.has(name));
            stmts.splice(i, 1);
            if (removeSource) {
                stmts.splice(i - 1, 1);
                i--;
            }
            this.changed = true;
        }
    }
    /** X = E; (X = !X;)? if (!X / X / 含 X 的复合条件) -> if (E / !E / ...) */
    cleanupConditionAssignments(stmts: TYPE.Statement[], ctx: FunctionContext): void {
        // 自取反物化链可能位于任意嵌套块里,和下面的 if test 清理一起递归处理。
        if (this.conditionsOnly) this.foldNegatedSelfAssignments(stmts, ctx);
        for (let i = 0; i < stmts.length; i++) {
            const stmt = stmts[i];
            if (isIfStatement(stmt)) {
                const pattern = this.matchConditionPattern(stmts, i, ctx);
                if (pattern) {
                    const { start, expr, testIds } = pattern;
                    const oldTest = stmt.test;
                    // 只移除旧 test 里对 X 的那些读取;test 中其它标识符(E 替换后仍在)
                    // 的引用必须保留,否则后续声明清理会误删它们。
                    for (const testId of testIds) removeRefs(testId, ctx);
                    if (i - start > 1) {
                        // 删除整条 `X = !X` 取反链(可能有多条)里的引用
                        for (let j = start + 1; j < i; j++) {
                            const negation = stmts[j];
                            if (isExpressionStatement(negation) && isAssignmentExpression(negation.expression)) {
                                removeRefs(negation.expression.right, ctx);
                            }
                        }
                    }
                    let newTest: TYPE.Expression;
                    let replaced = true;
                    if (oldTest === testIds[0]) {
                        newTest = expr;
                    } else {
                        newTest = oldTest;
                        for (const testId of testIds) {
                            if (!replaceNodeInTree(newTest, testId, expr)) {
                                replaced = false;
                                break;
                            }
                        }
                    }
                    if (!replaced) {
                        this.cleanupConditionChildren(stmt, ctx);
                        continue;
                    }
                    stmt.test = newTest;
                    stmts.splice(start, i - start);
                    i = start - 1;
                    this.changed = true;
                    continue;
                }
            }
            this.cleanupConditionChildren(stmt, ctx);
        }
    }
    private cleanupConditionChildren(stmt: TYPE.Statement, ctx: FunctionContext): void {
        switch (stmt.type) {
            case "BlockStatement":
                this.cleanupConditionAssignments(stmt.body, ctx);
                break;
            case "IfStatement":
                // consequent 可能是非块的 if(Region 归约会生成 `if (A) if (B) ...`),
                // 同样需要下钻,否则整条分支里的条件物化都无法折叠。
                if (isBlockStatement(stmt.consequent)) this.cleanupConditionAssignments(stmt.consequent.body, ctx);
                else this.cleanupConditionChildren(stmt.consequent, ctx);
                if (stmt.alternate) {
                    if (isBlockStatement(stmt.alternate)) this.cleanupConditionAssignments(stmt.alternate.body, ctx);
                    else this.cleanupConditionChildren(stmt.alternate, ctx);
                }
                break;
            case "WhileStatement":
            case "DoWhileStatement":
            case "ForStatement":
            case "ForInStatement":
            case "ForOfStatement":
            case "LabeledStatement":
                if (isBlockStatement(stmt.body)) this.cleanupConditionAssignments(stmt.body.body, ctx);
                break;
            case "TryStatement":
                this.cleanupConditionAssignments(stmt.block.body, ctx);
                if (stmt.handler) this.cleanupConditionAssignments(stmt.handler.body.body, ctx);
                if (stmt.finalizer) this.cleanupConditionAssignments(stmt.finalizer.body, ctx);
                break;
            case "SwitchStatement":
                for (const c of stmt.cases) this.cleanupConditionAssignments(c.consequent, ctx);
                break;
            default:
                break;
        }
    }
    private matchConditionPattern(
        stmts: TYPE.Statement[],
        ifIndex: number,
        ctx: FunctionContext,
    ): { start: number; name: string; expr: TYPE.Expression; testIds: TYPE.Identifier[] } | null {
        const ifStmt = stmts[ifIndex];
        if (!isIfStatement(ifStmt)) return null;
        const test = ifStmt.test;
        let name: string;
        let testId: TYPE.Identifier | null = null;
        if (isIdentifier(test)) {
            name = test.name;
            testId = test;
        } else if (isUnaryExpression(test) && test.operator === "!"
            && isIdentifier(test.argument)) {
            name = test.argument.name;
            testId = test.argument;
        } else {
            // 复合 test(`!X && B` / `X || B`):变量名从前一条赋值获取。
            const prev = stmts[ifIndex - 1];
            if (!isExpressionStatement(prev) || !isAssignmentExpression(prev.expression)
                || prev.expression.operator !== "=" || !isIdentifier(prev.expression.left)) {
                return null;
            }
            name = prev.expression.left.name;
            if (hasDeferredSelfReference(test, name)) return null;
            if (countReadsInNode(test, name) === 0) return null;
        }
        if (!isTempName(name)) return null;
        const info = ctx.infos.get(name);
        if (!info || info.captured) return null;

        // 收集 test 里对 X 的全部读取。多得不只是因为复合条件:编译器会把
        // `A && (f(), A)` 这类"读取同一物化布尔"的条件 lowering 成
        // `acc = E; acc = !acc; if (!acc && (f(), acc))`,test 里有两次读取,
        // 折叠时每一处都要按同一奇偶值替换。
        const testIds: TYPE.Identifier[] = [];
        walkNode(test, (node, parent) => {
            if (isFunctionLike(node) || isClassLike(node)) return false;
            if (isIdentifier(node) && node.name === name && parent && isReferenced(node, parent)) {
                testIds.push(node);
            }
            return true;
        });
        if (testId && !testIds.includes(testId)) testIds.unshift(testId);
        if (testIds.length === 0) return null;

        let start = ifIndex - 1;
        let negations = 0;
        // 编译器把 if 条件里的取反 lowering 成 istrue + 分支 + ldtrue/ldfalse,
        // 反编译后会出现连续多条 `X = !X`(通常是 1~2 条)。按取反次数的奇偶性
        // 决定最终条件,避免把 `!T` 误当成 T 或只折叠一层。
        while (start >= 0) {
            const prev = stmts[start];
            if (!isExpressionStatement(prev) || !isAssignmentExpression(prev.expression)) break;
            const negation = prev.expression;
            if (negation.operator !== "="
                || !isIdentifier(negation.left) || negation.left.name !== name
                || !isUnaryExpression(negation.right) || negation.right.operator !== "!"
                || !isIdentifier(negation.right.argument) || negation.right.argument.name !== name) break;
            negations++;
            start--;
        }
        if (start < 0) return null;
        const assign = stmts[start];
        if (!isExpressionStatement(assign) || !isAssignmentExpression(assign.expression)) return null;
        const expression = assign.expression;
        if (expression.operator !== "=" || !isIdentifier(expression.left) || expression.left.name !== name) {
            return null;
        }
        if (isDeclarationValue(expression.right)) return null;
        // E 读取 X(`X = X.length; if (X > 0)`)是合法的:start..ifIndex 的赋值
        // 会被整体删除,test 里的替换值读到的正是删除前的旧 X,语义不变。

        // X 只能在当前模式里被读取,不能影响模式之后/之前的代码。
        // 但 acc 是字节码累加器,通常在整个函数里反复复用(模式之外还有大量读写),
        // 此时退一步:只要模式之后 X 已死、且 if 分支在写入 X 之前不读取 X,
        // 删除这几条赋值仍然安全。
        const patternRefs = new Set<TYPE.Node>();
        for (let j = start; j < ifIndex; j++) {
            walkNode(stmts[j], (node, parent) => {
                if (isIdentifier(node) && node.name === name && parent && isReferenced(node, parent)) {
                    patternRefs.add(node);
                }
            });
        }
        for (const ref of testIds) patternRefs.add(ref);
        for (const ref of patternRefs) if (!info.refs.has(ref)) return null;
        // 复制传播会克隆节点,ctx.infos 里的 referencePaths 可能已经过期,
        // 不能因为“引用数恰好等于模式内的引用数”就跳过下面的安全检查。
        const liveAfterIf = ctx.liveAfter.get(ifStmt);
        if (!liveAfterIf || liveAfterIf.has(name)) return null;
        // break/continue 可能跳过 if 之后的写入,继续读取 X(例如
        // `v4 = g(); if (v4.completed) break; ... v4 = h();` 循环外的 return v4)。
        // branchLive 已把 break/continue 目标处的活跃变量算进来。
        const branchLive = ctx.branchLive.get(ifStmt);
        if (branchLive && branchLive.has(name)) return null;
        if (branchReadsNameBeforeWrite(ifStmt.consequent, name)) return null;
        if (ifStmt.alternate && branchReadsNameBeforeWrite(ifStmt.alternate, name)) return null;

        // 取反链的奇偶性直接作用在赋给 X 的值上,test 里每处读取都替换成同一个值
        // (物化后所有读取看到的是同一个 acc 版本)。多次读取只在存在取反链时折叠:
        // 此时物化值被困在 test 里,不整体消费就消不掉 `X = !X`(典型
        // `acc = E; acc = !acc; if (!acc && (f(), acc))`)。negations = 0 的多次
        // 读取(`v2 = E; if (v2 && (..., !v2 ...))`)保持原样——替换会把 E 复制
        // 多遍,输出反而变差。E 有副作用时同样只允许单读取;且 test 序列里不得
        // 再赋值 X——`acc = trim(), acc = acc.length, acc === 0` 的两次读取是
        // 不同版本,不能都替换成模式右值。
        let expr = expression.right;
        if (negations % 2 === 1) expr = negateExpression(expr);
        if (testIds.length > 1) {
            if (negations === 0) return null;
            if (!isPureExpression(expression.right)) return null;
            if (collectAssignedNames(test).has(name)) return null;
        }
        // 求值时序:把赋值右值搬进 test 会把它的求值推迟到 test 中 X 的位置。
        // 有副作用的右值只有位于 test 最先求值的位置时才安全(如 test 就是 X/!X);
        // 纯右值也要避免越过 test 里先求值的写入(如 `X = Y; if ((Y = 1, X))`)。
        if (!isPureExpression(expr)) {
            if (testIds.length !== 1 || !isFirstEvaluatedOccurrence(test, testIds[0])) return null;
        } else {
            const assigned = collectAssignedNames(test);
            for (const dep of collectIdentifierNames(expr)) {
                if (dep !== name && assigned.has(dep)) return null;
            }
        }

        return { start, name, expr, testIds };
    }
}
