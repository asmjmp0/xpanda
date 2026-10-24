import { NodePath } from "@babel/traverse";
import * as TYPE from "@babel/types";
import {
    VISITOR_KEYS,
    isAssignmentExpression,
    isBinaryExpression,
    isBlockStatement,
    isBooleanLiteral,
    isBreakStatement,
    isCallExpression,
    isConditionalExpression,
    isContinueStatement,
    isDoWhileStatement,
    isEmptyStatement,
    isExpressionStatement,
    isFunctionExpression,
    isIfStatement,
    isIdentifier,
    isLogicalExpression,
    isMemberExpression,
    isNewExpression,
    isOptionalCallExpression,
    isOptionalMemberExpression,
    isParenthesizedExpression,
    isProgram as isProgramNode,
    isReferenced,
    isReturnStatement,
    isSequenceExpression,
    isStringLiteral,
    isSpreadElement,
    isTaggedTemplateExpression,
    isUnaryExpression,
    isUpdateExpression,
    isVariableDeclaration,
    unaryExpression,
} from "@babel/types";
import {
    collectAssignedNames,
    collectIdentifierNames,
    collectReadNames,
    isClassLike,
    isDeclarationValue,
    isFunctionLike,
    isNodeEqual,
    isPureExpression,
    walkNode,
} from "../AstUtils";
import { BindingInfo, FunctionContext, LoopLive } from "./types";

/**
 * 纯查询/AST 判定工具:不读写 pass 状态,也不修改 AST。
 *
 * 从 TempVariableSimplify 拆出后,各折叠模块直接导入这些函数,
 * 不再需要把 4000 行的方法全部挂在一个类上。
 *
 * @Author: jmp0
 */

/** 属性归一化键:非 computed 标识符与 computed 字符串字面量视为同一属性;动态键返回 null。 */
export function memberPropertyKey(property: TYPE.Expression, computed: boolean): string | null {
    if (!computed && isIdentifier(property)) return property.name;
    if (computed && isStringLiteral(property)) return String(property.value);
    return null;
}

/** expr 中是否存在读取 `object.<key>` 的成员装载;key 为 null(动态键)时按同基对象保守命中。 */
export function exprReadsMember(expr: TYPE.Node, object: TYPE.Expression, key: string | null): boolean {
    let found = false;
    walkNode(expr, (n) => {
        if (found) return false;
        if (isFunctionLike(n) || isClassLike(n)) return false;
        if (isMemberExpression(n) || isOptionalMemberExpression(n)) {
            const m = n as TYPE.MemberExpression;
            if (isNodeEqual(m.object as TYPE.Expression, object)) {
                const k = memberPropertyKey(m.property as TYPE.Expression, m.computed);
                // 任一方是动态键时无法证明属性不同,保守视为命中
                if (key === null || k === null || k === key) found = true;
            }
        }
        return !found;
    });
    return found;
}

/** 统计一条语句里对 name 的读取次数(不含嵌套函数,复合赋值左侧算读取)。 */
export function countReadsInNode(node: TYPE.Node | null | undefined, name: string): number {
    let count = 0;
    walkNode(node, (n, parent) => {
        if (isFunctionLike(n) || isClassLike(n)) return false;
        if (!isIdentifier(n) || n.name !== name) return true;
        if (!parent || isReferenced(n, parent)) count++;
        else if (isAssignmentExpression(parent) && parent.left === n && parent.operator !== "=") count++;
        return true;
    });
    return count;
}

export function containsNode(root: TYPE.Node | null | undefined, target: TYPE.Node): boolean {
    let found = false;
    walkNode(root, (n) => {
        if (n === target) { found = true; return false; }
        return true;
    });
    return found;
}

export function countIdentifiers(node: TYPE.Node, name: string): number {
    let count = 0;
    walkNode(node, (child) => {
        if (isIdentifier(child) && child.name === name) count++;
        return true;
    });
    return count;
}

