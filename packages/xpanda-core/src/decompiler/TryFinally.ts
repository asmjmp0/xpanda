import * as TYPE from "@babel/types";
import generate from "@babel/generator";
import type { PandaIRCFG } from "../disasm/PandaIRCFG";
import type { PandaIRBasicBlock } from "../disasm/PandaIRBasicBlock";

/**
 * ArkTS 13(字节码 13.0.1.0)的 try/finally 还原。
 *
 * 一些 es2panda 构建把 catch 块的 codeSize 全部写成 0(amcl1.0.6.abc 7422/7422、
 * zhihupp0.59.hap 1359/1359,而 yourpipe0.7.0.abc 是 1845/1846 非 0,abc 版本都是
 * 13.0.1.0,所以这是 SDK/编译器差异而非格式变化)。codeSize 只是 handler 代码范围的
 * 元数据,异常派发只用 handler_pc,所以写 0 不影响执行;但 RegionGraphBuilder 无法
 * 用它界定 handler,会跳过这些 try 块,于是 finally 的异常分支不在区域图里,
 * 线性输出退化成:
 *
 *   <body>
 *   X = hole;                 // try 结束
 *   if (resumeValue == undefined) { cleanup(); }
 *   if (X != hole) throw X;   // finally 收尾
 *
 * 这里不改区域图(把 landing pad 接进图会破坏可归约性),而是在结构化成功后
 * 按 try 表在 AST 上把 [try 起点, cleanup) / [cleanup, rethrow 检查) 重新包成
 * `try { ... } finally { ... }`,并丢掉哨兵赋值与 rethrow 检查。
 *
 * 识别特征(仅处理 codeSize === 0 的 finally try 块):
 *   1. try 结束块含 ldhole,且以 jmp 跳到 handler 的落点(cleanup 起点);
 *   2. handler 入口以 sta 开始,且不以 throw 结束(是 finally 落点而非 catch);
 *   3. cleanup 之后第一个含 ldhole 的条件块是 rethrow 检查,
 *      它的两个后继一个是 throw,另一个是 finally 之后的语句。
 */

export type FinallyRole = "start" | "cleanup" | "guard" | "end" | "suppress";

export interface FinallyPlan {
    id: number;
    startPC: number;
    /** try 的正常完成块(只做寄存器恢复并写 hole 哨兵),输出时整块丢弃 */
    endPC: number;
    cleanupStartPC: number;
    guardStartPC: number;
    guardEndPC: number;
    /** 守卫的正常继续分支就是方法末尾(隐式 return),不需要再补一条 `return;` */
    endIsMethodTail?: boolean;
    /** 守卫 else 分支里的正常继续语句是否搬回 try/finally 之后(24.0.0.0+ 的布局) */
    restoreContinuation?: boolean;
    /** 语句级 try 起点标记 */
    startMarker?: TYPE.Statement;
    /** 对应角色落在条件 test 序列里时的表达式标记(applyFinallyPlans 会提升到包含它的语句) */
    startExpr?: TYPE.Expression;
    cleanupMarker?: TYPE.Statement;
    cleanupExpr?: TYPE.Expression;
    guardMarker?: TYPE.Statement;
    guardExpr?: TYPE.Expression;
    endMarker?: TYPE.Statement;
    endExpr?: TYPE.Expression;
}

export interface FinallyRoleInfo {
    plan: FinallyPlan;
    role: FinallyRole;
}

const MARKER_PREFIX = "__xpanda_finally_marker__";

function isHoleLoad(block: PandaIRBasicBlock): boolean {
    return block.pandaInstructions.some((instruction) => instruction.kind === "load" && instruction.loadType === "HOLE");
}

