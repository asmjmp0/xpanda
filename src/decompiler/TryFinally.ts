import * as TYPE from "@babel/types";
import type { PandaIRCFG } from "../disasm/PandaIRCFG";
import type { PandaIRBasicBlock } from "../disasm/PandaIRBasicBlock";

/**
 * ArkTS 13(字节码 13.0.1.0)的 try/finally 还原。
 *
 * 该版本编译器给 catch 块写的 codeSize 恒为 0,RegionGraphBuilder 会跳过这些
 * try 块,于是 finally 的异常分支不在区域图里,线性输出退化成:
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
    startMarker?: TYPE.Statement;
    cleanupMarker?: TYPE.Statement;
    guardMarker?: TYPE.Statement;
    endMarker?: TYPE.Statement;
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
        if (!catchBlock || catchBlock.codeSize !== 0 || tryBlock.length === 0) continue;
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

export function isFinallyMarker(node: any): boolean {
    return TYPE.isExpressionStatement(node)
        && TYPE.isStringLiteral(node.expression)
        && node.expression.value.startsWith(MARKER_PREFIX);
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

function stripMarkers(node: any): void {
    if (!node || typeof node !== "object" || !node.type) return;
    for (const key of TYPE.VISITOR_KEYS[node.type] ?? []) {
        const value = node[key];
        if (Array.isArray(value)) {
            node[key] = value.filter((item) => !isFinallyMarker(item));
            for (const item of node[key]) stripMarkers(item);
        } else if (value && typeof value === "object") {
            stripMarkers(value);
        }
    }
}

/** 在函数体 AST 上把标记区间替换成 try/finally;失败时至少清掉标记 */
export function applyFinallyPlans(astNode: any, plans: FinallyPlan[]): void {
    for (const plan of plans) {
        left: {
            const { startMarker, cleanupMarker, guardMarker, endMarker } = plan;
            if (!startMarker || !cleanupMarker || !guardMarker) break left;
            const list = findStatementList(astNode, startMarker);
            if (!list) break left;
            const start = list.indexOf(startMarker);
            const cleanup = list.indexOf(cleanupMarker);
            const guard = list.indexOf(guardMarker);
            if (!(start >= 0 && cleanup > start && guard > cleanup)) break left;
            // 守卫语句(if (sentinel != hole) throw sentinel)可能把“之后”的块收进
            // else 分支,此时 endMarker 不在同一层。以守卫本身(第一个 IfStatement)
            // 为删除边界,同时删掉它前面的哨兵比较语句。
            let guardEnd = guard + 1;
            while (guardEnd < list.length && !TYPE.isIfStatement(list[guardEnd])) guardEnd++;
            if (guardEnd < list.length && TYPE.isIfStatement(list[guardEnd])) {
                guardEnd++;
            } else if (endMarker) {
                const end = list.indexOf(endMarker);
                if (end <= guard) break left;
                guardEnd = end;
            } else {
                break left;
            }
            const tryStatements = list.slice(start + 1, cleanup);
            const finallyStatements = list.slice(cleanup + 1, guard);
            const tryNode = TYPE.tryStatement(
                TYPE.blockStatement(tryStatements),
                null,
                TYPE.blockStatement(finallyStatements),
            );
            list.splice(start, guardEnd - start, tryNode);
        }
    }
    stripMarkers(astNode);
}

export function stripFinallyMarkers(astNode: any): void {
    stripMarkers(astNode);
}
