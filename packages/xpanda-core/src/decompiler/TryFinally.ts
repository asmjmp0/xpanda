import * as TYPE from "@babel/types";
import generate from "@babel/generator";
import type { PandaIRCFG } from "../disasm/PandaIRCFG";
import type { PandaIRBasicBlock } from "../disasm/PandaIRBasicBlock";
import { ValueAnalysis } from "./ValueAnalysis";
import { blockLoadsHole, blockThrowsRegister, isHoleLoadInstruction } from "./IRPatterns";

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
    /**
     * 哨兵写在结束块之后的共享汇合块里(24+ 的 `try { … } catch { … } finally { … }`)。
     * 这种布局下结束块是用户 catch 的完成路径,它的寄存器恢复要保留,不能按 suppress 丢弃。
     */
    sharedSentinel?: boolean;
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
    /**
     * 编译器已经把 cleanup 内联到正常出口之前(`try { …; CLEANUP; return X }`),
     * 异常路径的 handler 入口里带着 await resume 派发,所以没有可用的 suppress 块。
     * 这种计划只需要起点标记 + `inlinedCleanupStartPC`:还原时把 try 体末尾的
     * cleanup 副本剪出来当 finally,`return` 移到 try/finally 之后。
     */
    eagerCleanup?: boolean;
    /** 内联副本的首/末指令 pc(按指令签名在出口块里找到的) */
    inlinedCleanupStartPC?: number;
    inlinedCleanupEndPC?: number;
    /**
     * 出口前所有内联 cleanup 副本的 pc 区间(多出口时每个 return 前各有一份)。
     * 只有一份时与 `inlinedCleanupStartPC/EndPC` 相同。
     */
    inlinedCleanupCopies?: Array<{ startPC: number; endPC: number }>;
    /**
     * cleanup 副本落在**循环体尾部**:cleanup/guard 被并进 do-while 的 test,
     * 守卫的非抛出分支是循环回边。副本语句按 pc 区间 `[startPC, endPC)` 定位
     * (共享那份在 handler 里,pc 更小)。
     */
    tailCleanupRange?: { startPC: number; endPC: number };
    /**
     * cleanup 落在**循环体尾部**,守卫是尾部的一组独立语句(哨兵比较被物化成
     * do-while 的 test),守卫的非抛出分支是循环回边(经一条 jmp 跳回循环头)。
     * 还原时把 try 体包成 try/finally,删掉守卫脚手架并把循环 test 改成 true
     * (回边立刻无条件跳回循环头,退出只靠循环体里的 break)。
     */
    loopTailGuard?: boolean;
}

export interface FinallyPlanOptions {
    /**
     * try 范围(`startPC:endPC`)集合:这些 try 的 handler 已经被
     * `classifyTryEntries` 当作 `finallyEpilogue` 接进区域图,异常路径由
     * `foldEagerCatchToFinally` 折回 try/finally。循环体尾部形态(cleanup/guard
     * 被折进循环 test)只用于 handler 不在图里的经典 finally;对这类范围再生成
     * 计划,会在已经能还原的 finally 外多套一层(hx360e LogExport)。
     */
    readonly skipLoopLatchRanges?: ReadonlySet<string>;
}

export interface FinallyRoleInfo {
    plan: FinallyPlan;
    role: FinallyRole;
}

const MARKER_PREFIX = "__xpanda_finally_marker__";

/**
 * 指令的「值形状」文本:去掉 pc 前缀、字面量池下标和寄存器编号。
 *
 * 编译器把同一段 cleanup 抄两遍时,除了寄存器分配和池下标,指令序列是一致的
 * (`ldobjbyname acc = 478, "close"` vs `acc = 476, "close"`),按这个形状比较
 * 才能把出口前的那份副本认出来。
 */
function instructionShape(instruction: any): string {
    const text = String(instruction.toString());
    const separator = text.indexOf("||");
    const operands = (separator >= 0 ? text.slice(separator + 2) : text)
        .replace(/acc = \d+,/g, "acc = ,")
        .replace(/\bv\d+\b/g, "v")
        .replace(/\bp\d+\b/g, "p")
        .replace(/\s+/g, " ")
        .trim();
    return ((instruction.opcode?.name ?? "") + " " + operands).trim();
}

/**
 * 共享 cleanup 块(handler 落点)的指令形状签名。
 *
 * cleanup 起点可能只是 `vX = undefined` 之类的一两块(amcl mods/o17 `execute`
 * 的 handler 落空块只有 `ldundefined; sta v0`),沿单一后继把 cleanup 体拼出来。
 */
function sharedCleanupShape(
    cfg: PandaIRCFG,
    cleanupBlock: PandaIRBasicBlock,
    guardBlock: PandaIRBasicBlock,
): string[] {
    const shared = cleanupBlock.pandaInstructions.map(instructionShape);
    while (shared.length > 0 && shared[0].startsWith("mov ")) shared.shift();
    let cursor: PandaIRBasicBlock | null = cleanupBlock;
    const shapedBlocks = new Set<PandaIRBasicBlock>([cleanupBlock]);
    while (shared.length < 6 && cursor && cursor !== guardBlock) {
        const successors = cfg.graph.normalSuccessors(cursor)
            .filter((successor) => successor.getStartPC() > cursor!.getStartPC());
        if (successors.length !== 1) break;
        const next = successors[0];
        if (next === guardBlock || shapedBlocks.has(next)) break;
        shapedBlocks.add(next);
        for (const instruction of next.pandaInstructions) shared.push(instructionShape(instruction));
        cursor = next;
    }
    while (shared.length > 0 && shared[0].startsWith("mov ")) shared.shift();
    return shared;
}

/**
 * 在终止于 `return` 的出口块前找一份 cleanup 副本。从出口块往前收,
 * 按指令形状做最长前缀匹配;匹配之后只允许剩 resume 派发的收尾 + 返回。
 */
function matchInlinedCleanupCopy(
    cfg: PandaIRCFG,
    exitBlock: PandaIRBasicBlock,
    shared: string[],
    startPC: number,
    guardBlock: PandaIRBasicBlock,
): { startPC: number; endPC: number } | null {
    if (shared.length < 6) return null;
    // 编译器可能把 cleanup 和 return 拆成了相邻的两个块(amcl l8 `jarInspect`
    // 的 4240 只负责返回),往前最多走 4 个单前驱块。
    const window: Array<{ pc: number; shape: string }> = [];
    let current: PandaIRBasicBlock | null = exitBlock;
    const visited = new Set<PandaIRBasicBlock>();
    for (let step = 0; step < 4 && current && !visited.has(current); step++) {
        visited.add(current);
        const instructions = current.pandaInstructions;
        for (let index = instructions.length - 1; index >= 0; index--) {
            window.unshift({ pc: instructions[index].pc, shape: instructionShape(instructions[index]) });
        }
        let bestStart = -1;
        let bestLength = 0;
        // 允许跳过 cleanup 开头的 resume 标记检查(`ldundefined; eq; jeqz …`),
        // 从 cleanup 体本身开始匹配:正常路径的内联副本没有这段检查
        // (demo `asyncFinallyConditional` / amcl mods/o17 `execute`)。
        for (let offset = 0; offset < shared.length; offset++) {
            const remaining = shared.length - offset;
            if (remaining < 6) break;
            for (let index = 0; index < window.length; index++) {
                let length = 0;
                while (length < remaining && index + length < window.length
                    && window[index + length].shape === shared[offset + length]) length++;
                if (length > bestLength) {
                    bestLength = length;
                    bestStart = index;
                }
            }
        }
        if (bestStart >= 0 && bestLength >= 6) {
            // 副本必须紧贴出口:匹配点之后只剩 resume 派发的收尾 + 返回,块尾是 return
            const tailAfter = window.length - (bestStart + bestLength);
            const lastShape = window[window.length - 1].shape;
            const pc = window[bestStart].pc;
            const endPc = window[bestStart + bestLength - 1].pc;
            if (tailAfter <= 12 && lastShape === "return"
                && typeof pc === "number" && pc > startPC && pc < guardBlock.getStartPC()
                && typeof endPc === "number") return { startPC: pc, endPC: endPc };
            return null;
        }
        const predecessors = cfg.graph.normalPredecessors
            ? cfg.graph.normalPredecessors(current)
            : [];
        current = predecessors.length === 1 ? predecessors[0] : null;
    }
    return null;
}

/**
 * try 体出口前内联的 cleanup 副本(编译器把 finally 内联到每个 return 之前)。
 * 多出口时每个 `return` 前各有一份,全部返回;没有副本时返回空数组,
 * 计划放弃、不影响现有输出。
 */
function locateInlinedCleanupCopies(
    cfg: PandaIRCFG,
    blocks: PandaIRBasicBlock[],
    startPC: number,
    endPC: number,
    cleanupBlock: PandaIRBasicBlock,
    guardBlock: PandaIRBasicBlock,
): Array<{ startPC: number; endPC: number }> {
    const shared = sharedCleanupShape(cfg, cleanupBlock, guardBlock);
    if (shared.length < 6) return [];
    const copies: Array<{ startPC: number; endPC: number }> = [];
    for (const block of blocks) {
        const pc = block.getStartPC();
        if (pc < startPC || pc >= endPC) continue;
        if (block.getTerminator().kind !== "return") continue;
        const copy = matchInlinedCleanupCopy(cfg, block, shared, startPC, guardBlock);
        if (!copy) continue;
        if (copies.some((existing) => existing.startPC === copy.startPC)) continue;
        copies.push(copy);
    }
    copies.sort((left, right) => left.startPC - right.startPC);
    return copies;
}