/** 从 try 表提取 finally 计划;不是 finally 的 try 块返回 null */
export function buildFinallyPlans(cfg: PandaIRCFG): FinallyPlan[] {
    const method = cfg.getPandaMethod();
    if (!method.hasException()) return [];
    const plans: FinallyPlan[] = [];
    const blocks = cfg.pandaIRBasicBlocks;
    for (const tryBlock of method.methodCode!.pandaMethodTryBlocks!) {
        const catchBlock = tryBlock.pandaMethodCatchBlocks[0];
        // 不同 ArkTS 13 编译器版本的 finally handler 会带 `sta vX` 保存异常
        // (codeSize 0/2/3 都出现过);不能按 codeSize 过滤,否则这些 finally 会退化
        // 成 `catch (acc) { if (acc != hole) throw acc }`。
        // 真正的 catch 由下面的结构特征排除:try 结束块必须写 hole 哨兵并跳到 cleanup。
        if (!catchBlock || tryBlock.length === 0) continue;
        const startBlock = cfg.getBasicBlockByPC(tryBlock.startPC);
        const endBlock = cfg.getBasicBlockByPC(tryBlock.startPC + tryBlock.length);
        const handlerBlock = cfg.getBasicBlockByPC(catchBlock.handlerPC);
        if (!startBlock || !endBlock || !handlerBlock) continue;
        if (!isHoleLoad(endBlock)) continue;
        // finally 落点:先 sta 保存异常,再恢复寄存器并落到 cleanup,不会立刻 throw
        if (handlerBlock.pandaInstructions[0]?.kind !== "store") continue;
        const handlerSuccessors = cfg.graph.successors(handlerBlock);
        if (handlerSuccessors.length !== 1 || handlerBlock.getTerminator().kind === "throw") continue;
        const cleanupBlock = handlerSuccessors[0];
        // 正常完成块必须显式跳到 cleanup 起点
        const endTerminator = endBlock.getTerminator();
        if (endTerminator.kind !== "jumpDirect" || endTerminator.destinationPC !== cleanupBlock.getStartPC()) continue;

        // cleanup 之后第一个带 ldhole 的条件块是 rethrow 检查
        let guardBlock: PandaIRBasicBlock | null = null;
        const cleanupIndex = blocks.indexOf(cleanupBlock);
        for (let i = cleanupIndex + 1; i < blocks.length; i++) {
            if (isHoleLoad(blocks[i])) {
                guardBlock = blocks[i];
                break;
            }
        }
        if (!guardBlock) continue;
        const guardSuccessors = cfg.graph.successors(guardBlock);
        if (guardSuccessors.length !== 2) continue;
        if (guardBlock.getTerminator().kind !== "jumpEqual" && guardBlock.getTerminator().kind !== "jumpNotEqual") continue;
        const throwBranch = guardSuccessors.find((successor) => successor.getTerminator().kind === "throw");
        const afterBranch = guardSuccessors.find((successor) => successor !== throwBranch);
        if (!throwBranch || !afterBranch) continue;
        if (!(tryBlock.startPC < endBlock.getStartPC()
            && endBlock.getStartPC() <= cleanupBlock.getStartPC()
            && cleanupBlock.getStartPC() < guardBlock.getStartPC()
            && guardBlock.getStartPC() < afterBranch.getStartPC())) continue;

        plans.push({
            id: plans.length,
            startPC: tryBlock.startPC,
            endPC: endBlock.getStartPC(),
            cleanupStartPC: cleanupBlock.getStartPC(),
            guardStartPC: guardBlock.getStartPC(),
            guardEndPC: afterBranch.getStartPC(),
            endIsMethodTail: isImplicitMethodTail(cfg, afterBranch),
            // 正常继续在 `if (pending != hole) throw else { CONTINUATION }` 的
            // 非抛出分支里。13.0.1.0 的 amcl 与 24+ 都是这个布局;空 else 取出来
            // 仍是空数组。方法尾的隐式 `return undefined` 由 endIsMethodTail 丢掉。
            restoreContinuation: true,
        });
    }
    return plans;
}

/** pc -> (plan, role);同一个 pc 只保留一个角色 */
export function buildFinallyRoles(plans: FinallyPlan[]): Map<number, FinallyRoleInfo> {
    const roles = new Map<number, FinallyRoleInfo>();
    for (const plan of plans) {
        roles.set(plan.startPC, { plan, role: "start" });
        roles.set(plan.endPC, { plan, role: "suppress" });
        roles.set(plan.cleanupStartPC, { plan, role: "cleanup" });
        roles.set(plan.guardStartPC, { plan, role: "guard" });
        roles.set(plan.guardEndPC, { plan, role: "end" });
    }
    return roles;
}

export function createFinallyMarker(plan: FinallyPlan, role: FinallyRole): TYPE.Statement {
    return TYPE.expressionStatement(TYPE.stringLiteral(MARKER_PREFIX + plan.id + "_" + role));
}

export function createFinallyMarkerExpression(plan: FinallyPlan, role: FinallyRole): TYPE.Expression {
    return TYPE.stringLiteral(MARKER_PREFIX + plan.id + "_" + role);
}

