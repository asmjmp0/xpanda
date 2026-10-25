import * as TYPE from "@babel/types";
import {
    cloneNode,
    isEmptyStatement,
    isAssignmentExpression,
    isBlockStatement,
    isBooleanLiteral,
    isExpressionStatement,
    isIdentifier,
    isIfStatement,
    isLogicalExpression,
    isMemberExpression,
    isOptionalMemberExpression,
    isParenthesizedExpression,
    isReferenced,
    isSequenceExpression,
    isUnaryExpression,
    logicalExpression,
    sequenceExpression,
    unaryExpression,
} from "@babel/types";
import {
    collectAssignedNames,
    collectIdentifierNames,
    isClassLike,
    isDeclarationValue,
    isFunctionLike,
    isNodeEqual,
    isPureExpression,
    isTempName,
    replaceNodeInTree,
    walkNode,
} from "../AstUtils";
import { TempVariablePass } from "./base";
import { FunctionContext } from "./types";
import {
    canDeferTestValue,
    countReadsInNode,
    hasDeferredSelfReference,
    headReadsNameBeforeWrite,
    isNameDeadAfterTest,
    isRemovableDeadTestAssignment,
    isTailExpression,
    isUnlabelledBreak,
    looksLikeForLoopLowering,
    union,
} from "./queries";
import { registerCloneRefs, removeRefs, tempReads, tempWrites } from "./context";

/**
 * test 位置与循环结构的折叠:
 *   - 短路链 `X = E; if (X) { X = B }` -> `X = E && B`
 *   - 自引用成员链 `X = X.prop; X = f(X)` -> `X = f(X.prop)`
 *   - if test 里的取反/死赋值序列
 *   - `while (true) { if (!COND) break; ... }` -> `while (COND)`
 *   - 循环 test 的 SequenceExpression 清理
 *
 * @Author: jmp0
 */
export class TestFolds extends TempVariablePass {

    /**
     * 逆变换编译器对 `A && B` / `A || B` 的“物化 + 跳转”lowering:
     *
     *   X = E; if (X)  { X = B; }  ->  X = E && B
     *   X = E; if (!X) { X = B; }  ->  X = E || B
     *
     * 结构化归约会把 if 的 test 重新生成成原表达式(X = E; if (E) {...}),
     * E 为纯表达式时同样处理(test 改读 X 再折叠,避免同一表达式求值两次)。
     * 连续的 `if (X) { X = B; }` 通过定点迭代逐轮合并成一条逻辑运算链,
     * 最后由 foldReturnAssignments 折进 return。
     *
     * 等价性:if (X) { X = B } 中 X 为真才求值 B、否则 X 保持原值,
     * 与 `X = E && B` 的短路语义完全一致(X 为假时整个表达式取 X 的旧值);
     * `!X` 对应 `E || B` 同理。条件:
     *   - X 是未被闭包捕获的临时变量,赋值语句与 if 紧邻(中间不能有其它语句);
     *   - if 没有 else,分支体只有一条 `X = B`;
     *   - B 不是函数/类表达式(保护 hoistNamedFunctionExpressions 的提升机会),
     *     且 B 里没有延迟读取 X 的闭包(B 求值期间 X 的新旧值时序在两种写法中不同)。
     */
    foldShortCircuitChains(stmts: TYPE.Statement[], ctx: FunctionContext): void {
        for (let i = 0; i < stmts.length; i++) {
            const folded = this.matchShortCircuitFold(stmts, i, ctx);
            if (folded) {
                const assignStmt = stmts[i] as TYPE.ExpressionStatement;
                (assignStmt.expression as TYPE.AssignmentExpression).right = folded.value;
                removeRefs(folded.removedTest, ctx);
                stmts.splice(i + 1, 1);
                this.changed = true;
                // 新赋值可能继续与后面的 if 成链,原地重试
                i--;
                continue;
            }
            if (this.foldNegatedTestSelfAssignment(stmts, i, ctx)) {
                // 链头已变成 `X = A && X`,原地重试让后续 `if (X) { X = B }` 继续成链
                i--;
                continue;
            }
            this.foldShortCircuitChildren(stmts[i], ctx);
        }
    }