/**
 * 共享哨兵块:try 结束块只恢复寄存器、哨兵写在后面被用户 catch 完成路径复用的块里。
 *
 * 24+ 的编译器会把 try 结尾的寄存器恢复与 hole 哨兵合并到一个汇合块:
 *
 *   542: jmp 595                      // try 体正常完成,跳过用户 catch
 *   581: mov v3,v14; …; jmp 605       // 用户 catch 完成 → 恢复寄存器
 *   595: mov v11,v18; …;             // try 正常完成 → 恢复寄存器
 *   605: ldhole; sta v13; …; v10 = v13; jmp 624   // 共享:写哨兵再进 cleanup
 *   622: sta v10                      // finally 的异常落点
 *
 * `buildFinallyPlans` 原来的判据要求"try 结束块自己写 ldhole",这里不成立,于是
 * 整个 finally 计划丢失(SettingsPanel.clearCache)。沿"只做寄存器恢复"的块前进,
 * 找到写 hole 且唯一后继就是 cleanup 的块即可确认;finally 体从结束块开始,
 * 那些寄存器恢复是 cleanup 的输入,必须留在 finally 里。
 */
function findSharedSentinelBlock(
    cfg: PandaIRCFG,
    endBlock: PandaIRBasicBlock,
    cleanupBlock: PandaIRBasicBlock,
): PandaIRBasicBlock | null {
    const visited = new Set<PandaIRBasicBlock>();
    let current: PandaIRBasicBlock | null = endBlock;
    while (current && !visited.has(current)) {
        visited.add(current);
        if (current.pandaInstructions.length === 0) return null;
        if (blockLoadsHole(current)) {
            const successors = cfg.graph.normalSuccessors(current);
            return successors.length === 1 && successors[0] === cleanupBlock ? current : null;
        }
        // 中间块只能是纯寄存器恢复(末尾可以带一条无条件跳转)
        if (!current.pandaInstructions.every((instruction) => instruction.kind === "mov"
            || instruction.kind === "nop" || instruction.isJump())) {
            return null;
        }
        const successors = cfg.graph.normalSuccessors(current);
        if (successors.length !== 1) return null;
        current = successors[0];
    }
    return null;
}

/**
 * 守卫是否在比较「handler 保存的那个异常值」(值语义)。
 *
 * `comparesHoleWith` 只在同一个块里找 `lda vX; noteq` 的语法形状;寄存器先在别的块
 * 被复制、或守卫读的是个 φ(正常路径写 hole、异常路径写异常)时它就认不出来。
 * 这里用到达定义:守卫块里比较指令读到的寄存器,其到达定义集合里包含 handler
 * 保存异常的那条 `sta`(或它的拷贝)就命中。
 */
function guardComparesSavedValue(
    analysis: ValueAnalysis,
    guardBlock: PandaIRBasicBlock,
    savedDefinition: { id: number } | null,
): boolean {
    if (!savedDefinition) return false;
    for (const instruction of guardBlock.pandaInstructions) {
        if (!instruction.isCompareOp) continue;
        const operands: any[] = Array.isArray(instruction.params) ? instruction.params : [];
        for (const operand of operands) {
            if (!operand || typeof operand !== "object" || typeof operand.index !== "number") continue;
            const name = String(operand.toString());
            if (analysis.definitionsAtRead(guardBlock, instruction, name).includes(savedDefinition.id)) return true;
        }
    }
    return false;
}

/** 块内是否 `X == hole` / `X != hole` 比较(X 为 handler 保存的异常) */
export function comparesHoleWith(block: PandaIRBasicBlock, register: string): boolean {
    const instructions = block.pandaInstructions;
    const holeIndex = instructions.findIndex(isHoleLoadInstruction);
    if (holeIndex < 0) return false;
    const next = instructions[holeIndex + 1];
    const holder = next && next.kind === "store" ? (next as any).destObj?.toString() : null;
    if (!holder) return false;
    let loadedSaved = false;
    for (const instruction of instructions) {
        if (instruction.kind === "load" && instruction.loadType === "OBJECT"
            && (instruction as any).loadParam?.toString() === register) {
            loadedSaved = true;
        }
        if (instruction.kind === "binaryOp" && (instruction as any).isCompareOp && loadedSaved
            && (instruction as any).params.some((param: any) => param?.toString?.() === holder)) {
            return true;
        }
    }
    return false;
}