/** 右值中是否存在位于函数/类内部、可能在赋值之后才执行的同名读取。 */
export function hasDeferredSelfReference(node: TYPE.Node | null | undefined, name: string): boolean {
    let found = false;
    const visit = (current: TYPE.Node | null | undefined, inDeferred: boolean): void => {
        if (found || !current || typeof (current as any).type !== "string") return;
        if (inDeferred && isIdentifier(current) && current.name === name) {
            found = true;
            return;
        }
        const nested = inDeferred || isFunctionLike(current) || isClassLike(current);
        const keys = (VISITOR_KEYS as any)[current.type] as string[] | undefined;
        if (!keys) return;
        for (const key of keys) {
            const value = (current as any)[key];
            if (Array.isArray(value)) {
                for (const child of value) visit(child, nested);
            } else {
                visit(value, nested);
            }
        }
    };
    visit(node, false);
    return found;
}

/**
 * target 是否是 root 中最先求值的子表达式。
 * 用于判断有副作用的右值能否搬进该位置(搬过去后仍先于其它操作求值)。
 */
export function isFirstEvaluatedOccurrence(root: TYPE.Node, target: TYPE.Node): boolean {
    let node: TYPE.Node = root;
    while (node !== target) {
        const next = firstEvaluatedChild(node);
        if (!next) return false;
        node = next;
    }
    return true;
}

export function firstEvaluatedChild(node: TYPE.Node): TYPE.Node | null {
    if (isBinaryExpression(node) || isLogicalExpression(node)) return node.left;
    if (isConditionalExpression(node)) return node.test;
    if (isSequenceExpression(node)) return node.expressions[0] ?? null;
    if (isUnaryExpression(node) || isUpdateExpression(node) || isSpreadElement(node)) return node.argument;
    if (isMemberExpression(node)) return node.object;
    if (isOptionalMemberExpression(node)) return node.object;
    if (isCallExpression(node) || isNewExpression(node) || isOptionalCallExpression(node)) return node.callee;
    if (isTaggedTemplateExpression(node)) return node.tag;
    if (isAssignmentExpression(node)) return node.left;
    return null;
}

/**
 * 把 value 的求值推迟到 target 中 id 的位置是否安全。
 * value 纯时只要求 target 里更早的写入不影响它的读取;有副作用时只允许
 * 推后到“先求值的部分无副作用”的位置(典型是调用表达式的参数,callee 为标识符)。
 */
export function canDeferTestValue(value: TYPE.Expression, target: TYPE.Expression, id: TYPE.Identifier): boolean {
    if (isPureExpression(value)) {
        const assigned = collectAssignedNames(target);
        for (const dep of collectIdentifierNames(value)) {
            if (assigned.has(dep)) return false;
        }
        return true;
    }
    if (isFirstEvaluatedOccurrence(target, id)) return true;
    if (isCallExpression(target) && !containsNode(target.callee, id)
        && isPureExpression(target.callee)) {
        const assigned = collectAssignedNames(value);
        for (const dep of collectIdentifierNames(target.callee)) {
            if (assigned.has(dep)) return false;
        }
        return true;
    }
    return false;
}

/**
 * target 是否是 root 中最后求值的子表达式(之后没有会读取变量的兄弟表达式)。
 * 用于判断序列里的死赋能否删除:只关心“赋值之后是否还有读取”,之前(短路左侧)
 * 的读取不受影响。
 */
