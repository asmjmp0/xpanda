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
        const handlerSuccessors = cfg.graph.normalSuccessors(handlerBlock);
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
        const guardSuccessors = cfg.graph.normalSuccessors(guardBlock);
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

/** list 里直接包含 target 的语句下标(没有则 -1) */
function findStatementIndexContaining(list: TYPE.Statement[], target: any): number {
    for (let index = 0; index < list.length; index++) {
        const item = list[index];
        if (item && typeof item === "object" && TYPE.isStatement(item) && containsNode(item, target)) return index;
    }
    return -1;
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

interface GuardContinuation {
    statements: TYPE.Statement[];
    /** 由 end 标记切出来的尾段:它明确位于 afterBranch 之后,不再做 hole 检查 */
    fromEndMarker: boolean;
}

function extractGuardContinuation(guard: TYPE.IfStatement, endMarker: string | null): GuardContinuation {
    // 守卫的 else 可能一直延伸到方法尾,里面还嵌着后面的 try/finally(n1195):
    // end 标记就在该分支里,标记之后才是真正的正常继续。整段 else 直接搬出来会把
    // 守卫自身的哨兵比较和后续 finally 的 hole 判断混进来,甚至两端都以 throw
    // 结束而整段丢弃。
    const splitAtEnd = (branch: TYPE.Statement | null | undefined): TYPE.Statement[] | null => {
        if (!endMarker) return null;
        const statements = branchStatements(branch);
        const index = statements.findIndex((statement) => TYPE.isExpressionStatement(statement)
            && TYPE.isStringLiteral(statement.expression) && statement.expression.value === endMarker);
        return index >= 0 ? statements.slice(index + 1) : null;
    };
    const fromConsequent = splitAtEnd(guard.consequent);
    if (fromConsequent) return { statements: fromConsequent, fromEndMarker: true };
    const fromAlternate = splitAtEnd(guard.alternate);
    if (fromAlternate) return { statements: fromAlternate, fromEndMarker: true };
    if (branchEndsWithThrow(guard.consequent) && !branchEndsWithThrow(guard.alternate)) {
        return { statements: branchStatements(guard.alternate).slice(), fromEndMarker: false };
    }
    if (branchEndsWithThrow(guard.alternate) && !branchEndsWithThrow(guard.consequent)) {
        return { statements: branchStatements(guard.consequent).slice(), fromEndMarker: false };
    }
    return { statements: [], fromEndMarker: false };
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
        const successors = cfg.graph.normalSuccessors(current);
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
    /** true 表示按基本块 pc 反查到的 try 体首条语句(index 就是 try 体起点) */
    byPC?: boolean;
}

/**
 * 按 pc 反查 try 体起点:取第一条来源于 `[plan.startPC, plan.cleanupStartPC)` 的语句。
 *
 * 只在 start 标记丢失时使用。`MethodHandler.statementBlockPC` 记录了每条 emit 出来的
 * 语句来自哪个基本块(区域复制会产生多条同 pc 语句),所以 pc 落在 try 保护范围内的
 * 最早一条语句就是 try 体起点;它所在的列表就是 try 体列表。
 */
function locateTryStartByPC(
    astNode: any,
    context: FinallyContext | undefined,
    plan: FinallyPlan,
): MarkerPosition | null {
    const statementPC = context?.statementPC;
    if (!statementPC) return null;
    let best: { list: TYPE.Statement[]; index: number; pc: number } | null = null;
    const visit = (node: any): void => {
        if (!node || typeof node !== "object" || !node.type) return;
        for (const key of TYPE.VISITOR_KEYS[node.type] ?? []) {
            const value = node[key];
            if (!Array.isArray(value)) { visit(value); continue; }
            const list = value as any[];
            for (let index = 0; index < list.length; index++) {
                const item = list[index];
                if (!item || typeof item !== "object" || !item.type) continue;
                if (!TYPE.isStatement(item)) { visit(item); continue; }
                const pc = statementPC.get(item);
                if (pc !== undefined && pc >= plan.startPC && pc < plan.cleanupStartPC) {
                    if (!best || pc < best.pc) best = { list: list as TYPE.Statement[], index, pc };
                }
                visit(item);
            }
        }
    };
    visit(astNode);
    return best ? { list: best.list, index: best.index, inExpression: false, byPC: true } : null;
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

/** 尾段开头几层就是另一个哨兵重抛守卫(区域复制留下的重复段,i8) */
function startsWithSentinelGuard(statements: TYPE.Statement[]): boolean {
    const head = statements.slice(0, 8);
    const code = head.map((statement) => generate(statement).code).join("\n");
    return /\bhole\b/.test(code) && /\bthrow\b/.test(code);
}

/** 尾段里是否有比当前 plan 更外层的 plan 标记(外层 finally 的正常继续) */
function hasEnclosingPlanMarker(statements: TYPE.Statement[], plans: FinallyPlan[], current: FinallyPlan): boolean {
    const starts = new Map(plans.map((plan) => [plan.id, plan.startPC]));
    let found = false;
    const visit = (node: any): void => {
        if (found || !node || typeof node !== "object" || !node.type) return;
        if (TYPE.isStringLiteral(node) && node.value.startsWith(MARKER_PREFIX)) {
            const id = Number(node.value.slice(MARKER_PREFIX.length).split("_")[0]);
            const startPC = starts.get(id);
            if (startPC !== undefined && startPC < current.startPC) found = true;
            return;
        }
        for (const key of TYPE.VISITOR_KEYS[node.type] ?? []) {
            const value = node[key];
            if (Array.isArray(value)) value.forEach(visit);
            else visit(value);
        }
    };
    statements.forEach(visit);
    return found;
}

/**
 * finally 的结构元数据(方法级):try 体范围与 cleanup/guard 的 pc。
 * 区域归约后 AST 布局可能丢信息,这里保留字节码侧的事实。
 */
export interface FinallyStructure {
    planId: number;
    tryStartPC: number;
    /** try 正常完成块(写 hole 的 suppress 块) */
    tryEndPC: number;
    cleanupStartPC: number;
    guardStartPC: number;
    guardEndPC: number;
}

/** applyFinallyPlans 的上下文:结构表 + 语句到来源基本块 pc 的映射 */
export interface FinallyContext {
    structures: FinallyStructure[];
    /** 反编译时 emit 的语句 → 来源基本块起始 pc(区域复制会产生多条同 pc 语句) */
    statementPC: WeakMap<object, number>;
    /** 结构化分析产出的 try 语句 → try 表里该 try 保护范围的结束 pc */
    tryBodyEndPC?: WeakMap<object, number>;
}


/** 跑一遍计划;失败的 plan 连同原因返回(retry 非空时只重试这些 plan)。 */
function applyPlans(
    astNode: any,
    plans: FinallyPlan[],
    context: FinallyContext | undefined,
    /** 只重试这些 plan(尾块去重之后);null 表示全部 */
    retry: Set<FinallyPlan> | null,
): Map<FinallyPlan, string> {
    const failures = new Map<FinallyPlan, string>();
    for (const plan of plans) {
        if (retry && !retry.has(plan)) continue;
        let applied = false;
        let reason = "unknown";
        left: {
            // ---- try 体起点 ----
            // 标记可能根本没插上:try 起点块被区域归约合进别的语句、或被结构化进
            // 条件 test 后标记丢失。此时按基本块 pc 反查第一条来源于
            // [startPC, cleanupStartPC) 的语句,它就是 try 体的第一句。
            const start = locateMarker(astNode, plan.startMarker, plan.startExpr)
                ?? locateTryStartByPC(astNode, context, plan);
            if (!start) { reason = "start marker not found"; break left; }
            const startList = start.list;
            const tryStart = start.byPC ? start.index : (start.inExpression ? start.index : start.index + 1);

            // ---- cleanup / guard ----
            const cleanupPos = locateMarker(astNode, plan.cleanupMarker, plan.cleanupExpr);
            if (!cleanupPos) { reason = "cleanup marker not found"; break left; }
            // 按 pc 反查只在“常规布局”(try 体与 cleanup 在同一层语句列表)里可信:
            // 跨列表时起点多半不是真正的 try 体首条语句,硬套会切错范围
            // (amcl commons/p1 的 i49 曾因此把条件 test 里的函数表达式切断)。
            if (start.byPC && cleanupPos.list !== start.list) {
                reason = "pc-located start in another list"; break left;
            }
            const cleanupList = cleanupPos.list;
            const cleanup = cleanupPos.index;
            // cleanup 落在 test 序列里时,包含它的整条语句(通常是 `if (sentinel === undefined) { cleanup }`)
            // 都属于 finally 体,不能只从它的下一条开始。
            const finallyStart = cleanupPos.inExpression ? cleanup : cleanup + 1;

            const guardPos = locateMarker(astNode, plan.guardMarker, plan.guardExpr);
            if (!guardPos || guardPos.list !== cleanupList) { reason = "guard marker missing or in another list"; break left; }
            const guard = guardPos.index;
            if (cleanup < 0 || guard <= cleanup) { reason = "cleanup/guard order"; break left; }

            // 守卫语句(if (sentinel != hole) throw sentinel)可能把“之后”的块收进
            // else 分支,此时 endMarker 不在同一层。以守卫本身(第一个 IfStatement)
            // 为删除边界,同时删掉它前面的哨兵比较语句。
            // 24.0.0.0 的 if/else 形状(`if (X != hole) { throw X } else { <正常继续> }`)
            // 要把 else 里的正常继续语句搬回 try/finally 之后,不能整条 if 丢掉,
            // 否则 try/finally 后面的代码会整体消失(exportLogs 的成功返回路径)。
            let guardEnd: number;
            let guardContinuation: TYPE.Statement[] = [];
            let continuationFromEndMarker = false;
            if (guardPos.inExpression) {
                // 表达式标记所在的语句就是守卫检查本身
                guardEnd = guard + 1;
            } else {
                guardEnd = guard + 1;
                while (guardEnd < cleanupList.length && !TYPE.isIfStatement(cleanupList[guardEnd])) guardEnd++;
                if (guardEnd < cleanupList.length && TYPE.isIfStatement(cleanupList[guardEnd])) {
                    const guardStatement = cleanupList[guardEnd] as TYPE.IfStatement;
                    const endMarkerValue = plan.endMarker && TYPE.isExpressionStatement(plan.endMarker)
                        && TYPE.isStringLiteral(plan.endMarker.expression) ? plan.endMarker.expression.value
                        : (plan.endExpr && TYPE.isStringLiteral(plan.endExpr) ? plan.endExpr.value : null);
                    const extracted = extractGuardContinuation(guardStatement, endMarkerValue);
                    guardContinuation = extracted.statements;
                    continuationFromEndMarker = extracted.fromEndMarker;
                    guardEnd++;
                } else {
                    const end = locateMarker(astNode, plan.endMarker, plan.endExpr);
                    if (!end || end.list !== cleanupList || end.index <= guard) { reason = "no usable end marker"; break left; }
                    guardEnd = end.index;
                }
            }
            // 非抛出分支是正常继续。方法尾只有隐式 return 时不搬回来。
            // 守卫后面已经有语句时,那些语句才是正常继续,else 里的是副本,搬出来会
            // 盖住后面的赋值(amcl i8 的 `v11 = v6`)。
            if (!plan.restoreContinuation || plan.endIsMethodTail || guardEnd < cleanupList.length) {
                guardContinuation = [];
            }
            // else 里还夹着 hole 哨兵比较时,多数是区域复制把尾部又抄了一份
            // (amcl i8 的复制校验),搬出来会重复执行。两种例外:
            //  - 按 end 标记切出来的尾段(标记之后就是 afterBranch):只有开头立刻又是
            //    一个哨兵重抛守卫才是重复段(n1195 的尾段里嵌着下一个 finally,不丢);
            //  - 尾段里带着更外层 plan 的标记:那是外层 finally 的正常继续(q17 的嵌套
            //    try/finally),搬出来才能让外层 finally 继续还原。
            if (continuationFromEndMarker) {
                if (startsWithSentinelGuard(guardContinuation)) guardContinuation = [];
            } else if (!hasEnclosingPlanMarker(guardContinuation, plans, plan)
                && guardContinuation.some((statement) => generate(statement).code.includes("hole"))) {
                guardContinuation = [];
            }

            const finallyStatements = cleanupList.slice(finallyStart, guard);
            // try/catch 布局:结构化分析已经把 finally handler 生成成了
            // `try { <start> ... } catch (acc) { <cleanup> ... <guard> }`
            // (try 表里同一个 try 起点既有真正的 catch、又有 finally handler 时
            // 就会这样)。start 在 TryStatement 的 try 块里、cleanup/guard 在它的
            // handler 块里,直接改写成 try/finally,sentinel 保存与重抛守卫整段丢弃。
            const tryOwner = findTryStatementForBlock(astNode, startList);
            // catch 在 finally 里面还是外面,由 try 表里两者的保护范围决定:
            // catch 的范围在 cleanup 之前结束 => catch 嵌在 finally 里
            // (源码 `try { … } catch { … } finally { … }`),必须写成
            // try/catch/finally;否则 finally 嵌在 catch 所在的 try 体里(常规布局)。
            const catchEndPC = tryOwner && context?.tryBodyEndPC ? context.tryBodyEndPC.get(tryOwner) : undefined;
            const catchInsideFinally = catchEndPC !== undefined && catchEndPC <= plan.cleanupStartPC;
            // 折叠布局里 cleanup/guard 可能被区域复制进 try 体的多条分支分支尾
            // (g10)。每一份都只是“正常完成路径”上的同一段收尾,把它们统一上提到
            // try 体末尾只留一份,等价于每条分支末尾 goto 到同一条收尾:分支走到
            // 末尾本来就会继续执行后面的语句,所以不需要真的发 goto。
            const bodyTailCopies = tryOwner && tryOwner.block.body === startList
                ? collectFinallyTailCopies(tryOwner.block, plan)
                : null;
            if (tryOwner && tryOwner.handler && cleanupList === startList && catchInsideFinally) {
                // cleanup/guard 落在 try 体尾部:两条分支共享、必定退出的尾块被
                // hoistDuplicatedFinallyTails 提到 if 之后,finally 的 cleanup 就成了
                // try 体内最后一段语句(amcl g9 的 executeInstall)。这里必须把现有
                // try/catch 直接改写成 try/catch/finally:catch 先于 finally 执行,
                // 在 try 体内部再套一层 try/finally 会把顺序反过来(cleanup 抢在
                // catch 记录失败之前跑)。
                if (!(cleanup > tryStart)) { reason = "empty try body"; break left; }
                if (finallyStatements.length === 0) { reason = "empty finally body"; break left; }
                const parentList = findStatementList(astNode, tryOwner);
                const parentIndex = parentList ? parentList.indexOf(tryOwner) : -1;
                if (!parentList || parentIndex < 0) { reason = "no parent list"; break left; }
                // 守卫之后如果还有语句,它们是 try/finally 之后的正常继续
                const afterGuard = startList.slice(guardEnd);
                startList.length = cleanup;
                tryOwner.finalizer = TYPE.blockStatement(finallyStatements);
                parentList.splice(parentIndex + 1, 0, ...guardContinuation, ...afterGuard);
                applied = true;
            } else if (tryOwner && tryOwner.handler && tryOwner.handler.body.body === cleanupList) {
                const tryStatements = startList.slice(tryStart);
                const tryNode = TYPE.tryStatement(
                    TYPE.blockStatement(tryStatements),
                    null,
                    TYPE.blockStatement(finallyStatements),
                );
                const parentList = findStatementList(astNode, tryOwner);
                const parentIndex = parentList ? parentList.indexOf(tryOwner) : -1;
                if (parentIndex < 0) { reason = "no parent list"; break left; }
                parentList!.splice(parentIndex, 1, tryNode, ...guardContinuation);
                applied = true;
            } else if (tryOwner && tryOwner.handler && bodyTailCopies
                && (catchInsideFinally || catchEndPC === undefined)) {
                // 用户 catch + 折叠布局:cleanup/guard 被结构化进 try 体的分支尾部,
                // cleanup 直接挂到已有 try/catch 的 finally 上(catch 必须先于 finally
                // 执行,在 try 体里再套一层 try/finally 会把顺序反过来:n8 的 start)。
                const finalizer = bodyTailCopies[0].body;
                if (finalizer.length === 0) { reason = "empty finally body"; break left; }
                const reference = finalizer.map((statement) => generate(statement).code).join("\n");
                if (bodyTailCopies.some((copy) => copy.body.map((statement) => generate(statement).code).join("\n") !== reference)) {
                    reason = "cleanup copies differ"; break left;
                }
                const parentList = findStatementList(astNode, tryOwner);
                const parentIndex = parentList ? parentList.indexOf(tryOwner) : -1;
                if (!parentList || parentIndex < 0) { reason = "no parent list"; break left; }
                const perList = new Map<TYPE.Statement[], FinallyTailCopy[]>();
                for (const copy of bodyTailCopies) {
                    const group = perList.get(copy.list) ?? [];
                    group.push(copy);
                    perList.set(copy.list, group);
                }
                for (const [list, group] of perList) {
                    group.sort((a, b) => b.start - a.start);
                    for (const copy of group) list.splice(copy.start, copy.end - copy.start);
                }
                tryOwner.finalizer = TYPE.blockStatement(finalizer);
                parentList.splice(parentIndex + 1, 0, ...guardContinuation);
                applied = true;
            } else if (tryOwner && tryOwner.handler && cleanupList !== startList) {
                // 用户 catch 在 try 范围内终止,finally 的 cleanup/guard 落在这条
                // try/catch 后面(f1268 写文件:catch 打日志再抛,close 在范围外)。
                // 只有 cleanup 标记紧跟这条 try 时才包一层 try/finally。
                const parentList = findStatementList(astNode, tryOwner);
                const parentIndex = parentList ? parentList.indexOf(tryOwner) : -1;
                if (!parentList || parentList !== cleanupList || parentIndex < 0
                    || cleanup !== parentIndex + 1 || finallyStart > guard) { reason = "cleanup not right after the try/catch"; break left; }
                const finallyStatements = cleanupList.slice(finallyStart, guard);
                if (finallyStatements.length === 0) { reason = "empty finally body"; break left; }
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
                if (!(cleanup > tryStart)) { reason = "empty try body"; break left; }
                const tryStatements = startList.slice(tryStart, cleanup);
                const tryNode = TYPE.tryStatement(
                    TYPE.blockStatement(tryStatements),
                    null,
                    TYPE.blockStatement(finallyStatements),
                );
                startList.splice(tryStart, guardEnd - tryStart, tryNode, ...guardContinuation);
                applied = true;
            } else if (plan.startMarker && !start.byPC && !start.inExpression && start.index === 0) {
                // 起始标记落在嵌套语句的头部:try 体的第一个基本块就是循环头
                // (`try { do { … } while (…) } finally { … }`),结构化后标记被插在
                // do-while 循环体的首条。try 体因此是 cleanupList 里从“包含标记的
                // 那条语句”到 cleanup 前的整段,而不是标记所在列表的后续语句。
                const ownerIndex = findStatementIndexContaining(cleanupList, plan.startMarker);
                if (ownerIndex < 0 || cleanup <= ownerIndex) { reason = "nested start owner not found"; break left; }
                const tryStatements = cleanupList.slice(ownerIndex, cleanup);
                const tryNode = TYPE.tryStatement(
                    TYPE.blockStatement(tryStatements),
                    null,
                    TYPE.blockStatement(finallyStatements),
                );
                cleanupList.splice(ownerIndex, guardEnd - ownerIndex, tryNode, ...guardContinuation);
                applied = true;
            } else {
                // 折叠布局:只有整段 finally 都在嵌套列表尾部、且该嵌套列表的顶层语句
                // 是 startList 的最后一条时,才能把 finally 整体上提。
                if (guardEnd !== cleanupList.length) { reason = "guard not at list tail"; break left; }
                const owner = startList[startList.length - 1];
                const cleanupAnchor = plan.cleanupMarker ?? plan.cleanupExpr;
                if (!owner || !cleanupAnchor || !containsNode(owner, cleanupAnchor)) { reason = "cleanup not inside last statement"; break left; }
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
        if (!applied) failures.set(plan, reason);
    }
    return failures;
}

/**
 * 在函数体 AST 上把标记区间替换成 try/finally;失败时清掉标记并留下注释。
 *
 * 两种布局:
 *  1. try 起点 / cleanup / guard 在同一层语句列表(常规);
 *  2. try 起点落在某个条件 test 的求值区(第一个块就是可选链比较),
 *     cleanup/guard 也可能被结构化进 test 或最后一个分支的尾部:
 *     此时用表达式标记定位到包含它的语句,并在尾部分支情形把 finally 上提。
 *
 * 两种布局都失败时,说明 cleanup/guard 被复制进了 if 的多条分支:先做一次
 * 尾块去重(hoistDuplicatedFinallyTails)再重试,仍不成功则回滚去重。
 */
export function applyFinallyPlans(astNode: any, plans: FinallyPlan[], context?: FinallyContext): void {
    const failures = applyPlans(astNode, plans, context, null);
    // cleanup / guard 可能被共享尾块复制进了 if 的两条分支(区域归约把“必定退出”的
    // 尾块按引用展开到每条归约路径上,见 hoistDuplicatedFinallyTails)。先做一次
    // AST 级尾块去重,再重试失败的 plan;仍然还原不了就整体回滚,
    // 去重本身只为还原 finally 服务,不留副作用(amcl commons/p1 的 i49 保持原输出)。
    if (failures.size > 0) {
        const firstReasons = new Map(failures);
        const retry = new Set(failures.keys());
        const touched = new Map<TYPE.Statement[], TYPE.Statement[]>();
        if (hoistDuplicatedFinallyTails(astNode, Array.from(retry), touched)) {
            const retried = applyPlans(astNode, plans, context, retry);
            if (retried.size === retry.size) {
                for (const [list, saved] of touched) {
                    list.length = 0;
                    list.push(...saved);
                }
                failures.clear();
                for (const [plan, reason] of firstReasons) failures.set(plan, reason);
            } else {
                failures.clear();
                for (const [plan, reason] of retried) failures.set(plan, reason);
            }
        }
    }
    if (failures.size > 0) {
        // 兜底:无法还原时留一条注释,避免 finally 静默消失。
        // 带上 plan 的 pc 与失败原因,便于后续定位(不影响可执行语义)。
        const detail = Array.from(failures).map(([plan, reason]) =>
            `plan ${plan.id}: start=${plan.startPC} end=${plan.endPC}`
            + ` cleanup=${plan.cleanupStartPC} guard=${plan.guardStartPC} (${reason})`);
        const statement = TYPE.emptyStatement();
        TYPE.addComment(statement, "leading",
            ` xpanda: try/finally not restored${context ? ` [${detail.join("; ")}]` : ""} `, false);
        if (Array.isArray(astNode.body)) astNode.body.push(statement);
    }
    stripMarkers(astNode);
}

export function stripFinallyMarkers(astNode: any): void {
    stripMarkers(astNode);
}

// ---------------------------------------------------------------------------
// 共享尾块去重(cleanup / guard 被复制进 if 的多条分支时的补救)
// ---------------------------------------------------------------------------

interface MarkerOccurrence {
    /** 标记所在的语句列表 */
    list: TYPE.Statement[];
    /** 标记所在语句在 list 中的下标(表达式标记时是包含它的整条语句) */
    index: number;
    /** 从根到该语句列表的父链:每项是“包含下一层语句列表”的那条语句 */
    chain: Array<{ list: TYPE.Statement[]; index: number }>;
}

function markerValue(plan: FinallyPlan, role: FinallyRole): string {
    return MARKER_PREFIX + plan.id + "_" + role;
}

/** 计划的 cleanup 标记值(语句标记或 test 序列里的表达式标记) */
function cleanupMarkerValueOf(plan: FinallyPlan): string {
    if (plan.cleanupMarker && TYPE.isExpressionStatement(plan.cleanupMarker)
        && TYPE.isStringLiteral(plan.cleanupMarker.expression)) return plan.cleanupMarker.expression.value;
    if (plan.cleanupExpr && TYPE.isStringLiteral(plan.cleanupExpr)) return plan.cleanupExpr.value;
    return "";
}

/** 折叠布局里的一段 finally 收尾副本(cleanup 标记 → guard 语句,正好走到列表末尾) */
interface FinallyTailCopy {
    list: TYPE.Statement[];
    start: number;
    end: number;
    /** cleanup 之后、guard 之前的语句(即 finally 体) */
    body: TYPE.Statement[];
}

/**
 * 收集 try 体里所有“finally 收尾尾块”的副本。
 *
 * ArkTS 会把 finally 内联到每一条正常出口前,区域归约再把这段尾块按分支引用展开,
 * 于是同一段 `cleanup; if (pending != hole) throw` 会出现在多条分支的末尾
 * (g10 的嵌套 if)。这些副本都只是同一个收尾:分支走到末尾会继续执行后面的语句,
 * 所以把每一份都摘掉、只留一份上提到 try 体末尾,等价于每条分支末尾 goto 到同一段
 * 收尾(前向跳转,天然由 fall-through 实现,不需要真的发 goto)。
 *
 * 只在“这份副本从 cleanup 标记到 guard 语句正好走到列表末尾、且不嵌在循环里”时
 * 才可摘除:这样每条路径最多执行它一次,上提后仍然恰好一次。任何一份不满足
 * (中间还有别的语句、在循环体里、cleanup 落在条件 test 序列里)就整体放弃。
 */
function collectFinallyTailCopies(root: any, plan: FinallyPlan): FinallyTailCopy[] | null {
    const cleanupValue = cleanupMarkerValueOf(plan);
    if (cleanupValue.length === 0) return null;
    let guardValue = "";
    if (plan.guardMarker && TYPE.isExpressionStatement(plan.guardMarker)
        && TYPE.isStringLiteral(plan.guardMarker.expression)) guardValue = plan.guardMarker.expression.value;
    else if (plan.guardExpr && TYPE.isStringLiteral(plan.guardExpr)) guardValue = plan.guardExpr.value;
    if (guardValue.length === 0) return null;

    const copies: FinallyTailCopy[] = [];
    const walk = (node: any, insideLoop: boolean): boolean => {
        if (!node || typeof node !== "object" || !node.type) return true;
        const nextInsideLoop = insideLoop || isLoopStatement(node);
        for (const key of TYPE.VISITOR_KEYS[node.type] ?? []) {
            const value = node[key];
            if (!Array.isArray(value)) {
                if (!walk(value, nextInsideLoop)) return false;
                continue;
            }
            const list = value as any[];
            for (let index = 0; index < list.length; index++) {
                const item = list[index];
                if (!item || typeof item !== "object" || !item.type) continue;
                if (!TYPE.isStatement(item)) {
                    if (!walk(item, nextInsideLoop)) return false;
                    continue;
                }
                if (TYPE.isExpressionStatement(item) && TYPE.isStringLiteral(item.expression)
                    && item.expression.value === cleanupValue) {
                    if (nextInsideLoop) return false;
                    let guardIndex = -1;
                    for (let next = index; next < list.length; next++) {
                        if (containsOwnMarker(list[next], guardValue)) { guardIndex = next; break; }
                    }
                    if (guardIndex < 0) return false;
                    // 守卫标记之后的语句(哨兵比较)属于尾部,收尾到守卫的 if 语句为止,
                    // 并且必须正好走到列表末尾。
                    let end = guardIndex + 1;
                    while (end < list.length && !TYPE.isIfStatement(list[end])) end++;
                    if (end >= list.length) return false;
                    if (end + 1 !== list.length) return false;
                    copies.push({
                        list: list as TYPE.Statement[],
                        start: index,
                        end: end + 1,
                        body: list.slice(index + 1, guardIndex) as TYPE.Statement[],
                    });
                    continue;
                }
                // cleanup 标记落在语句内部的表达式里(test 序列)不是可摘的尾块
                if (containsOwnMarker(item, cleanupValue)) return false;
                if (!walk(item, nextInsideLoop)) return false;
            }
        }
        return true;
    };
    if (!walk(root, false) || copies.length === 0) return null;
    return copies;
}

function isLoopStatement(node: any): boolean {
    return TYPE.isWhileStatement(node) || TYPE.isDoWhileStatement(node) || TYPE.isForStatement(node)
        || TYPE.isForInStatement(node) || TYPE.isForOfStatement(node);
}

/**
 * 标记是否就在这条语句自身的表达式里(条件 test 序列、赋值右侧等)。
 * 嵌套语句里的标记属于更深一层的语句列表,交给列表递归处理。
 */
function containsOwnMarker(statement: any, value: string): boolean {
    const visit = (node: any, isRoot: boolean): boolean => {
        if (!node || typeof node !== "object" || !node.type) return false;
        if (!isRoot && TYPE.isStatement(node)) return false;
        if (TYPE.isStringLiteral(node) && node.value === value) return true;
        for (const key of TYPE.VISITOR_KEYS[node.type] ?? []) {
            const child = node[key];
            if (Array.isArray(child)) {
                for (const item of child) if (visit(item, false)) return true;
            } else if (visit(child, false)) return true;
        }
        return false;
    };
    return visit(statement, true);
}

function collectMarkerOccurrences(
    node: any,
    value: string,
    chain: Array<{ list: TYPE.Statement[]; index: number }>,
    out: MarkerOccurrence[],
): void {
    if (!node || typeof node !== "object" || !node.type) return;
    for (const key of TYPE.VISITOR_KEYS[node.type] ?? []) {
        const child = node[key];
        if (!Array.isArray(child)) {
            collectMarkerOccurrences(child, value, chain, out);
            continue;
        }
        const list = child as any[];
        for (let index = 0; index < list.length; index++) {
            const item = list[index];
            if (!item || typeof item !== "object" || !item.type) continue;
            if (!TYPE.isStatement(item)) {
                collectMarkerOccurrences(item, value, chain, out);
                continue;
            }
            if (TYPE.isExpressionStatement(item) && TYPE.isStringLiteral(item.expression)
                && item.expression.value === value) {
                out.push({ list: list as TYPE.Statement[], index, chain });
                continue;
            }
            if (containsOwnMarker(item, value)) {
                out.push({ list: list as TYPE.Statement[], index, chain });
                continue;
            }
            collectMarkerOccurrences(item, value, chain.concat([{ list: list as TYPE.Statement[], index }]), out);
        }
    }
}

/**
 * `if (C) { A; TAIL } else { TAIL }` → `if (C) { A } TAIL`。
 *
 * 区域归约没有 goto:两条路径汇合到“必定退出”的尾块时,尾块按引用展开进每条
 * 归约路径。ArkTS 13 的 finally cleanup + 重抛守卫正好在这段尾块里,于是
 * cleanup 被复制进 if 的两条分支,applyFinallyPlans 找不到“紧跟 try/catch”
 * 的布局(amcl1.0.6.abc 的 g9 executeInstall)。
 *
 * 分支走到末尾本来就会继续执行 if 之后的语句,所以把分支末尾逐字相同的尾块
 * 提到 if 之后只保留一份,语义不变(同一批语句每次仍然只执行一次)。
 * 约束:
 *  - 尾块必须到分支列表末尾(后面没有别的语句);
 *  - 尾块里不能有声明(块级作用域会随位置改变);
 *  - 只有嵌套在保留者所在 if 里的副本才会被删,避免把别处的同名尾块误删。
 */
function hoistDuplicatedFinallyTails(
    astNode: any,
    plans: FinallyPlan[],
    /** 被改动的语句列表 → 改动前的内容(还原失败时整体回滚) */
    touched: Map<TYPE.Statement[], TYPE.Statement[]> = new Map(),
): boolean {
    let changed = false;
    for (const plan of plans) {
        const cleanups: MarkerOccurrence[] = [];
        collectMarkerOccurrences(astNode, markerValue(plan, "cleanup"), [], cleanups);
        if (cleanups.length < 2) continue;
        const guards: MarkerOccurrence[] = [];
        collectMarkerOccurrences(astNode, markerValue(plan, "guard"), [], guards);
        const tails: Array<{ list: TYPE.Statement[]; start: number; end: number; chain: MarkerOccurrence["chain"] }> = [];
        for (const cleanup of cleanups) {
            const guard = guards.find((candidate) => candidate.list === cleanup.list
                && candidate.index >= cleanup.index);
            // 从 cleanup 到列表末尾就是这段尾块(守卫的“正常继续”分支还在守卫语句里,
            // end 标记也在里面);两条分支必须逐字相同才会被认成同一段。
            if (!guard) continue;
            tails.push({ list: cleanup.list, start: cleanup.index, end: cleanup.list.length - 1, chain: cleanup.chain });
        }
        if (tails.length < 2) continue;
        const groups = new Map<string, typeof tails>();
        for (const tail of tails) {
            const code = tail.list.slice(tail.start, tail.end + 1).map((statement) => generate(statement).code).join("\n");
            const group = groups.get(code);
            if (group) group.push(tail);
            else groups.set(code, [tail]);
        }
        for (const group of groups.values()) {
            if (group.length < 2) continue;
            const statements = group[0].list.slice(group[0].start, group[0].end + 1);
            if (statements.some((statement) => TYPE.isVariableDeclaration(statement)
                || TYPE.isFunctionDeclaration(statement) || TYPE.isClassDeclaration(statement))) continue;
            // 最浅的一处(离外层语句列表最近)保留,其余删掉后把这一份提到 if 之后
            group.sort((a, b) => a.chain.length - b.chain.length);
            const keeper = group[0];
            const anchor = keeper.chain[keeper.chain.length - 1];
            if (!anchor) continue;
            const owner = anchor.list[anchor.index];
            if (group.slice(1).some((tail) => !containsNode(owner, tail.list[tail.start]))) continue;
            const remember = (list: TYPE.Statement[]): void => {
                if (!touched.has(list)) touched.set(list, list.slice());
            };
            remember(keeper.list);
            remember(anchor.list);
            const hoisted = keeper.list.splice(keeper.start, keeper.end - keeper.start + 1);
            for (const tail of group.slice(1)) {
                remember(tail.list);
                tail.list.splice(tail.start, tail.end - tail.start + 1);
            }
            anchor.list.splice(anchor.index + 1, 0, ...hoisted);
            changed = true;
        }
    }
    return changed;
}