    /**
     * 链头 `if (!A) { X = A }` -> `X = A && X`。
     *
     * 编译器会把 `X = A && B`(此时 X 已经保存 B)降级成"A 为假时把 A 写回结果变量,
     * 否则保持 B",即 `if (!A) { X = A }`;它后面通常紧跟 `if (X) { X = C }` 的短路链。
     * 不先折成赋值,链头没有 `X = E` 供 matchShortCircuitFold 匹配,整条链都会留在
     * if 形态(NgaQrLoginUtils 的登录参数校验: `hasLib && hasAct && hasKey && ...`
     * 被输出成一串 `if (v6) { v6 = ... }`)。
     *
     * 等价性:A 为假时原分支写入 A,`A && X` 也取 A;A 为真时原分支不动 X,
     * `A && X` 取 X 的旧值。要求 A 纯(原形态在 test 与分支里各求值一次,折叠后只
     * 求值一次)、X 是未被闭包捕获的临时变量,且下一句确实是读 X 的短路 if,
     * 避免把孤立的 if 改写成赋值。
     */
    private foldNegatedTestSelfAssignment(stmts: TYPE.Statement[], i: number, ctx: FunctionContext): boolean {
        if (i + 1 >= stmts.length) return false;
        const ifStmt = stmts[i];
        if (!isIfStatement(ifStmt) || ifStmt.alternate) return false;
        const test = ifStmt.test;
        if (!isUnaryExpression(test) || test.operator !== "!") return false;
        const value = test.argument;
        if (!isPureExpression(value) || isDeclarationValue(value)) return false;
        const consequent = ifStmt.consequent;
        const only = isBlockStatement(consequent)
            ? (consequent.body.length === 1 ? consequent.body[0] : null)
            : consequent;
        if (!only || !isExpressionStatement(only) || !isAssignmentExpression(only.expression)) return false;
        const assign = only.expression;
        if (assign.operator !== "=" || !isIdentifier(assign.left)) return false;
        const name = assign.left.name;
        if (!isTempName(name)) return false;
        const info = ctx.infos.get(name);
        if (!info || info.captured) return false;
        // 只处理 `X = A`(A 正是 test 取反的那个值);同时排除 `if (!X) { X = X }` 自赋值
        if (!isNodeEqual(assign.right, value)) return false;
        if (isIdentifier(value) && value.name === name) return false;
        // 下一句必须是读 X 的短路 if,否则保持原样
        const next = stmts[i + 1];
        if (!isIfStatement(next)) return false;
        const nextTest = isUnaryExpression(next.test) && next.test.operator === "!"
            ? next.test.argument
            : next.test;
        if (!isIdentifier(nextTest) || nextTest.name !== name) return false;

        stmts[i] = TYPE.expressionStatement(TYPE.assignmentExpression(
            "=",
            assign.left,
            logicalExpression("&&", value, TYPE.identifier(name)),
        ));
        // 先移除被删分支里的引用,再登记新语句(复用 A 的节点,顺序反了会把它当成已删除)
        removeRefs(only, ctx);
        registerCloneRefs(stmts[i], ctx);
        this.changed = true;
        return true;
    }
    private foldShortCircuitChildren(stmt: TYPE.Statement, ctx: FunctionContext): void {
        switch (stmt.type) {
            case "BlockStatement":
                this.foldShortCircuitChains(stmt.body, ctx);
                break;
            case "IfStatement":
                if (isBlockStatement(stmt.consequent)) this.foldShortCircuitChains(stmt.consequent.body, ctx);
                else this.foldShortCircuitChildren(stmt.consequent, ctx);
                if (stmt.alternate) {
                    if (isBlockStatement(stmt.alternate)) this.foldShortCircuitChains(stmt.alternate.body, ctx);
                    else this.foldShortCircuitChildren(stmt.alternate, ctx);
                }
                break;
            case "WhileStatement":
            case "DoWhileStatement":
            case "ForStatement":
            case "ForInStatement":
            case "ForOfStatement":
            case "LabeledStatement":
                if (isBlockStatement(stmt.body)) this.foldShortCircuitChains(stmt.body.body, ctx);
                else this.foldShortCircuitChildren(stmt.body, ctx);
                break;
            case "TryStatement":
                this.foldShortCircuitChains(stmt.block.body, ctx);
                if (stmt.handler) this.foldShortCircuitChains(stmt.handler.body.body, ctx);
                if (stmt.finalizer) this.foldShortCircuitChains(stmt.finalizer.body, ctx);
                break;
            case "SwitchStatement":
                for (const c of stmt.cases) this.foldShortCircuitChains(c.consequent, ctx);
                break;
            default:
                break;
        }
    }
    /**
     * 匹配 stmts[i] = `X = E` 且 stmts[i + 1] = 可折叠 if 的模式。
     * 返回合并后的右值以及需要从引用集合里移除的旧 test 节点。
     */
    private matchShortCircuitFold(
        stmts: TYPE.Statement[],
        i: number,
        ctx: FunctionContext,
    ): { value: TYPE.Expression; removedTest: TYPE.Expression } | null {
        if (i + 1 >= stmts.length) return null;
        const assignStmt = stmts[i];
        if (!isExpressionStatement(assignStmt) || !isAssignmentExpression(assignStmt.expression)) return null;
        const assign = assignStmt.expression;
        if (assign.operator !== "=" || !isIdentifier(assign.left)) return null;
        const name = assign.left.name;
        if (!isTempName(name)) return null;
        const info = ctx.infos.get(name);
        if (!info || info.captured) return null;
        // X = !X 是条件物化(isfalse / 布尔 if-else 合成)的自取反链片段,
        // 整条链的奇偶性归流水线尾部的 foldConditionAssignments 处理——
        // 那里能看到 HighLevelGrammarSimplify 合成后的完整链,把
        // `X = has(); X = !X; if (!X) { X = set(...) }` 折成 if (!has())。
        // 若在这里以自取反为链头抢先折叠成 `X = !X || set(...)`,
        // 会让尾部折叠失去链头,输出反而退化。函数/类表达式保持语句形态,
        // 留给 hoistNamedFunctionExpressions 提升。
        if (isUnaryExpression(assign.right) && assign.right.operator === "!"
            && isIdentifier(assign.right.argument) && assign.right.argument.name === name) return null;
        if (isDeclarationValue(assign.right)) return null;

        const ifStmt = stmts[i + 1];
        if (!isIfStatement(ifStmt)) return null;

        // 分支体必须是唯一一条 `X = B`;空 then + else 赋值是同一语义的取反形态
        // (`if (X) {} else X = B` ≡ `if (!X) { X = B }`),按 emptyThen 翻转极性。
        const branchStatements = (statement: TYPE.Statement | null | undefined): TYPE.Statement[] | null => {
            if (!statement || isEmptyStatement(statement)) return null;
            if (isBlockStatement(statement)) {
                return statement.body.length === 1 ? statement.body : null;
            }
            return [statement];
        };
        const isEmptyBranch = (statement: TYPE.Statement | null | undefined): boolean =>
            !statement || isEmptyStatement(statement)
            || (isBlockStatement(statement) && statement.body.length === 0);
        let body = branchStatements(ifStmt.consequent);
        let emptyThen = false;
        if (body !== null) {
            // then 是赋值语句时保持旧约定:不允许 else,否则会丢掉 else 分支
            if (ifStmt.alternate) return null;
        } else {
            // 只有 then 真正为空时才允许看 else;then 是多语句块时必须整体放弃
            if (!isEmptyBranch(ifStmt.consequent) || !ifStmt.alternate) return null;
            body = branchStatements(ifStmt.alternate);
            if (body === null) return null;
            emptyThen = true;
        }
        const only = body[0];
        if (!isExpressionStatement(only) || !isAssignmentExpression(only.expression)) return null;
        const inner = only.expression;
        if (inner.operator !== "=" || !isIdentifier(inner.left) || inner.left.name !== name) return null;
        if (isDeclarationValue(inner.right)) return null;
        if (hasDeferredSelfReference(inner.right, name)) return null;

        const test = ifStmt.test;
        // 有效极性:test 为 `!T` 时取反,空 then(`if (T) {} else X = B`)再取反一次。
        const testNegated = isUnaryExpression(test) && test.operator === "!";
        const effectiveNegated = testNegated !== emptyThen;
        const operator = effectiveNegated ? "||" : "&&";
        if (isIdentifier(test) && test.name === name) {
            return { value: logicalExpression(operator, assign.right, inner.right), removedTest: test };
        }
        if (testNegated && isIdentifier(test.argument) && test.argument.name === name) {
            return { value: logicalExpression(operator, assign.right, inner.right), removedTest: test };
        }
        // 跨变量布尔物化:`X = E; Y = E; if (X/!X) { Y = B }` -> `Y = E &&/|| B`。
        // 编译器会把短路条件的左值物化到两个临时变量(一个用于跳转、一个存最终结果),
        // 形如 `acc = A; v1 = A; if (acc) { v1 = B }`。E 为纯表达式时两次求值等价,
        // 可合并成 `Y = E && B`;跳转变量 X 在 if 之后必须已死(X = E 的死存储
        // 由下一轮死存储清除删除)。
        const crossVar = (holder: string, negated: boolean): { value: TYPE.Expression; removedTest: TYPE.Expression } | null => {
            if (i < 1) return null;
            const prevStmt = stmts[i - 1];
            if (!isExpressionStatement(prevStmt) || !isAssignmentExpression(prevStmt.expression)) return null;
            const holderAssign = prevStmt.expression;
            if (holderAssign.operator !== "="
                || !isIdentifier(holderAssign.left) || holderAssign.left.name !== holder
                || !isNodeEqual(holderAssign.right, assign.right) || !isPureExpression(assign.right)) return null;
            const liveAfterIf = ctx.liveAfter.get(ifStmt);
            if (liveAfterIf && liveAfterIf.has(holder)) return null;
            return {
                value: logicalExpression(negated ? "||" : "&&", assign.right, inner.right),
                removedTest: test,
            };
        };
        if (isIdentifier(test) && test.name !== name && isTempName(test.name)) {
            const folded = crossVar(test.name, effectiveNegated);
            if (folded) return folded;
        }
        if (testNegated
            && isIdentifier(test.argument) && test.argument.name !== name && isTempName(test.argument.name)) {
            const folded = crossVar(test.argument.name, effectiveNegated);
            if (folded) return folded;
        }
        // test 是结构化归约重新物化的同一表达式:X = E; if (E) { X = B } / if (!E) {...}
        // 只有 E 纯(重复求值无副作用)才能把两次求值合并成一次。
        const testValue = testNegated ? (test as TYPE.UnaryExpression).argument : test;
        if (testValue && isNodeEqual(testValue, assign.right) && isPureExpression(assign.right)) {
            return {
                value: logicalExpression(operator, assign.right, inner.right),
                removedTest: test,
            };
        }
        return null;
    }
    /**
     * `X = A; X = B`(两者各只读取一次 X、A 为纯表达式):
     *   X = X.length; X = p0.path.substring(X)  ->  X = p0.path.substring(X.length)
     *
     * A 的右值读取旧 X 并写回 X,复制传播为了安全不会缓存这类自引用表达式;
     * 但 A 的结果只可能被紧随其后的 B 消费一次,因此可以整体搬进 B 的读取位置。
     * 常用于 `v0 = v0.length; v0 = p0.path.substring(v0)` 这类先取长度再切片的链。
     */
    foldSelfReadChains(stmts: TYPE.Statement[], ctx: FunctionContext): void {
        for (let i = 0; i < stmts.length; i++) {
            if (i + 1 < stmts.length && this.tryFoldSelfReadChain(stmts, i, ctx)) {
                // 合并后的语句仍可能继续与下一条组成链,原地重试
                i--;
                continue;
            }
            // 最后一条语句同样要下钻,否则函数体/分支末尾的 if 里的链不会被处理
            this.foldSelfReadChainChildren(stmts[i], ctx);
        }
    }
    /** 尝试折叠 stmts[i] / stmts[i + 1],成功时修改列表并返回 true。 */
    private tryFoldSelfReadChain(stmts: TYPE.Statement[], i: number, ctx: FunctionContext): boolean {
        const first = stmts[i];
        const second = stmts[i + 1];
        if (!isExpressionStatement(first) || !isAssignmentExpression(first.expression)) return false;
        if (!isExpressionStatement(second) || !isAssignmentExpression(second.expression)) return false;
        const a = first.expression;
        const b = second.expression;
        if (a.operator !== "=" || b.operator !== "=") return false;
        if (!isIdentifier(a.left) || !isIdentifier(b.left)) return false;
        const name = a.left.name;
        if (b.left.name !== name || !isTempName(name)) return false;
        const info = ctx.infos.get(name);
        if (!info || info.captured) return false;
        // A 必须只读取一次旧 X 且无副作用;B 必须只消费一次新 X,
        // 并且在 B 内部没有再写入 X(避免 sequence 里混入 X = ...)。
        // 只处理成员装载(X = X.prop / X.length):其它自引用形态
        // (X = X + 1、X = !X)分别由 foldCompoundAssignments / 条件折叠负责。
        if (!isMemberExpression(a.right) && !isOptionalMemberExpression(a.right)) return false;
        if (countReadsInNode(a.right, name) !== 1) return false;
        if (countReadsInNode(b.right, name) !== 1) return false;
        if (!isPureExpression(a.right)) return false;
        const assignedInB = collectAssignedNames(b.right);
        if (assignedInB.has(name)) return false;
        // A 里依赖的名字不能在 B 中被重新赋值,否则搬进 B 后读到的是新值
        for (const dep of collectIdentifierNames(a.right)) {
            if (dep !== name && assignedInB.has(dep)) return false;
        }
        let id: TYPE.Identifier | null = null;
        walkNode(b.right, (node, parent) => {
            if (isFunctionLike(node) || isClassLike(node)) return false;
            if (isIdentifier(node) && node.name === name && parent && isReferenced(node, parent)) {
                id = node;
                return false;
            }
            return true;
        });
        if (!id) return false;
        const clone = cloneNode(a.right, true) as TYPE.Expression;
        if (!replaceNodeInTree(b.right, id, clone)) return false;
        info.refs.delete(id);
        removeRefs(a.right, ctx);
        registerCloneRefs(clone, ctx);
        stmts.splice(i, 1);
        this.changed = true;
        return true;
    }
    private foldSelfReadChainChildren(stmt: TYPE.Statement, ctx: FunctionContext): void {
        switch (stmt.type) {
            case "BlockStatement":
                this.foldSelfReadChains(stmt.body, ctx);
                break;
            case "IfStatement":
                if (isBlockStatement(stmt.consequent)) this.foldSelfReadChains(stmt.consequent.body, ctx);
                else this.foldSelfReadChainChildren(stmt.consequent, ctx);
                if (stmt.alternate) {
                    if (isBlockStatement(stmt.alternate)) this.foldSelfReadChains(stmt.alternate.body, ctx);
                    else this.foldSelfReadChainChildren(stmt.alternate, ctx);
                }
                break;
            case "WhileStatement":
            case "DoWhileStatement":
            case "ForStatement":
            case "ForInStatement":
            case "ForOfStatement":
            case "LabeledStatement":
                if (isBlockStatement(stmt.body)) this.foldSelfReadChains(stmt.body.body, ctx);
                else this.foldSelfReadChainChildren(stmt.body, ctx);
                break;
            case "TryStatement":
                this.foldSelfReadChains(stmt.block.body, ctx);
                if (stmt.handler) this.foldSelfReadChains(stmt.handler.body.body, ctx);
                if (stmt.finalizer) this.foldSelfReadChains(stmt.finalizer.body, ctx);
                break;
            case "SwitchStatement":
                for (const c of stmt.cases) this.foldSelfReadChains(c.consequent, ctx);
                break;
            default:
                break;
        }
    }
    /**
     * 折叠 boolean 上下文 test 序列里的自取反链:
     *   if (A || (X = E, X = !X, !X)) -> if (A || E)          // X 在 test 后已死
     *   if (X = E, E)                  -> if (E)              // X 在 test 后已死
     * 只处理 if(不处理循环 test,循环每次迭代都会重新求值),且要求 X 在 test 之后
     * 不再被读取、短路分支也不会先读后写,避免改变 X 的最终值。
     */
    foldTestSequences(stmts: TYPE.Statement[], ctx: FunctionContext): void {
        for (const stmt of stmts) this.foldTestSequencesInStatement(stmt, ctx);
    }
    private foldTestSequencesInStatement(stmt: TYPE.Statement, ctx: FunctionContext): void {
        switch (stmt.type) {
            case "IfStatement":
                stmt.test = this.foldBooleanExpr(stmt.test, stmt, ctx);
                this.foldTestSequencesInStatement(stmt.consequent, ctx);
                if (stmt.alternate) this.foldTestSequencesInStatement(stmt.alternate, ctx);
                return;
            case "BlockStatement":
                this.foldTestSequences(stmt.body, ctx);
                return;
            case "WhileStatement":
            case "DoWhileStatement":
            case "ForStatement":
                // 循环 test 每轮都会重新求值,不做跨语句的取反链折叠
                if (stmt.body) this.foldTestSequencesInStatement(stmt.body, ctx);
                return;
            case "TryStatement":
                this.foldTestSequences(stmt.block.body, ctx);
                if (stmt.handler) this.foldTestSequences(stmt.handler.body.body, ctx);
                if (stmt.finalizer) this.foldTestSequences(stmt.finalizer.body, ctx);
                return;
            case "SwitchStatement":
                for (const c of stmt.cases) this.foldTestSequences(c.consequent, ctx);
                return;
            case "LabeledStatement":
                this.foldTestSequencesInStatement(stmt.body, ctx);
                return;
            default:
                return;
        }
    }
    private foldBooleanExpr(expr: TYPE.Expression, stmt: TYPE.IfStatement, ctx: FunctionContext): TYPE.Expression {
        if (isLogicalExpression(expr)) {
            expr.left = this.foldBooleanExpr(expr.left, stmt, ctx);
            expr.right = this.foldBooleanExpr(expr.right, stmt, ctx);
            return expr;
        }
        if (isUnaryExpression(expr) && expr.operator === "!") {
            expr.argument = this.foldBooleanExpr(expr.argument as TYPE.Expression, stmt, ctx);
            return expr;
        }
        if (isSequenceExpression(expr)) {
            const folded = this.foldTestSequence(expr, stmt, ctx);
            if (folded) return folded;
            const last = expr.expressions.length - 1;
            if (last >= 0) expr.expressions[last] = this.foldBooleanExpr(expr.expressions[last] as TYPE.Expression, stmt, ctx);
            return expr;
        }
        return expr;
    }
    private foldTestSequence(
        seq: TYPE.SequenceExpression,
        stmt: TYPE.IfStatement,
        ctx: FunctionContext,
    ): TYPE.Expression | null {
        const exprs = seq.expressions;
        if (exprs.length < 2) return null;
        const last = exprs[exprs.length - 1];
        let name: string | null = null;
        let lastBang = false;
        if (isIdentifier(last)) {
            name = last.name;
        } else if (isUnaryExpression(last) && last.operator === "!"
            && isIdentifier(last.argument)) {
            name = last.argument.name;
            lastBang = true;
        }
        if (name !== null && isTempName(name)) {
            // (X = E, X = !X, ..., X/!X)
            let neg = 0;
            let j = exprs.length - 2;
            while (j >= 0) {
                const e = exprs[j];
                if (isAssignmentExpression(e) && e.operator === "="
                    && isIdentifier(e.left) && e.left.name === name
                    && isUnaryExpression(e.right) && e.right.operator === "!"
                    && isIdentifier(e.right.argument) && e.right.argument.name === name) {
                    neg++;
                    j--;
                    continue;
                }
                break;
            }
            const base = j >= 0 ? exprs[j] : null;
            if (base && isAssignmentExpression(base) && base.operator === "="
                && isIdentifier(base.left) && base.left.name === name
                && !headReadsNameBeforeWrite(exprs, j, name)
                && isNameDeadAfterTest(stmt, name, ctx)
                && isTailExpression(stmt.test, seq)) {
                const parity = (neg + (lastBang ? 1 : 0)) % 2;
                const replacement = parity === 0 ? base.right : unaryExpression("!", base.right);
                const kept = exprs.slice(0, j) as TYPE.Expression[];
                kept.push(replacement);
                return kept.length === 1 ? kept[0] : sequenceExpression(kept);
            }
        }
        // (X = E, <last>) 且 E 无副作用、last 不读取 X、X 在 test 后已死:直接丢掉 X = E
        const base = exprs[exprs.length - 2];
        if (isAssignmentExpression(base) && base.operator === "="
            && isIdentifier(base.left) && isTempName(base.left.name)
            && isPureExpression(base.right)
            && !headReadsNameBeforeWrite(exprs, exprs.length - 2, base.left.name)
            && countReadsInNode(last, base.left.name) === 0
            && isNameDeadAfterTest(stmt, base.left.name, ctx)
            && isTailExpression(stmt.test, seq)) {
            const kept = exprs.slice(0, exprs.length - 2) as TYPE.Expression[];
            kept.push(last);
            return kept.length === 1 ? kept[0] : sequenceExpression(kept);
        }
        return null;
    }
    /**
     * `while (true) { if (COND) break; BODY }` -> `while (!COND) { BODY }`。
     *
     * ArkTS 把 `while (COND)` 折成常量 test + 守卫(二分查找、下标遍历等都是这个
     * 形态)。守卫留在 body 里时,条件中的累加器物化既不在语句列表、也不是循环
     * test,cleanupStatements/foldTestSequences 都扫不到,只能原样留在输出里;
     * 提成 test 后同一轮的 foldLoopTestTemps 就能按求值顺序清理它,取反的
     * De Morgan / 比较反转由流水线末尾的 normalizeConditionTests 完成。
     *
     * 必须跳过 `init; while (true) { if (!cond) break; BODY; update }`:
     * HighLevelGrammarSimplify 还要把它还原成 for 循环(见 looksLikeForLoopLowering)。
     * 等价性:COND 仍在每轮 body 之前求值一次,continue 回到 test 时同样先求值
     * COND;要求守卫前只有表达式语句、break 不带 label(带 label 时不跳出本循环)。
     */
    foldWhileTrueBreakGuards(stmts: TYPE.Statement[], ctx: FunctionContext): void {
        for (let i = 0; i < stmts.length; i++) {
            const stmt = stmts[i];
            if (TYPE.isWhileStatement(stmt)) {
                if (!looksLikeForLoopLowering(stmts, i) && this.foldWhileTrueBreakGuard(stmt)) {
                    this.changed = true;
                }
                this.foldWhileTrueBreakGuardsInStatement(stmt.body, ctx);
                continue;
            }
            this.foldWhileTrueBreakGuardsInStatement(stmt, ctx);
        }
    }
    private foldWhileTrueBreakGuardsInStatement(stmt: TYPE.Statement, ctx: FunctionContext): void {
        switch (stmt.type) {
            case "BlockStatement":
                this.foldWhileTrueBreakGuards(stmt.body, ctx);
                return;
            case "IfStatement":
                this.foldWhileTrueBreakGuardsInStatement(stmt.consequent, ctx);
                if (stmt.alternate) this.foldWhileTrueBreakGuardsInStatement(stmt.alternate, ctx);
                return;
            case "DoWhileStatement":
            case "ForStatement":
            case "ForInStatement":
            case "ForOfStatement":
            case "LabeledStatement":
                this.foldWhileTrueBreakGuardsInStatement(stmt.body, ctx);
                return;
            case "TryStatement":
                this.foldWhileTrueBreakGuards(stmt.block.body, ctx);
                if (stmt.handler) this.foldWhileTrueBreakGuards(stmt.handler.body.body, ctx);
                if (stmt.finalizer) this.foldWhileTrueBreakGuards(stmt.finalizer.body, ctx);
                return;
            case "SwitchStatement":
                for (const c of stmt.cases) this.foldWhileTrueBreakGuards(c.consequent, ctx);
                return;
            default:
                return;
        }
    }
    /** 取出守卫并折叠。守卫前连续的表达式语句(如 `acc = !(i < len)` 死保存)
     *  一起搬进 test:它们原本就在每轮 body 最前面求值,进 test 后求值时机不变,
     *  foldLoopTestTemps 才能按 test 的求值顺序判断是否死保存。 */
    private foldWhileTrueBreakGuard(loop: TYPE.WhileStatement): boolean {
        if (!isBooleanLiteral(loop.test) || !loop.test.value) return false;
        if (!isBlockStatement(loop.body)) return false;
        const body = loop.body.body;
        let guardIndex = -1;
        for (let i = 0; i < body.length; i++) {
            const statement = body[i];
            if (isExpressionStatement(statement)) {
                // for-of / for-in 的 lowering 以 `vv = it.next()`(或 `.value`)开头,
                // 这些循环要留给 HighLevelGrammarSimplify / simplifyTail 还原;
                // 含调用的前缀同样不能搬进 test(否则 for-of 再也认不出来)。
                if (!isPureExpression(statement.expression)) return false;
                continue;
            }
            if (isIfStatement(statement) && !statement.alternate
                && isUnlabelledBreak(statement.consequent)) {
                guardIndex = i;
            }
            break;
        }
        if (guardIndex < 0) return false;
        const guard = body[guardIndex] as TYPE.IfStatement;
        const prefix = body.slice(0, guardIndex)
            .map((statement) => (statement as TYPE.ExpressionStatement).expression);
        const condition = prefix.length === 0
            ? guard.test
            : sequenceExpression([...prefix, guard.test] as TYPE.Expression[]);
        loop.test = unaryExpression("!", condition);
        body.splice(0, guardIndex + 1);
        return true;
    }
    /**
     * 循环 test 里的临时变量清理。
     *
     * 结构化归约会把循环条件生成为一整个 SequenceExpression,例如:
     *   do { ... } while ((acc = JSON.stringify(v), acc = decode(acc), v = acc,
     *                      acc = !(acc !== undefined), v8 = false, v === undefined) || ...)
     * 其中 `acc = !(...)`、寄存器恢复(`v8 = false`)都是死保存,`acc = f(v); v = acc`
     * 也能合并。它们不在任何语句列表里,cleanupStatements/cleanupSequenceExpressions
     * 都扫不到,所以在这里按 test 自己的求值顺序做一轮活跃性分析。
     *
     * 循环 test 每轮重新求值,因此“test 之后”的活跃集是 body 入口(bodyIn)∪ 循环之后
     * (liveAfter),不能只用一个;缺失 bodyIn 时保守放弃。
     */
    foldLoopTestTemps(stmts: TYPE.Statement[], ctx: FunctionContext): void {
        for (const stmt of stmts) this.foldLoopTestTempsInStatement(stmt, ctx);
    }
    private foldLoopTestTempsInStatement(stmt: TYPE.Statement, ctx: FunctionContext): void {
        switch (stmt.type) {
            case "WhileStatement":
            case "DoWhileStatement":
            case "ForStatement": {
                const loop = stmt as TYPE.WhileStatement | TYPE.DoWhileStatement | TYPE.ForStatement;
                if (loop.test) {
                    const bodyIn = ctx.loopBodyIn.get(stmt);
                    if (bodyIn) {
                        const liveOut = new Set<string>(ctx.liveAfter.get(stmt) || []);
                        for (const name of bodyIn) liveOut.add(name);
                        const next = this.simplifyTestExpression(loop.test, liveOut, ctx);
                        if (next !== loop.test) {
                            loop.test = next;
                            this.changed = true;
                        }
                    }
                }
                this.foldLoopTestTempsInStatement(loop.body, ctx);
                return;
            }
            case "BlockStatement":
                this.foldLoopTestTemps(stmt.body, ctx);
                return;
            case "IfStatement":
                this.foldLoopTestTempsInStatement(stmt.consequent, ctx);
                if (stmt.alternate) this.foldLoopTestTempsInStatement(stmt.alternate, ctx);
                return;
            case "ForInStatement":
            case "ForOfStatement":
            case "LabeledStatement":
                this.foldLoopTestTempsInStatement(stmt.body, ctx);
                return;
            case "TryStatement":
                this.foldLoopTestTemps(stmt.block.body, ctx);
                if (stmt.handler) this.foldLoopTestTemps(stmt.handler.body.body, ctx);
                if (stmt.finalizer) this.foldLoopTestTemps(stmt.finalizer.body, ctx);
                return;
            case "SwitchStatement":
                for (const c of stmt.cases) this.foldLoopTestTemps(c.consequent, ctx);
                return;
            default:
                return;
        }
    }
    /** 按表达式求值顺序清理 test;返回替换后的表达式(sequence 只剩一个元素时会解开)。 */
    private simplifyTestExpression(
        expr: TYPE.Expression,
        liveOut: Set<string>,
        ctx: FunctionContext,
    ): TYPE.Expression {
        if (isSequenceExpression(expr)) {
            this.simplifyTestSequence(expr, liveOut, ctx);
            return expr.expressions.length === 1
                ? expr.expressions[0] as TYPE.Expression
                : expr;
        }
        if (isLogicalExpression(expr)) {
            expr.right = this.simplifyTestExpression(expr.right as TYPE.Expression, liveOut, ctx);
            const rightIn = this.testLiveIn(expr.right as TYPE.Expression, liveOut, ctx);
            expr.left = this.simplifyTestExpression(
                expr.left as TYPE.Expression, union(liveOut, rightIn), ctx);
            return expr;
        }
        if (isUnaryExpression(expr) && expr.operator === "!") {
            expr.argument = this.simplifyTestExpression(expr.argument as TYPE.Expression, liveOut, ctx);
            return expr;
        }
        if (isParenthesizedExpression(expr)) {
            (expr as any).expression = this.simplifyTestExpression(
                (expr as any).expression as TYPE.Expression, liveOut, ctx);
            return expr;
        }
        return expr;
    }
    /**
     * test 表达式之前的活跃集(纯分析,不改 AST)。
     * 与 simplifyTestExpression 保持同一套规则:死赋值若会被整体删除,右值读取不再发生。
     */
    private testLiveIn(expr: TYPE.Expression, liveOut: Set<string>, ctx: FunctionContext): Set<string> {
        if (isSequenceExpression(expr)) {
            let live = liveOut;
            for (let i = expr.expressions.length - 1; i >= 0; i--) {
                live = this.testLiveIn(expr.expressions[i] as TYPE.Expression, live, ctx);
            }
            return live;
        }
        if (isLogicalExpression(expr)) {
            const rightIn = this.testLiveIn(expr.right as TYPE.Expression, liveOut, ctx);
            return this.testLiveIn(
                expr.left as TYPE.Expression, union(liveOut, rightIn), ctx);
        }
        if (isUnaryExpression(expr) && expr.operator === "!") {
            return this.testLiveIn(expr.argument as TYPE.Expression, liveOut, ctx);
        }
        if (isParenthesizedExpression(expr)) {
            return this.testLiveIn((expr as any).expression as TYPE.Expression, liveOut, ctx);
        }
        if (isAssignmentExpression(expr) && expr.operator === "=" && isIdentifier(expr.left)
            && isTempName(expr.left.name)) {
            const name = expr.left.name;
            if (liveOut.has(name)) {
                const result = tempReads(expr.right, ctx);
                for (const existing of liveOut) if (existing !== name) result.add(existing);
                return result;
            }
            const info = ctx.infos.get(name);
            if (isRemovableDeadTestAssignment(expr.right, name, info)) return new Set(liveOut);
            const result = tempReads(expr.right, ctx);
            for (const existing of liveOut) result.add(existing);
            return result;
        }
        const result = tempReads(expr, ctx);
        const writes = tempWrites(expr, ctx);
        for (const existing of liveOut) if (!writes.has(existing)) result.add(existing);
        return result;
    }
    /** 删除 test 序列里的死赋值;返回替代表达式、null(删除)或原节点(保持)。 */
    private cleanupDeadTestAssignment(
        expr: TYPE.Expression,
        live: Set<string>,
        ctx: FunctionContext,
    ): TYPE.Expression | null {
        if (!isAssignmentExpression(expr) || expr.operator !== "=" || !isIdentifier(expr.left)) return expr;
        const name = expr.left.name;
        if (!isTempName(name) || live.has(name)) return expr;
        const info = ctx.infos.get(name);
        if (!info || info.captured) return expr;
        const rhs = expr.right;
        if (isIdentifier(rhs) && rhs.name === name) {
            removeRefs(rhs, ctx);
            this.changed = true;
            return null;
        }
        if (isDeclarationValue(rhs)) return rhs;
        if (isPureExpression(rhs)) {
            removeRefs(rhs, ctx);
            this.changed = true;
            return null;
        }
        // 有副作用:保留表达式本身(不保留对 name 的写入)
        this.changed = true;
        return rhs;
    }
    /** 清理一个循环 test 里的 SequenceExpression,并把它折叠成更短的形式。 */
    private simplifyTestSequence(seq: TYPE.SequenceExpression, liveOut: Set<string>, ctx: FunctionContext): void {
        if (seq.expressions.length === 0) return;
        // 1. 从右往左删除死赋值,使用“本元素之后仍活跃”的集合。
        let live = new Set(liveOut);
        for (let i = seq.expressions.length - 1; i >= 0; i--) {
            const expr = seq.expressions[i] as TYPE.Expression;
            const replaced = this.cleanupDeadTestAssignment(expr, live, ctx);
            if (replaced === expr) {
                live = this.testLiveIn(expr, live, ctx);
            } else if (replaced === null) {
                seq.expressions.splice(i, 1);
            } else {
                seq.expressions[i] = replaced;
                live = this.testLiveIn(replaced, live, ctx);
            }
        }
        // 2. 折叠 `X = E; X = F(X)` / `X = E; Y = X`。每折一次重新算一遍
        //    “本元素之后活跃”的集合,下标才对得上。
        let guard = 0;
        while (guard++ < 64) {
            const after = this.testLiveAfter(seq.expressions as TYPE.Expression[], liveOut, ctx);
            let folded = false;
            for (let i = 0; i + 1 < seq.expressions.length; i++) {
                const elements = seq.expressions as TYPE.Expression[];
                if (this.tryFoldTestAccumulator(elements, i, ctx)
                    || this.tryFoldTestAlias(elements, i, after[i + 1], ctx)) {
                    seq.expressions.splice(i, 1);
                    this.changed = true;
                    folded = true;
                    break;
                }
            }
            if (!folded) break;
        }
    }
    private testLiveAfter(
        elements: TYPE.Expression[],
        liveOut: Set<string>,
        ctx: FunctionContext,
    ): Set<string>[] {
        const after: Set<string>[] = new Array(elements.length);
        let live = new Set(liveOut);
        for (let i = elements.length - 1; i >= 0; i--) {
            after[i] = new Set(live);
            live = this.testLiveIn(elements[i], live, ctx);
        }
        return after;
    }
    /** `X = E; X = F(X)` -> `X = F(E)`,要求 X 在 F 中只读一次。 */
    private tryFoldTestAccumulator(elements: TYPE.Expression[], i: number, ctx: FunctionContext): boolean {
        const a = elements[i];
        const b = elements[i + 1];
        if (!isAssignmentExpression(a) || !isAssignmentExpression(b)) return false;
        if (a.operator !== "=" || b.operator !== "=") return false;
        if (!isIdentifier(a.left) || !isIdentifier(b.left)) return false;
        const name = a.left.name;
        if (b.left.name !== name || !isTempName(name)) return false;
        const info = ctx.infos.get(name);
        if (!info || info.captured) return false;
        if (countReadsInNode(b.right, name) !== 1) return false;
        if (collectAssignedNames(b.right).has(name)) return false;
        if (hasDeferredSelfReference(a.right, name) || hasDeferredSelfReference(b.right, name)) return false;

        let id: TYPE.Identifier | null = null;
        walkNode(b.right, (node, parent) => {
            if (isFunctionLike(node) || isClassLike(node)) return false;
            if (isIdentifier(node) && node.name === name && parent && isReferenced(node, parent)) {
                id = node;
                return false;
            }
            return true;
        });
        if (!id) return false;
        const value = a.right;
        if (!canDeferTestValue(value, b.right, id)) return false;
        // b 里对 value 依赖名字的写入会改变 value 的读取结果
        const assigned = collectAssignedNames(b.right);
        for (const dep of collectIdentifierNames(value)) {
            if (dep !== name && assigned.has(dep)) return false;
        }
        if (!replaceNodeInTree(b.right, id, value)) return false;
        info.refs.delete(id);
        return true;
    }
    /** `X = E; Y = X` -> `Y = E`(X 在第二条之后已死)。 */
    private tryFoldTestAlias(
        elements: TYPE.Expression[],
        i: number,
        liveAfterSecond: Set<string>,
        ctx: FunctionContext,
    ): boolean {
        const a = elements[i];
        const b = elements[i + 1];
        if (!isAssignmentExpression(a) || !isAssignmentExpression(b)) return false;
        if (a.operator !== "=" || b.operator !== "=") return false;
        if (!isIdentifier(a.left) || !isIdentifier(b.left)) return false;
        const name = a.left.name;
        if (!isTempName(name) || !isIdentifier(b.right) || b.right.name !== name) return false;
        const info = ctx.infos.get(name);
        if (!info || info.captured) return false;
        // 旧值在第二条赋值之后已死,删除第一条不会改变后续读取
        if (liveAfterSecond.has(name)) return false;
        if (hasDeferredSelfReference(a.right, name)) return false;
        info.refs.delete(b.right);
        b.right = a.right;
        return true;
    }
    /** 清理 SequenceExpression 中的死赋值,例如 if 条件里的 (v0 = x, v1 = y, ...)。 */
    cleanupSequenceExpressions(stmts: TYPE.Statement[], ctx: FunctionContext): void {
        for (const stmt of stmts) {
            // 整条语句的读取集合只算一次,避免多个 SequenceExpression 造成重复扫描
            const stmtLive = new Set<string>(ctx.liveAfter.get(stmt) || []);
            for (const name of tempReads(stmt, ctx)) stmtLive.add(name);
            walkNode(stmt, (node) => {
                if (isFunctionLike(node) || isClassLike(node)) return false;
                if (!isSequenceExpression(node)) return true;

                const live = new Set(stmtLive);

                const kept: TYPE.Expression[] = [];
                for (let i = node.expressions.length - 1; i >= 0; i--) {
                    const expr = node.expressions[i];
                    const reads = tempReads(expr, ctx);
                    if (isAssignmentExpression(expr) && expr.operator === "="
                        && isIdentifier(expr.left) && isTempName(expr.left.name)) {
                        const name = expr.left.name;
                        const info = ctx.infos.get(name);
                        if (info && !info.captured && !live.has(name) && !reads.has(name)) {
                            const rhs = expr.right;
                            if (ctx.moved.has(rhs)) {
                                // 中间副本直接删除;只有最终落点也是死代码时,有副作用的部分才需保留
                                const isFinalDestination = ctx.moved.get(rhs) === stmt;
                                if (isFinalDestination && !isPureExpression(rhs) && !isDeclarationValue(rhs)) {
                                    kept.unshift(rhs);
                                    for (const read of reads) live.add(read);
                                }
                            } else if (isDeclarationValue(rhs)) {
                                kept.unshift(rhs);
                                for (const read of reads) live.add(read);
                            } else if (isPureExpression(rhs)) {
                                removeRefs(rhs, ctx);
                            } else {
                                kept.unshift(rhs);
                                for (const read of reads) live.add(read);
                            }
                            this.changed = true;
                            continue;
                        }
                        live.delete(name);
                        for (const read of reads) live.add(read);
                        kept.unshift(expr);
                    } else {
                        for (const read of reads) live.add(read);
                        kept.unshift(expr);
                    }
                }
                if (kept.length !== node.expressions.length) node.expressions = kept;
                return true;
            });
        }
    }
}