export function isFinallyMarker(node: any): boolean {
    return TYPE.isExpressionStatement(node)
        && TYPE.isStringLiteral(node.expression)
        && node.expression.value.startsWith(MARKER_PREFIX);
}

export function isFinallyMarkerExpression(node: any): boolean {
    return TYPE.isStringLiteral(node) && node.value.startsWith(MARKER_PREFIX);
}

/** 找到 try 块 body 正好是给定语句列表的 TryStatement */
function findTryStatementForBlock(root: any, body: TYPE.Statement[]): TYPE.TryStatement | null {
    if (!root || typeof root !== "object" || !root.type) return null;
    if (TYPE.isTryStatement(root) && root.block?.body === body && root.handler) return root;
    for (const key of TYPE.VISITOR_KEYS[root.type] ?? []) {
        const value = root[key];
        if (Array.isArray(value)) {
            for (const item of value) {
                const found = findTryStatementForBlock(item, body);
                if (found) return found;
            }
        } else if (value && typeof value === "object") {
            const found = findTryStatementForBlock(value, body);
            if (found) return found;
        }
    }
    return null;
}

/** 在 statements 数组里查找 target 所在的语句列表 */
function findStatementList(node: any, target: any): TYPE.Statement[] | null {
    if (!node || typeof node !== "object" || !node.type) return null;
    for (const key of TYPE.VISITOR_KEYS[node.type] ?? []) {
        const value = node[key];
        if (Array.isArray(value)) {
            if (value.includes(target)) return value;
            for (const item of value) {
                const found = findStatementList(item, target);
                if (found) return found;
            }
        } else if (value && typeof value === "object") {
            const found = findStatementList(value, target);
            if (found) return found;
        }
    }
    return null;
}

/** target 是否在 node 的子树里(含自身) */
function containsNode(node: any, target: any): boolean {
    if (!node || typeof node !== "object") return false;
    if (node === target) return true;
    if (!node.type) return false;
    for (const key of TYPE.VISITOR_KEYS[node.type] ?? []) {
        const value = node[key];
        if (Array.isArray(value)) {
            for (const item of value) {
                if (containsNode(item, target)) return true;
            }
        } else if (value && typeof value === "object") {
            if (containsNode(value, target)) return true;
        }
    }
    return false;
}

/** 包含 target 的最近一层语句节点(把 test 序列里的标记提升成语句级边界) */
function findEnclosingStatement(root: any, target: any): TYPE.Statement | null {
    let found: TYPE.Statement | null = null;
    const visit = (node: any, lastStatement: TYPE.Statement | null): boolean => {
        if (!node || typeof node !== "object" || !node.type) return false;
        if (node === target) {
            found = lastStatement;
            return true;
        }
        const next = TYPE.isStatement(node) ? node : lastStatement;
        for (const key of TYPE.VISITOR_KEYS[node.type] ?? []) {
            const value = node[key];
            if (Array.isArray(value)) {
                for (const item of value) {
                    if (visit(item, next)) return true;
                }
            } else if (value && typeof value === "object") {
                if (visit(value, next)) return true;
            }
        }
        return false;
    };
    visit(root, null);
    return found;
}

/**
 * 守卫 if 的“非抛出”分支就是 try/finally 之后的正常继续语句。
 * 24.0.0.0 把守卫降级成 `if (sentinel != hole) { throw sentinel } else { <继续> }`,
 * 继续语句被收进 else,删除守卫时必须把它们搬回 try/finally 之后。
 */
/** catch 体是否只是把异常存进临时变量(`v = catchAcc` / `acc = catchAcc; v = acc`)。 */
function catchOnlyStoresException(handler: TYPE.CatchClause): boolean {
    if (!TYPE.isIdentifier(handler.param)) return false;
    const allowed = new Set<string>([handler.param.name]);
    let sawStore = false;
    for (const statement of handler.body.body) {
        if (isFinallyMarker(statement)) continue;
        if (!TYPE.isExpressionStatement(statement) || !TYPE.isAssignmentExpression(statement.expression)) return false;
        const assign = statement.expression;
        if (assign.operator !== "=" || !TYPE.isIdentifier(assign.left) || !TYPE.isIdentifier(assign.right)) return false;
        if (!allowed.has(assign.right.name)) return false;
        allowed.add(assign.left.name);
        sawStore = true;
    }
    return sawStore;
}

