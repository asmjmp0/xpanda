import * as TYPE from "@babel/types";
import {
    expressionStatement,
    isAssignmentExpression,
    isBlockStatement,
    isCallExpression,
    isExpressionStatement,
    isIdentifier,
    isStatement as isStatementNode,
} from "@babel/types";
import { isDeclarationValue, isPureExpression, isTempName, writesOnTakenPath } from "../AstUtils";
import { TempVariablePass } from "./base";
import { FunctionContext, LoopLive } from "./types";
import { doWhileKillsTestReads, loopLive, sameSet, union } from "./queries";
import { removeRefs, tempReadWrites, tempReadWritesBeforeStore, tempReads, tempReadsBeforeWrite, tempWrites } from "./context";

/**
 * 反向活跃性分析与死存储删除。
 *
 * analyze* 只做分析(结果登记到 ctx.liveAfter / branchLive / loopBodyIn),
 * cleanup* 同时删除死存储;两条路径共用同一套控制流结构。
 *
 * @Author: jmp0
 */
export class LivenessAnalyzer extends TempVariablePass {

    /** 不做任何修改的活跃性分析,结果写入 ctx.liveAfter。 */
    analyzeList(stmts: TYPE.Statement[], liveOut: Set<string>, ctx: FunctionContext, loop?: LoopLive): Set<string> {
        const live = new Set(liveOut);
        for (let i = stmts.length - 1; i >= 0; i--) {
            const stmt = stmts[i];
            ctx.liveAfter.set(stmt, new Set(live));
            const before = this.transfer(stmt, live, ctx, loop, false);
            live.clear();
            for (const name of before) live.add(name);
        }
        return live;
    }
    private analyzeNested(stmt: TYPE.Statement, liveOut: Set<string>, ctx: FunctionContext, loop?: LoopLive): Set<string> {
        if (isBlockStatement(stmt)) return this.analyzeList(stmt.body, liveOut, ctx, loop);
        return this.transfer(stmt, liveOut, ctx, loop, false);
    }
    /**
     * 反向活跃性分析 + 死存储删除。
     * @param liveOut 当前语句列表之后仍然活跃的 temp
     * @returns 语句列表之前仍然活跃的 temp
     */
    cleanupStatements(stmts: TYPE.Statement[], ctx: FunctionContext, liveOut: Set<string>, loop?: LoopLive): Set<string> {
        const live = new Set(liveOut);
        for (let i = stmts.length - 1; i >= 0; i--) {
            const stmt = stmts[i];
            const dead = this.tryDeadStore(stmt, ctx, live);
            if (dead) {
                this.changed = true;
                this.cleanupVersion++;
                if (dead.replace === null) {
                    stmts.splice(i, 1);
                } else {
                    stmts[i] = dead.replace;
                }
                for (const name of dead.remainingReads) live.add(name);
                continue;
            }
            const before = this.transfer(stmt, live, ctx, loop, true);
            live.clear();
            for (const name of before) live.add(name);
        }
        return live;
    }
    /**
     * 活跃性传递。两种模式共用同一套控制流结构:
     *   cleanup=false 只做分析(结果登记到 ctx.liveAfter / branchLive / loopBodyIn);
     *   cleanup=true  同时删除死存储(由 cleanupStatements 驱动)。
     * 唯一的语义差异是 if 分支的 live-out(分析时减去 test 的写入)和嵌套处理方式,
     * 之前 analyze/cleanup 各维护一份几乎相同的 switch,改一处容易漏掉另一处。
     */
    private transfer(
        stmt: TYPE.Statement,
        liveOut: Set<string>,
        ctx: FunctionContext,
        loop: LoopLive | undefined,
        cleanup: boolean,
    ): Set<string> {
        if (!cleanup) {
            // 非列表位置(else-if 链的 if、直接作为循环体的语句等)也要登记 liveAfter,
            // 否则 isNameDeadAfterTest / matchConditionPattern 拿到 undefined 会放弃折叠。
            ctx.liveAfter.set(stmt, new Set(liveOut));
        }
        switch (stmt.type) {
            case "ExpressionStatement":
            case "VariableDeclaration": {
                // 读取只算“确定写入之前”发生的那些:语句内部的序列/短路表达式
                // 常常先写临时变量再读(`v7 = acc, ... && v7.avatar`),那部分读取
                // 不依赖语句执行前的旧值,否则前面的前置装载永远不会被删。
                // 只在末尾清理轮启用:中途轮次沿用整语句读取集合,避免改变
                // 复制传播/条件折叠的轨迹(其他类的既有形态依赖它)。
                const { reads, writes } = this.readsAndWrites(stmt, ctx);
                const result = new Set(reads);
                for (const name of liveOut) if (!writes.has(name)) result.add(name);
                return result;
            }
            case "IfStatement": {
                // 分支的 live-out 就是 if 之后的 live-out。清理模式不能减去 test 的写入:
                // test 里的临时赋值不会让分支里的同名赋值变成死代码。
                const testReads = this.reads(stmt.test, ctx);
                let branchOut: Set<string>;
                if (cleanup) {
                    branchOut = new Set(liveOut);
                } else {
                    const testWrites = tempWrites(stmt.test, ctx);
                    branchOut = new Set();
                    for (const name of liveOut) if (!testWrites.has(name)) branchOut.add(name);
                }
                const consequentIn = this.transferNested(stmt.consequent, branchOut, ctx, loop, cleanup);
                const alternateIn = stmt.alternate
                    ? this.transferNested(stmt.alternate, branchOut, ctx, loop, cleanup)
                    : branchOut;
                // 清理模式额外吃掉“test 在进入分支的路径上一定写过”的名字:
                // `if ((v13 = f(), cond)) { ... v13.x ... }` 的分支读到的是 test
                // 刚写入的新值,分支前的 `v13 = ...` 死预装载可以删除。只在清理
                // 模式做,避免改变复制传播依赖的分析结果。
                if (cleanup && ctx.aggressiveCleanup) {
                    for (const name of [...consequentIn]) {
                        if (writesOnTakenPath(stmt.test, name, true)) consequentIn.delete(name);
                    }
                    for (const name of [...alternateIn]) {
                        if (writesOnTakenPath(stmt.test, name, false)) alternateIn.delete(name);
                    }
                }
                ctx.branchLive.set(stmt, union(consequentIn, alternateIn));
                return union(testReads, consequentIn, alternateIn);
            }
            case "WhileStatement":
            case "DoWhileStatement": {
                const testReads = this.reads(stmt.test, ctx);
                const initialOut = union(liveOut, testReads);
                const body = this.analyzeLoopBody(stmt.body, initialOut, ctx, liveOut);
                if (!cleanup) ctx.loopBodyIn.set(stmt, new Set(body.bodyIn));
                const resultIn = cleanup
                    ? this.cleanupNested(stmt.body, ctx, body.bodyOut, loopLive(liveOut, body.bodyOut))
                    : body.bodyIn;
                if (stmt.type === "WhileStatement") {
                    return union(testReads, resultIn, liveOut);
                }
                // do-while 的 test 在 body 之后执行:body 一定先写 name 时,test 读到的是新值,
                // 不应把这次读取算作循环入口处旧值的活跃使用。
                const result = new Set(resultIn);
                for (const name of testReads) if (!doWhileKillsTestReads(stmt, name)) result.add(name);
                for (const name of liveOut) result.add(name);
                return result;
            }
            case "ForStatement": {
                const testReads = stmt.test ? this.reads(stmt.test, ctx) : new Set<string>();
                const updateReads = stmt.update ? this.reads(stmt.update, ctx) : new Set<string>();
                const body = this.analyzeLoopBody(
                    stmt.body,
                    union(liveOut, testReads, updateReads),
                    ctx,
                    liveOut,
                );
                if (!cleanup) ctx.loopBodyIn.set(stmt, new Set(body.bodyIn));
                const resultIn = cleanup
                    ? this.cleanupNested(stmt.body, ctx, body.bodyOut, loopLive(liveOut, body.bodyOut))
                    : body.bodyIn;
                const initReads = stmt.init ? this.reads(stmt.init, ctx) : new Set<string>();
                const initWrites = stmt.init ? tempWrites(stmt.init, ctx) : new Set<string>();
                const afterInit = union(resultIn, testReads, updateReads, liveOut);
                const result = new Set(initReads);
                for (const name of afterInit) if (!initWrites.has(name)) result.add(name);
                return result;
            }
            case "ForInStatement":
            case "ForOfStatement": {
                const rightReads = tempReads((stmt as TYPE.ForInStatement).right, ctx);
                const body = this.analyzeLoopBody(stmt.body, new Set(liveOut), ctx, liveOut);
                const resultIn = cleanup
                    ? this.cleanupNested(stmt.body, ctx, body.bodyOut, loopLive(liveOut, body.bodyOut))
                    : body.bodyIn;
                return union(rightReads, resultIn, liveOut);
            }
            case "BlockStatement":
                return this.transferNested(stmt, liveOut, ctx, loop, cleanup);
            case "LabeledStatement":
                return this.transferNested(stmt.body, liveOut, ctx, loop, cleanup);
            case "TryStatement": {
                const finalizerReads = stmt.finalizer ? tempReads(stmt.finalizer, ctx) : new Set<string>();
                const after = union(liveOut, finalizerReads);
                // finally 会在 try/handler 的 return/throw/break/continue 出口上执行,
                // try 里一旦有 finally 就可能在任何位置抛异常。出口活跃集必须并入
                // finally 的读取,否则 finally 之前最后一次赋值会被当成死存储删掉
                // (`v14 = request` 被删后 finally 只剩 try 之前的 `v14 = null`)。
                let nestedLoop = loop;
                if (stmt.finalizer) {
                    const finallyLive = union(loop?.finallyLive ?? new Set<string>(), finalizerReads);
                    nestedLoop = {
                        breakLive: union(loop?.breakLive ?? liveOut, finalizerReads),
                        continueLive: union(loop?.continueLive ?? liveOut, finalizerReads),
                        inSwitch: loop?.inSwitch ?? false,
                        finallyLive,
                    };
                }
                const blockIn = this.transferNested(stmt.block, after, ctx, nestedLoop, cleanup);
                const handlerIn = stmt.handler
                    ? this.transferNested(stmt.handler.body, after, ctx, nestedLoop, cleanup)
                    : after;
                const finalizerIn = stmt.finalizer
                    ? this.transferNested(stmt.finalizer, liveOut, ctx, loop, cleanup)
                    : liveOut;
                return union(blockIn, handlerIn, finalizerIn, liveOut);
            }
            case "SwitchStatement": {
                const result = this.reads(stmt.discriminant, ctx);
                const caseLoop: LoopLive = {
                    breakLive: liveOut,
                    continueLive: loop?.continueLive ?? liveOut,
                    inSwitch: true,
                };
                for (const c of stmt.cases) {
                    const caseIn = cleanup
                        ? this.cleanupStatements(c.consequent, ctx, liveOut, caseLoop)
                        : this.analyzeList(c.consequent, liveOut, ctx, caseLoop);
                    for (const name of caseIn) result.add(name);
                    for (const name of liveOut) result.add(name);
                }
                return result;
            }
            case "ReturnStatement":
            case "ThrowStatement":
                // return/throw 之后没有代码,只有返回表达式里的读取需要保留;
                // 外层 try/finally 的 finally 读取在出口处也仍然活跃。
                return union(
                    this.reads(stmt.argument, ctx),
                    loop?.finallyLive ?? new Set<string>(),
                );
            case "ExportNamedDeclaration":
                if (stmt.declaration && isStatementNode(stmt.declaration)) {
                    return this.transfer(stmt.declaration as TYPE.Statement, liveOut, ctx, loop, cleanup);
                }
                return new Set(liveOut);
            case "ExportDefaultDeclaration":
                return tempReads(stmt.declaration as TYPE.Node, ctx);
            case "BreakStatement":
                // break 跳出循环后,活跃集是循环之后的代码;switch 里的 break 只跳出 switch。
                // 必须返回副本:调用方会 live.clear() 后把返回值写回 live,
                // 直接返回 liveOut 时 before 与 live 是同一个 Set,clear() 会一起清空。
                return union(
                    loop && !loop.inSwitch ? loop.breakLive : liveOut,
                    loop?.finallyLive ?? new Set<string>(),
                );
            case "ContinueStatement":
                // continue 跳到循环头(test/update),循环头的读取仍然活跃;
                // 外层 try/finally 的 finally 会先执行,它的读取也要算进来。
                return union(
                    loop ? loop.continueLive : liveOut,
                    loop?.finallyLive ?? new Set<string>(),
                );
            default:
                return new Set(liveOut);
        }
    }
    /**
     * 语句/表达式对“语句执行前的旧值”的读取集合。
     * 末尾清理轮按求值顺序只看“确定写入之前”的读取;中途轮次用整语句读取集合
     * (与历史实现一致,避免改变复制传播/条件折叠的轨迹)。
     */
    private reads(node: TYPE.Node | null | undefined, ctx: FunctionContext): Set<string> {
        return ctx.aggressiveCleanup ? tempReadsBeforeWrite(node, ctx) : tempReads(node, ctx);
    }