export function isTailExpression(root: TYPE.Expression, target: TYPE.Expression): boolean {
    if (root === target) return true;
    if (isParenthesizedExpression(root)) return isTailExpression(root.expression as TYPE.Expression, target);
    if (isLogicalExpression(root)) {
        return containsNode(root.right, target) && isTailExpression(root.right as TYPE.Expression, target);
    }
    if (isSequenceExpression(root)) {
        const last = root.expressions[root.expressions.length - 1];
        return !!last && containsNode(last, target) && isTailExpression(last as TYPE.Expression, target);
    }
    if (isUnaryExpression(root)) {
        return containsNode(root.argument, target) && isTailExpression(root.argument as TYPE.Expression, target);
    }
    if (isBinaryExpression(root)) {
        return containsNode(root.right, target) && isTailExpression(root.right as TYPE.Expression, target);
    }
    if (isConditionalExpression(root)) {
        return containsNode(root.alternate, target) && isTailExpression(root.alternate as TYPE.Expression, target);
    }
    return false;
}

/** 序列前缀是否可能在写入 name 之前读取它(循环里会把上一轮的值带进来)。 */
export function headReadsNameBeforeWrite(exprs: TYPE.Expression[], end: number, name: string): boolean {
    let killed = false;
    for (let i = 0; i < end; i++) {
        const e = exprs[i];
        if (isAssignmentExpression(e) && e.operator === "="
            && isIdentifier(e.left) && e.left.name === name) {
            if (!killed && countReadsInNode(e.right, name) > 0) return true;
            killed = true;
            continue;
        }
        if (!killed && countReadsInNode(e, name) > 0) return true;
    }
    return false;
}

/** X 在该 test 之后(含分支体)是否已经不再被读取。 */
export function isNameDeadAfterTest(stmt: TYPE.Statement, name: string, ctx: FunctionContext): boolean {
    if (!isIfStatement(stmt)) return false;
    const liveAfter = ctx.liveAfter.get(stmt);
    if (!liveAfter || liveAfter.has(name)) return false;
    if (branchReadsNameBeforeWrite(stmt.consequent, name)) return false;
    if (branchReadsNameBeforeWrite(stmt.alternate, name)) return false;
    return true;
}

/** 构造 `!expr`,`!!E` 直接还原成 E。 */
export function negateExpression(expr: TYPE.Expression): TYPE.Expression {
    if (isUnaryExpression(expr) && expr.operator === "!") return expr.argument;
    return unaryExpression("!", expr);
}

export function isPureLVal(node: TYPE.LVal | TYPE.OptionalMemberExpression): boolean {
    if (isIdentifier(node)) return true;
    if (isMemberExpression(node) || isOptionalMemberExpression(node)) {
        return isPureExpression(node.object as TYPE.Node)
            && (!node.computed || isPureExpression(node.property as TYPE.Node));
    }
    return false;
}

export function isPureStatement(stmt: TYPE.Statement): boolean {
    if (isEmptyStatement(stmt)) return true;
    if (isExpressionStatement(stmt)) {
        const expr = stmt.expression;
        if (isAssignmentExpression(expr)) {
            return isIdentifier(expr.left) && isPureExpression(expr.right);
        }
        return isPureExpression(expr);
    }
    if (isVariableDeclaration(stmt)) {
        return stmt.declarations.every((d) => !d.init || isPureExpression(d.init));
    }
    if (isBlockStatement(stmt)) {
        return stmt.body.every((s) => isPureStatement(s));
    }
    return false;
}

export function isSafeToMoveBetween(list: TYPE.Statement[], from: number, to: number): boolean {
    for (let i = from; i < to && i < list.length; i++) {
        if (!isPureStatement(list[i])) return false;
    }
    return true;
}

/**
 * 当前语句是否是 `x = x + ...` 形式的自覆盖,且读取的正是本次读取的节点。
 * 只对二元运算放开:这类累加链的旧值在本条语句后失效,可以安全搬移前一条语句的结果。
 */
export function statementOverwritesSelf(stmt: TYPE.Statement | undefined, name: string, id: TYPE.Identifier): boolean {
    if (!stmt || !isExpressionStatement(stmt) || !isAssignmentExpression(stmt.expression)) return false;
    const assign = stmt.expression;
    if (assign.operator !== "=" || !isIdentifier(assign.left) || assign.left.name !== name) return false;
    if (!isBinaryExpression(assign.right)) return false;
    return assign.right.left === id || assign.right.right === id;
}