function branchStatements(branch: TYPE.Statement | null | undefined): TYPE.Statement[] {
    if (!branch) return [];
    if (TYPE.isBlockStatement(branch)) return branch.body;
    return [branch];
}

function branchEndsWithThrow(branch: TYPE.Statement | null | undefined): boolean {
    if (!branch) return false;
    if (TYPE.isThrowStatement(branch)) return true;
    if (TYPE.isBlockStatement(branch)) {
        const last = branch.body[branch.body.length - 1];
        return !!last && TYPE.isThrowStatement(last);
    }
    return false;
}

function extractGuardContinuation(guard: TYPE.IfStatement): TYPE.Statement[] {
    if (branchEndsWithThrow(guard.consequent) && !branchEndsWithThrow(guard.alternate)) {
        return branchStatements(guard.alternate).slice();
    }
    if (branchEndsWithThrow(guard.alternate) && !branchEndsWithThrow(guard.consequent)) {
        return branchStatements(guard.consequent).slice();
    }
    return [];
}

/**
 * afterBranch 是否是方法末尾的隐式返回(只有寄存器恢复 / `undefined` 载入 / 异步收尾 /
 * `return`)。这种“正常继续”没有源码语句,搬回 try/finally 之后只会多出一条
 * `return undefined;`。
 */
function isImplicitMethodTail(cfg: PandaIRCFG, block: PandaIRBasicBlock): boolean {
    const visited = new Set<any>();
    let current = block;
    for (let depth = 0; depth < 8 && current; depth++) {
        if (visited.has(current)) return false;
        visited.add(current);
        for (const instruction of current.pandaInstructions) {
            const name = instruction.opcode.name;
            if (instruction.kind === "mov" || instruction.kind === "nop" || instruction.kind === "popLexEnv") continue;
            if (instruction.kind === "load" && (instruction.loadType === "UNDEFINED" || instruction.loadType === "HOLE")) continue;
            if (name === "asyncfunctionresolve" || name === "asyncfunctionreject") continue;
            if (instruction.kind === "return") continue;
            return false;
        }
        const terminator = current.getTerminator();
        if (terminator.isReturnIns()) return true;
        if (terminator.isThrowIns() || terminator.isConditional() || !terminator.isJump()) return false;
        const successors = cfg.graph.successors(current);
        if (successors.length !== 1) return false;
        current = successors[0];
    }
    return false;
}

function stripMarkers(node: any): void {
    if (!node || typeof node !== "object" || !node.type) return;
    for (const key of TYPE.VISITOR_KEYS[node.type] ?? []) {
        const value = node[key];
        if (Array.isArray(value)) {
            node[key] = key === "expressions"
                ? value.filter((item) => !isFinallyMarkerExpression(item))
                : value.filter((item) => !isFinallyMarker(item));
            for (const item of node[key]) stripMarkers(item);
        } else if (value && typeof value === "object") {
            stripMarkers(value);
        }
    }
}

/**
 * 把一个角色标记解析成语句列表位置:
 *  - 语句标记:标记自身所在列表的下标;
 *  - 表达式标记(条件 test 序列):包含它的语句及其所在列表的下标。
 */
interface MarkerPosition {
    list: TYPE.Statement[];
    index: number;
    /** true 表示标记在 test 序列里,index 指向包含它的整条语句 */
    inExpression: boolean;
}

function locateMarker(
    astNode: any,
    statementMarker: TYPE.Statement | undefined,
    expressionMarker: TYPE.Expression | undefined,
): MarkerPosition | null {
    if (statementMarker) {
        const list = findStatementList(astNode, statementMarker);
        if (!list) return null;
        const index = list.indexOf(statementMarker);
        return index < 0 ? null : { list, index, inExpression: false };
    }
    if (expressionMarker) {
        const owner = findEnclosingStatement(astNode, expressionMarker);
        if (!owner) return null;
        const list = findStatementList(astNode, owner);
        if (!list) return null;
        const index = list.indexOf(owner);
        return index < 0 ? null : { list, index, inExpression: true };
    }
    return null;
}

/**
 * 在函数体 AST 上把标记区间替换成 try/finally;失败时清掉标记并留下注释。
 *
 * 两种布局:
 *  1. try 起点 / cleanup / guard 在同一层语句列表(常规);
 *  2. try 起点落在某个条件 test 的求值区(第一个块就是可选链比较),
 *     cleanup/guard 也可能被结构化进 test 或最后一个分支的尾部:
 *     此时用表达式标记定位到包含它的语句,并在尾部分支情形把 finally 上提。
 */