    /** 语句的读取(见 reads)+ 全部写入。 */
    private readsAndWrites(
        node: TYPE.Node | null | undefined,
        ctx: FunctionContext,
    ): { reads: Set<string>; writes: Set<string> } {
        return ctx.aggressiveCleanup ? tempReadWritesBeforeStore(node, ctx) : tempReadWrites(node, ctx);
    }

    private transferNested(
        stmt: TYPE.Statement,
        liveOut: Set<string>,
        ctx: FunctionContext,
        loop: LoopLive | undefined,
        cleanup: boolean,
    ): Set<string> {
        return cleanup
            ? this.cleanupNested(stmt, ctx, liveOut, loop)
            : this.analyzeNested(stmt, liveOut, ctx, loop);
    }
    /** 循环体的活跃性定点迭代:bodyOut 收敛后同时返回入口活跃集与最终 live-out。 */
    private analyzeLoopBody(
        body: TYPE.Statement,
        initialOut: Set<string>,
        ctx: FunctionContext,
        liveOut: Set<string>,
    ): { bodyIn: Set<string>; bodyOut: Set<string> } {
        let bodyOut = initialOut;
        let bodyIn = this.analyzeNested(body, bodyOut, ctx, loopLive(liveOut, bodyOut));
        for (let k = 0; k < 4; k++) {
            const next = union(bodyOut, bodyIn);
            if (sameSet(next, bodyOut)) break;
            bodyOut = next;
            bodyIn = this.analyzeNested(body, bodyOut, ctx, loopLive(liveOut, bodyOut));
        }
        return { bodyIn, bodyOut };
    }
    private cleanupNested(stmt: TYPE.Statement, ctx: FunctionContext, liveOut: Set<string>, loop?: LoopLive): Set<string> {
        if (isBlockStatement(stmt)) return this.cleanupStatements(stmt.body, ctx, liveOut, loop);
        return this.transfer(stmt, liveOut, ctx, loop, true);
    }
    /**
     * 判断并删除一条死赋值。
     * @returns null 表示不是死赋值;否则给出替换语句(或 null 表示删除)以及仍需保留的读取
     */
    private tryDeadStore(
        stmt: TYPE.Statement,
        ctx: FunctionContext,
        live: Set<string>,
    ): { replace: TYPE.Statement | null; remainingReads: Set<string> } | null {
        if (!isExpressionStatement(stmt) || !isAssignmentExpression(stmt.expression)) return null;
        const assign = stmt.expression;
        if (assign.operator !== "=" || !isIdentifier(assign.left)) return null;
        const name = assign.left.name;
        if (!isTempName(name)) return null;
        const info = ctx.infos.get(name);
        if (!info || info.captured) return null;
        // 返回表达式里直接使用该变量时,保守保留有副作用的调用结果赋值,避免活跃性误判丢失返回值
        // (已经被复制传播搬进 return 的调用不受此限,否则会同时留下调用语句和 return 调用)。
        // 纯调用(p0.trim() 等)没有副作用,删除死存储不可能丢失任何值,不适用该守卫:
        // 否则 `acc = E; X = acc; ... return acc(新版本)` 会留下 `acc = E` 死赋值,
        // 并让 X 复制出第二份调用(`acc = p0.trim(); v2 = p0.trim();`)。
        if (ctx.returned.has(name) && isCallExpression(assign.right)
            && !isPureExpression(assign.right) && !ctx.moved.has(assign.right)) return null;
        // v = v 恒等于无操作,无论 v 之后是否活跃都可以删除
        if (isIdentifier(assign.right) && assign.right.name === name) {
            removeRefs(assign.right, ctx);
            return { replace: null, remainingReads: new Set() };
        }
        if (live.has(name)) return null;
        const reads = tempReads(assign.right, ctx);
        const rhs = assign.right;
        if (ctx.moved.has(rhs)) {
            // 中间副本直接删除;最终落点若也是死代码,则保留有副作用的表达式
            const isFinalDestination = ctx.moved.get(rhs) === stmt;
            if (!isFinalDestination || isPureExpression(rhs) || isDeclarationValue(rhs)) {
                return { replace: null, remainingReads: new Set() };
            }
            return { replace: expressionStatement(rhs), remainingReads: reads };
        }
        if (isDeclarationValue(rhs)) {
            // 函数/类表达式需要保留,SyntaxRewriteSimplify/ClassSyntaxSimplify 会转成声明
            return { replace: expressionStatement(rhs), remainingReads: reads };
        }
        if (isPureExpression(rhs)) {
            removeRefs(rhs, ctx);
            return { replace: null, remainingReads: new Set() };
        }
        // 调用等有副作用:保留表达式本身
        return { replace: expressionStatement(rhs), remainingReads: reads };
    }
}