/**
 * 语句形如 `name = RHS`(plain =),且 RHS 里对 name 只有 id 这一次读取:
 * 旧值在本语句执行后立即被覆盖,因此这次读取就是旧值的最后一次使用。
 * 名字级活跃性分不清 acc 的新旧版本(后续读取读到的是新值),这里按值补判。例如:
 *   acc = p0.trim(); acc = acc.length;  ->  acc = p0.trim().length;
 */
export function statementOverwritesSelfAssign(stmt: TYPE.Statement | undefined, name: string, id: TYPE.Identifier): boolean {
    if (!stmt || !isExpressionStatement(stmt) || !isAssignmentExpression(stmt.expression)) return false;
    const assign = stmt.expression;
    if (assign.operator !== "=" || !isIdentifier(assign.left) || assign.left.name !== name) return false;
    return countReadsInNode(assign.right, name) === 1 && containsNode(assign.right, id);
}

/**
 * id 在当前语句里是否以“方法调用接收者”的身份被读取:语句形如 `X = ... X.m(args)`。
 * 当这次读取是靠“本语句覆盖 X”才成为旧值最后用法时,只允许把不可复制的右值
 * (如 `v0 = new RegExp(...)` 的 newExpr)搬进这种形态,搬移后等价于 newExpr.m(args);
 * 裸成员装载(`acc = acc.test`)是 AccCallSimplify 依赖的中间形态,必须保持原样。
 */
export function isCalleeReceiverRead(stmt: TYPE.Statement | null | undefined, id: TYPE.Identifier): boolean {
    if (!stmt || !isExpressionStatement(stmt) || !isAssignmentExpression(stmt.expression)) return false;
    let current: TYPE.Node = stmt.expression.right;
    while (isUnaryExpression(current) && current.prefix) current = current.argument;
    if (!isCallExpression(current)) return false;
    const callee = current.callee;
    return isMemberExpression(callee) && callee.object === id;
}

/**
 * 当前语句之后紧跟的是 `name.call(...)`(AccCallSimplify 要还原的方法装载形态)。
 * `name = name.prop` 这种裸成员装载不能提前改成别名读取,否则 AccCallSimplify
 * 匹配不到 `acc = acc.prop; acc.call(recv, ...)`。
 */
export function nextStatementIsAccMethodCall(list: TYPE.Statement[], index: number, name: string): boolean {
    const next = list[index + 1];
    if (!next) return false;
    let expr: TYPE.Node | null = null;
    if (isExpressionStatement(next)) {
        expr = next.expression;
        if (isAssignmentExpression(expr)) expr = expr.right;
    } else if (isReturnStatement(next) && next.argument) {
        expr = next.argument;
    }
    if (!expr) return false;
    while (isUnaryExpression(expr) && expr.prefix) expr = expr.argument;
    if (!isCallExpression(expr)) return false;
    const callee = expr.callee;
    return isMemberExpression(callee)
        && !callee.computed
        && isIdentifier(callee.object) && callee.object.name === name
        && isIdentifier(callee.property) && callee.property.name === "call";
}

/**
 * 分支体是否可能在写入 name 之前读取它。
 * 只按顺序看块内语句;遇到“所有路径都会先写 name”的语句(直接赋值,
 * 或 if/else 两个分支都先写)就认为后续读取都读到新值,可以提前结束。
 * 注意不能对复合语句(嵌套 if)做整子树的 collectReadNames 短路判断:
 * 子分支里 `X = true/false; if (X)` 这类“先写后读”会被误判成
 * “可能读旧值”,导致 test 序列里的死赋值无法清理。
 */