/** 从 try 表提取 finally 计划;不是 finally 的 try 块返回 null */
export function buildFinallyPlans(cfg: PandaIRCFG, options: FinallyPlanOptions = {}): FinallyPlan[] {
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
        // finally 落点:先 sta 保存异常,再恢复寄存器并落到 cleanup,不会立刻 throw
        if (handlerBlock.pandaInstructions[0]?.kind !== "store") continue;
        const handlerSuccessors = cfg.graph.normalSuccessors(handlerBlock);
        if (handlerBlock.getTerminator().kind === "throw") continue;
        // 编译器把 cleanup 内联到正常出口之前时(`try { …; CLEANUP; return X }`),
        // 异常路径的 handler 入口带着 await resume 派发,有两条正常边:跳转边直达
        // 守卫,落空边才是 cleanup。amcl l8 `jarInspect` 就是这种形态。
        let eager = false;
        let cleanupBlock: PandaIRBasicBlock | null = null;
        if (handlerSuccessors.length === 1) {
            cleanupBlock = handlerSuccessors[0];
        } else if (handlerSuccessors.length === 2 && endBlock === handlerBlock
            && (handlerBlock.getTerminator().kind === "jumpEqual" || handlerBlock.getTerminator().kind === "jumpNotEqual")) {
            eager = true;
            cleanupBlock = handlerSuccessors.find((successor) => successor.getStartPC() !== handlerBlock.getTerminator().destinationPC) ?? null;
        }
        if (!cleanupBlock) continue;
        // 正常完成路径:结束块自己写 hole 并跳到 cleanup(经典布局),或者哨兵写在
        // 结束块之后的共享汇合块里(24+ 的 `try { … } catch { … } finally { … }`)。
        const sharedSentinel = !eager && !blockLoadsHole(endBlock);
        let cleanupStartPC = cleanupBlock.getStartPC();
        if (eager) {
            // 没有 suppress 块:正常路径的 cleanup 已经内联在 return 之前
        } else if (sharedSentinel) {
            // 哨兵写在一个被 try 正常完成路径与用户 catch 完成路径共用的块里:
            // finally 从那个块开始(它的寄存器写入是 cleanup 的输入),
            // 两条路径各自的恢复指令留在原来的分支里。
            const sentinelBlock = findSharedSentinelBlock(cfg, endBlock, cleanupBlock);
            if (!sentinelBlock) continue;
            cleanupStartPC = sentinelBlock.getStartPC();
        } else {
            const endTerminator = endBlock.getTerminator();
            if (endTerminator.kind !== "jumpDirect" || endTerminator.destinationPC !== cleanupBlock.getStartPC()) continue;
        }

        // cleanup 之后第一个带 ldhole 的条件块是 rethrow 检查。嵌套 finally 时
        // cleanup 里还有内层 finally 自己的哨兵,所以优先找「和本 handler 保存的
        // 异常寄存器比较 hole」的那个守卫(amcl l8 `jarFreeze`:
        // `try { … } finally { try { … } finally { … } }`);找不到再退回第一个。
        const savedRegister = handlerBlock.pandaInstructions[0].destObj?.toString() ?? null;
        const cleanupIndex = blocks.indexOf(cleanupBlock);
        let guardBlock: PandaIRBasicBlock | null = null;
        let matchedByRegister = false;
        if (savedRegister) {
            for (let i = cleanupIndex + 1; i < blocks.length; i++) {
                if (blockLoadsHole(blocks[i]) && comparesHoleWith(blocks[i], savedRegister)) {
                    guardBlock = blocks[i];
                    matchedByRegister = true;
                    break;
                }
            }
            if (!guardBlock) {
                // 语法形状认不出来(寄存器在别的块被复制、或守卫读的是 φ)时按值找一次
                const savedInstruction = handlerBlock.pandaInstructions[0];
                let analysis: ValueAnalysis | null = null;
                for (let i = cleanupIndex + 1; i < blocks.length; i++) {
                    if (!blockLoadsHole(blocks[i])) continue;
                    analysis ??= new ValueAnalysis(cfg);
                    if (!guardComparesSavedValue(analysis, blocks[i], analysis.definitionOf(savedInstruction))) continue;
                    guardBlock = blocks[i];
                    matchedByRegister = true;
                    break;
                }
            }
        }
        let firstHoleBlock: PandaIRBasicBlock | null = null;
        for (let i = cleanupIndex + 1; i < blocks.length; i++) {
            if (blockLoadsHole(blocks[i])) { firstHoleBlock = blocks[i]; break; }
        }
        matchedByRegister = matchedByRegister && guardBlock !== firstHoleBlock;
        if (!guardBlock) guardBlock = firstHoleBlock;
        if (!guardBlock) continue;
        const guardSuccessors = cfg.graph.normalSuccessors(guardBlock);
        if (guardSuccessors.length !== 2) continue;
        if (guardBlock.getTerminator().kind !== "jumpEqual" && guardBlock.getTerminator().kind !== "jumpNotEqual") continue;
        let throwBranch = guardSuccessors.find((successor) => successor.getTerminator().kind === "throw");
        let afterBranch = guardSuccessors.find((successor) => successor !== throwBranch);
        if (!throwBranch || !afterBranch) continue;
        // 守卫的两个后继可能都以 throw 结束:try 位于 catch 体里时,一个是守卫
        // 自己的重抛(`if (pending != hole) throw pending`),另一个是外层 catch 的
        // 重抛(正常继续)。必须把后者当作 afterBranch,否则 end 标记落进守卫的
        // throw 分支,throw 残留在布局之后,`throw pending` 还会被折叠成寄存器里
        // 的上一份值(amcl e4/k9 的 `throw g50.openSync`)。按抛出的寄存器区分:
        // 守卫重抛的是 handler 保存的哨兵/pending 值。
        if (afterBranch.getTerminator().kind === "throw" && savedRegister) {
            const sentinelThrows = guardSuccessors.filter((successor) => blockThrowsRegister(successor, savedRegister));
            if (sentinelThrows.length === 1) {
                throwBranch = sentinelThrows[0];
                afterBranch = guardSuccessors.find((successor) => successor !== sentinelThrows[0])!;
            }
        }
        // 守卫的非抛出分支通常是往后的续接;cleanup/guard 落在循环体尾部时它是
        // 循环回边(do-while 的 test),pc 比守卫小 —— 只对「第一个 hole 块」认这个
        // 形态(寄存器匹配出来的另一个守卫带出回边,说明那是别的 finally 的守卫)。
        const directBackEdge = afterBranch.getStartPC() <= tryBlock.startPC;
        // 守卫的非抛出分支也可能只是一条跳回循环头的 jmp(回边块自己单独成块):
        // 这时它的 pc 比守卫大,不能按 afterBranch 的起始 pc 判断。只认「整块只有
        // 这一条 jmp」的块 —— 循环增量块(mov/lda/++/jmp)后面还有真正的循环体代码,
        // 截断守卫之后的语句会把它们一起丢掉(amcl e4/a9 的 `stage`)。
        const afterTerminator = afterBranch.getTerminator();
        const bareBackJump = afterTerminator.kind === "jumpDirect"
            && afterBranch.pandaInstructions.length === 1;
        const jumpBackEdge = bareBackJump && afterTerminator.destinationPC <= tryBlock.startPC;
        const loopLatch = !matchedByRegister
            && !options.skipLoopLatchRanges?.has(tryBlock.startPC + ":" + (tryBlock.startPC + tryBlock.length))
            && (directBackEdge || jumpBackEdge);
        if (!(tryBlock.startPC < endBlock.getStartPC()
            && endBlock.getStartPC() <= cleanupBlock.getStartPC()
            && cleanupBlock.getStartPC() < guardBlock.getStartPC()
            && (guardBlock.getStartPC() < afterBranch.getStartPC() || loopLatch))) continue;

        const endIsMethodTail = isImplicitMethodTail(cfg, afterBranch);
        // Fields shared by every layout. The restore strategy differs per branch,
        // but the bytecode-side ranges are the same.
        const planBase = {
            id: plans.length,
            startPC: tryBlock.startPC,
            endPC: endBlock.getStartPC(),
            cleanupStartPC,
            guardStartPC: guardBlock.getStartPC(),
            guardEndPC: afterBranch.getStartPC(),
        };
        if (loopLatch && !directBackEdge) {
            // 守卫没被折进 do-while 的 test,而是留在循环体尾部的一组语句里:
            // `do { …; try { … } finally { … }; if (pending != hole) throw pending } while (!guard)`
            // 仍然按经典角色插标记,只是还原布局不同(amcl i15 `concatParts` 的内层 finally)。
            plans.push({
                ...planBase,
                endIsMethodTail: false,
                restoreContinuation: false,
                loopTailGuard: true,
            });
            continue;
        }
        if (loopLatch) {
            plans.push({
                ...planBase,
                endIsMethodTail,
                restoreContinuation: true,
                tailCleanupRange: { startPC: endBlock.getStartPC(), endPC: guardBlock.getStartPC() },
            });
            continue;
        }
        if (eager) {
            // cleanup 副本必须能在 try 体的出口块里按指令形状找到,否则放弃
            const copies = locateInlinedCleanupCopies(
                cfg, blocks, tryBlock.startPC, endBlock.getStartPC(), cleanupBlock, guardBlock);
            if (copies.length === 0) continue;
            // 单出口走原来的「剪出同层副本」布局;多出口时每份副本分散在分支尾部,
            // 由 applyMultiExitEagerCleanup 统一上提。
            const inlined = copies[copies.length - 1];
            plans.push({
                ...planBase,
                endIsMethodTail,
                restoreContinuation: true,
                eagerCleanup: true,
                inlinedCleanupStartPC: inlined.startPC,
                inlinedCleanupEndPC: inlined.endPC,
                inlinedCleanupCopies: copies,
            });
            continue;
        }
        // 寄存器匹配出来的守卫只用于「外层 finally 包住内层 finally」这一种嵌套:
        //  - 守卫的正常分支必须是方法隐式收尾(amcl i8 `c763` 的守卫被归约进了
        //    resume 派发的分支,AST 上拿不到布局,建出计划反而会毁掉输出);
        //  - 内层计划必须落在 cleanup..guard 之间(那才是 finally 体);
        //  - try 体里不能再有自己的 finally 计划(amcl r2/p5 `openEditor` 三层计划
        //    套在一起,认成外层计划会把整段 body 复制进 finally)。
        if (matchedByRegister) {
            if (!endIsMethodTail) continue;
            const cleanupPC = cleanupBlock.getStartPC();
            const guardPC = guardBlock.getStartPC();
            if (plans.some((other) => other.startPC > tryBlock.startPC && other.startPC < endBlock.getStartPC())) continue;
            if (!plans.some((other) => other.startPC > cleanupPC && other.guardStartPC < guardPC)) continue;
        }
        plans.push({
            ...planBase,
            // 共享哨兵布局:结束块是用户 catch 的完成路径(寄存器恢复留在 catch 里),
            // finally 从哨兵所在的那个共享块开始;结束块不再按 suppress 丢弃。
            sharedSentinel,
            endIsMethodTail,
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
        // eager / 循环体尾部形态不注册任何角色(起点按 pc 反查):还原不了时既不能
        // 改动别的计划的角色,也不能插标记 —— 否则哨兵/守卫语句的去留会变。
        if (plan.eagerCleanup || plan.tailCleanupRange) continue;
        roles.set(plan.startPC, { plan, role: "start" });
        if (!plan.sharedSentinel) roles.set(plan.endPC, { plan, role: "suppress" });
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

interface StatementPosition {
    list: TYPE.Statement[];
    index: number;
}

/** statement 所在的语句列表与下标(不在 AST 里时返回 null)。 */
function locateStatementPosition(root: any, statement: TYPE.Statement): StatementPosition | null {
    const list = findStatementList(root, statement);
    if (!list) return null;
    const index = list.indexOf(statement);
    return index < 0 ? null : { list, index };
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

/**
 * 构造 try/finally 的语句块:只有一条语句、而且本身就是块时直接展开
 * (`finally { { … } }` → `finally { … }`)。这层块是我们自己包出来的
 * (cleanup 语句来自折叠掉的 `if (resume == undefined) { … }` 的块体),
 * 展开不改变作用域:外层块里没有别的语句。其它来源的词法块(带 let 的
 * 循环体块)不受影响。
 */
function bodyBlock(statements: TYPE.Statement[]): TYPE.BlockStatement {
    if (statements.length === 1 && TYPE.isBlockStatement(statements[0])) return statements[0];
    return TYPE.blockStatement(statements);
}

/** `try { tryStatements } finally { finallyStatements }` */
function tryFinallyNode(
    tryStatements: TYPE.Statement[],
    finallyStatements: TYPE.Statement[],
): TYPE.TryStatement {
    return TYPE.tryStatement(
        TYPE.blockStatement(tryStatements),
        null,
        bodyBlock(finallyStatements),
    );
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

/** Block-scoped declarations cannot be moved to a different statement list. */
function hasDeclaration(statements: TYPE.Statement[]): boolean {
    return statements.some((statement) => TYPE.isVariableDeclaration(statement)
        || TYPE.isFunctionDeclaration(statement) || TYPE.isClassDeclaration(statement));
}

/** First IfStatement at or after `from` in a statement list. */
function findNextIfStatement(
    statements: TYPE.Statement[],
    from: number,
): { statement: TYPE.IfStatement; index: number } | null {
    for (let index = from; index < statements.length; index++) {
        const statement = statements[index];
        if (TYPE.isIfStatement(statement)) return { statement, index };
    }
    return null;
}

/**
 * Non-throwing continuation of a loop-tail finally guard, taken from this
 * plan's end marker. Both loop-tail layouts need the same validation.
 */
function extractLoopContinuation(
    plan: FinallyPlan,
    guardStatement: TYPE.IfStatement | null,
): TYPE.Statement[] | null {
    if (!guardStatement || !plan.restoreContinuation) return null;
    const extracted = extractGuardContinuation(
        guardStatement, markerValueOf(plan.endMarker, plan.endExpr) || null);
    if (!extracted.fromEndMarker || extracted.statements.length === 0) return null;
    if (hasDeclaration(extracted.statements)) return null;
    return extracted.statements;
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
            // 允许沿无条件的收尾跳转继续往前看;条件跳转在循环外单独拒绝。
            if (instruction.isJump() || instruction.kind === "return") continue;
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
        const index = list ? list.indexOf(statementMarker) : -1;
        if (list && index >= 0) return { list, index, inExpression: false };
        // 标记对象可能已经不在树里:同一个角色会被 emit 多份(区域复制),plan 的标记
        // 只指向最后 emit 的那份,而内层 finally 的裁剪可能正好把那份删掉。按标记值
        // 重新找一份,避免 finally 因此静默丢失。
        if (TYPE.isExpressionStatement(statementMarker) && TYPE.isStringLiteral(statementMarker.expression)) {
            const occurrences: MarkerOccurrence[] = [];
            collectMarkerOccurrences(astNode, statementMarker.expression.value, [], occurrences);
            const first = occurrences[0];
            if (first) return { list: first.list, index: first.index, inExpression: false };
        }
        return null;
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
    /** 语句 → 产生它的指令 pc(定位「已内联到出口前」的 cleanup 副本) */
    statementInstructionPC?: WeakMap<object, number>;
    /** 结构化分析产出的 try 语句 → try 表里该 try 保护范围的结束 pc */
    tryBodyEndPC?: WeakMap<object, number>;
}


/**
 * 「cleanup 已内联到出口前」的 finally:把 try 体末尾的 cleanup 副本剪出来当 finally,
 * 终止的 `return` 移到 try/finally 之后。
 *
 *   try { …; CLEANUP; return X }        →   try { … } finally { CLEANUP }
 *                                          return X
 *
 * 这里的 cleanup 副本按指令 pc 定位(`FinallyContext.statementInstructionPC`),
 * 因为编译器把同一段代码抄了一份,pc 和共享那份不同。
 */
function applyEagerCleanupFinally(
    context: FinallyContext | undefined,
    plan: FinallyPlan,
    startList: TYPE.Statement[],
    tryStart: number,
): boolean {
    const instructionPC = context?.statementInstructionPC;
    const inlinedStart = plan.inlinedCleanupStartPC;
    const inlinedEnd = plan.inlinedCleanupEndPC;
    if (!instructionPC || inlinedStart === undefined || inlinedEnd === undefined) return false;
    // cleanup 副本 = [inlinedStart, inlinedEnd] 里的指令产出的语句;之后的语句是
    // 出口路径(return 的值从 cleanup 之后才装进 acc)。
    let cleanupIndex = -1;
    let afterCleanupIndex = -1;
    for (let index = tryStart; index < startList.length; index++) {
        const pc = instructionPC.get(startList[index]);
        if (typeof pc !== "number") continue;
        if (cleanupIndex < 0) {
            if (pc === inlinedStart) cleanupIndex = index;
            continue;
        }
        if (pc > inlinedEnd) { afterCleanupIndex = index; break; }
    }
    if (cleanupIndex < 0) return false;
    if (afterCleanupIndex < 0) afterCleanupIndex = startList.length;
    const finallyStatements = startList.slice(cleanupIndex, afterCleanupIndex);
    const tryStatements = startList.slice(tryStart, cleanupIndex);
    const after = startList.slice(afterCleanupIndex);
    if (finallyStatements.length === 0 || tryStatements.length === 0) return false;
    // 出口路径必须以 return 收尾(中间只允许寄存器搬运/标记)
    const returnIndex = after.findIndex((statement) => TYPE.isReturnStatement(statement));
    if (returnIndex < 0) return false;
    if (after.slice(returnIndex + 1).some((statement) => !isRegisterMove(statement) && !isFinallyMarker(statement))) {
        return false;
    }
    const tryNode = tryFinallyNode(tryStatements, finallyStatements);
    startList.splice(tryStart, startList.length - tryStart, tryNode, ...after);
    return true;
}

interface CleanupCopyOwner {
    list: TYPE.Statement[];
    index: number;
    statement: TYPE.Statement;
}

/**
 * 语句列表里「try { CLEANUP } catch {}」形式的 cleanup 副本。
 *
 * 多出口 finally 的内联副本被编译器放在每条 return 之前,结构化分析会把副本
 * 自己那个 `try { … } catch {}`(try 表里的 emptyJoin 条目)归约成 TryStatement,
 * 它由区域归约创建、没有指令 pc;副本的第一条语句才是 cleanup 的首指令。
 */
function collectWrappedCleanupCopies(
    list: TYPE.Statement[],
    startIndex: number,
    range: { startPC: number; endPC: number },
    instructionPC: WeakMap<object, number>,
    out: CleanupCopyOwner[],
): void {
    for (let index = startIndex; index < list.length; index++) {
        const statement = list[index];
        if (!statement || typeof statement !== "object" || !TYPE.isStatement(statement)) continue;
        if (TYPE.isTryStatement(statement) && !statement.finalizer && statement.block.body.length > 0
            && instructionPC.get(statement.block.body[0]) === range.startPC) {
            out.push({ list, index, statement });
            continue;
        }
        collectWrappedCleanupCopiesInNode(statement, range, instructionPC, out);
    }
}

function collectWrappedCleanupCopiesInNode(
    node: any,
    range: { startPC: number; endPC: number },
    instructionPC: WeakMap<object, number>,
    out: CleanupCopyOwner[],
): void {
    if (!node || typeof node !== "object" || !node.type) return;
    // 闭包是独立方法的代码,pc 与当前方法无关,不能拿来做归属判断
    if (TYPE.isFunction(node) || TYPE.isClassDeclaration(node) || TYPE.isClassExpression(node)) return;
    for (const key of (TYPE.VISITOR_KEYS as any)[node.type] ?? []) {
        const value = (node as any)[key];
        if (!Array.isArray(value)) {
            collectWrappedCleanupCopiesInNode(value, range, instructionPC, out);
            continue;
        }
        // 只把语句列表当候选;表达式参数列表里的语句型节点(箭头函数体)由上面的
        // Function 判断挡掉。
        if (value.length > 0 && !value.every((item: any) => item && typeof item === "object" && TYPE.isStatement(item))) {
            continue;
        }
        collectWrappedCleanupCopies(value as TYPE.Statement[], 0, range, instructionPC, out);
    }
}

/** 语句是否在所有路径上都离开当前结构(return / throw / break / continue)。 */
function statementAlwaysLeaves(statement: any): boolean {
    if (!statement || typeof statement !== "object" || !statement.type) return false;
    if (TYPE.isReturnStatement(statement) || TYPE.isThrowStatement(statement)
        || TYPE.isBreakStatement(statement) || TYPE.isContinueStatement(statement)) return true;
    if (TYPE.isBlockStatement(statement)) {
        return statement.body.length > 0 && statementAlwaysLeaves(statement.body[statement.body.length - 1]);
    }
    if (TYPE.isIfStatement(statement)) {
        return !!statement.alternate && statementAlwaysLeaves(statement.consequent)
            && statementAlwaysLeaves(statement.alternate);
    }
    return false;
}

/**
 * 多出口的 eager finally:cleanup 副本被编译器内联到每个 `return` 之前,结构化
 * 分析把它们留在各自分支的尾部(例如 `if (cancelled) { CLEANUP; return A } else
 * { …; CLEANUP; return B }`),没有一份和 try 起点同层,单副本布局定位不到。
 *
 * 还原:把 try 体整段包进 `try { … } finally { CLEANUP }`,删除所有内联副本 ——
 * 分支里的 return 会经由 finally 执行同一份 cleanup。约束:
 *  - 每一份副本都必须定位到唯一一个 `try { CLEANUP } catch {}` 包装语句;
 *  - 所有副本逐字相同(同一段源码,寄存器分配一致才会采用);
 *  - try 体列表的末尾语句必须在所有路径上离开结构,否则后续语句会被罩进 try。
 */
function applyMultiExitEagerCleanup(
    context: FinallyContext | undefined,
    plan: FinallyPlan,
    startList: TYPE.Statement[],
    tryStart: number,
): boolean {
    const instructionPC = context?.statementInstructionPC;
    const copies = plan.inlinedCleanupCopies;
    if (!instructionPC || !copies || copies.length === 0) return false;
    if (startList.length <= tryStart) return false;
    if (!statementAlwaysLeaves(startList[startList.length - 1])) return false;
    const owners: CleanupCopyOwner[] = [];
    for (const range of copies) {
        const found: CleanupCopyOwner[] = [];
        collectWrappedCleanupCopies(startList, tryStart, range, instructionPC, found);
        // 区域复制可能让同一段代码出现多份;只处理能唯一定位的情况
        if (found.length !== 1) return false;
        owners.push(found[0]);
    }
    const reference = generate(owners[0].statement).code;
    if (owners.some((owner) => generate(owner.statement).code !== reference)) return false;
    const perList = new Map<TYPE.Statement[], number[]>();
    for (const owner of owners) {
        const indices = perList.get(owner.list) ?? [];
        if (indices.includes(owner.index)) return false;
        indices.push(owner.index);
        perList.set(owner.list, indices);
    }
    for (const [list, indices] of perList) {
        indices.sort((left, right) => right - left);
        for (const index of indices) list.splice(index, 1);
    }
    const body = startList.slice(tryStart);
    if (body.length === 0) return false;
    const tryNode = tryFinallyNode(body, [owners[0].statement]);
    startList.splice(tryStart, startList.length - tryStart, tryNode);
    return true;
}

/**
 * cleanup 副本落在循环体尾部(do-while 的 test 就是 finally 的重抛守卫)的布局:
 *
 *   do { … try 体 …; CLEANUP; acc = … } while (!acc)
 *     →  do { … try { try 体 } finally { CLEANUP }; acc = … } while (!acc)
 *
 * 副本语句按指令 pc 定位(`[startPC, endPC)`);副本里夹着的归约语句(if/while 等
 * 没有指令 pc)也算副本的一部分,循环 test 的脚手架留在原处。
 */
function applyTailCleanupFinally(
    context: FinallyContext | undefined,
    plan: FinallyPlan,
    startList: TYPE.Statement[],
    /** 索引含在 try 体内(调用方已排除源码之外的纯寄存器搬移) */
    firstTryIndex: number,
): boolean {
    const instructionPC = context?.statementInstructionPC;
    const range = plan.tailCleanupRange;
    if (!instructionPC || !range) return false;
    const inRange = (pc: number | undefined): boolean =>
        typeof pc === "number" && pc >= range.startPC && pc < range.endPC;
    let cleanupIndex = -1;
    for (let index = firstTryIndex; index < startList.length; index++) {
        if (inRange(instructionPC.get(startList[index]))) { cleanupIndex = index; break; }
    }
    if (cleanupIndex < 0) return false;
    let tailIndex = cleanupIndex;
    while (tailIndex < startList.length) {
        const pc = instructionPC.get(startList[tailIndex]);
        if (typeof pc === "number" && !inRange(pc)) break;
        tailIndex++;
    }
    const finallyStatements = startList.slice(cleanupIndex, tailIndex);
    const tryStatements = startList.slice(firstTryIndex, cleanupIndex);
    if (finallyStatements.length === 0 || tryStatements.length === 0) return false;
    const tail = startList.slice(tailIndex);
    const tryNode = tryFinallyNode(tryStatements, finallyStatements);
    startList.splice(firstTryIndex, startList.length - firstTryIndex, tryNode, ...tail);
    return true;
}

/**
 * 循环体尾部守卫布局(见 `FinallyPlan.loopTailGuard`):
 *
 *   do {
 *     <try 体>
 *     if (inp) { try { close(inp) } catch {} }   // cleanup
 *     <守卫脚手架:寄存器恢复 + hole 比较>        // guard 起
 *   } while (!<物化守卫值>)
 *
 * 守卫的非抛出分支是循环回边(经一条 jmp 跳回循环头),所以整段守卫脚手架删掉、
 * 循环 test 改成 true 之后回边依旧成立(退出只靠循环体里的 break)。
 */
function applyLoopTailGuardFinally(
    astNode: any,
    startList: TYPE.Statement[],
    tryStart: number,
    cleanupList: TYPE.Statement[],
    cleanup: number,
    guard: number,
    finallyStart: number,
): boolean {
    if (cleanupList !== startList) return false;
    if (guard <= cleanup || guard >= startList.length) return false;
    const owner = findStatementListOwner(astNode, startList);
    const loop = owner?.statement;
    if (!loop || !(TYPE.isWhileStatement(loop) || TYPE.isDoWhileStatement(loop))) return false;
    // 守卫之后的循环 test 必须是物化的布尔临时值(`while (!acc)`),否则截断
    // 会把真正的循环条件一起带走。
    const test = loop.test;
    const materialized = test && (TYPE.isIdentifier(test)
        || (TYPE.isUnaryExpression(test) && test.operator === "!" && TYPE.isIdentifier(test.argument)));
    if (!materialized) return false;
    const finallyStatements = startList.slice(finallyStart, guard);
    if (finallyStatements.length === 0) return false;
    if (!(cleanup > tryStart)) return false;
    const tryStatements = startList.slice(tryStart, cleanup);
    const tryNode = tryFinallyNode(tryStatements, finallyStatements);
    // cleanup 语句(以及整段守卫脚手架)都属于 finally,替换 range 一直到循环体尾
    startList.splice(tryStart, startList.length - tryStart, tryNode);
    loop.test = TYPE.booleanLiteral(true);
    return true;
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
    // 嵌套 finally 先还原外层:外层 finally 体里还带着内层 try/finally 的原始语句,
    // 先包外层再让内层在自己的作用域里还原(内层先还原会把外层的守卫卷进自己的
    // try 体,外层随后找不到标记——amcl i8 `c763`)。
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
            if (plan.eagerCleanup) {
                applied = applyEagerCleanupFinally(context, plan, startList, tryStart)
                    || ((plan.inlinedCleanupCopies?.length ?? 0) > 1
                        && applyMultiExitEagerCleanup(context, plan, startList, tryStart));
                if (!applied) reason = "eager cleanup not located";
                break left;
            }
            if (plan.tailCleanupRange) {
                // locateTryStartByPC 给出的起始语句可能只是 try 范围里的纯寄存器搬移
                // (源码在 try 之外):留在 try 外不改变语义。其它语句必须留在 try 体内,
                // 否则它抛异常时 finally 不会执行。
                const firstTry = start.byPC
                    ? (isRegisterMove(startList[start.index]) ? start.index + 1 : start.index)
                    : tryStart;
                applied = applyTailCleanupFinally(context, plan, startList, firstTry);
                if (!applied) reason = "tail cleanup not located";
                break left;
            }

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

            if (plan.loopTailGuard) {
                applied = applyLoopTailGuardFinally(astNode, startList, tryStart, cleanupList, cleanup, guard, finallyStart);
                if (!applied) reason = "loop tail guard not located";
                break left;
            }

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
                    const endMarkerValue = markerValueOf(plan.endMarker, plan.endExpr) || null;
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
                const parent = locateStatementPosition(astNode, tryOwner);
                if (!parent) { reason = "no parent list"; break left; }
                const { list: parentList, index: parentIndex } = parent;
                // 守卫之后如果还有语句,它们是 try/finally 之后的正常继续
                const afterGuard = startList.slice(guardEnd);
                startList.length = cleanup;
                tryOwner.finalizer = bodyBlock(finallyStatements);
                parentList.splice(parentIndex + 1, 0, ...guardContinuation, ...afterGuard);
                applied = true;
            } else if (tryOwner && tryOwner.handler && tryOwner.handler.body.body === cleanupList
                && cleanupList.slice(0, finallyStart).some((statement) => !isHandlerWiring(statement))) {
                // 用户 catch 与 finally 共用同一段续接:归约把 try 正常完成路径上的
                // cleanup/guard 并进了 catch 体尾部(catch 里先是用户代码,再是
                // cleanup/guard/续接),于是 cleanup 标记落在 handler 里而不是续接列表。
                // 这里把 catch 体截断到 cleanup 之前(用户 catch 保留),cleanup 段挂成
                // 同一个 try 的 finally,守卫之后的续接搬到 try/catch/finally 之后:
                // 正常路径由 finally 收尾,异常路径先过 catch 再过 finally。
                if (tryOwner.finalizer) { reason = "handler already has a finalizer"; break left; }
                if (finallyStatements.length === 0) { reason = "empty finally body"; break left; }
                const continuation = cleanupList.slice(guardEnd);
                if (hasDeclaration(continuation)) {
                    reason = "guard continuation declares"; break left;
                }
                const parent = locateStatementPosition(astNode, tryOwner);
                if (!parent) { reason = "no parent list"; break left; }
                const { list: parentList, index: parentIndex } = parent;
                cleanupList.splice(cleanup, cleanupList.length - cleanup);
                tryOwner.finalizer = bodyBlock(finallyStatements);
                parentList.splice(parentIndex + 1, 0, ...continuation);
                applied = true;
            } else if (tryOwner && tryOwner.handler && tryOwner.handler.body.body === cleanupList
                && plan.endIsMethodTail
                && applyLoopExitGuardFinally(astNode, plan, tryOwner, startList)) {
                // `try { do { … } while (cond) } finally { … }`:归约把 do-while 变成
                // `while (true) { <try 体>; if (!cond) { <cleanup 副本; 守卫; return> } }`,
                // finally handler 又生成成同一 try 的 catch 副本。branch 3 只会把 try 体
                // 包成 try/finally(守卫与清理副本留在退出分支、finally 每轮执行一次)。
                // 放在 branch 3 之前(条件重叠),内部门槛不满足时返回 false 让链继续。
                applied = true;
            } else if (tryOwner && tryOwner.handler && tryOwner.handler.body.body === cleanupList) {
                const tryStatements = startList.slice(tryStart);
                const tryNode = tryFinallyNode(tryStatements, finallyStatements);
                const parent = locateStatementPosition(astNode, tryOwner);
                if (!parent) { reason = "no parent list"; break left; }
                parent.list.splice(parent.index, 1, tryNode, ...guardContinuation);
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
                const parent = locateStatementPosition(astNode, tryOwner);
                if (!parent) { reason = "no parent list"; break left; }
                const { list: parentList, index: parentIndex } = parent;
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
                tryOwner.finalizer = bodyBlock(finalizer);
                parentList.splice(parentIndex + 1, 0, ...guardContinuation);
                applied = true;
            } else if (tryOwner && tryOwner.handler && cleanupList !== startList
                && (plan.endIsMethodTail || plan.restoreContinuation)
                && !plan.eagerCleanup && !plan.tailCleanupRange && !plan.loopTailGuard
                && startList === tryOwner.block.body
                && applyHandlerWrappedCatchFinally(astNode, plan, tryOwner)) {
                // v24 async 单层 `try { … } catch { … } finally { … }`:finally handler
                // 生成成嵌在用户 catch try 体里的内层 try/catch(cleanup/guard 标记在
                // 它的 handler 里),而共享的 cleanup/guard 尾块又被区域归约复制到这条
                // try/catch 之后的正常路径上,locateMarker 按值找到的是后一份,常规
                // 布局全部失配(lnga startQrLoginScan / fetchThreadInfo /
                // importEncryptedCredential / loadMorePrivateMessages)。
                // 布局调用放在条件里(与 applyLoopFollowedByCleanup 相同):内部形状
                // 门槛不满足时返回 false 让链继续,不能 break left 独占——否则会把
                // 条件上重叠、但本可由后续布局正确还原的形状(知乎
                // NotificationState.fetchPage)遮蔽掉。
                applied = true;
            } else if (tryOwner && tryOwner.handler && cleanupList !== startList) {
                // 用户 catch 在 try 范围内终止,finally 的 cleanup/guard 落在这条
                // try/catch 后面(f1268 写文件:catch 打日志再抛,close 在范围外)。
                // 只有 cleanup 标记紧跟这条 try 时才包一层 try/finally。
                const parent = locateStatementPosition(astNode, tryOwner);
                if (!parent || parent.list !== cleanupList
                    || cleanup !== parent.index + 1 || finallyStart > guard) { reason = "cleanup not right after the try/catch"; break left; }
                const parentList = parent.list;
                const parentIndex = parent.index;
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
                // 的 release)。
                if (catchOnlyStoresException(tryOwner.handler)) {
                    const merged = TYPE.tryStatement(
                        tryOwner.block,
                        null,
                        bodyBlock(finallyStatements),
                    );
                    parentList.splice(parentIndex, removeThrough - parentIndex, merged, ...continuation);
                } else if (!tryOwner.finalizer) {
                    // 用户 catch 保留时直接挂到已有的 try/catch 上:
                    // `try { try { A } catch (e) { B } } finally { C }` 与
                    // `try { A } catch (e) { B } finally { C }` 等价(外层没有 catch,
                    // 异常先过用户 catch,finally 在两条路径后都执行),
                    // 没必要多包一层(SettingsPanel.clearCache)。
                    tryOwner.finalizer = bodyBlock(finallyStatements);
                    parentList.splice(parentIndex, removeThrough - parentIndex, tryOwner, ...continuation);
                } else {
                    // 源码本身就是嵌套 try/catch/finally,保留原有 finally 再包一层
                    const wrapped = tryFinallyNode([tryOwner], finallyStatements);
                    parentList.splice(parentIndex, removeThrough - parentIndex, wrapped, ...continuation);
                }
                applied = true;
            } else if (cleanupList === startList) {
                // 常规布局:try 体 = [tryStart, cleanup),守卫之后是 try/finally 之后的语句
                if (!(cleanup > tryStart)) { reason = "empty try body"; break left; }
                const tryStatements = startList.slice(tryStart, cleanup);
                const tryNode = tryFinallyNode(tryStatements, finallyStatements);
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
                const tryNode = tryFinallyNode(tryStatements, finallyStatements);
                cleanupList.splice(ownerIndex, guardEnd - ownerIndex, tryNode, ...guardContinuation);
                applied = true;
            } else if (applyLoopFollowedByCleanup(astNode, startList, cleanupPos, guardPos, plan)) {
                applied = true;
            } else if (applyLoopExhaustedFinally(astNode, startList, tryStart, cleanupPos, guardPos, plan)) {
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
                const tryNode = tryFinallyNode(tryStatements, finallyStatements);
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
    // eager / 循环体尾部的计划还原不了时不留注释:它们没有 suppress 块、也没有丢掉
    // 任何代码(编译器内联的 cleanup 还在原处),只是缺 try 包装;留注释反而会改变
    // 方法尾语句、扰动 simplify。
    for (const plan of Array.from(failures.keys())) {
        if (plan.eagerCleanup || plan.tailCleanupRange) failures.delete(plan);
    }
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

/**
 * Marker string carried by a plan role. A role lands either on a statement
 * (block statement list) or on an expression (condition test sequence).
 */
function markerValueOf(
    statement: TYPE.Statement | undefined,
    expression: TYPE.Expression | undefined,
): string {
    if (statement && TYPE.isExpressionStatement(statement)
        && TYPE.isStringLiteral(statement.expression)) return statement.expression.value;
    if (expression && TYPE.isStringLiteral(expression)) return expression.value;
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
    const cleanupValue = markerValueOf(plan.cleanupMarker, plan.cleanupExpr);
    if (cleanupValue.length === 0) return null;
    const guardValue = markerValueOf(plan.guardMarker, plan.guardExpr);
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

/** 直接持有某个语句表的语句节点(以及从函数体到它的语句链) */
interface StatementListOwner {
    statement: TYPE.Statement | null;
    chain: TYPE.Statement[];
}

function findStatementListOwner(root: any, list: TYPE.Statement[]): StatementListOwner | null {
    const visit = (node: any, chain: TYPE.Statement[]): StatementListOwner | null => {
        if (!node || typeof node !== "object" || !node.type) return null;
        for (const key of TYPE.VISITOR_KEYS[node.type] ?? []) {
            const value = node[key];
            if (Array.isArray(value)) {
                if (value === list) {
                    return { statement: chain.length > 0 ? chain[chain.length - 1] : null, chain };
                }
                for (const item of value) {
                    if (!item || typeof item !== "object" || !item.type) continue;
                    const found = visit(item, TYPE.isStatement(item) ? chain.concat([item]) : chain);
                    if (found) return found;
                }
            } else if (value && typeof value === "object") {
                const found = visit(value, chain);
                if (found) return found;
            }
        }
        return null;
    };
    return visit(root, []);
}

/** 寄存器搬运语句(`v1 = v0` / `acc = v37`),循环之后的哨兵残渣只允许这种 */
function isRegisterMove(statement: any): boolean {
    if (!TYPE.isExpressionStatement(statement) || !TYPE.isAssignmentExpression(statement.expression)) return false;
    const { left, right, operator } = statement.expression;
    return operator === "=" && TYPE.isIdentifier(left) && TYPE.isIdentifier(right);
}

/**
 * handler 体开头的接线语句:注入的 `acc = catchAcc`、finally 标记、寄存器搬运。
 * 这些不算用户 catch 的正文,`applyPlans` 用它区分「handler 本身就是 finally」
 * (v24 的 finally handler)和「用户 catch 后面又跟了同一段 cleanup」。
 */
function isHandlerWiring(statement: any): boolean {
    return isFinallyMarker(statement) || isRegisterMove(statement);
}

/** 语句本身就是携带指定值的 finally 标记(`MARKER_PREFIX<id>_<role>`) */
function isFinallyMarkerWithValue(statement: any, value: string): boolean {
    return TYPE.isExpressionStatement(statement) && TYPE.isStringLiteral(statement.expression)
        && statement.expression.value === value;
}

/** 子树里是否存在指定值的字符串字面量(找 else 分支里的 end 标记) */
function containsStringLiteralValue(node: any, value: string): boolean {
    if (!node || typeof node !== "object" || !node.type) return false;
    if (TYPE.isStringLiteral(node) && node.value === value) return true;
    for (const key of TYPE.VISITOR_KEYS[node.type] ?? []) {
        const child = node[key];
        if (Array.isArray(child)) {
            for (const item of child) if (containsStringLiteralValue(item, value)) return true;
        } else if (containsStringLiteralValue(child, value)) return true;
    }
    return false;
}

/**
 * `try { do { … } while (cond) } finally { … }`(lnga SocialListSettings.runFavoritesSyncLoop):
 *
 *   try {                                       ← finally handler 生成成的 try/catch
 *     START; <循环体>;
 *     if (!cond) { C_MARKER; <cleanup>; G_MARKER; <哨兵比较>; if (pending != hole) { throw } else { END; return } }
 *   } catch { <异常保存>; C_MARKER; <cleanup>; G_MARKER; … }
 *
 * 外层是 `while (true)`(归约没有把 do-while 的尾部测试还原到 test 里)。
 * 还原:退出分支里从 cleanup 标记到守卫 if 的整段副本换成 `break`(finally 反正
 * 会执行),去掉 try-as-catch 包装,把循环还原成 do-while(`if (T) break` 尾部守卫
 * ⇔ `while (!T)`),最后把循环整体包进 try/finally——finally 只在循环结束后执行
 * 一次,与源码一致。continue 在 do-while 里会先求 test,与 while(true) 的语义不同,
 * 循环体里有绑定到本循环的 continue 时放弃。
 */
function applyLoopExitGuardFinally(
    astNode: any,
    plan: FinallyPlan,
    tryOwner: TYPE.TryStatement,
    startList: TYPE.Statement[],
): boolean {
    if (!tryOwner.handler || tryOwner.finalizer) return false;
    const cleanupValue = markerValue(plan, "cleanup");
    const guardValue = markerValue(plan, "guard");
    const endValue = markerValue(plan, "end");
    // handler 副本:cleanup/guard 标记(语句或表达式)
    const handlerBody = tryOwner.handler.body.body;
    let cleanupIdx = handlerBody.findIndex((statement) => isFinallyMarkerWithValue(statement, cleanupValue));
    const cleanupIsRoot = cleanupIdx >= 0;
    if (cleanupIdx < 0) {
        cleanupIdx = handlerBody.findIndex((statement) => containsStringLiteralValue(statement, cleanupValue));
    }
    if (cleanupIdx < 0) return false;
    let guardIdx = handlerBody.findIndex((statement) => isFinallyMarkerWithValue(statement, guardValue));
    if (guardIdx < 0) {
        guardIdx = handlerBody.findIndex((statement) => containsStringLiteralValue(statement, guardValue));
    }
    if (guardIdx <= cleanupIdx) return false;
    const finallyStatements = handlerBody.slice(cleanupIsRoot ? cleanupIdx + 1 : cleanupIdx, guardIdx);
    if (finallyStatements.length === 0) return false;
    // 循环必须是 try 的直接父语句,而且 try 是它的唯一语句
    const innerPos = locateStatementPosition(astNode, tryOwner);
    if (!innerPos) return false;
    const loopOwner = findStatementListOwner(astNode, innerPos.list);
    if (!loopOwner || !loopOwner.statement) return false;
    const loopStatement = loopOwner.statement;
    if (!TYPE.isWhileStatement(loopStatement)) return false;
    const loop = loopStatement;
    if (!TYPE.isBooleanLiteral(loop.test) || loop.test.value !== true) return false;
    if (!TYPE.isBlockStatement(loop.body)) return false;
    if (loop.body.body.length !== 1 || loop.body.body[0] !== tryOwner) return false;
    // 退出分支:try 体最后一条 if,分支从 cleanup 标记开始、以带 end 标记的守卫收尾
    const exitIf = startList[startList.length - 1];
    if (!exitIf || !TYPE.isIfStatement(exitIf) || exitIf.alternate) return false;
    if (!TYPE.isBlockStatement(exitIf.consequent)) return false;
    const branchBody = exitIf.consequent.body;
    if (branchBody.length === 0) return false;
    if (!containsStringLiteralValue(branchBody[0], cleanupValue)) return false;
    const branchCleanupRoot = isFinallyMarkerWithValue(branchBody[0], cleanupValue);
    let branchGuardIdx = -1;
    for (let index = 1; index < branchBody.length; index++) {
        if (containsStringLiteralValue(branchBody[index], guardValue)) { branchGuardIdx = index; break; }
    }
    if (branchGuardIdx < 0) return false;
    // 分支尾部必须是一条携带 end 标记的守卫 if,且它的非抛出分支是方法尾
    const guardIf = branchBody[branchBody.length - 1];
    if (!TYPE.isIfStatement(guardIf) || !containsStringLiteralValue(guardIf, endValue)) return false;
    // 退出分支的 cleanup 副本必须与 handler 副本同型
    const branchCleanup = branchBody.slice(branchCleanupRoot ? 1 : 0, branchGuardIdx);
    if (branchCleanup.length !== finallyStatements.length) return false;
    const reference = finallyStatements.map((statement) => generate(statement).code).join("\n");
    if (branchCleanup.map((statement) => generate(statement).code).join("\n") !== reference) return false;
    // do-while 的 continue 会先求 test,while (true) 的 continue 直接回到循环头
    if (hasContinueBoundToBody(loop.body.body)) return false;
    // 先定位持有循环的语句列表(校验全部通过后才改 AST)
    const parentList = findStatementList(astNode, loop);
    if (!parentList) return false;
    const parentIndex = parentList.indexOf(loop);
    if (parentIndex < 0) return false;
    // 退出分支的副本换成 break(在 finally 里统一执行 cleanup)
    branchBody.splice(0, branchBody.length, TYPE.breakStatement());
    // while (true) { BODY; if (T) break } → do { BODY } while (!T)
    const doWhile = TYPE.doWhileStatement(
        TYPE.unaryExpression("!", exitIf.test),
        TYPE.blockStatement(startList.slice(0, startList.length - 1)),
    );
    const tryNode = tryFinallyNode([doWhile], finallyStatements);
    parentList.splice(parentIndex, 1, tryNode);
    return true;
}

/** 循环体里是否有绑定到本循环的 continue(嵌套循环 / 函数里的不算) */
function hasContinueBoundToBody(statements: TYPE.Statement[]): boolean {
    let found = false;
    const visit = (node: any): void => {
        if (found || !node || typeof node !== "object" || !node.type) return;
        if (TYPE.isFunction(node)) return;
        if (TYPE.isContinueStatement(node)) { found = true; return; }
        if (isLoopStatement(node)) return;
        for (const key of TYPE.VISITOR_KEYS[node.type] ?? []) {
            const child = node[key];
            if (Array.isArray(child)) child.forEach(visit);
            else visit(child);
        }
    };
    statements.forEach(visit);
    return found;
}

/**
 * v24 async 单层 `try { … } catch { … } finally { … }` 的还原。
 *
 * 结构化输出形状(lnga ProfilePanel.startQrLoginScan、SaveThreadDialogs.fetchThreadInfo、
 * LoginPage.importEncryptedCredential、NotificationPanel.loadMorePrivateMessages):
 *
 *   try {                                ← 用户 catch 的 try(外层)
 *     try { START; <try 体> }            ← finally handler 生成成的内层 try/catch
 *     catch { C_MARKER; <cleanup>; G_MARKER; <哨兵比较>; if (pending != hole) { throw } else { END; <方法尾> } }
 *   } catch { <用户 catch> }
 *   C_MARKER; <cleanup>; G_MARKER; <哨兵比较>; if (…) { throw } else { END; <方法尾> }
 *
 * 守卫脚手架把 pending 寄存器重写为 hole 哨兵;两份尾块是同一区域的展开副本。
 * 还原:内层 block(try 体)+ 外层 handler(用户 catch)合并成 try/catch/finally,
 * finally 体取内层 handler 中 cleanup..guard 两标记之间的语句,并删除 try/catch
 * 之后从 cleanup 标记到含 end 标记的守卫语句的整段正常路径副本。哨兵写入随守卫
 * 一起消失,`if (flag == undefined)` 的清理包装由 simplify 折成普通语句。
 * 仅接受 endIsMethodTail(守卫 else 里只是隐式方法尾,丢弃)。
 */
function applyHandlerWrappedCatchFinally(
    astNode: any,
    plan: FinallyPlan,
    innerTry: TYPE.TryStatement,
): boolean {
    if (!innerTry.handler || innerTry.finalizer) return false;
    const cleanupValue = markerValue(plan, "cleanup");
    const guardValue = markerValue(plan, "guard");
    const endValue = markerValue(plan, "end");
    const handlerBody = innerTry.handler.body.body;
    // cleanup/guard 标记:语句标记,或被结构化进条件 test 的表达式标记(取包含它的整条语句)
    let cleanupIdx = handlerBody.findIndex((statement) => isFinallyMarkerWithValue(statement, cleanupValue));
    const cleanupIsRoot = cleanupIdx >= 0;
    if (cleanupIdx < 0) {
        cleanupIdx = handlerBody.findIndex((statement) => containsStringLiteralValue(statement, cleanupValue));
    }
    if (cleanupIdx < 0) return false;
    let guardIdx = handlerBody.findIndex((statement) => isFinallyMarkerWithValue(statement, guardValue));
    if (guardIdx < 0) {
        guardIdx = handlerBody.findIndex((statement) => containsStringLiteralValue(statement, guardValue));
    }
    if (guardIdx <= cleanupIdx) return false;
    // 表达式标记时包含它的整条语句都属于 finally 体(与常规布局的 finallyStart 语义一致)
    const finallyStatements = handlerBody.slice(cleanupIsRoot ? cleanupIdx + 1 : cleanupIdx, guardIdx);
    if (finallyStatements.length === 0 || finallyStatements.some((statement) => hasDeclaration([statement]))) return false;
    // 内层 try 必须是外层用户 catch try 体的唯一语句
    const innerPos = locateStatementPosition(astNode, innerTry);
    if (!innerPos) return false;
    const outerTry = findTryStatementForBlock(astNode, innerPos.list);
    if (!outerTry || outerTry === innerTry || !outerTry.handler || outerTry.finalizer) return false;
    if (outerTry.block.body.length !== 1 || outerTry.block.body[0] !== innerTry) return false;
    const outerPos = locateStatementPosition(astNode, outerTry);
    if (!outerPos) return false;
    const mainList = outerPos.list;
    const outerIndex = outerPos.index;
    // 正常路径副本必须紧跟这条 try/catch,并以 cleanup 标记(语句或表达式)开头
    const duplicateHead = mainList[outerIndex + 1];
    if (!duplicateHead || !containsStringLiteralValue(duplicateHead, cleanupValue)) return false;
    const duplicateRoot = isFinallyMarkerWithValue(duplicateHead, cleanupValue);
    // 守卫标记:cleanup 副本之后携带 guard 标记的语句(与 finally 体等长的窗口内)
    let guardDup = -1;
    const windowEnd = Math.min(mainList.length, outerIndex + 2 + finallyStatements.length + 8);
    for (let index = outerIndex + 2; index < windowEnd; index++) {
        if (containsStringLiteralValue(mainList[index], guardValue)) { guardDup = index; break; }
    }
    if (guardDup < 0) return false;
    // 守卫语句:guard 标记之后几条哨兵比较内的 if,子树里带 end 标记(else 方法尾)
    let guardIf = -1;
    for (let index = guardDup + 1; index < mainList.length && index <= guardDup + 8; index++) {
        const statement = mainList[index];
        if (containsStringLiteralValue(statement, cleanupValue) || containsStringLiteralValue(statement, guardValue)) {
            return false;
        }
        if (TYPE.isIfStatement(statement)) {
            if (!containsStringLiteralValue(statement, endValue)) return false;
            guardIf = index;
            break;
        }
    }
    if (guardIf < 0) return false;
    // 两份 cleanup 必须同型(同一区域的两次展开)
    const duplicateCleanup = mainList.slice(duplicateRoot ? outerIndex + 2 : outerIndex + 1, guardDup);
    if (duplicateCleanup.length !== finallyStatements.length) return false;
    const reference = finallyStatements.map((statement) => generate(statement).code).join("\n");
    if (duplicateCleanup.map((statement) => generate(statement).code).join("\n") !== reference) return false;
    // 非方法尾:守卫的非抛出分支是 try/finally 之后的正常继续,搬回合并节点之后
    // (24+ 的 `if (pending != hole) { throw } else { END; continuation }`,或
    // `if (pending == hole) { continuation } throw pending`)。
    let continuation: TYPE.Statement[] = [];
    let removeThrough = guardIf;
    if (!plan.endIsMethodTail) {
        const guardStatement = mainList[guardIf];
        const endMarkerValue = markerValueOf(plan.endMarker, plan.endExpr) || null;
        const extracted = extractGuardContinuation(guardStatement as TYPE.IfStatement, endMarkerValue);
        continuation = extracted.statements;
        if (!extracted.fromEndMarker) {
            const afterGuard = mainList[guardIf + 1];
            if (TYPE.isThrowStatement(afterGuard) && !branchEndsWithThrow((guardStatement as TYPE.IfStatement).consequent)) {
                continuation = branchStatements((guardStatement as TYPE.IfStatement).consequent).slice();
                removeThrough = guardIf + 1;
            }
        }
        // 续接里不能带块级声明(会被搬出守卫分支,作用域改变)
        if (continuation.length === 0 || hasDeclaration(continuation)) return false;
    }
    // 合并:内层 block(含 START 标记,stripMarkers 统一清掉)+ 外层 handler + finally
    const merged = TYPE.tryStatement(innerTry.block, outerTry.handler, bodyBlock(finallyStatements));
    mainList.splice(outerIndex, removeThrough - outerIndex + 1, merged, ...continuation);
    return true;
}

/**
 * 循环耗尽分支里的 finally。
 *
 * ArkTS 把 `for (… of …) { … }` 之后的代码放进 done 分支(done 就跳出循环),而
 * try/finally 的 cleanup/guard 又跟在 for-of 之后,于是归约出来是:
 *
 *   do { … if (done) { <post-loop>; cleanup; guard } … } while (…)
 *   acc = v37; throw acc;            // v37 = hole 的哨兵重抛
 *
 * done 路径本来就是 try 体的正常完成(guard 里 `if (hole == v9) return` 立刻返回),
 * 循环之后的 `throw hole` 是编译器内联 finally 时的"跳到 cleanup"记号。还原成真实
 * try/finally 后:
 *  - done 分支只留 `<post-loop>` + `break`(跳出循环后继续执行 try 体尾部);
 *  - 哨兵重抛整段丢弃(异常由 finally 自然处理);
 *  - cleanup 段(`[cleanup 标记, guard 标记)`)成为 finally 体。
 *
 * 要求 done 分支就是紧贴循环体的那个 if(中间没有别的循环/switch),循环是 try 体
 * 末尾唯一的结构语句,循环之后只剩寄存器恢复 + 哨兵 throw。
 */
/**
 * 循环之后的顶层 finally:try 体是循环本身,cleanup/guard 紧跟在循环后面,和循环
 * 在同一个语句列表里(不是循环的 done 分支)。
 *
 * 源码 `try { while (…) { … } } finally { cleanup }` 的正常完成路径被编译成
 * 「循环结束 → cleanup → 哨兵守卫 → 续接」,cleanup/guard 直接排在循环之后;起始
 * 标记在循环头的 if test 里,所以 `startList` 是循环体、循环是它的父节点。
 * amcl n4/o8 `#~@0>#drain` 是样本(cleanup 本身还带一个条件:
 * `if (v5 != undefined) this.draining = false`)。
 */
function applyLoopFollowedByCleanup(
    astNode: any,
    startList: TYPE.Statement[],
    cleanupPos: MarkerPosition,
    guardPos: MarkerPosition,
    plan: FinallyPlan,
): boolean {
    if (guardPos.list !== cleanupPos.list) return false;
    const parentList = cleanupPos.list;
    const startOwner = findStatementListOwner(astNode, startList);
    const loop = startOwner?.statement;
    if (!loop || !isLoopStatement(loop)) return false;
    const loopIndex = parentList.indexOf(loop);
    if (loopIndex < 0) return false;
    const cleanup = cleanupPos.index;
    // cleanup 必须紧跟循环,guard 在它之后
    if (cleanup !== loopIndex + 1) return false;
    const guard = guardPos.index;
    if (guard <= cleanup) return false;
    const guardIf = findNextIfStatement(parentList, guard + 1);
    // 守卫必须是列表最后一条;续接(正常完成)在它的非抛出分支里
    if (!guardIf || guardIf.index !== parentList.length - 1) return false;
    let continuation: TYPE.Statement[] = [];
    if (!plan.endIsMethodTail) {
        const extracted = extractLoopContinuation(plan, guardIf.statement);
        if (!extracted) return false;
        continuation = extracted;
    }
    const finallyStatements = parentList.slice(cleanup + 1, guard);
    if (finallyStatements.length === 0) return false;
    const tryNode = tryFinallyNode([loop], finallyStatements);
    parentList.splice(loopIndex, guardIf.index + 1 - loopIndex, tryNode, ...continuation);
    return true;
}

function applyLoopExhaustedFinally(
    astNode: any,
    startList: TYPE.Statement[],
    tryStart: number,
    cleanupPos: MarkerPosition,
    guardPos: MarkerPosition,
    plan: FinallyPlan,
): boolean {
    const cleanupList = cleanupPos.list;
    if (guardPos.list !== cleanupList) return false;
    const cleanup = cleanupPos.index;
    const guard = guardPos.index;
    if (cleanup < 0 || guard <= cleanup) return false;
    const owner = findStatementListOwner(astNode, cleanupList);
    if (!owner || !owner.statement || !TYPE.isIfStatement(owner.statement) || owner.chain.length < 2) return false;
    // 分支必须是这个 if 的直接分支块,且 if 直接挂在循环体里
    const ifStatement = owner.statement;
    const branchBody = (branch: any): TYPE.Statement[] | null =>
        branch && TYPE.isBlockStatement(branch) ? branch.body : null;
    if (branchBody(ifStatement.consequent) !== cleanupList && branchBody(ifStatement.alternate) !== cleanupList) return false;
    const loop = owner.chain[owner.chain.length - 2];
    if (!isLoopStatement(loop)) return false;
    const loopIndex = startList.indexOf(loop);
    // guard 的正常分支必须是方法的隐式收尾(落空等价于 `return undefined`),
    // 否则 done 路径原本的返回值会被丢掉;非收尾的计划可以把非抛出分支里的
    // 续接语句抽出来放到 try/finally 之后(见下面的 continuation)。
    if (!plan.endIsMethodTail && !plan.restoreContinuation) return false;
    const finallyStatements = cleanupList.slice(cleanupPos.inExpression ? cleanup : cleanup + 1, guard);
    if (finallyStatements.length === 0) return false;

    // 守卫语句(guard 标记之后第一条 IfStatement)与它的非抛出续接。正常完成
    // 分支在 end 标记之后:amcl n16 `migrateHistory_` 的
    // `if (pending != hole) throw pending else { await drain(); changed(); return }`,
    // 续接语句在循环结束后、try/finally 之后执行。
    const guardIf = findNextIfStatement(cleanupList, guard + 1);
    let continuation: TYPE.Statement[] = [];
    if (!plan.endIsMethodTail) {
        const extracted = extractLoopContinuation(plan, guardIf?.statement ?? null);
        if (!extracted) return false;
        continuation = extracted;
    }

    if (loopIndex < 0) {
        // 起始标记在循环体内部(循环头 `if` 的 test 里):try 体就是循环本身,
        // 外层列表持有这个循环。amcl n16 `migrateHistory_` 是这种形态。
        const parentList = findStatementList(astNode, loop);
        if (!parentList) return false;
        const parentIndex = parentList.indexOf(loop);
        if (parentIndex < 0) return false;
        cleanupList.splice(cleanup, cleanupList.length - cleanup);
        cleanupList.push(TYPE.breakStatement());
        const tryNode = tryFinallyNode([loop], finallyStatements);
        parentList.splice(parentIndex, 1, tryNode, ...continuation);
        return true;
    }
    if (loopIndex < tryStart) return false;
    if (!plan.endIsMethodTail) return false;
    // 循环之后:寄存器恢复 + 唯一的哨兵 throw
    const tail = startList.slice(loopIndex + 1);
    const throws = tail.filter((statement) => TYPE.isThrowStatement(statement));
    if (throws.length !== 1) return false;
    const throwIndex = tail.indexOf(throws[0]);
    if (tail.slice(throwIndex + 1).some((statement) => !isRegisterMove(statement))) return false;
    if (tail.slice(0, throwIndex).some((statement) => !isRegisterMove(statement))) return false;
    // 哨兵 throw 只能抛一个寄存器(`acc = v37; throw acc;`)
    const thrown = (throws[0] as TYPE.ThrowStatement).argument;
    if (!thrown || !TYPE.isIdentifier(thrown)) return false;
    // done 分支尾部整段都是 cleanup/guard 脚手架
    cleanupList.splice(cleanup, cleanupList.length - cleanup);
    cleanupList.push(TYPE.breakStatement());
    // 丢弃哨兵重抛及其前面的寄存器恢复
    startList.splice(loopIndex + 1, startList.length - loopIndex - 1);
    const tryStatements = startList.slice(tryStart);
    const tryNode = tryFinallyNode(tryStatements, finallyStatements);
    startList.splice(tryStart, startList.length - tryStart, tryNode);
    return true;
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
        const guards: MarkerOccurrence[] = [];
        collectMarkerOccurrences(astNode, markerValue(plan, "guard"), [], guards);
        if (cleanups.length < 2 && !(cleanups.length === 1 && guards.length >= 2)) continue;
        const tails: Array<{ list: TYPE.Statement[]; start: number; end: number; chain: MarkerOccurrence["chain"] }> = [];
        for (const cleanup of cleanups) {
            const guard = guards.find((candidate) => candidate.list === cleanup.list
                && candidate.index >= cleanup.index);
            // 从 cleanup 到列表末尾就是这段尾块(守卫的“正常继续”分支还在守卫语句里,
            // end 标记也在里面);两条分支必须逐字相同才会被认成同一段。
            if (!guard) continue;
            tails.push({ list: cleanup.list, start: cleanup.index, end: cleanup.list.length - 1, chain: cleanup.chain });
        }
        if (tails.length < 2 && cleanups.length === 1 && guards.length >= 2) {
            // cleanup 只有一份、守卫被复制进 if 的两条分支:await resume 派发的
            // `if (resumeMode === undefined) { …; GUARD } else { GUARD }` 没有 goto,
            // 归约把共用的守卫尾块按引用展开到两条分支上(amcl l8 `jarFreeze` 的
            // 外层 finally)。把守卫尾块本身当共享尾块上提:
            // `if (C) { A; GUARD } else { GUARD }` → `if (C) { A } GUARD`,
            // 之后 cleanup/guard 落在同一层,常规布局才能把 cleanup 段挂成 finally。
            for (const guard of guards) {
                tails.push({ list: guard.list, start: guard.index, end: guard.list.length - 1, chain: guard.chain });
            }
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
            if (hasDeclaration(statements)) continue;
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
