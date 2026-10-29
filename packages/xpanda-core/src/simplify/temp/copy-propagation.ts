import * as TYPE from "@babel/types";
import {
    VISITOR_KEYS,
    cloneNode,
    isArrayPattern,
    isAssignmentExpression,
    isAssignmentPattern,
    isBlockStatement,
    isClassDeclaration,
    isClassExpression,
    isExpression,
    isExpressionStatement,
    isIdentifier,
    isIfStatement,
    isMemberExpression,
    isNewExpression,
    isObjectPattern,
    isObjectProperty,
    isOptionalMemberExpression,
    isRestElement,
    isSpreadElement,
    isVariableDeclaration,
    identifier as identifierBuilder,
} from "@babel/types";
import {
    collectAssignedNames,
    collectIdentifierNames,
    collectMemberWriteTargets,
    MemberWriteTarget,
    isClassLike,
    isCopyable,
    isDeclarationValue,
    isFunctionLike,
    isNodeEqual,
    isPureExpression,
    isTempName,
    nodeSize,
    walkNode,
} from "../AstUtils";
import { TempVariablePass } from "./base";
import { EnvState } from "./env";
import { FunctionContext, MAX_PROPAGATED_SIZE } from "./types";
import {
    containsNode,
    definitelyWritesBeforeRead,
    isCalleeReceiverRead,
    isLastReadInStatement,
    isPureLVal,
    isSafeToMoveBetween,
    nextStatementIsAccMethodCall,
    statementOverwritesSelf,
    statementOverwritesSelfAssign,
} from "./queries";
import { registerCloneRefs } from "./context";

/**
 * 函数内线性复制传播:维护 temp -> 表达式环境,按作用域/控制流失效,
 * 在最后一次读取处克隆或搬移表达式。
 *
 * @Author: jmp0
 */
export class CopyPropagation extends TempVariablePass {