export function branchReadsNameBeforeWrite(stmt: TYPE.Statement | null | undefined, name: string): boolean {
    if (!stmt) return false;
    if (isBlockStatement(stmt)) {
        for (const s of stmt.body) {
            if (definitelyWritesBeforeRead(s, name)) return false;
            if (branchReadsNameBeforeWrite(s, name)) return true;
        }
        return false;
    }
    if (isIfStatement(stmt)) {
        if (collectReadNames(stmt.test).has(name)) return true;
        return branchReadsNameBeforeWrite(stmt.consequent, name)
            || branchReadsNameBeforeWrite(stmt.alternate, name);
    }
    // while 的 test 在每轮 body 之前求值;test 不读 name 时,循环本身不构成
    // “先读后写”,body 内部仍按语句顺序判断。否则嵌套循环里“先写后读”的
    // 读取(inline 的累加器链)会被当成整个分支的首次读取,挡住外层条件的
    // 累加器折叠(parseVttSubtitles 的 `acc = !!v11; if (!acc) {... else { while ... }}`)。
    if (TYPE.isWhileStatement(stmt)) {
        if (collectReadNames(stmt.test).has(name)) return true;
        return branchReadsNameBeforeWrite(stmt.body, name);
    }
    return collectReadNames(stmt).has(name);
}

/** 语句是否一定会在读取 name 之前写入 name(所有执行路径)。 */
export function definitelyWritesBeforeRead(stmt: TYPE.Statement | null | undefined, name: string): boolean {
    if (!stmt) return false;
    if (isBlockStatement(stmt)) {
        for (const s of stmt.body) {
            if (definitelyWritesBeforeRead(s, name)) return true;
            if (collectReadNames(s).has(name)) return false;
        }
        return false;
    }
    if (isIfStatement(stmt)) {
        if (collectReadNames(stmt.test).has(name)) return false;
        return stmt.alternate != null
            && definitelyWritesBeforeRead(stmt.consequent, name)
            && definitelyWritesBeforeRead(stmt.alternate, name);
    }
    // do-while 先执行 body 再求值 test:body 一定先写 name 时,test 读到的是新值
    if (isDoWhileStatement(stmt)) {
        return doWhileKillsTestReads(stmt, name);
    }
    if (isExpressionStatement(stmt) && isAssignmentExpression(stmt.expression)) {
        const assign = stmt.expression;
        return assign.operator === "=" && isIdentifier(assign.left) && assign.left.name === name
            && !collectReadNames(assign.right).has(name);
    }
    return false;
}

/**
 * do-while 的 test 在 body 之后执行。只有 body 是“所有路径都会先写 name 再读”
 * 且没有 continue(continue 会跳过后续写入直接进入 test)时,test 读取的才是新值。
 */
export function doWhileKillsTestReads(stmt: TYPE.DoWhileStatement, name: string): boolean {
    let hasContinue = false;
    walkNode(stmt.body, (node) => {
        if (isContinueStatement(node)) {
            hasContinue = true;
            return false;
        }
        return true;
    });
    return !hasContinue && definitelyWritesBeforeRead(stmt.body, name);
}

/**
 * 当前 id 是否是所在语句里对该名字的最后一次读取。
 * 绝大多数语句里保持原来的保守判断;只有 if 的 test 读取且两个分支都会先写后读时,
 * 才允许把非纯右值搬进 test(例如 `acc = f(); if (acc) { ... acc = x; use(acc) }`)。
 */
export function isLastReadInStatement(stmt: TYPE.Statement | null | undefined, id: TYPE.Identifier): boolean {
    if (!stmt || countReadsInNode(stmt, id.name) <= 1) return true;
    if (!isIfStatement(stmt) || !containsNode(stmt.test, id)) return false;
    if (countReadsInNode(stmt.test, id.name) > 1) return false;
    return !branchReadsNameBeforeWrite(stmt.consequent, id.name)
        && !branchReadsNameBeforeWrite(stmt.alternate, id.name);
}