export function applyFinallyPlans(astNode: any, plans: FinallyPlan[]): void {
    let failed = 0;
    for (const plan of plans) {
        let applied = false;
        left: {
            // ---- try 体起点 ----
            const start = locateMarker(astNode, plan.startMarker, plan.startExpr);
            if (!start) break left;
            const startList = start.list;
            const tryStart = start.inExpression ? start.index : start.index + 1;

            // ---- cleanup / guard ----
            const cleanupPos = locateMarker(astNode, plan.cleanupMarker, plan.cleanupExpr);
            if (!cleanupPos) break left;
            const cleanupList = cleanupPos.list;
            const cleanup = cleanupPos.index;
            // cleanup 落在 test 序列里时,包含它的整条语句(通常是 `if (sentinel === undefined) { cleanup }`)
            // 都属于 finally 体,不能只从它的下一条开始。
            const finallyStart = cleanupPos.inExpression ? cleanup : cleanup + 1;

            const guardPos = locateMarker(astNode, plan.guardMarker, plan.guardExpr);
            if (!guardPos || guardPos.list !== cleanupList) break left;
            const guard = guardPos.index;
            if (cleanup < 0 || guard <= cleanup) break left;

            // 守卫语句(if (sentinel != hole) throw sentinel)可能把“之后”的块收进
            // else 分支,此时 endMarker 不在同一层。以守卫本身(第一个 IfStatement)
            // 为删除边界,同时删掉它前面的哨兵比较语句。
            // 24.0.0.0 的 if/else 形状(`if (X != hole) { throw X } else { <正常继续> }`)
            // 要把 else 里的正常继续语句搬回 try/finally 之后,不能整条 if 丢掉,
            // 否则 try/finally 后面的代码会整体消失(exportLogs 的成功返回路径)。
            let guardEnd: number;
            let guardContinuation: TYPE.Statement[] = [];
            if (guardPos.inExpression) {
                // 表达式标记所在的语句就是守卫检查本身
                guardEnd = guard + 1;
            } else {
                guardEnd = guard + 1;
                while (guardEnd < cleanupList.length && !TYPE.isIfStatement(cleanupList[guardEnd])) guardEnd++;
                if (guardEnd < cleanupList.length && TYPE.isIfStatement(cleanupList[guardEnd])) {
                    const guardStatement = cleanupList[guardEnd] as TYPE.IfStatement;
                    guardContinuation = extractGuardContinuation(guardStatement);
                    guardEnd++;
                } else {
                    const end = locateMarker(astNode, plan.endMarker, plan.endExpr);
                    if (!end || end.list !== cleanupList || end.index <= guard) break left;
                    guardEnd = end.index;
                }
            }
            // 非抛出分支是正常继续。方法尾只有隐式 return 时不搬回来。
            // 守卫后面已经有语句时,那些语句才是正常继续,else 里的是副本,搬出来会
            // 盖住后面的赋值(amcl i8 的 `v11 = v6`)。
            if (!plan.restoreContinuation || plan.endIsMethodTail || guardEnd < cleanupList.length) {
                guardContinuation = [];
            }
            // else 里还夹着 hole 哨兵比较时,那不是干净的正常继续,搬出来会把
            // 已经在 try 里的尾部再贴一份(amcl i8 的复制校验)。
            if (guardContinuation.some((statement) => generate(statement).code.includes("hole"))) {
                guardContinuation = [];
            }

            const finallyStatements = cleanupList.slice(finallyStart, guard);
            // try/catch 布局:结构化分析已经把 finally handler 生成成了
            // `try { <start> ... } catch (acc) { <cleanup> ... <guard> }`
            // (try 表里同一个 try 起点既有真正的 catch、又有 finally handler 时
            // 就会这样)。start 在 TryStatement 的 try 块里、cleanup/guard 在它的
            // handler 块里,直接改写成 try/finally,sentinel 保存与重抛守卫整段丢弃。
            const tryOwner = findTryStatementForBlock(astNode, startList);
            if (tryOwner && tryOwner.handler && tryOwner.handler.body.body === cleanupList) {
                const tryStatements = startList.slice(tryStart);
                const tryNode = TYPE.tryStatement(
                    TYPE.blockStatement(tryStatements),
                    null,
                    TYPE.blockStatement(finallyStatements),
                );
                const parentList = findStatementList(astNode, tryOwner);
                const parentIndex = parentList ? parentList.indexOf(tryOwner) : -1;
                if (parentIndex < 0) break left;
                parentList!.splice(parentIndex, 1, tryNode, ...guardContinuation);
                applied = true;
            } else if (tryOwner && tryOwner.handler && cleanupList !== startList) {
                // 用户 catch 在 try 范围内终止,finally 的 cleanup/guard 落在这条
                // try/catch 后面(f1268 写文件:catch 打日志再抛,close 在范围外)。
                // 只有 cleanup 标记紧跟这条 try 时才包一层 try/finally。
                const parentList = findStatementList(astNode, tryOwner);
                const parentIndex = parentList ? parentList.indexOf(tryOwner) : -1;
                if (!parentList || parentList !== cleanupList || parentIndex < 0
                    || cleanup !== parentIndex + 1 || finallyStart > guard) break left;
                const finallyStatements = cleanupList.slice(finallyStart, guard);
                if (finallyStatements.length === 0) break left;
                let continuation = guardContinuation;
                let removeThrough = guardEnd;
                const guardStatement = cleanupList[guardEnd - 1];
                const afterGuard = cleanupList[guardEnd];
                if (continuation.length === 0 && guardStatement && TYPE.isIfStatement(guardStatement)
                    && !guardStatement.alternate && afterGuard && TYPE.isThrowStatement(afterGuard)
                    && !branchEndsWithThrow(guardStatement.consequent)) {
                    // `if (pending == hole) { CONTINUATION } throw pending`
                    continuation = branchStatements(guardStatement.consequent).slice();
                    removeThrough = guardEnd + 1;
                }
                if (plan.endIsMethodTail) continuation = [];
                // catch 里只有 `v = catchAcc` 时,那是 finally 的异常保存,重抛在守卫里。
                // 丢掉这个 catch,异常由 try/finally 自己继续抛(SabrOfflineDownloader
                // 的 release)。用户 catch(打日志再抛)保留。
                const tryBlock = catchOnlyStoresException(tryOwner.handler)
                    ? tryOwner.block
                    : TYPE.blockStatement([tryOwner]);
                const wrapped = TYPE.tryStatement(
                    tryBlock,
                    null,
                    TYPE.blockStatement(finallyStatements),
                );
                parentList.splice(parentIndex, removeThrough - parentIndex, wrapped, ...continuation);
                applied = true;
            } else if (cleanupList === startList) {
                // 常规布局:try 体 = [tryStart, cleanup),守卫之后是 try/finally 之后的语句
                if (!(cleanup > tryStart)) break left;
                const tryStatements = startList.slice(tryStart, cleanup);
                const tryNode = TYPE.tryStatement(
                    TYPE.blockStatement(tryStatements),
                    null,
                    TYPE.blockStatement(finallyStatements),
                );
                startList.splice(tryStart, guardEnd - tryStart, tryNode, ...guardContinuation);
                applied = true;
            } else {
                // 折叠布局:只有整段 finally 都在嵌套列表尾部、且该嵌套列表的顶层语句
                // 是 startList 的最后一条时,才能把 finally 整体上提。
                if (guardEnd !== cleanupList.length) break left;
                const owner = startList[startList.length - 1];
                const cleanupAnchor = plan.cleanupMarker ?? plan.cleanupExpr;
                if (!owner || !cleanupAnchor || !containsNode(owner, cleanupAnchor)) break left;
                const tryStatements = startList.slice(tryStart);
                cleanupList.splice(cleanup, guardEnd - cleanup);
                const tryNode = TYPE.tryStatement(
                    TYPE.blockStatement(tryStatements),
                    null,
                    TYPE.blockStatement(finallyStatements),
                );
                startList.splice(tryStart, startList.length - tryStart, tryNode, ...guardContinuation);
                applied = true;
            }
        }
        if (!applied) failed++;
    }
    if (failed > 0) {
        // 兜底:无法还原时留一条注释,避免 finally 静默消失
        const statement = TYPE.emptyStatement();
        TYPE.addComment(statement, "leading", " xpanda: try/finally not restored ", false);
        if (Array.isArray(astNode.body)) astNode.body.push(statement);
    }
    stripMarkers(astNode);
}

export function stripFinallyMarkers(astNode: any): void {
    stripMarkers(astNode);
}