    processStatements(stmts: TYPE.Statement[], env: EnvState, ctx: FunctionContext): void {
        for (let i = 0; i < stmts.length; i++) {
            this.processStatement(stmts[i], env, stmts, i, ctx);
        }
    }
    /** 收集区域的写入(标识符名 + 成员目标);必须在处理该区域之前调用,处理会改写 AST。 */
    private collectRegionWrites(
        nodes: Array<TYPE.Node | null | undefined>,
    ): { names: Set<string>; members: MemberWriteTarget[] } {
        const names = new Set<string>();
        const members: MemberWriteTarget[] = [];
        for (const node of nodes) {
            if (!node) continue;
            collectAssignedNames(node, names);
            collectMemberWriteTargets(node, members);
        }
        return { names, members };
    }
    /**
     * catch 里 `X = Y` 的 Y。try 写过 Y 时,这次拷贝看到的是异常发生时的 Y,
     * 不能换成 try 之前的值。
     */
    private identifierCopySources(node: TYPE.Node): Set<string> {
        const names = new Set<string>();
        walkNode(node, (current) => {
            if (current !== node && isFunctionLike(current)) return false;
            if (isAssignmentExpression(current) && current.operator === "="
                && isIdentifier(current.left) && isIdentifier(current.right)) {
                names.add(current.right.name);
            }
            return true;
        });
        return names;
    }
    /** 处理完区域后调用:区域内的写入使外层 env 的缓存失效。 */
    private invalidateRegionWrites(
        writes: { names: Set<string>; members: MemberWriteTarget[] },
        env: EnvState,
    ): void {
        for (const name of writes.names) env.invalidate(name);
        for (const target of writes.members) {
            env.invalidateMemberReads(target.object, target.property, target.computed);
        }
    }
    /** 单个赋值/更新目标引发的失效:成员左值按“同对象.同属性”精确失效,其余按名字失效。 */
    private invalidateAssignTarget(
        target: TYPE.LVal | TYPE.OptionalMemberExpression,
        env: EnvState,
    ): void {
        if (isMemberExpression(target) || isOptionalMemberExpression(target)) {
            const m = target as TYPE.MemberExpression;
            env.invalidateMemberReads(m.object as TYPE.Expression, m.property as TYPE.Expression, m.computed);
            return;
        }
        if (isIdentifier(target)) {
            env.invalidate(target.name);
            return;
        }
        for (const name of collectAssignedNames(target)) env.invalidate(name);
    }
    private processStatement(
        stmt: TYPE.Statement,
        env: EnvState,
        list: TYPE.Statement[],
        index: number,
        ctx: FunctionContext,
    ): void {
        switch (stmt.type) {
            case "ExpressionStatement":
                stmt.expression = this.processExpression(stmt.expression, env, list, index, ctx);
                return;
            case "VariableDeclaration":
                this.processVariableDeclaration(stmt, env, list, index, ctx);
                return;
            case "IfStatement": {
                stmt.test = this.rewriteExpr(stmt.test, env, list, index, ctx, true);
                const writes = this.collectRegionWrites([stmt.consequent, stmt.alternate]);
                this.processNestedStatement(stmt.consequent, env.copy(), ctx);
                if (stmt.alternate) this.processNestedStatement(stmt.alternate, env.copy(), ctx);
                this.invalidateRegionWrites(writes, env);
                return;
            }
            case "WhileStatement": {
                const writes = this.collectRegionWrites([stmt.test, stmt.body]);
                this.invalidateRegionWrites(writes, env);
                stmt.test = this.rewriteExpr(stmt.test, env, list, index, ctx, false);
                this.processNestedStatement(stmt.body, env.copy(), ctx);
                this.invalidateRegionWrites(writes, env);
                return;
            }
            case "DoWhileStatement": {
                const writes = this.collectRegionWrites([stmt.body, stmt.test]);
                this.invalidateRegionWrites(writes, env);
                this.processNestedStatement(stmt.body, env.copy(), ctx);
                stmt.test = this.rewriteExpr(stmt.test, env, list, index, ctx, false);
                this.invalidateRegionWrites(writes, env);
                return;
            }
            case "ForStatement": {
                const writes = this.collectRegionWrites([stmt.init, stmt.test, stmt.update, stmt.body]);
                this.invalidateRegionWrites(writes, env);
                if (stmt.init) {
                    if (isVariableDeclaration(stmt.init)) {
                        this.processVariableDeclaration(stmt.init, env, list, index, ctx);
                    } else {
                        stmt.init = this.processExpression(stmt.init, env, list, index, ctx);
                    }
                }
                // test/update/body 在第二次及之后的迭代里读到的是上一轮写入的值,
                // 不能沿用 init 刚建立的常量(否则 `for (v = 0; v < n; v = v + 1)`
                // 会被传播成 `0 < n` / `v = 0 + 1`)。只清掉循环内会被改写的名字。
                this.invalidateRegionWrites(
                    this.collectRegionWrites([stmt.test, stmt.update, stmt.body]), env);
                stmt.test = this.rewriteExpr(stmt.test, env, list, index, ctx, false);
                if (stmt.update) stmt.update = this.processExpression(stmt.update, env.copy(), list, index, ctx, false);
                this.processNestedStatement(stmt.body, env.copy(), ctx);
                this.invalidateRegionWrites(writes, env);
                return;
            }
            case "ForInStatement":
            case "ForOfStatement": {
                const writes = this.collectRegionWrites([stmt.left, stmt.body]);
                this.invalidateRegionWrites(writes, env);
                (stmt as TYPE.ForInStatement).right = this.rewriteExpr(
                    (stmt as TYPE.ForInStatement).right, env, list, index, ctx, true);
                this.processNestedStatement(stmt.body, env.copy(), ctx);
                this.invalidateRegionWrites(writes, env);
                return;
            }
            case "BlockStatement":
                this.processStatements(stmt.body, env, ctx);
                return;
            case "LabeledStatement":
                this.processNestedStatement(stmt.body, env, ctx);
                return;
            case "TryStatement": {
                const tryBodyWrites = this.collectRegionWrites([stmt.block]);
                const tryWrites = this.collectRegionWrites([stmt.block, stmt.handler?.body]);
                const writes = {
                    names: new Set(tryWrites.names),
                    members: tryWrites.members.slice(),
                };
                if (stmt.finalizer) {
                    const finalizerWrites = this.collectRegionWrites([stmt.finalizer]);
                    for (const name of finalizerWrites.names) writes.names.add(name);
                    for (const target of finalizerWrites.members) writes.members.push(target);
                }
                this.processNestedStatement(stmt.block, env.copy(), ctx);
                if (stmt.handler) {
                    // `v5 = v7` 这种标识符拷贝的右值,如果 try 体写过 v7,不能用
                    // try 之前的别名。f1268 的 catch 要把打开的 fd 留给 finally
                    // 的 closeSync;沿用 try 前的日志字符串会把字符串当成 fd。
                    // 其它读取仍用外层 env:HttpDownloader 的 catch 里 `if (v14)
                    // v14.destroy()` 是 finally 已经做过的清理,用 try 前的空值
                    // 折掉,避免和 finally 各销毁一次。
                    const catchEnv = env.copy();
                    // try 之前建立的别名(`v0 = acc`)在 try 写过 `acc` 之后,异常
                    // 路径上已经不成立:catch 里读 `v0` 必须保留 `v0`(amcl p16
                    // acquire 的 `closeSync(v0)` 曾被折成 `closeSync(acc)`,把 fd
                    // 变成 tryLock 函数)。
                    catchEnv.invalidateIdentifierAliases(tryBodyWrites.names);
                    for (const name of this.identifierCopySources(stmt.handler.body)) {
                        if (tryBodyWrites.names.has(name)) catchEnv.invalidate(name);
                    }
                    this.processNestedStatement(stmt.handler.body, catchEnv, ctx);
                }
                if (stmt.finalizer) {
                    // finally 可能在 try 的任意位置(含异常路径)执行,不能沿用 try 之前
                    // 的别名关系:try 里写过的名字在 finally 入口必须视为未知,
                    // 否则 `v2 = acc` 会在 acc 已被改写后仍被折叠成 acc。
                    const finalEnv = env.copy();
                    this.invalidateRegionWrites(tryWrites, finalEnv);
                    this.processNestedStatement(stmt.finalizer, finalEnv, ctx);
                }
                this.invalidateRegionWrites(writes, env);
                return;
            }
            case "SwitchStatement": {
                const writes = this.collectRegionWrites(stmt.cases);
                stmt.discriminant = this.rewriteExpr(stmt.discriminant, env, list, index, ctx, true);
                for (const c of stmt.cases) {
                    const caseEnv = env.copy();
                    if (c.test) c.test = this.rewriteExpr(c.test, caseEnv, list, index, ctx, true);
                    this.processStatements(c.consequent, caseEnv, ctx);
                }
                this.invalidateRegionWrites(writes, env);
                return;
            }
            case "ReturnStatement":
            case "ThrowStatement":
                if (stmt.argument) {
                    stmt.argument = this.rewriteExpr(stmt.argument, env, list, index, ctx, true);
                }
                return;
            case "ExportNamedDeclaration":
                if (stmt.declaration && isVariableDeclaration(stmt.declaration)) {
                    this.processVariableDeclaration(stmt.declaration, env, list, index, ctx);
                }
                return;
            case "ExportDefaultDeclaration":
                if (stmt.declaration && !isFunctionLike(stmt.declaration) && !isClassLike(stmt.declaration)
                    && isExpression(stmt.declaration)) {
                    stmt.declaration = this.rewriteExpr(stmt.declaration, env, list, index, ctx, false);
                }
                return;
            default:
                return;
        }
    }
    private processNestedStatement(stmt: TYPE.Statement, env: EnvState, ctx: FunctionContext): void {
        if (isBlockStatement(stmt)) {
            this.processStatements(stmt.body, env, ctx);
        } else {
            this.processStatement(stmt, env, [stmt], 0, ctx);
        }
    }
    private processVariableDeclaration(
        decl: TYPE.VariableDeclaration,
        env: EnvState,
        list: TYPE.Statement[],
        index: number,
        ctx: FunctionContext,
    ): void {
        for (const declarator of decl.declarations) {
            if (!isIdentifier(declarator.id)) {
                if (declarator.init) declarator.init = this.rewriteExpr(declarator.init, env, list, index, ctx, false);
                continue;
            }
            const name = declarator.id.name;
            env.invalidate(name);
            if (!declarator.init) continue;

            // let Y = X; 当 X 当前值是 class/function/new/call 等不可复制值时,
            // 直接把值搬到 Y 的初始化里,避免多一个临时变量。
            if (isIdentifier(declarator.init) && declarator.init.name !== name) {
                const sourceName = declarator.init.name;
                const sourceEntry = env.get(sourceName);
                const sourceInfo = ctx.infos.get(sourceName);
                if (sourceEntry && sourceInfo && !sourceInfo.captured
                    && sourceEntry.unsubstitutedReads <= 1
                    && sourceEntry.list === list && sourceEntry.index < index
                    && isSafeToMoveBetween(list, sourceEntry.index + 1, index)) {
                    const definition = sourceEntry.list[sourceEntry.index];
                    const isSimpleDefinition = isExpressionStatement(definition)
                        && isAssignmentExpression(definition.expression)
                        && definition.expression.operator === "="
                        && definition.expression.right === sourceEntry.expr;
                    const deps = collectIdentifierNames(sourceEntry.expr);
                    const liveAfterMove = ctx.liveAfter.get(list[index]);
                    if (isSimpleDefinition && !isCopyable(sourceEntry.expr)
                        && !deps.has(name)
                        && !(liveAfterMove && liveAfterMove.has(sourceName))) {
                        const value = sourceEntry.expr;
                        sourceInfo.refs.delete(declarator.init);
                        ctx.moved.set(value, list[index]);
                        declarator.init = value;
                        env.invalidate(sourceName);
                        if (isTempName(sourceName) && ctx.infos.has(sourceName)) {
                            env.set(sourceName, {
                                expr: identifierBuilder(name),
                                list,
                                index,
                                deps: [name],
                                unsubstitutedReads: 0,
                            });
                        }
                        if (isTempName(name) && ctx.infos.has(name)) this.define(env, name, value, list, index, ctx);
                        this.changed = true;
                        continue;
                    }
                }
            }

            const init = this.rewriteExpr(declarator.init, env, list, index, ctx, false);
            declarator.init = init;
            if (isTempName(name) && ctx.infos.has(name)) {
                this.define(env, name, init, list, index, ctx);
            }
        }
    }
    private processExpression(
        expr: TYPE.Expression,
        env: EnvState,
        list: TYPE.Statement[],
        index: number,
        ctx: FunctionContext,
        allowImpure: boolean = true,
    ): TYPE.Expression {
        if (isAssignmentExpression(expr)) {
            this.processAssignment(expr, env, list, index, ctx, allowImpure);
            return expr;
        }
        return this.rewriteExpr(expr, env, list, index, ctx, allowImpure);
    }
    private processAssignment(
        assign: TYPE.AssignmentExpression,
        env: EnvState,
        list: TYPE.Statement[],
        index: number,
        ctx: FunctionContext,
        allowImpure: boolean = true,
    ): void {
        this.rewriteLVal(assign.left, env, list, index, ctx);
        // LHS 会先于 RHS 求值;只有简单标识符左值才允许把副作用搬到 RHS
        assign.right = this.rewriteExpr(
            assign.right, env, list, index, ctx, allowImpure && isPureLVal(assign.left));

        // Y = X:若 X 当前值是不可复制但可搬移的(New/调用/函数/类等),把值搬到 Y,
        // 并让 X 暂时别名到 Y。这样后续 X.method / X.call(Y,...) 能还原成 Y.method(...)。
        if (assign.operator === "=" && isIdentifier(assign.left) && isIdentifier(assign.right)
            && assign.left.name !== assign.right.name) {
            const targetName = assign.left.name;
            const sourceName = assign.right.name;
            const targetInfo = ctx.infos.get(targetName);
            const sourceInfo = ctx.infos.get(sourceName);
            const sourceEntry = env.get(sourceName);
            if (targetInfo && sourceInfo && !targetInfo.captured && !sourceInfo.captured
                && isTempName(targetName) && sourceEntry
                && sourceEntry.unsubstitutedReads <= 1
                && sourceEntry.list === list && sourceEntry.index < index
                && isSafeToMoveBetween(list, sourceEntry.index + 1, index)) {
                const definition = sourceEntry.list[sourceEntry.index];
                const isSimpleDefinition = isExpressionStatement(definition)
                    && isAssignmentExpression(definition.expression)
                    && definition.expression.operator === "="
                    && definition.expression.right === sourceEntry.expr;
                const deps = collectIdentifierNames(sourceEntry.expr);
                const liveAfterMove = ctx.liveAfter.get(list[index]);
                if (isSimpleDefinition && isNewExpression(sourceEntry.expr)
                    && !deps.has(targetName)
                    && !(liveAfterMove && liveAfterMove.has(sourceName))) {
                    const value = sourceEntry.expr;
                    sourceInfo.refs.delete(assign.right);
                    ctx.moved.set(value, list[index]);
                    assign.right = value;
                    env.invalidate(sourceName);
                    this.define(env, targetName, value, list, index, ctx);
                    env.set(sourceName, {
                        expr: identifierBuilder(targetName),
                        list,
                        index,
                        deps: [targetName],
                        unsubstitutedReads: 0,
                    });
                    this.changed = true;
                    return;
                }
            }
        }

        // 标识符/解构写入使依赖名字的缓存失效;成员左值(this.x = v)按
        // “同对象.同属性”精确失效——成员写入不改变变量绑定,别名与模板对象
        // 必须跨成员写入存活(ObjectLiteralSimplify 依赖该形态)。
        this.invalidateAssignTarget(assign.left, env);
        if (assign.operator === "=" && isIdentifier(assign.left)) {
            const name = assign.left.name;
            if (isTempName(name) && ctx.infos.has(name)) {
                this.define(env, name, assign.right, list, index, ctx);
            }
        }
    }
    private define(
        env: EnvState,
        name: string,
        expr: TYPE.Expression,
        list: TYPE.Statement[],
        index: number,
        ctx: FunctionContext,
    ): void {
        const info = ctx.infos.get(name);
        if (!info || info.captured) return;
        const deps = Array.from(collectIdentifierNames(expr));
        // v = v + 1 这类自引用不能再传播,否则后续 use(v) 会读到新 v
        if (deps.includes(name)) return;
        // 函数/类表达式只在最后一次引用时整块搬移,不会克隆,可以不受大小限制
        if (!isDeclarationValue(expr)
            && nodeSize(expr, MAX_PROPAGATED_SIZE + 1) > MAX_PROPAGATED_SIZE) return;
        env.set(name, { expr, list, index, deps, unsubstitutedReads: 0 });
    }
    private rewriteLVal(
        node: TYPE.LVal | TYPE.OptionalMemberExpression,
        env: EnvState,
        list: TYPE.Statement[],
        index: number,
        ctx: FunctionContext,
    ): void {
        if (!node) return;
        if (isIdentifier(node)) return;
        if (isMemberExpression(node) || isOptionalMemberExpression(node)) {
            node.object = this.rewriteExpr(node.object as TYPE.Expression, env, list, index, ctx, false);
            if (node.computed) {
                node.property = this.rewriteExpr(node.property as TYPE.Expression, env, list, index, ctx, false);
            }
            return;
        }
        if (isRestElement(node)) {
            this.rewriteLVal(node.argument as any, env, list, index, ctx);
        } else if (isAssignmentPattern(node)) {
            this.rewriteLVal(node.left as any, env, list, index, ctx);
            node.right = this.rewriteExpr(node.right, env, list, index, ctx, false);
        } else if (isArrayPattern(node)) {
            for (const e of node.elements) if (e) this.rewriteLVal(e as any, env, list, index, ctx);
        } else if (isObjectPattern(node)) {
            for (const p of node.properties) {
                if (isRestElement(p)) this.rewriteLVal(p.argument as any, env, list, index, ctx);
                else if (isObjectProperty(p)) {
                    if (p.computed) p.key = this.rewriteExpr(p.key as TYPE.Expression, env, list, index, ctx, false);
                    this.rewriteLVal(p.value as any, env, list, index, ctx);
                }
            }
        }
    }
    private rewriteExpr(
        node: TYPE.Expression,
        env: EnvState,
        list: TYPE.Statement[],
        index: number,
        ctx: FunctionContext,
        allowImpure: boolean,
    ): TYPE.Expression {
        if (!node) return node;
        if (isIdentifier(node)) {
            return this.resolveIdentifier(node, env, list, index, ctx, allowImpure);
        }
        if (isFunctionLike(node)) return node;
        if (isClassExpression(node)) {
            // 只处理 extends 表达式,不进入 class body(方法有独立作用域)
            if (node.superClass) {
                node.superClass = this.rewriteExpr(
                    node.superClass as TYPE.Expression, env, list, index, ctx, false);
            }
            return node;
        }
        if (isClassDeclaration(node)) return node;

        switch (node.type) {
            case "MemberExpression":
            case "OptionalMemberExpression": {
                const n = node as TYPE.MemberExpression;
                n.object = this.rewriteExpr(n.object as TYPE.Expression, env, list, index, ctx, allowImpure);
                if (n.computed) {
                    n.property = this.rewriteExpr(
                        n.property as TYPE.Expression, env, list, index, ctx,
                        allowImpure && isPureExpression(n.object));
                }
                return n as TYPE.Expression;
            }
            case "AssignmentExpression": {
                const n = node as TYPE.AssignmentExpression;
                this.rewriteLVal(n.left, env, list, index, ctx);
                n.right = this.rewriteExpr(n.right, env, list, index, ctx, false);
                this.invalidateAssignTarget(n.left, env);
                if (n.operator === "=" && isIdentifier(n.left)) {
                    const name = n.left.name;
                    if (isTempName(name) && ctx.infos.has(name)) this.define(env, name, n.right, list, index, ctx);
                }
                return n;
            }
            case "UpdateExpression": {
                const n = node as TYPE.UpdateExpression;
                if (isIdentifier(n.argument)) {
                    env.invalidate(n.argument.name);
                } else {
                    this.rewriteLVal(n.argument as any, env, list, index, ctx);
                    // this.x++ 同样读取并写入成员:按“同对象.同属性”精确失效
                    this.invalidateAssignTarget(n.argument as any, env);
                }
                return n;
            }
            case "SequenceExpression": {
                const n = node as TYPE.SequenceExpression;
                let canMove = allowImpure;
                n.expressions = n.expressions.map((e) => {
                    const rewritten = this.rewriteExpr(e, env, list, index, ctx, canMove);
                    if (canMove && !isPureExpression(rewritten)) canMove = false;
                    return rewritten;
                });
                return n;
            }
            case "LogicalExpression": {
                const n = node as TYPE.LogicalExpression;
                n.left = this.rewriteExpr(n.left, env, list, index, ctx, allowImpure);
                // 右侧是条件求值,不能把前一语句的副作用搬进来
                const rightEnv = env.copy();
                n.right = this.rewriteExpr(n.right, rightEnv, list, index, ctx, false);
                // 右值可能执行,也可能不执行;它写入的变量在 outer env 中必须视为未知,
                // 否则分支里会把 v7 错误地继续当成 acc(acc 已被右值改掉)。
                this.invalidateRegionWrites(this.collectRegionWrites([n.right]), env);
                return n;
            }
            case "BinaryExpression": {
                const n = node as TYPE.BinaryExpression;
                const leftBefore = n.left as TYPE.Expression;
                const rightBefore = n.right as TYPE.Expression;
                n.left = this.rewriteExpr(leftBefore, env, list, index, ctx, allowImpure);
                // 右操作数在左侧之后求值:左侧有副作用时不能再把前一语句的调用搬进来
                n.right = this.rewriteExpr(rightBefore, env, list, index, ctx,
                    allowImpure && isPureExpression(n.left as TYPE.Expression));
                // 两侧被替换成同一个**属性读取**时还原一侧的读取:
                //   v4 = this.generation; ... if (v4 !== this.generation) ...
                // 缓存表达式(v4 → this.generation)和接收者别名(p2 → this)的替换会让
                // 比较变成 `this.generation !== this.generation`(恒假),而 v4 是跨
                // await 的旧值快照,两侧读到的本来就不是同一个值。常量/标识符两侧
                // 相同是合法的常量折叠(`v21 = undefined; if (v21 == undefined)`),
                // 不能还原。
                if (isNodeEqual(n.left as TYPE.Node, n.right as TYPE.Node)) {
                    if (isIdentifier(leftBefore) && (n.left as TYPE.Node) !== leftBefore
                        && this.isMemberRead(n.left as TYPE.Expression)) {
                        this.restoreSubstitutedRead(leftBefore, ctx);
                        n.left = leftBefore;
                    } else if (isIdentifier(rightBefore) && (n.right as TYPE.Node) !== rightBefore
                        && this.isMemberRead(n.right as TYPE.Expression)) {
                        this.restoreSubstitutedRead(rightBefore, ctx);
                        n.right = rightBefore;
                    }
                }
                return n;
            }
            case "ConditionalExpression": {
                const n = node as TYPE.ConditionalExpression;
                n.test = this.rewriteExpr(n.test, env, list, index, ctx, allowImpure);
                n.consequent = this.rewriteExpr(n.consequent, env.copy(), list, index, ctx, false);
                n.alternate = this.rewriteExpr(n.alternate, env.copy(), list, index, ctx, false);
                // consequent/alternate 只会执行其中一个,写入的变量在 outer env 中都视为未知
                this.invalidateRegionWrites(this.collectRegionWrites([n.consequent, n.alternate]), env);
                return n;
            }
            case "CallExpression":
            case "NewExpression": {
                const n = node as TYPE.CallExpression;
                n.callee = this.rewriteExpr(n.callee as TYPE.Expression, env, list, index, ctx, allowImpure) as any;
                let canMove = allowImpure && isPureExpression(n.callee as TYPE.Expression);
                n.arguments = n.arguments.map((arg) => {
                    if (isSpreadElement(arg)) {
                        arg.argument = this.rewriteExpr(arg.argument, env, list, index, ctx, canMove);
                        if (canMove && !isPureExpression(arg.argument)) canMove = false;
                        return arg;
                    }
                    const rewritten = this.rewriteExpr(arg as TYPE.Expression, env, list, index, ctx, canMove);
                    if (canMove && !isPureExpression(rewritten)) canMove = false;
                    return rewritten as any;
                });
                return n;
            }
            case "UnaryExpression": {
                const n = node as TYPE.UnaryExpression;
                n.argument = this.rewriteExpr(n.argument, env, list, index, ctx, allowImpure);
                return n;
            }
            case "AwaitExpression": {
                const n = node as TYPE.AwaitExpression;
                n.argument = this.rewriteExpr(n.argument, env, list, index, ctx, allowImpure);
                return n;
            }
            case "YieldExpression": {
                const n = node as TYPE.YieldExpression;
                if (n.argument) n.argument = this.rewriteExpr(n.argument, env, list, index, ctx, allowImpure);
                return n;
            }
            case "TemplateLiteral": {
                const n = node as TYPE.TemplateLiteral;
                let canMove = allowImpure;
                n.expressions = n.expressions.map((e) => {
                    const rewritten = this.rewriteExpr(e as TYPE.Expression, env, list, index, ctx, canMove);
                    if (canMove && !isPureExpression(rewritten)) canMove = false;
                    return rewritten;
                });
                return n;
            }
            case "TaggedTemplateExpression": {
                const n = node as TYPE.TaggedTemplateExpression;
                n.tag = this.rewriteExpr(n.tag, env, list, index, ctx, allowImpure);
                let canMove = allowImpure && isPureExpression(n.tag);
                n.quasi.expressions = n.quasi.expressions.map((e) => {
                    const rewritten = this.rewriteExpr(e as TYPE.Expression, env, list, index, ctx, canMove);
                    if (canMove && !isPureExpression(rewritten)) canMove = false;
                    return rewritten;
                });
                return n;
            }
            case "ArrayExpression": {
                const n = node as TYPE.ArrayExpression;
                let canMove = allowImpure;
                n.elements = n.elements.map((e) => {
                    if (!e) return e;
                    if (isSpreadElement(e)) {
                        e.argument = this.rewriteExpr(e.argument, env, list, index, ctx, canMove);
                        if (canMove && !isPureExpression(e.argument)) canMove = false;
                        return e;
                    }
                    const rewritten = this.rewriteExpr(e as TYPE.Expression, env, list, index, ctx, canMove);
                    if (canMove && !isPureExpression(rewritten)) canMove = false;
                    return rewritten;
                });
                return n;
            }
            case "ObjectExpression": {
                const n = node as TYPE.ObjectExpression;
                let canMove = allowImpure;
                n.properties = n.properties.map((p) => {
                    if (isSpreadElement(p)) {
                        p.argument = this.rewriteExpr(p.argument, env, list, index, ctx, canMove);
                        if (canMove && !isPureExpression(p.argument)) canMove = false;
                        return p;
                    }
                    if (isObjectProperty(p)) {
                        if (p.computed) {
                            p.key = this.rewriteExpr(p.key as TYPE.Expression, env, list, index, ctx, canMove);
                            if (canMove && !isPureExpression(p.key as TYPE.Expression)) canMove = false;
                        }
                        p.value = this.rewriteExpr(p.value as TYPE.Expression, env, list, index, ctx, canMove);
                        if (canMove && !isPureExpression(p.value as TYPE.Expression)) canMove = false;
                    }
                    return p;
                });
                return n;
            }
            case "ParenthesizedExpression": {
                const n = node as any;
                n.expression = this.rewriteExpr(n.expression, env, list, index, ctx, allowImpure);
                return n;
            }
            case "TSAsExpression":
            case "TSTypeAssertion":
            case "TSNonNullExpression":
            case "TypeCastExpression": {
                const n = node as any;
                n.expression = this.rewriteExpr(n.expression, env, list, index, ctx, allowImpure);
                return n;
            }
            default:
                return this.rewriteExprFallback(node, env, list, index, ctx);
        }
    }
    private rewriteExprFallback(
        node: TYPE.Expression,
        env: EnvState,
        list: TYPE.Statement[],
        index: number,
        ctx: FunctionContext,
    ): TYPE.Expression {
        const keys = (VISITOR_KEYS as any)[node.type] as string[] | undefined;
        if (!keys) return node;
        for (const key of keys) {
            const value = (node as any)[key];
            if (Array.isArray(value)) {
                (node as any)[key] = value.map((child: any) =>
                    child && isExpression(child)
                        ? this.rewriteExpr(child, env, list, index, ctx, false)
                        : child);
            } else if (value && isExpression(value)) {
                (node as any)[key] = this.rewriteExpr(value, env, list, index, ctx, false);
            }
        }
        return node;
    }
    /** 表达式是否就是一次属性读取(可复制但不稳定,跨 await 的两次读取不一定相同)。 */
    private isMemberRead(expr: TYPE.Expression): boolean {
        return expr.type === "MemberExpression" || expr.type === "OptionalMemberExpression";
    }
    /** 还原被替换掉的读取:把引用登记回 binding,声明清理时不会误删。 */
    private restoreSubstitutedRead(id: TYPE.Identifier, ctx: FunctionContext): void {
        ctx.infos.get(id.name)?.refs.add(id);
        this.changed = true;
    }
    private resolveIdentifier(
        id: TYPE.Identifier,
        env: EnvState,
        list: TYPE.Statement[],
        index: number,
        ctx: FunctionContext,
        allowImpure: boolean,
    ): TYPE.Expression {
        const info = ctx.infos.get(id.name);
        if (!info || info.captured || !info.refs.has(id)) return id;
        const entry = env.get(id.name);
        if (!entry) return id;

        if (isCopyable(entry.expr) && ctx.cloneBudget > 0) {
            const size = nodeSize(entry.expr);
            if (size <= ctx.cloneBudget) {
                info.refs.delete(id);
                ctx.cloneBudget -= size;
                const clone = cloneNode(entry.expr, true) as TYPE.Expression;
                registerCloneRefs(clone, ctx);
                this.changed = true;
                return clone;
            }
        }

        // 当前值的最后一次读取:可以用克隆/搬移代替读取变量。
        // 注意 liveness 只看“名字是否还活着”,分不清 acc 的新旧版本:
        //   acc = f(); acc = x + acc; y = acc;
        // 第 2 条读取的是旧 acc,但旧值在本条语句结束后就被覆盖,因此也应视为 last use。
        // statementOverwritesSelfAssign 把这一点推广到任意 `name = RHS` 且 RHS 只读一次
        // name 的语句(如 acc = acc.length):旧值在本语句后立即失效。
        const liveAfter = ctx.liveAfter.get(list[index]);
        let deadAfter = liveAfter != null && !liveAfter.has(id.name);
        // if 的 test 读取:分支可能通过 break/return 跳出后继续读该变量,
        // liveAfter(if 之后的语句)看不到这条路径,要看分支的 live-in。
        if (deadAfter && isIfStatement(list[index]) && containsNode(list[index].test, id)) {
            const branchLive = ctx.branchLive.get(list[index]);
            if (branchLive && branchLive.has(id.name)) deadAfter = false;
        }
        const binarySelf = statementOverwritesSelf(list[index], id.name, id);
        // `name = RHS` 且 RHS 只读一次 name:旧值在本语句后立即被覆盖。
        // 这条新路径下若变量名在语句后仍活跃(后续读到的是新值),默认只允许搬进
        // 调用接收者位置,避免破坏 acc = acc.test 这类 AccCallSimplify 依赖的
        // 方法装载形态;若后面不是 name.call(...),则允许搬进成员装载的其它位置
        // (如 acc = acc.length)。binarySelf(二元自累加)保持原有任意位置搬移的行为。
        const assignSelf = !binarySelf && statementOverwritesSelfAssign(list[index], id.name, id);
        const overwrittenHere = binarySelf || assignSelf;
        // if 的 test 读取:两个分支都一定会在读取前覆盖 name 时,test 里的这次读取
        // 就是旧值的最后用法(之后任何读取拿到的都是分支写入的新值)。
        // 典型形态:
        //   v0 = new RegExp(...);
        //   if (!v0.test(p0)) { v0 = true } else { v0 = false }
        // 把 new RegExp 搬进 test 后,v0 = new RegExp 成为死存储,
        // 整个结构才能折成 `v0 = A && !new RegExp(...).test(p0)`。
        const ifStmt = list[index];
        const testLastUse = isIfStatement(ifStmt) && ifStmt.alternate != null
            && containsNode(ifStmt.test, id)
            && definitelyWritesBeforeRead(ifStmt.consequent, id.name)
            && definitelyWritesBeforeRead(ifStmt.alternate, id.name);
        // 同一个语句里可能还有别的读取(典型是 if 的 test 和分支体都读同一个
        // 临时变量)。只有分支在读取前会先覆盖该变量时,测试里的这次读取才算
        // 最后一次读取;否则搬移调用会复制一份调用。
        const lastUse = (overwrittenHere || deadAfter || testLastUse) && isLastReadInStatement(list[index], id);
        if (lastUse && entry.unsubstitutedReads === 0) {
            if (isPureExpression(entry.expr) && !isDeclarationValue(entry.expr)) {
                // 数组/对象字面量:只在唯一使用处求值一次,原赋值稍后会被作为死存储删除
                info.refs.delete(id);
                let value = entry.expr;
                const size = nodeSize(value);
                if (size <= ctx.cloneBudget) {
                    ctx.cloneBudget -= size;
                    value = cloneNode(value, true) as TYPE.Expression;
                    registerCloneRefs(value, ctx);
                } else {
                    ctx.moved.set(value, list[index]);
                }
                env.invalidate(id.name);
                this.changed = true;
                return value;
            }
            // 调用/构造/函数/类表达式:跨过的语句必须无副作用,保持求值顺序。
            // assignSelf 路径(靠本语句覆盖才成为 last-use)只允许调用接收者位置,
            // 见上方 assignSelf 的说明。
            //
            // deadAfter 必须准确(分支里 break/continue 后仍会读取的情况见 branchLive),
            // 否则 `v4 = parse(...); if (v4.completed) break; ... return v4;` 会把调用
            // 搬进 test,造成同一个有副作用的调用执行两次。
            if (allowImpure && entry.list === list && entry.index < index
                && isSafeToMoveBetween(list, entry.index + 1, index)
                && (deadAfter || binarySelf || assignSelf || isCalleeReceiverRead(list[index], id)
                    || !nextStatementIsAccMethodCall(list, index, id.name))) {
                info.refs.delete(id);
                ctx.moved.set(entry.expr, list[index]);
                env.invalidate(id.name);
                this.changed = true;
                return entry.expr;
            }
        }

        // 裸成员装载 `x = x.prop`(RHS 只读一次 x),但 x 之后仍会读取新值,
        // 且旧值是不可复制表达式(如 `acc = v2.slice(v8); v6 = acc; acc = acc.length`)。
        // 此时旧值已经复制给别名 y,把本语句里的 x 改读 y:
        //   acc = v6.length; 后续 if (acc === 0) 再把 v6.length 传播进 test。
        // 这样 x 被覆盖后 y 仍持有旧值,下一轮就能把旧值搬到 y 的赋值处。
        if (assignSelf && !deadAfter && !isCopyable(entry.expr) && !isDeclarationValue(entry.expr)
            && !isCalleeReceiverRead(list[index], id)
            && !nextStatementIsAccMethodCall(list, index, id.name)) {
            const alias = this.findAliasOf(env, id.name, ctx);
            if (alias && !entry.deps.includes(alias)) {
                info.refs.delete(id);
                ctx.infos.get(alias)?.refs.add(id);
                id.name = alias;
                // 别名原先记为 `alias = x`(依赖 x);x 即将被覆盖,
                // 这里改为直接持有旧值,避免 x 失效时把别名一起级联失效。
                env.set(alias, {
                    expr: entry.expr,
                    list: entry.list,
                    index: entry.index,
                    deps: entry.deps.slice(),
                    unsubstitutedReads: 0,
                });
                this.changed = true;
                return id;
            }
        }

        entry.unsubstitutedReads++;
        return id;
    }
    /**
     * 在 env 中查找当前持有 name 旧值的别名临时变量(前面执行过 `alias = name`,
     * 且两者此后都没有被改写)。返回第一个可用别名。
     */
    private findAliasOf(env: EnvState, name: string, ctx: FunctionContext): string | null {
        for (const [alias, entry] of env.map) {
            if (alias === name || !isTempName(alias)) continue;
            const info = ctx.infos.get(alias);
            if (!info || info.captured) continue;
            if (isIdentifier(entry.expr) && entry.expr.name === name) return alias;
        }
        return null;
    }
}