/** 死赋值能否整体删除(右值无副作用且不是需要保留的函数/类表达式)。 */
export function isRemovableDeadTestAssignment(rhs: TYPE.Expression, name: string, info?: BindingInfo): boolean {
    if (!info || info.captured) return false;
    if (isIdentifier(rhs) && rhs.name === name) return true;
    return !isDeclarationValue(rhs) && isPureExpression(rhs);
}

/** 语句是否就是一条跳出当前循环的 break(允许单语句块包裹)。 */
export function isUnlabelledBreak(stmt: TYPE.Statement): boolean {
    if (isBreakStatement(stmt)) return !stmt.label;
    if (isBlockStatement(stmt) && stmt.body.length === 1) {
        const inner = stmt.body[0];
        return isBreakStatement(inner) && !inner.label;
    }
    return false;
}

/** 是否 HighLevelGrammarSimplify.checkAndTransformToForStatement 会消费的形态。 */
export function looksLikeForLoopLowering(stmts: TYPE.Statement[], index: number): boolean {
    const prev = stmts[index - 1];
    if (!isExpressionStatement(prev)) return false;
    const loop = stmts[index] as TYPE.WhileStatement;
    if (!isBooleanLiteral(loop.test) || !loop.test.value) return false;
    if (!isBlockStatement(loop.body)) return false;
    const body = loop.body.body;
    if (body.length < 2) return false;
    const first = body[0];
    if (!isIfStatement(first) || first.alternate) return false;
    if (!isBreakStatement(first.consequent)) return false;
    // 守卫 test 可能是已经取反的 `i >= n`,也可能是待 SyntaxRewriteSimplify 归一化的
    // `!(i < n)`;两者最终都会成为 checkAndTransformToForStatement 需要的二元比较。
    const test = first.test;
    const binaryLike = isBinaryExpression(test)
        || (isUnaryExpression(test) && test.operator === "!"
            && isBinaryExpression(test.argument));
    if (!binaryLike) return false;
    return isExpressionStatement(body[body.length - 1]);
}

export function hasHoistCandidate(stmts: TYPE.Statement[]): boolean {
    for (const stmt of stmts) {
        if (!isExpressionStatement(stmt) || !isAssignmentExpression(stmt.expression)) continue;
        const assign = stmt.expression;
        if (assign.operator !== "=" || !isIdentifier(assign.left)) continue;
        if (!/^local_\d+_\d+(_\d+)?$/.test(assign.left.name)) continue;
        if (isFunctionExpression(assign.right) && assign.right.id) return true;
    }
    return false;
}

/**
 * 变量是否被嵌套函数读写。
 * 读取记录在 binding.referencePaths,赋值/自增记录在 binding.constantViolations;
 * 只看读取会漏掉“闭包只写不读”的变量(如 `local_x = undefined` 初始化后仅由回调赋值),
 * 导致把外层初始化当成唯一值传播进闭包后的读取,并连带删掉声明。
 */
export function isCapturedBinding(binding: any, functionNode: TYPE.Node): boolean {
    const isProgram = isProgramNode(functionNode);
    const paths: NodePath[] = [
        ...(binding.referencePaths ?? []),
        ...(binding.constantViolations ?? []),
    ];
    for (const path of paths) {
        const functionParent = path.getFunctionParent();
        if (isProgram ? functionParent != null : (!functionParent || functionParent.node !== functionNode)) {
            return true;
        }
    }
    return false;
}

export function union(...sets: Set<string>[]): Set<string> {
    const result = new Set<string>();
    for (const set of sets) for (const name of set) result.add(name);
    return result;
}

export function sameSet(a: Set<string>, b: Set<string>): boolean {
    if (a.size !== b.size) return false;
    for (const name of a) if (!b.has(name)) return false;
    return true;
}

export function loopLive(breakLive: Set<string>, continueLive: Set<string>): LoopLive {
    return { breakLive, continueLive, inSwitch: false };
}
