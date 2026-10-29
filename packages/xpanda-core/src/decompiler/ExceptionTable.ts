import type { PandaIRCFG } from "../disasm/PandaIRCFG";
import type { PandaIRBasicBlock } from "../disasm/PandaIRBasicBlock";
import type { PandaMethodTryBlock } from "../file/method/PandaMethodTryBlock";
import { buildFinallyPlans, comparesHoleWith, type FinallyPlan } from "./TryFinally";
import type { ValueDefinition } from "./ValueAnalysis";
import { instructionAccess, ValueAnalysis } from "./ValueAnalysis";
import {
    blockLoadsHole,
    blockThrowsRegister,
    isAsyncDispatchInstruction,
    isHoleLoadInstruction,
} from "./IRPatterns";

/**
 * try 表分类:ArkTS 把语言特性(for-in / for-of / async / generator)以及 finally
 * 都编译成**无类型 catch-all** 条目,`codeSize` 恒为 0,真正的语义只能从 handler
 * 的指令形状判断。这里把判定集中到一处,区域图构建只消费结论。
 *
 * 分类结果的两层作用:
 *   - `keep`:该条目是否作为真正的 try/catch(或需要输出 cleanup 的内联 finally
 *     异常路径)接进区域图;
 *   - `protectedEndPC`:try 体吸收语句的边界(原 Region.tryBodyEndPC 的决策)。
 *
 * 判定本身是从 RegionGraphBuilder 原样迁移的(见 docs/BYTECODE_PATTERNS.md §2),
 * 迁移阶段不改变任何一条规则的先后顺序。
 * @Author: jmp0
 */
export type HandlerKind =
    | "userCatch"
    | "ignoredCatch"
    | "emptyJoin"
    | "finallyEpilogue"
    | "classicFinally"
    | "pureRethrow"
    | "forInAcquire"
    | "forOfClose"
    | "asyncReject"
    | "asyncGeneratorReject"
    | "resumeThrowArm"
    | "noProtectedRange"
    | "unknown";

export interface TryEntry {
    readonly tryBlock: PandaMethodTryBlock;
    readonly startPC: number;
    readonly endPC: number;
    readonly tryEntryBlock: PandaIRBasicBlock | null;
    readonly handlerEntryBlock: PandaIRBasicBlock | null;
    readonly kind: HandlerKind;
    /** 是否接进区域图 */
    readonly keep: boolean;
    /** try 体吸收语句的结束 pc(不含);null 表示不切割 */
    readonly protectedEndPC: number | null;
    readonly usesException: boolean;
    /** handler 的每条路径都离开 try 范围 */
    readonly exits: boolean;
    /** catch 跳回循环头(源码 continue) */
    readonly loopContinue: boolean;
}

export interface ExceptionTable {
    readonly entries: TryEntry[];
    /** await 拒绝派发块 → 整体标记 async 函数 */
    isAsyncFunction: boolean;
    /** createGeneratorObj 派发 → 整体标记 generator 函数 */
    isGeneratorFunction: boolean;
}

/**
 * 纯 rethrow 处理器:`sta vX; [mov 恢复寄存器 / poplexenv]; lda vX; throw`。
 * 模块初始化的词法环境清理、for-of 的迭代器关闭清理、24.0.0.0 的 finally
 * 前置跳板都用这个形状,接进区域图只会多出一层语义等价的
 * `catch (e) { throw e }`,还会破坏 for-of 还原。
 */
export function isPureRethrowHandler(block: PandaIRBasicBlock): boolean {
    const instructions = block.pandaInstructions;
    if (instructions.length < 3) return false;
    const store = instructions[0];
    if (store.kind !== "store") return false;
    const saved = (store as any).destObj;
    if (!saved) return false;
    if (instructions[instructions.length - 1].kind !== "throw") return false;
    const load = instructions[instructions.length - 2];
    if (load.kind !== "load" || (load as any).loadType !== "OBJECT") return false;
    const loaded = (load as any).loadParam;
    if (!loaded || loaded.toString() !== saved.toString()) return false;
    // 保存异常和重新加载之间只允许恢复寄存器 / 关闭词法环境(异常值本身未改变)
    for (let i = 1; i < instructions.length - 2; i++) {
        const kind = instructions[i].kind;
        if (kind !== "mov" && kind !== "popLexEnv" && kind !== "nop") return false;
    }
    return true;
}

/**
 * finally 处理器:入口 `sta vX` 保存异常,清理代码之后用 hole 哨兵和 X 比较,
 * 由 X 是否等于 hole 决定正常继续还是重抛:
 *   ldhole; sta vt; lda X; noteq vt; ...; <正常继续> / `lda X; throw`
 * 经典形状(正常完成块写 hole 哨兵再跳到 cleanup)由 TryFinally 还原,不接进
 * 区域图;24.0.0.0 的内联 finally 只剩异常清理路径,必须接进图输出 cleanup,
 * 再由 foldEagerCatchToFinally 还原成 try/finally。
 */
export function isFinallyHandler(cfg: PandaIRCFG, block: PandaIRBasicBlock): boolean {
    const first = block.pandaInstructions[0];
    if (!first || first.kind !== "store") return false;
    const saved = (first as any).destObj;
    if (!saved) return false;
    const savedName = saved.toString();
    const visited = new Set<PandaIRBasicBlock>();
    const queue: PandaIRBasicBlock[] = [block];
    let budget = 32;
    while (queue.length > 0 && budget-- > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);
        if (current !== block && comparesHoleWith(current, savedName)) {
            for (const successor of cfg.graph.normalSuccessors(current)) {
                if (blockThrowsRegister(successor, savedName)) return true;
            }
        }
        for (const successor of cfg.graph.normalSuccessors(current)) {
            if (!visited.has(successor)) queue.push(successor);
        }
    }
    return false;
}

/**
 * 入口 `sta vX` 保存的异常随后被使用: `mov dst, vX`,或 `lda vX` 且下一条
 * 不是 `throw`。`lda vX; throw` 只是重抛,不算用户 catch。
 */
export function catchUsesException(block: PandaIRBasicBlock): boolean {
    const entry = handlerEffectiveEntry(block);
    if (!entry.exceptionRegister) return false;
    const saved = entry.exceptionRegister;
    const instructions = block.pandaInstructions;
    for (let i = entry.start + 1; i < instructions.length; i++) {
        const instruction = instructions[i];
        const moved = instruction.kind === "mov" && instruction.srcObj?.toString() === saved;
        const loaded = instruction.kind === "load" && instruction.loadType === "OBJECT"
            && (instruction as { loadParam?: { toString(): string } }).loadParam?.toString() === saved;
        if (!moved && !loaded) continue;
        const next = instructions[i + 1];
        if (loaded && next && next.kind === "throw") continue;
        return true;
    }
    return false;
}

/**
 * Empty catch that skips exactly one success-path `mov` and rejoins.
 * Returns the continuation pc (the mov belongs to the try), or null.
 * `try { v0 = 0; v1 = stat() } jmp; mov v0, v1; formula` with handler
 * `jmp formula` is `try { v0 = stat() } catch {} formula` (y1267).
 */
export function skippedCommitEnd(cfg: PandaIRCFG, entry: PandaIRBasicBlock, tryEnd: number): number | null {
    if (entry.pandaInstructions.length !== 1 || entry.pandaInstructions[0].kind !== "jumpDirect") return null;
    const targets = cfg.graph.normalSuccessors(entry);
    if (targets.length !== 1) return null;
    const continuation = targets[0];
    if (continuation.getStartPC() < tryEnd) return null;
    const exit = cfg.getBasicBlockByPC(tryEnd);
    if (!exit || exit.pandaInstructions.length !== 1 || exit.getTerminator().kind !== "jumpDirect") return null;
    const commits = cfg.graph.normalSuccessors(exit);
    if (commits.length !== 1) return null;
    const commit = commits[0];
    if (commit.pandaInstructions.length !== 1 || commit.pandaInstructions[0].kind !== "mov") return null;
    const after = cfg.graph.normalSuccessors(commit);
    if (after.length !== 1 || after[0] !== continuation) return null;
    return continuation.getStartPC();
}

/**
 * Handler entry that does not save the exception, load the finally sentinel,
 * or consist of a bare jump. Shared by the "ignored exception" catch shapes.
 */
function startsLikeIgnoredCatch(entry: PandaIRBasicBlock): boolean {
    const first = entry.pandaInstructions[0];
    if (!first || first.kind === "store" || first.kind === "throw") return false;
    if (isHoleLoadInstruction(first)) return false;
    if (first.kind === "jumpDirect" || first.opcode.name === "jmp") return false;
    return true;
}

/**
 * Bounded breadth-first walk over normal edges. `visit` may return true to stop
 * early; `follow` decides whether an edge is traversed. Returns true when the
 * walk stopped early.
 */
function walkForward(
    cfg: PandaIRCFG,
    entry: PandaIRBasicBlock,
    budget: number,
    visit: (block: PandaIRBasicBlock) => boolean,
    follow: (block: PandaIRBasicBlock, successor: PandaIRBasicBlock) => boolean = () => true,
): boolean {
    const seen = new Set<PandaIRBasicBlock>();
    const queue: PandaIRBasicBlock[] = [entry];
    let remaining = budget;
    while (queue.length > 0 && remaining-- > 0) {
        const block = queue.shift()!;
        if (seen.has(block)) continue;
        seen.add(block);
        if (visit(block)) return true;
        for (const successor of cfg.graph.normalSuccessors(block)) {
            if (follow(block, successor)) queue.push(successor);
        }
    }
    return false;
}

/**
 * 忽略异常值的 catch:handler 不以 `sta` 开头。
 * `ldnull; return`、单条 `mov`(保留默认值),或常量日志后 return。
 * 单条 `jmp` 默认不接:它常常跳过成功路径上的一条赋值再汇合,盲目接进图
 * 会把汇合点拆坏。`skippedCommitEnd` 只认「跳过恰好一条 mov」这一种,
 * 并把那条 mov 留在 try 的成功路径里(y1267 的空 catch)。
 * 多条 `mov` 是 for-of close 的寄存器倒换,不能接进图。
 */
export function isIgnoredExceptionCatch(cfg: PandaIRCFG, entry: PandaIRBasicBlock): boolean {
    if (!startsLikeIgnoredCatch(entry)) return false;
    const first = entry.pandaInstructions[0];
    if (first.kind === "mov") {
        if (entry.pandaInstructions.length === 1) return true;
        // Spill reloads, then `return ""` / `return null`. The exception
        // value is unused (readJarMainClass's manifest read).
        let index = 0;
        while (index < entry.pandaInstructions.length && entry.pandaInstructions[index].kind === "mov") index++;
        if (index === 0 || index === entry.pandaInstructions.length) return false;
        let returns = false;
        let constant = false;
        for (const instruction of entry.pandaInstructions.slice(index)) {
            if (instruction.kind === "throw" || instruction.kind === "call") return false;
            if (instruction.kind === "return" || instruction.opcode.name === "asyncfunctionresolve") returns = true;
            if (instruction.kind === "load" && (instruction.loadType === "STRING"
                || instruction.loadType === "NULL" || instruction.loadType === "UNDEFINED")) constant = true;
            if (instruction.opcode.name === "ldnull" || instruction.opcode.name === "ldundefined"
                || instruction.opcode.name === "lda.str" || instruction.opcode.name === "ldai") constant = true;
        }
        return returns && constant;
    }
    if (first.opcode.name === "ldnull") {
        return entry.pandaInstructions.some((instruction) => instruction.kind === "return");
    }
    let sawString = false;
    let sawReturn = false;
    let sawThrow = false;
    const start = entry.getStartPC();
    walkForward(cfg, entry, 6, (block) => {
        for (const instruction of block.pandaInstructions) {
            if (instruction.kind === "throw") sawThrow = true;
            if (instruction.kind === "return") sawReturn = true;
            if (instruction.kind === "load" && instruction.loadType === "STRING") sawString = true;
        }
        return false;
    }, (_block, successor) => {
        // A handler that jumps back into the loop (an empty catch whose
        // "continue" lands on the latch) is not a constant-log handler:
        // following the back edge would walk the whole loop body and find
        // its strings/returns (`o8.clearDisplayListeners`).
        return successor.getStartPC() > start;
    });
    return sawString && sawReturn && !sawThrow;
}

/**
 * Empty catch whose handler block *is* the try's normal continuation: the
 * compiler lowers `try { … } catch {}` by making the handler PC the block the
 * success path already falls through to. The handler is reachable normally, so
 * using it as the catch body would copy the whole continuation into the catch
 * (`hx360e AppLog.init` duplicated `rotateIfNeeded` + the second try + log).
 * RegionGraphBuilder replaces the handler with an empty region; the block stays
 * the normal continuation.
 */
export function isEmptyJoinHandler(
    cfg: PandaIRCFG,
    handlerEntryBlock: PandaIRBasicBlock,
    endPC: number,
): boolean {
    if (cfg.graph.normalPredecessors(handlerEntryBlock).length === 0) return false;
    // A finally suppress block writes the hole sentinel and is then shared as a
    // normal-completion join; it is not an empty catch (`FollowListPanel.loadMore`
    // try/finally lost its plan and leaked `hole`).
    if (blockLoadsHole(handlerEntryBlock)) return false;
    let block = cfg.getBasicBlockByPC(endPC);
    // The success path must jump *over* the handler to reach it. When the
    // handler starts exactly at the try end, the block there is a catch body
    // shared with an internal branch (`AppUpdateClient.checkLatestRelease`:
    // the `if (v4 === undefined)` branch joins the handler), not an
    // empty-catch bridge. The one safe exception is a terminal handler block:
    // the compiler merged the catch's own return/throw with the continuation,
    // so both paths end the same way (`AppLog.append`'s method-tail return).
    if (!block || block === handlerEntryBlock) {
        return block === handlerEntryBlock
            && cfg.graph.normalSuccessors(handlerEntryBlock).length === 0;
    }
    const seen = new Set<PandaIRBasicBlock>();
    while (block && block !== handlerEntryBlock) {
        if (seen.has(block) || block.getStartPC() >= handlerEntryBlock.getStartPC()) return false;
        seen.add(block);
        const instructions = block.pandaInstructions;
        if (instructions.length !== 1 || block.getTerminator().kind !== "jumpDirect") return false;
        const successors = cfg.graph.normalSuccessors(block);
        if (successors.length !== 1) return false;
        block = successors[0];
    }
    return block === handlerEntryBlock;
}

/** True when a much larger try of the same method strictly contains this range. */
export function nestedInMuchLargerTry(cfg: PandaIRCFG, tryBlock: { startPC: number; length: number }): boolean {
    const tries = cfg.getPandaMethod().methodCode?.pandaMethodTryBlocks;
    if (!tries) return false;
    const start = tryBlock.startPC;
    const end = start + tryBlock.length;
    for (const other of tries) {
        if (other === tryBlock || other.length < tryBlock.length * 4) continue;
        if (other.length - tryBlock.length < 256) continue;
        const otherStart = other.startPC;
        const otherEnd = otherStart + other.length;
        if (otherStart <= start && otherEnd >= end) return true;
    }
    return false;
}

/** Await resume dispatch: suspend/resume shows up after the entry block. */
export function isAsyncResumeHandler(cfg: PandaIRCFG, entry: PandaIRBasicBlock): boolean {
    return walkForward(cfg, entry, 6, (block) =>
        block.pandaInstructions.some((instruction) => isAsyncDispatchInstruction(instruction)));
}

/**
 * handler 的每条路径都离开 try 范围(return / throw / 落到范围外)。
 * 跳回 try 里面的 catch 会改变循环出口,结构化归约会把循环后的代码内联进循环体。
 */
export function handlerExits(cfg: PandaIRCFG, entry: PandaIRBasicBlock, tryStart: number, tryEnd: number): boolean {
    const seen = new Set<PandaIRBasicBlock>();
    const stack: PandaIRBasicBlock[] = [entry];
    let sawExit = false;
    while (stack.length > 0) {
        const block = stack.pop()!;
        if (seen.has(block)) continue;
        seen.add(block);
        if (seen.size > 16) return false;
        const terminator = block.getTerminator();
        if (terminator.kind === "return" || terminator.kind === "throw") {
            sawExit = true;
            continue;
        }
        const successors = cfg.graph.normalSuccessors(block);
        if (successors.length === 0) {
            sawExit = true;
            continue;
        }
        for (const successor of successors) {
            const pc = successor.getStartPC();
            if (pc >= tryStart && pc < tryEnd) return false;
            stack.push(successor);
        }
    }
    return sawExit;
}

/**
 * Catch body does real work, then jumps to a loop head that sits before the
 * try and is the target of a back edge from inside the try. That edge is the
 * source `continue` (`for (mUrl of urls) { try { ... } catch { warn } }`).
 * Re-entering the try before that head is a different shape and stays out.
 */
export function continuesAtLoopHead(cfg: PandaIRCFG, entry: PandaIRBasicBlock, tryStart: number, tryEnd: number): boolean {
    if (!isCatchHandler(entry)) return false;
    const heads = new Set<PandaIRBasicBlock>();
    for (const block of cfg.pandaIRBasicBlocks) {
        const pc = block.getStartPC();
        if (pc < tryStart || pc >= tryEnd) continue;
        for (const successor of cfg.graph.normalSuccessors(block)) {
            if (successor.getStartPC() < tryStart) heads.add(successor);
        }
    }
    if (heads.size === 0) return false;
    const seen = new Set<PandaIRBasicBlock>();
    const stack: PandaIRBasicBlock[] = [entry];
    while (stack.length > 0) {
        const block = stack.pop()!;
        if (seen.has(block)) continue;
        seen.add(block);
        if (seen.size > 32) return false;
        if (block !== entry) {
            const pc = block.getStartPC();
            if (pc >= tryStart && pc < tryEnd) return false;
            if (heads.has(block)) return true;
        }
        for (const successor of cfg.graph.normalSuccessors(block)) stack.push(successor);
    }
    return false;
}

/**
 * handler 的有效入口:跳过入口处的寄存器恢复前缀(`mov v6, v11` …)。
 *
 * 用户 catch / finally 落点在 try 体里保存过活跃寄存器时,处理器入口先是一串
 * `mov` 把原值恢复回被复用的寄存器,之后才 `sta` 保存异常或做真正的清理
 * (`SettingsPanel.clearCache` 的 catch 入口就是 4 条 mov 之后才 `showToast`)。
 * 这些 mov 是数据流的一部分(handler 体和 try 之后的代码要读恢复后的值),
 * 不能删;但分类不该要求"首条就是 sta"。
 *
 * 返回有效起始下标与异常保存寄存器;前缀太长或整块都是 mov 时按原样处理
 * (start = 0),避免把"纯恢复块"误认成 catch。
 */
export function handlerEffectiveEntry(block: PandaIRBasicBlock): { start: number; exceptionRegister: string | null } {
    const instructions = block.pandaInstructions;
    let start = 0;
    while (start < instructions.length) {
        const kind = instructions[start].kind;
        if (kind !== "mov" && kind !== "nop" && kind !== "popLexEnv") break;
        start++;
    }
    if (start === 0 || start > 8 || start === instructions.length) {
        const first = instructions[0];
        const save = first && first.kind === "store" && first.destObj ? first.destObj.toString() : null;
        return { start: 0, exceptionRegister: save };
    }
    const save = instructions[start];
    return {
        start,
        exceptionRegister: save.kind === "store" && save.destObj ? save.destObj.toString() : null,
    };
}

/** 证明 catch 体在做真实工作的指令形状(见 `isCatchHandler`)。 */
function isCatchBodyWork(instruction: any): boolean {
    if (instruction.kind === "load") {
        return instruction.loadType === "STRING" || instruction.loadType === "GLOBAL";
    }
    // tryldglobalbyname 是独立的 loadGlobal kind:`catch (e) { e instanceof Error
    // … }` 的入口块里只有它和 instanceof/比较,不带 STRING/GLOBAL 载入。
    if (instruction.kind === "loadGlobal") return true;
    if (instruction.kind === "loadObjectBy" || instruction.kind === "storeObject") return true;
    if (instruction.kind === "call") return true;
    return instruction.opcode.name === "ldexternalmodulevar" || instruction.opcode.name === "newobjrange";
}

/**
 * 真正的 catch 处理器:有效入口 `sta vX`,并在 handler 入口基本块里做可见工作
 * (读字符串 / 模块变量 / 属性,或发起调用)。编译器生成的 for-of / await
 * resume 派发 handler 只做寄存器恢复和条件跳转,不具备这些特征,不能接进区域图。
 */
export function isCatchHandler(block: PandaIRBasicBlock): boolean {
    const { start } = handlerEffectiveEntry(block);
    if (block.pandaInstructions[start]?.kind !== "store") return false;
    return block.pandaInstructions.slice(start).some(isCatchBodyWork);
}

/**
 * Catch-and-wrap:寄存器恢复前缀之后构造一个新错误并抛出,入口保存的异常值没被
 * 使用(`catch (e) { throw new Error(…) }`;amcl `e4/k9` 的 "RollbackFailed"、
 * `k10/m10` 的 `doStart`)。这类 handler 不是 finally 落点,旧扫描因为 body 里
 * 带 throw 把它判成 unknown,整个 catch 体随异常边一起丢失。
 */
export function isCatchAndWrapHandler(block: PandaIRBasicBlock): boolean {
    const instructions = block.pandaInstructions;
    if (instructions[0]?.kind !== "mov") return false;
    return instructions.some((instruction) => instruction.opcode.name === "newobjrange")
        && instructions.some((instruction) => instruction.kind === "throw");
}

/**
 * Handler forward body, bounded and stopped at the first block that is also
 * reachable from outside the handler (a join with the normal flow). Compiler
 * dispatch handlers often fall through into the method tail; walking past the
 * join would count normal-path reads as handler work.
 */
interface HandlerForwardBody {
    blocks: PandaIRBasicBlock[];
    /** The body falls out to a join with the normal flow or a loop back edge. */
    rejoin: boolean;
    /** The single join block the body falls out to, when all paths share it. */
    joinTarget: PandaIRBasicBlock | null;
}

function handlerForwardBody(
    cfg: PandaIRCFG,
    entry: PandaIRBasicBlock,
    tryStart: number,
    tryEnd: number,
    budget = 32,
): HandlerForwardBody {
    const closure: PandaIRBasicBlock[] = [];
    const closureSeen = new Set<PandaIRBasicBlock>();
    const closureStack: PandaIRBasicBlock[] = [entry];
    while (closureStack.length > 0 && closure.length < budget) {
        const block = closureStack.pop()!;
        if (closureSeen.has(block)) continue;
        closureSeen.add(block);
        const pc = block.getStartPC();
        if (block !== entry && pc >= tryStart && pc < tryEnd) continue;
        closure.push(block);
        for (const successor of cfg.graph.normalSuccessors(block)) {
            if (successor.getStartPC() <= pc) continue;
            closureStack.push(successor);
        }
    }
    const members = new Set(closure);
    const isJoin = (block: PandaIRBasicBlock): boolean => block !== entry
        && cfg.graph.normalPredecessors(block).some((predecessor) => !members.has(predecessor));
    const body: PandaIRBasicBlock[] = [];
    const seen = new Set<PandaIRBasicBlock>();
    const stack: PandaIRBasicBlock[] = [entry];
    let rejoin = false;
    const joinTargets = new Set<PandaIRBasicBlock>();
    while (stack.length > 0 && body.length < budget) {
        const block = stack.pop()!;
        if (seen.has(block)) continue;
        const pc = block.getStartPC();
        if (block !== entry && pc >= tryStart && pc < tryEnd) continue;
        seen.add(block);
        body.push(block);
        for (const successor of cfg.graph.normalSuccessors(block)) {
            // A join block belongs to the normal continuation, not to the catch
            // body: including it would copy the whole method tail into the
            // catch (`EntryAbility.updateBreakpoint`).
            if (successor.getStartPC() <= pc) {
                rejoin = true;
                continue;
            }
            if (isJoin(successor)) {
                rejoin = true;
                joinTargets.add(successor);
                continue;
            }
            stack.push(successor);
        }
    }
    return { blocks: body, rejoin, joinTarget: joinTargets.size === 1 ? Array.from(joinTargets)[0] : null };
}

interface HandlerBodyFlags {
    work: boolean;
    call: boolean;
    throws: boolean;
    hole: boolean;
    dispatch: boolean;
    returns: boolean;
    /** handler 里做了真实算术(binaryOp)——纯赋值型 catch,不是 mov/jmp 溢写跳板 */
    computes: boolean;
}

function scanHandlerBody(blocks: PandaIRBasicBlock[]): HandlerBodyFlags {
    const flags: HandlerBodyFlags = {
        work: false, call: false, throws: false, hole: false, dispatch: false, returns: false,
        computes: false,
    };
    for (const block of blocks) {
        for (const instruction of block.pandaInstructions) {
            if (isCatchBodyWork(instruction)) flags.work = true;
            if (instruction.kind === "call" || instruction.opcode.name === "newobjrange") flags.call = true;
            if (instruction.kind === "throw") flags.throws = true;
            if (isHoleLoadInstruction(instruction)) flags.hole = true;
            if (isAsyncDispatchInstruction(instruction, true)) flags.dispatch = true;
            if (instruction.kind === "return" || instruction.opcode.name === "asyncfunctionresolve") flags.returns = true;
            if (instruction.kind === "binaryOp") flags.computes = true;
        }
    }
    return flags;
}

/** Handler reachable only through its exception edge (not shared with the success path). */
function isExceptionOnlyHandler(cfg: PandaIRCFG, entry: PandaIRBasicBlock): boolean {
    return cfg.graph.normalPredecessors(entry).length === 0;
}

/**
 * v24 zero-size handler whose exception value is unused, identified by its
 * body shape:
 *  - constant/flag catch: only moves, constant loads, property stores and a
 *    return (`catch { return false }`, `catch { this.loading = false }`);
 *  - work catch: logging / UI / fallback work that rejoins the normal flow or
 *    returns, when the handler is exception-only (no normal predecessor).
 * Compiler cleanup handlers (inline finally / await dispatch) either have a
 * normal predecessor, contain the hole sentinel, or contain await dispatch
 * instructions, so they stay out.
 */
function isIgnoredCatchByBody(
    cfg: PandaIRCFG,
    entry: PandaIRBasicBlock,
    tryStart: number,
    tryEnd: number,
    sharedStartKept: boolean,
): boolean {
    if (isFinallyHandler(cfg, entry)) return false;
    // A handler whose entry saves the exception (`sta vX`) is either a user
    // catch that reads it later or compiler machinery; the ignored-catch rules
    // do not model the saved value across blocks (`TopicListPanel.loadTopics`
    // compared a call result against the exception register).
    if (entry.pandaInstructions[0]?.kind === "store") return false;
    // A handler with a normal predecessor is shared with the success path: its
    // body is already emitted there, and registering a catch would duplicate
    // it (`AudioPlayer.togglePlay`'s shared `return undefined` block).
    if (!isExceptionOnlyHandler(cfg, entry)) return false;
    const { blocks, rejoin, joinTarget } = handlerForwardBody(cfg, entry, tryStart, tryEnd);
    if (blocks.length === 0) return false;
    const flags = scanHandlerBody(blocks);
    if (flags.throws || flags.hole || flags.dispatch) return false;
    // Work catch: may rejoin the normal flow, so a return is not required.
    // 共用 finally 起点的 catch 只有在“以 return 退出”时才安全:落回正常流程的
    // catch 依赖 finally 布局,布局失败会留下 hole 守卫(lnga doFetch 是 return null;
    // amcl g10 checkAccount 是回落型,注册后 finally 布局失败、守卫泄漏)。
    if (flags.work) return flags.returns || rejoin;
    if (!flags.returns) {
        // Bare `jmp` empty catch to a forward join (`try { … } catch {}` then
        // more code). A `mov; jmp` handler restores the compiler's spills;
        // registering it would pull those saves/restores into the catch as
        // `v8 = v10` / `v8 = local_0_2` noise (`DraftMediaStore.inspectDir`,
        // `MovingPhotoCache.pruneCache`). A backward target is a loop latch
        // (continue) and stays out for the same reason (`GameInstall`).
        if (!rejoin || !joinTarget) return false;
        // 纯赋值型 catch:handler 里做真实算术后汇合正常流程
        // (`catch { posX = Math.max(...); posY = ... }`,lnga 各面板的
        // showProfileCard)。mov/jmp 跳板没有 binaryOp,仍留在旧行为。
        if (flags.computes) return true;
        return blocks.every((block) => block.pandaInstructions.every((instruction) =>
            instruction.kind === "jumpDirect" || instruction.kind === "nop"));
    }
    return true;
}

/**
 * Empty catch that rejoins the loop latch: `try { unlinkSync(…) } catch {}`
 * inside a loop compiles to a handler whose body is only register moves plus a
 * jump to the increment block. It has no visible work and no return; the only
 * forwarded jump is the loop back edge.
 */
function isEmptyContinueCatch(
    cfg: PandaIRCFG,
    entry: PandaIRBasicBlock,
    tryStart: number,
    tryEnd: number,
): boolean {
    if (isFinallyHandler(cfg, entry)) return false;
    if (!isExceptionOnlyHandler(cfg, entry)) return false;
    const { blocks } = handlerForwardBody(cfg, entry, tryStart, tryEnd, 12);
    if (blocks.length === 0) return false;
    const flags = scanHandlerBody(blocks);
    if (flags.throws || flags.hole || flags.dispatch || flags.call || flags.work || flags.returns) return false;
    // A bare `jmp` handler is the compiler's "skip one success-path block"
    // trampoline; the join is shared with the normal flow and registering it
    // pulls the surrounding spills into the catch
    // (GameInstall.installArchive). Only register an empty catch when the
    // handler at least restores registers (`mov; jmp`).
    const hasMove = blocks.some((block) => block.pandaInstructions.some((instruction) => instruction.kind === "mov"));
    if (!hasMove) return false;
    const last = blocks[blocks.length - 1];
    if (!last || last.getTerminator().kind !== "jumpDirect") return false;
    const successors = cfg.graph.normalSuccessors(last);
    return successors.length === 1 && successors[0].getStartPC() <= last.getStartPC();
}

/**
 * `catch (e) { throw new Error(…) }` where the object construction sits in a
 * later block than the handler entry (register spills first). The entry-only
 * check above covers the compact form.
 */
function handlerWrapsNewError(
    cfg: PandaIRCFG,
    entry: PandaIRBasicBlock,
    tryStart: number,
    tryEnd: number,
): boolean {
    if (!isExceptionOnlyHandler(cfg, entry)) return false;
    const { blocks } = handlerForwardBody(cfg, entry, tryStart, tryEnd, 12);
    let sawNew = false;
    for (const block of blocks) {
        for (const instruction of block.pandaInstructions) {
            if (instruction.opcode.name === "newobjrange") sawNew = true;
            else if (sawNew && instruction.kind === "throw") return true;
        }
    }
    return false;
}

/**
 * Join block a new-style ignored catch falls out to. The try body has to absorb
 * the register-copy completion block in front of it, otherwise region reduction
 * merges the shared continuation into the catch and emits the method tail twice
 * (`EntryAbility.updateBreakpoint`: try body → `mov v0, v1` → join).
 */
function ignoredCatchJoinTarget(
    cfg: PandaIRCFG,
    entry: PandaIRBasicBlock,
    tryStart: number,
    tryEnd: number,
): PandaIRBasicBlock | null {
    if (isFinallyHandler(cfg, entry)) return null;
    if (!isExceptionOnlyHandler(cfg, entry)) return null;
    return handlerForwardBody(cfg, entry, tryStart, tryEnd).joinTarget;
}

/** The try completion path from `endPC` to the join is jumps and pure `mov`s. */
function completionReachesJoin(
    cfg: PandaIRCFG,
    endPC: number,
    joinTarget: PandaIRBasicBlock,
): boolean {
    const targetPC = joinTarget.getStartPC();
    let block = cfg.getBasicBlockByPC(endPC);
    const seen = new Set<PandaIRBasicBlock>();
    while (block && block.getStartPC() < targetPC) {
        if (seen.has(block)) return false;
        seen.add(block);
        const instructions = block.pandaInstructions;
        const transparentJump = instructions.length === 1 && block.getTerminator().kind === "jumpDirect";
        const pureMoves = instructions.every((instruction) => instruction.kind === "mov" || instruction.kind === "nop");
        if (!transparentJump && !pureMoves) return false;
        const successors = cfg.graph.normalSuccessors(block);
        if (successors.length !== 1) return false;
        block = successors[0];
    }
    return block === joinTarget;
}

/**
 * 忽略异常值的用户 catch:入口是寄存器恢复前缀 + 可见工作,但没有 `sta` 保存异常。
 *
 * `catch { appStore.showToast('清除缓存失败') }` 这种源码里不引用异常的 catch,
 * 编译器只恢复寄存器,异常值留在 acc 里就没人读。它与 finally 落点的区别是
 * finally 还有 hole 哨兵/清理结构(调用方用 isFinallyHandler 排掉)。
 */
export function isIgnoringCatchHandler(block: PandaIRBasicBlock): boolean {
    const { start } = handlerEffectiveEntry(block);
    if (start <= 0 || start >= block.pandaInstructions.length) return false;
    if (block.pandaInstructions[start].kind === "store") return false;
    return block.pandaInstructions.slice(start).some(isCatchBodyWork);
}

/** handler 前向体(不重复进入保护范围、不走回边)的基本块;有界。 */
function forwardBodyBlocks(
    cfg: PandaIRCFG,
    entry: PandaIRBasicBlock,
    tryStart: number,
    tryEnd: number,
    budget = 64,
): PandaIRBasicBlock[] {
    const blocks: PandaIRBasicBlock[] = [];
    const seen = new Set<PandaIRBasicBlock>();
    const stack: PandaIRBasicBlock[] = [entry];
    while (stack.length > 0 && blocks.length < budget) {
        const block = stack.pop()!;
        if (seen.has(block)) continue;
        seen.add(block);
        const pc = block.getStartPC();
        if (pc >= tryStart && pc < tryEnd) continue;
        blocks.push(block);
        for (const successor of cfg.graph.normalSuccessors(block)) {
            if (successor.getStartPC() <= pc) continue;
            stack.push(successor);
        }
    }
    return blocks;
}

/**
 * 忽略异常值、但确实在做用户清理的 catch:入口有可见工作、不保存异常,每条路径
 * 都离开保护范围,且 handler 体里还嵌着一个 finally plan。
 *
 * 编译器协议 handler(for-of close / async 派发 / 词法清理)不会在 handler 体里
 * 再生成用户级 try/finally,所以「体内有嵌套 finally plan」是强判据。amcl
 * `feature_system/s12` 的 `writeSandboxHint` / `writeExternalHint`:handler 入口
 * 建提示文本、随后 open/write(内层 try/finally),但旧扫描的 6 块预算没走到
 * `return`,内联 finally 的守卫 `throw` 又让 `!sawThrow` 失败,整段 catch 被判
 * `unknown` 丢掉,内层 finally plan 只能报 `start marker not found`。
 */
export function isIgnoredExitingCatch(
    cfg: PandaIRCFG,
    entry: PandaIRBasicBlock,
    tryStart: number,
    tryEnd: number,
    plans: FinallyPlan[],
): boolean {
    if (!startsLikeIgnoredCatch(entry)) return false;
    if (!entry.pandaInstructions.some(isCatchBodyWork)) return false;
    if (isFinallyHandler(cfg, entry)) return false;
    // 空的 `try { … } catch {}` 里 handler 就是正常续接(`try { mkdir } catch {}` 的
    // handlerPC 与 jmp 目标相同),它会有普通前驱,体里的工作其实是 try 之后的代码;
    // 真正的用户 catch 只能从异常边进入。
    if (!isExceptionOnlyHandler(cfg, entry)) return false;
    if (!handlerExits(cfg, entry, tryStart, tryEnd)) return false;
    const bodyPCs = new Set(forwardBodyBlocks(cfg, entry, tryStart, tryEnd).map((block) => block.getStartPC()));
    if (bodyPCs.size === 0) return false;
    return plans.some((plan) => bodyPCs.has(plan.startPC));
}

/**
 * 零长度 handler 的入口块只有异常保存(`sta vX`):handler 体被切到了下一个
 * 基本块 —— 因为 handler 体自己又开了一个 try 范围(amcl `e4/k9` 的 `commit`:
 * 入口 `sta v7`,下一块是回滚体,里面还有
 * `try { fsyncSync(fd) } finally { closeSync(fd) }`)。
 *
 * 只看入口块会判成「没有可见工作」→ `unknown` → 丢掉异常边;handler 体在正常
 * 控制流里不可达,整段被剪掉,嵌套的 finally plan 随后只能报
 * `start marker not found`。
 *
 * 沿 handler 的前向体找可见工作:只走 fallthrough / 条件分支,不走回边、不
 * 重新进入保护范围、不穿过裸 `jmp`(空 catch 靠它跳到汇合点,穿过去会把汇合点
 * 或循环体当成 catch 工作)。
 */
export function handlerBodyHasVisibleWork(
    cfg: PandaIRCFG,
    entry: PandaIRBasicBlock,
    tryStart: number,
    tryEnd: number,
    allowEntryGuard = false,
): boolean {
    const instructions = entry.pandaInstructions;
    if (!allowEntryGuard) {
        if (instructions.length !== 1 || instructions[0].kind !== "store") return false;
    } else if (instructions[0]?.kind !== "store") {
        // 入口先做守卫判断(`sta e; lda page; === 1; jnez`)时,只有后续块里
        // 真正读取保存的异常才是用户 catch(见 handlerBodyUsesException)。
        return false;
    }
    const seen = new Set<PandaIRBasicBlock>();
    const stack: PandaIRBasicBlock[] = [entry];
    let budget = 10;
    while (stack.length > 0 && budget-- > 0) {
        const block = stack.pop()!;
        if (seen.has(block)) continue;
        seen.add(block);
        if (block !== entry && block.pandaInstructions.some(isCatchBodyWork)) return true;
        const pc = block.getStartPC();
        if (block !== entry && block.getTerminator().kind === "jumpDirect") continue;
        for (const successor of cfg.graph.normalSuccessors(block)) {
            const successorPC = successor.getStartPC();
            if (successorPC <= pc) continue;
            if (successorPC >= tryStart && successorPC < tryEnd) continue;
            stack.push(successor);
        }
    }
    return false;
}

/**
 * `catchUsesException` 的跨块版本:handler 的 forward body 读取保存的异常。
 */
function handlerBodyUsesException(
    cfg: PandaIRCFG,
    entry: PandaIRBasicBlock,
    tryStart: number,
    tryEnd: number,
): boolean {
    const saved = handlerEffectiveEntry(entry).exceptionRegister;
    if (!saved) return false;
    const { blocks } = handlerForwardBody(cfg, entry, tryStart, tryEnd);
    for (const bodyBlock of blocks) {
        const instructions = bodyBlock.pandaInstructions;
        for (let index = 0; index < instructions.length; index++) {
            const instruction = instructions[index];
            const moved = instruction.kind === "mov" && instruction.srcObj?.toString() === saved;
            const loaded = instruction.kind === "load" && instruction.loadType === "OBJECT"
                && (instruction as { loadParam?: { toString(): string } }).loadParam?.toString() === saved;
            if (!moved && !loaded) continue;
            const next = instructions[index + 1];
            if (loaded && next && next.kind === "throw") continue;
            return true;
        }
    }
    return false;
}

/**
 * handler 体是否读到「保护范围内写过的寄存器」——异常路径依赖 try 里保存的值。
 *
 * 编译器在可能抛出的语句前把活跃寄存器存到 v14…v20 之类的位置(每个 await 点都
 * 重存一遍),handler 再读回来。AST 优化器的 liveness 没有异常边,无法让这些预存
 * 在「每条可能抛出的语句」处都保持活跃,预存会被当死存储删掉,handler 里的读于是
 * 落到完全无关的版本上(amcl `commons/h1/w1` 的 `w91` 打出
 * `i50(v16.directory)` 而 v16 从未赋值;`k10/w10/d11` 的 `copyFileAtomic_`
 * 打出 `unlinkSync(v1)` 而 v1 是 `Math.floor(...)` 的结果)。
 *
 * 只把**可观察的读**(load / call 等)算进来:纯 `mov` 是寄存器倒换,死掉时由
 * liveness 删除,不影响输出(amcl `e4/k9` 的 catch-and-wrap 入口只有 `mov`)。
 * 这类 handler 不注册为 catch,保持旧行为(整段丢弃),而不是输出错值。
 */
export function handlerReadsTryValues(
    cfg: PandaIRCFG,
    entry: PandaIRBasicBlock,
    tryStart: number,
    tryEnd: number,
): boolean {
    return handlerObservedReads(cfg, entry, tryStart, tryEnd,
        forwardBodyBlocks(cfg, entry, tryStart, tryEnd)).size > 0;
}

/**
 * handler 体里对「保护范围内写过的寄存器」的可观察读集合。
 * `body` 是 handler 的前向体(分类用 forwardBodyBlocks 的宽松版本,
 * 保存计划用 handlerOwnedBodyBlocks 的截断版本,见各自注释)。
 */
function handlerObservedReads(
    cfg: PandaIRCFG,
    entry: PandaIRBasicBlock,
    tryStart: number,
    tryEnd: number,
    body: PandaIRBasicBlock[],
): Set<string> {
    const tryWrites = collectTryWrittenRegisters(cfg, tryStart, tryEnd);
    if (tryWrites.size === 0) return new Set();
    const observed = new Set<string>();
    const seen = new Set(body);
    const incoming = new Map<PandaIRBasicBlock, Set<string> | null>();
    const outgoing = new Map<PandaIRBasicBlock, Set<string>>();
    for (const block of body) {
        incoming.set(block, null);
        outgoing.set(block, new Set());
    }
    incoming.set(entry, new Set());
    for (let round = 0; round < 32; round++) {
        let changed = false;
        for (const block of body) {
            let current = incoming.get(block) ?? null;
            if (block !== entry) {
                let merged: Set<string> | null = null;
                for (const predecessor of cfg.graph.normalPredecessors(block)) {
                    if (!seen.has(predecessor)) continue;
                    const out = outgoing.get(predecessor);
                    if (!out) continue;
                    merged = merged === null ? new Set(out) : new Set([...merged].filter((name) => out.has(name)));
                }
                if (merged === null) continue;
                if (current === null || merged.size !== current.size || [...merged].some((name) => !current!.has(name))) {
                    incoming.set(block, merged);
                    changed = true;
                }
                current = merged;
            }
            if (current === null) continue;
            const out = new Set(current);
            for (const instruction of block.pandaInstructions) {
                const { def } = instructionAccess(instruction);
                if (def) out.add(def);
            }
            const previous = outgoing.get(block)!;
            if (out.size !== previous.size) {
                outgoing.set(block, out);
                changed = true;
            }
        }
        if (!changed) break;
    }
    for (const block of body) {
        const defined = new Set(incoming.get(block) ?? []);
        for (const instruction of block.pandaInstructions) {
            const { def, uses } = instructionAccess(instruction);
            // async/generator 机器指令(asyncfunctionresolve/reject、resumegenerator、
            // getresumemode 等)读的是 async 上下文/恢复模式寄存器,不是源级值;
            // 恢复派发会把它们写进保护范围,不能据此判定 handler 读了 try 里的值
            // (VideoSizeUtil.doFetch 的 `catch { return null }` 曾因此被判 unknown 丢掉)。
            if (instruction.kind !== "mov" && instruction.kind !== "async" && instruction.kind !== "generator") {
                for (const use of uses) {
                    if (!defined.has(use) && tryWrites.has(use)) observed.add(use);
                }
            }
            if (def) defined.add(def);
        }
    }
    return observed;
}

/**
 * handler 体里对「保护范围内写过的寄存器」的**可观察读**集合(mov/async 机器指令
 * 不算,见 handlerReadsTryValues 的注释)。liveness 重构(try/catch 恢复审计
 * reference/try-catch-restoration-lnga.md §4.6)用它决定哪些逐抛出点保存必须在
 * AST 里保持活跃,哪些可以按值等价证明丢掉。
 *
 * 与分类用的 handlerReadsTryValues 不同,这里的前向体在「与正常控制流汇合」的
 * 块处截断:落回正常流程的 catch(`catch { warn(...) }` 之后继续)不拥有汇合块
 * 之后的读取 —— 否则整个方法尾部的读都会被算成 handler 观察读,给无关寄存器
 * 强行复活保存(amcl n4/o8 的三元表达式因此裂成 if/else)。
 *
 * `defined` 跟踪与 handlerReadsTryValues 一致:handler 自己先写后读的临时量
 * (finally handler 的 `v7 = v13; … accessSync(v9)` 槽位倒换)不算观察读。
 */
export function handlerObservedTryValueReads(
    cfg: PandaIRCFG,
    entry: PandaIRBasicBlock,
    tryStart: number,
    tryEnd: number,
): Set<string> {
    const body = handlerOwnedBodyBlocks(cfg, entry, tryStart, tryEnd);
    if (body.length === 0) return new Set();
    return handlerObservedReads(cfg, entry, tryStart, tryEnd, body);
}

/**
 * handler「自有」前向体:forwardBodyBlocks 的结果再按前驱收 pruning——凡是有
 * normal 前驱不在前向体里的块(与正常控制流的汇合点)及其下游都不属于 handler。
 * 入口块永远保留。
 *
 * 前向体补长:内层 try 的 handler 是异常落点(普通边走不到),但它的保护范围
 * 完全落在 handler 体里时它就是 handler 自己的内层 catch,必须补进体里,否则
 * pruning 会把内层 catch 汇入的 join 块误判成「与正常流程的汇合点」
 * (downloadToFile 用户 catch 里的 closeSync/accessSync 内层 try)。
 */
function handlerOwnedBodyBlocks(
    cfg: PandaIRCFG,
    entry: PandaIRBasicBlock,
    tryStart: number,
    tryEnd: number,
): PandaIRBasicBlock[] {
    const collected = new Set<PandaIRBasicBlock>();
    const walkFrom = (start: PandaIRBasicBlock): void => {
        const stack: PandaIRBasicBlock[] = [start];
        while (stack.length > 0 && collected.size < 64) {
            const block = stack.pop()!;
            if (collected.has(block)) continue;
            const pc = block.getStartPC();
            if (pc >= tryStart && pc < tryEnd) continue;
            collected.add(block);
            for (const successor of cfg.graph.normalSuccessors(block)) {
                if (successor.getStartPC() <= block.getStartPC()) continue;
                stack.push(successor);
            }
        }
    };
    walkFrom(entry);
    let grown = true;
    while (grown && collected.size < 64) {
        grown = false;
        for (const tryEntry of cfg.getExceptionTable().entries) {
            const handler = tryEntry.handlerEntryBlock;
            if (!handler || collected.has(handler)) continue;
            if (tryEntry.startPC >= tryStart && tryEntry.endPC <= tryEnd) continue; // 外层自己/嵌套在保护范围里的 try
            let contained = true;
            for (const block of cfg.pandaIRBasicBlocks) {
                const pc = block.getStartPC();
                if (pc >= tryEntry.startPC && pc < tryEntry.endPC && !collected.has(block)) {
                    contained = false;
                    break;
                }
            }
            if (contained) {
                walkFrom(handler);
                grown = true;
            }
        }
    }
    const forward = [...collected];
    const owned = new Set(forward);
    let changed = true;
    while (changed) {
        changed = false;
        for (const block of forward) {
            if (!owned.has(block) || block === entry) continue;
            for (const predecessor of cfg.graph.normalPredecessors(block)) {
                if (!owned.has(predecessor)) {
                    owned.delete(block);
                    changed = true;
                    break;
                }
            }
        }
    }
    return forward.filter((block) => owned.has(block));
}

/** 保护范围 [tryStart, tryEnd) 内写过的寄存器名集合 */
function collectTryWrittenRegisters(cfg: PandaIRCFG, tryStart: number, tryEnd: number): Set<string> {
    const tryWrites = new Set<string>();
    for (const block of cfg.pandaIRBasicBlocks) {
        const pc = block.getStartPC();
        if (pc < tryStart || pc >= tryEnd) continue;
        for (const instruction of block.pandaInstructions) {
            const { def } = instructionAccess(instruction);
            if (def) tryWrites.add(def);
        }
    }
    return tryWrites;
}

/**
 * 逐抛出点寄存器保存的「值等价丢弃」计划(reference/try-catch-restoration-lnga.md §4.6)。
 *
 * 编译器在每个可能抛出的语句前把活跃寄存器 `mov` 进保存槽位,handler 再读回来;
 * AST liveness 没有异常边,只有这些保存被显式保持活跃(revive)时 catch 才能读到
 * 正确的值。对每个 handler 观察读的寄存器 R 做值证明:
 *   - 保护范围内的每个定义都是 `mov R, S`(同一源寄存器),且 S 在范围内不被写
 *     (范围不变量),且每个可能抛出的指令处 R 的到达定义非空 —— R 在 handler 处
 *     的值恒等于 S 的值 → 保存是冗余的:不 revive,在 try 前物化一次 `R = S`。
 *   - 证明失败 → R 进 resurrect 集合,liveness 在可抛语句处保持它的保存活跃。
 *
 * handler 观察读之外的内容(mov 倒换、常量槽位)一律不动,保持既有输出。
 */
export interface HandlerSavePlan {
    /** liveness 必须在抛出点保持活跃的保存槽位(handler 观察读、值证明失败) */
    resurrect: string[];
    /** 值等价证明成立的槽位 → 源寄存器(在 try 前物化一次,范围内的保存全部冗余) */
    materialize: Array<{ register: string; source: string }>;
}

/** 指令是否绝对不抛(保守白名单;属性访问/调用/分配一律按可抛处理) */
function instructionCannotThrow(instruction: any): boolean {
    switch (instruction.kind as string) {
        case "nop":
        case "doNothing":
        case "assert":
        case "jumpDirect":
        case "jumpEqual":
        case "jumpNotEqual":
        case "jumpPlain":
        case "mov":
        case "load":
        case "store":
        case "return":
        case "binaryOp":
        case "unary":
        case "loadGlobal":
        case "loadModuleVar":
        case "loadExternalModuleVar":
        case "storeModuleVar":
        case "newLexEnv":
        case "storeLex":
        case "loadLex":
        case "popLexEnv":
        // async 收尾(asyncfunctionresolve/reject)不抛;await 的派发单独按可抛处理
        case "async":
            return !(instruction.kind === "async" && String(instruction.asyncType ?? "").includes("await"));
        default:
            return false;
    }
}

export function planHandlerSaves(
    cfg: PandaIRCFG,
    tryStart: number,
    tryEnd: number,
    handlerEntry: PandaIRBasicBlock,
): HandlerSavePlan {
    const plan: HandlerSavePlan = { resurrect: [], materialize: [] };
    const observed = handlerObservedTryValueReads(cfg, handlerEntry, tryStart, tryEnd);
    if (observed.size === 0) return plan;
    // 到达定义只为「有观察读」的方法求解;大方法上这是唯一的额外开销
    const analysis = new ValueAnalysis(cfg);
    // 第一关:范围内每个定义都必须是 `mov R, S`(同一源),且 S 在范围内不变
    const sourceOf = new Map<string, string>();
    for (const register of observed) {
        const defsInRange = analysis.definitionsOf(register)
            .filter((definition) => definition.block.getStartPC() >= tryStart
                && definition.block.getStartPC() < tryEnd);
        if (defsInRange.length === 0) continue; // 范围内没有保存:既有 liveness 已能保住范围外的定义
        let source: string | null = null;
        let copyOnly = true;
        for (const definition of defsInRange) {
            const instruction = definition.instruction;
            if (instruction.kind !== "mov" || !instruction.srcObj) { copyOnly = false; break; }
            const defSource = instruction.srcObj.toString();
            if (source === null) source = defSource;
            else if (source !== defSource) { copyOnly = false; break; }
        }
        if (!copyOnly || source === null
            // 源寄存器必须在范围内不变(范围内没有它的定义)
            || analysis.definitionsOf(source).some((definition) => {
                const pc = definition.block.getStartPC();
                return pc >= tryStart && pc < tryEnd;
            })) {
            if (defsReadUnstableSources(analysis, defsInRange)) continue;
            plan.resurrect.push(register);
            continue;
        }
        if (defsReadUnstableSources(analysis, defsInRange)) continue;
        sourceOf.set(register, source);
    }
    if (sourceOf.size === 0) return plan;
    // 第二关:每个可能抛出的指令处,该寄存器的到达定义都必须非空且是范围内的同源
    // 保存。异常落点(handler 入口)的到达定义为空(值未知),但其有效值 = 嵌套
    // 范围内原抛出点的值 —— 而那些抛出点本身也会被本关检查,所以对「完全嵌套在本
    // 保护范围内」的 landing pad 放行:它的入口状态由供给它的范围的状态决定。
    const inRangeBlocks = cfg.pandaIRBasicBlocks.filter((block) => {
        const pc = block.getStartPC();
        return pc >= tryStart && pc < tryEnd;
    });
    // 完全嵌套的 try 条目按 handler 入口分组:landing pad 的入口状态 = 供给范围内
    // 所有块的状态汇合(任何一条可抛指令都可能先一步把异常送进该 handler)。
    const feederBlocksByLanding = new Map<PandaIRBasicBlock, PandaIRBasicBlock[]>();
    for (const entry of cfg.getExceptionTable().entries) {
        if (!entry.handlerEntryBlock) continue;
        if (entry.startPC < tryStart || entry.endPC > tryEnd || entry.startPC >= entry.endPC) continue;
        const landing = entry.handlerEntryBlock;
        const previous = feederBlocksByLanding.get(landing) ?? [];
        for (const block of inRangeBlocks) {
            const pc = block.getStartPC();
            if (pc >= entry.startPC && pc < entry.endPC) previous.push(block);
        }
        feederBlocksByLanding.set(landing, previous);
    }
    for (const [register, source] of sourceOf) {
        if (!statesProveSingleValue(cfg, analysis, inRangeBlocks, feederBlocksByLanding,
            register, source, tryStart, tryEnd)) {
            plan.resurrect.push(register);
            continue;
        }
        // 源寄存器必须真的有定义(从未写过的寄存器隐式为 undefined,物化反而会
        // 打印未赋值读取;保持旧行为,不 revive)
        if (analysis.definitionsOf(source).length === 0) continue;
        // 源值来自属性读取时整个槽位放弃(物化和复活都不做):AST 层的复制传播会把
        // `v4 = this.generation` 的定义表达式克隆进后续读取,跨 await 的旧值快照会和
        // 实时读取混同(amcl launch/f15 refreshOnce:一旦在循环体里出现该槽位的读取,
        // `if (v4 !== this.generation)` 就会被折成 `this.generation !== this.generation`)。
        // 这类槽位保持既有(不恢复)行为。
        if (sourceReadsUnstableValue(analysis, cfg, inRangeBlocks, source)) continue;
        plan.materialize.push({ register, source });
    }
    return plan;
}

/** 保存定义(`mov R, S`)的源 S 在保存点是否来自属性读取 */
function defsReadUnstableSources(analysis: ValueAnalysis, defsInRange: ValueDefinition[]): boolean {
    for (const definition of defsInRange) {
        const instruction = definition.instruction;
        if (instruction.kind !== "mov" || !instruction.srcObj) continue;
        const source = instruction.srcObj.toString();
        const block = definition.block;
        const reaching = analysis.definitionsAtRead(block, instruction, source);
        for (const id of reaching) {
            const reachingDefinition = analysis.definitionById(id);
            if (!reachingDefinition) continue;
            if (definitionReadsProperty(reachingDefinition)) return true;
        }
    }
    return false;
}

/**
 * 定义的值是否直接来自属性读取:定义指令本身是属性装载,或是 acc 的 sta/store,
 * 前一条产生 acc 值的指令是属性装载(`lda this; ldobjbyname generation; sta v4`)。
 */
function definitionReadsProperty(definition: ValueDefinition): boolean {
    const isPropertyLoad = (instruction: any): boolean => {
        switch (instruction?.kind as string) {
            case "loadObjectBy":
            case "loadSuper":
            case "loadSuperObj":
                return true;
            default:
                return false;
        }
    };
    const instruction = definition.instruction;
    if (isPropertyLoad(instruction)) return true;
    if (instruction?.kind !== "store") return false;
    const instructions = definition.block.pandaInstructions;
    const index = instructions.indexOf(instruction);
    for (let i = index - 1; i >= 0 && i >= index - 6; i--) {
        const previous = instructions[i];
        if (isPropertyLoad(previous)) return true;
        if (previous.kind !== "mov" && previous.kind !== "store" && previous.kind !== "load") break;
    }
    return false;
}

/** 源寄存器在进入保护范围时是否来自属性读取(这类值在 AST 层可被复制传播重复求值) */
function sourceReadsUnstableValue(
    analysis: ValueAnalysis,
    cfg: PandaIRCFG,
    inRangeBlocks: PandaIRBasicBlock[],
    source: string,
): boolean {
    const first = inRangeBlocks[0];
    const firstInstruction = first?.pandaInstructions[0];
    if (!first || !firstInstruction) return true;
    const reaching = analysis.definitionsAtRead(first, firstInstruction, source);
    for (const id of reaching) {
        const definition = analysis.definitionById(id);
        if (!definition) return true;
        switch (definition.instruction.kind as string) {
            case "loadObjectBy":
            case "loadSuper":
            case "loadSuperObj":
                return true;
            default:
                break;
        }
    }
    return false;
}

/**
 * 值证明第二关:寄存器 `register` 在保护范围内每个可能抛出的指令处,值是否恒等于
 * `source` 的值。普通路径用到达定义;异常落点的入口状态用布尔定点传播(入口的好
 * 状态 = 所有供给块的出口状态都好)。
 *
 * 返回 false 时调用方把该寄存器放进 resurrect 集合(liveness 逐抛出点保持活跃)。
 */
function statesProveSingleValue(
    cfg: PandaIRCFG,
    analysis: ValueAnalysis,
    inRangeBlocks: PandaIRBasicBlock[],
    feederBlocksByLanding: Map<PandaIRBasicBlock, PandaIRBasicBlock[]>,
    register: string,
    source: string,
    tryStart: number,
    tryEnd: number,
): boolean {
    const isLanding = (block: PandaIRBasicBlock): boolean => cfg.graph.normalPredecessors(block).length === 0;
    const firstDefIndex = (block: PandaIRBasicBlock): number => {
        const instructions = block.pandaInstructions;
        for (let index = 0; index < instructions.length; index++) {
            const { def } = instructionAccess(instructions[index]);
            if (def === register) return index;
        }
        return instructions.length;
    };
    // 普通块的入口状态:到达定义(ValueAnalysis;空集 = 路径上确实未定义,不放行)。
    const normalEntryGood = (block: PandaIRBasicBlock): boolean => {
        const first = block.pandaInstructions[0];
        if (!first) return false;
        const reaching = analysis.definitionsAtRead(block, first, register);
        if (reaching.length === 0) return false;
        return reaching.every((id) => {
            const definition = analysis.definitionById(id);
            if (!definition) return false;
            if (definition.instruction.kind !== "mov" || !definition.instruction.srcObj) return false;
            return definition.instruction.srcObj.toString() === source
                && definition.block.getStartPC() >= tryStart
                && definition.block.getStartPC() < tryEnd;
        });
    };
    // 「第一个 R 定义之前的可抛指令」是否存在(它们读到的是块入口状态)
    const hasPreDefThrow = (block: PandaIRBasicBlock): boolean => {
        const limit = firstDefIndex(block);
        const instructions = block.pandaInstructions;
        for (let index = 0; index < limit; index++) {
            if (!instructionCannotThrow(instructions[index])) return true;
        }
        return false;
    };
    // blockOK(B):B 内每条可抛指令处的值都恒等于 source。
    //   = 没有「定义前可抛指令」(定义后的值 = 同源保存,第一关保证)
    //     或入口状态良好(普通块:到达定义检查;landing:所有供给块都 blockOK ——
    //     落点入口值 = 嵌套范围里原抛出点的值)。
    const blockOK = new Map<PandaIRBasicBlock, boolean>();
    for (const block of inRangeBlocks) {
        blockOK.set(block, !hasPreDefThrow(block) || normalEntryGood(block));
    }
    for (let round = 0; round < 8; round++) {
        let changed = false;
        for (const block of inRangeBlocks) {
            if (blockOK.get(block)) continue;
            if (!isLanding(block)) continue;
            const feeders = feederBlocksByLanding.get(block);
            const entryGood = !!feeders && feeders.length > 0
                && feeders.every((feeder) => blockOK.get(feeder) === true);
            if (entryGood) {
                blockOK.set(block, true);
                changed = true;
            }
        }
        if (!changed) break;
    }
    for (const block of inRangeBlocks) {
        if (!blockOK.get(block)) return false;
    }
    return true;
}

/** try 范围内是否有经典 finally 的 hole 哨兵(13.0.1.0 的收尾残留) */
export function hasSentinelGuard(cfg: PandaIRCFG, tryBlock: { startPC: number; length: number }): boolean {
    const start = tryBlock.startPC;
    const end = start + tryBlock.length;
    for (const block of cfg.pandaIRBasicBlocks) {
        const pc = block.getStartPC();
        if (pc < start || pc >= end) continue;
        if (blockLoadsHole(block)) {
            return true;
        }
    }
    return false;
}

/**
 * 经典 finally 的正常完成块:try 范围结束后第一块就写 hole 哨兵,再跳到共享
 * cleanup。eager(handler-based)finally 没有这个 suppress 块。
 */
export function tryEndWritesHole(cfg: PandaIRCFG, tryBlock: { startPC: number; length: number }): boolean {
    const endBlock = cfg.getBasicBlockByPC(tryBlock.startPC + tryBlock.length);
    return !!endBlock && blockLoadsHole(endBlock);
}

export function checkIsForInException(cfg: PandaIRCFG, block: PandaIRBasicBlock): boolean {
    let blocks = cfg.graph.normalSuccessors(block);
    if (blocks.length !== 1) return false;
    block = blocks[0];
    blocks = cfg.graph.normalSuccessors(block);
    if (blocks.length !== 1) return false;
    block = blocks[0];
    for (const instruction of block.pandaInstructions) {
        if (instruction.kind === "getIterator") return true;
    }
    return false;
}

export function checkIsForOfException(cfg: PandaIRCFG, tryBlock: PandaIRBasicBlock, catchBlock: PandaIRBasicBlock): boolean {
    if (tryBlock.pandaInstructions.length > 2) {
        const instruction = tryBlock.pandaInstructions[1];
        if (instruction.kind === "loadObjectBy") {
            const obj = instruction.ldObj;
            if (!obj) return false;
            const content = obj.toString();
            if (content === "\"return\"") return true;
        }
    }
    const blocks = cfg.graph.normalSuccessors(catchBlock);
    if (blocks.length !== 2) return false;
    const first = blocks[0];
    const second = blocks[1];
    if (first.getTerminator().kind !== "throw") return false;
    return blockLoadsHole(second);
}

/**
 * startPC -> longest protected range. A try entry that shares its start with a
 * finally plan is shorter than the finally range (the catch ends inside it).
 */
function maxEndByStart(entries: Iterable<{ startPC: number; endPC: number }>): Map<number, number> {
    const result = new Map<number, number>();
    for (const entry of entries) {
        const previous = result.get(entry.startPC) ?? 0;
        if (entry.endPC > previous) result.set(entry.startPC, entry.endPC);
    }
    return result;
}

/**
 * 分类方法里所有 try 条目。判定顺序与迁移前 RegionGraphBuilder 的构造器一致。
 */
export function classifyTryEntries(cfg: PandaIRCFG): ExceptionTable {
    const method = cfg.getPandaMethod();
    const result: ExceptionTable = { entries: [], isAsyncFunction: false, isGeneratorFunction: false };
    if (!method.hasException()) return result;
    let isAsyncFunction = false;
    let isGeneratorFunction = false;
    // ArkTS 13 经典形状的 finally(正常完成块写 hole 哨兵再跳到 cleanup)由
    // TryFinally 在 AST 上还原成 try/finally,不能接进区域图
    // (landing pad 会破坏可归约性)。
    // 循环体尾部的计划只用于 AST 侧还原(没有 suppress 块、边界语义与经典 finally
    // 不同),不参与「哪些 handler 是 finally 落点」的分类。eager 计划要保留:
    // 它的起点仍标记「这个 try 有 finally」,共用起点的 handler 靠它做取舍。
    const finallyPlans = buildFinallyPlans(cfg).filter((plan) => plan.tailCleanupRange === undefined);
    const finallyStartPCs = new Set(finallyPlans.map((plan) => plan.startPC));
    // startPC -> finally 计划里最长的保护范围:用户 catch 与 finally 共用起点时,
    // catch 条目的范围一定比 finally 短(catch 在 finally 里面结束)。
    const finallyEndByStart = maxEndByStart(finallyPlans);
    // finally handler entry: start → longest protected range. A nested
    // sub-exit try (the per-await inline cleanup copy) shares its start with the
    // finally entry; it must not be re-registered as a user catch.
    const finallyHandlerRanges: Array<{ startPC: number; endPC: number }> = [];
    for (const candidate of method.methodCode!.pandaMethodTryBlocks!) {
        const candidateCatch = candidate.pandaMethodCatchBlocks[0];
        if (!candidateCatch) continue;
        const candidateHandler = cfg.getBasicBlockByPC(candidateCatch.handlerPC);
        if (!candidateHandler) continue;
        if (!isFinallyHandler(cfg, candidateHandler) || catchUsesException(candidateHandler)) continue;
        finallyHandlerRanges.push({ startPC: candidate.startPC, endPC: candidate.startPC + candidate.length });
    }
    const finallyHandlerEndByStart = maxEndByStart(finallyHandlerRanges);
    for (const tryBlock of method.methodCode!.pandaMethodTryBlocks!) {
        const catchBlock = tryBlock.pandaMethodCatchBlocks[0];
        if (!catchBlock) continue;
        const startPC = tryBlock.startPC;
        const endPC = startPC + tryBlock.length;
        const tryEntryBlock = cfg.getBasicBlockByPC(startPC);
        const handlerEntryBlock = cfg.getBasicBlockByPC(catchBlock.handlerPC);
        if (!tryEntryBlock || !handlerEntryBlock) continue;
        const tryCodeLength = tryBlock.length;
        const handleCodeLength = catchBlock.codeSize;
        const base = { tryBlock, startPC, endPC, tryEntryBlock, handlerEntryBlock };
        const push = (kind: HandlerKind, keep: boolean, extra: Partial<TryEntry> = {}): void => {
            result.entries.push({
                ...base,
                kind,
                keep,
                protectedEndPC: extra.protectedEndPC ?? null,
                usesException: extra.usesException ?? false,
                exits: extra.exits ?? false,
                loopContinue: extra.loopContinue ?? false,
            });
        };
        if (checkIsForInException(cfg, tryEntryBlock)) { push("forInAcquire", false); continue; }
        if (checkIsForOfException(cfg, tryEntryBlock, handlerEntryBlock)) { push("forOfClose", false); continue; }
        if (checkIsAsyncException(handlerEntryBlock)) {
            isAsyncFunction = true;
            push("asyncReject", false);
            continue;
        }
        if (checkIsGeneratorException(tryEntryBlock)) {
            isGeneratorFunction = true;
            push("resumeThrowArm", false);
            continue;
        }
        if (tryCodeLength === 0) { push("noProtectedRange", false); continue; }
        // 处理器的 codeSize 在很多 SDK 上都写成 0(不只是 24+,13.0.1.0 的 amcl
        // 也是如此;异常派发只用 handlerPC)。codeSize 为 0 时无法用 try 表界定
        // handler,但 handler 本身是一个完整的基本块链:真正的 catch 必须接进
        // 区域图,否则 catch 体在正常控制流里不可达、会被整段剪掉
        // (LogExport.readLogTail 的 hilog.error 分支曾整个消失)。
        // 分类完全按形状走,不看 bytecode 版本:纯 rethrow 处理器和没有可见
        // 工作的编译器派发 handler 仍然跳过:
        //  - 纯 rethrow 处理器只是 finally 的异常跳板 / 词法环境清理;
        //  - 经典 finally(正常完成块里写 hole 哨兵再跳到 cleanup)交给
        //    TryFinally 还原。
        const commitPC = handleCodeLength === 0 ? skippedCommitEnd(cfg, handlerEntryBlock, endPC) : null;
        if (handleCodeLength === 0) {
            if (isPureRethrowHandler(handlerEntryBlock)) { push("pureRethrow", false); continue; }
            // Handler block == success continuation: `try { … } catch {}` with the
            // compiler's empty handler. Register it with an empty catch body.
            // This is a shape, not a bytecode-version feature: 13.0.1.0 lowers
            // empty catches the same way (amcl GameAbility.onDestroy: without
            // it the continuation is wired as a real catch and duplicated).
            if (!isFinallyHandler(cfg, handlerEntryBlock)
                && isEmptyJoinHandler(cfg, handlerEntryBlock, endPC)) {
                push("emptyJoin", true, { protectedEndPC: endPC });
                continue;
            }
            // 用户 catch 会把入口 `sta` 保存的异常再读出来(传给日志、读
            // .message、再抛)。它和 finally 计划、内层 finally 的 hole
            // 可以共用同一个 try 范围,不能因为这些特征被整段丢掉
            // (amcl t11/a12 的 f1268 写文件失败、c1268 清单失败)。
            const usesException = catchUsesException(handlerEntryBlock);
            // handler 读保护范围内写过的值时不注册(见 handlerReadsTryValues);
            // 只有新的判定路径用它,已有 catch 的分类保持不变。
            let riskyTryValues: boolean | null = null;
            const readsTryValues = (): boolean => {
                if (riskyTryValues === null) {
                    riskyTryValues = handlerReadsTryValues(cfg, handlerEntryBlock, startPC, endPC);
                }
                return riskyTryValues;
            };
            const loopContinue = continuesAtLoopHead(cfg, handlerEntryBlock, startPC, endPC);
            const finallyHandler = isFinallyHandler(cfg, handlerEntryBlock) && !usesException;
            // Constant/flag catches, work catches that rejoin the normal flow,
            // empty catches that continue a loop, and wrap-in-error catches whose
            // `newobjrange` sits after the entry block.
            const sharedStartKept = (finallyHandlerEndByStart.get(startPC) ?? 0) > endPC;
            const ignoredByBody = !finallyHandler
                && (isIgnoredCatchByBody(cfg, handlerEntryBlock, startPC, endPC, sharedStartKept)
                    || (!sharedStartKept
                        && ((handlerWrapsNewError(cfg, handlerEntryBlock, startPC, endPC) && !readsTryValues())
                            || isEmptyContinueCatch(cfg, handlerEntryBlock, startPC, endPC))));
            const ignoredExitingCatch = isIgnoredExitingCatch(cfg, handlerEntryBlock, startPC, endPC, finallyPlans);
            const ignoredException = isIgnoredExceptionCatch(cfg, handlerEntryBlock)
                || (isCatchAndWrapHandler(handlerEntryBlock) && !readsTryValues())
                || (ignoredExitingCatch && !readsTryValues())
                || ignoredByBody;
            // 用户 catch 与 finally 共用起点时,catch 条目的保护范围更短;只有这种
            // 条目才允许用“忽略异常、入口带寄存器恢复”的判据,否则会把大量
            // finally 落点误判成 catch(amcl 上 try 数量翻倍)。
            const catchOfSharedStart = (finallyEndByStart.get(startPC) ?? 0) > endPC;
            // 入口只有 `sta vX` 时 handler 体在下一个块里(体自己开了嵌套 try),
            // 见 handlerBodyHasVisibleWork。
            // 入口 `sta` + 守卫判断、异常在后续块被读取的真实用户 catch
            // (lnga TopicListPanel.loadTopics 的 `e.message`);宽松形态必须
            // 同时满足「跨块读取保存的异常」和「handler 以 return/throw 退出」,
            // 否则会把 13.0.1.0 的循环清理 handler 当成 catch(zhihu
            // ContentFilterRuntimeStore 的 for-of/finally 曾因此退化)。
            const relaxedBodyWork = !finallyHandler
                && handlerBodyHasVisibleWork(cfg, handlerEntryBlock, startPC, endPC, true)
                && handlerBodyUsesException(cfg, handlerEntryBlock, startPC, endPC)
                && handlerExits(cfg, handlerEntryBlock, startPC, endPC);
            const bodyWork = (handlerBodyHasVisibleWork(cfg, handlerEntryBlock, startPC, endPC) || relaxedBodyWork)
                && !readsTryValues();
            const catchHandler = isCatchHandler(handlerEntryBlock) || ignoredException || commitPC !== null
                || bodyWork
                || (catchOfSharedStart && isIgnoringCatchHandler(handlerEntryBlock) && !finallyHandler);
            const exitingCatch = (usesException || ignoredException || commitPC !== null || bodyWork)
                && handlerExits(cfg, handlerEntryBlock, startPC, endPC);
            // 用户 catch 可以和 finally 共用同一个 try 起点(源码 `try { … }
            // catch { … } finally { … }`):入口块里有可见工作(读 .message /
            // instanceof / 调日志)就说明它是 catch,不能因为起点同时是 finally
            // 起点就整段丢掉(ReplyDialog.handleImagePick 的 `[MPUP] error`
            // 分支曾整个消失)。
            if (finallyStartPCs.has(startPC) && !exitingCatch && !catchHandler) { push("classicFinally", false, { usesException, exits: exitingCatch, loopContinue }); continue; }
            if (finallyHandler) {
                // A finally whose handler has no plan and either wraps a user
                // catch (same start, longer range) or writes the hole suppress
                // block at the try end stays with TryFinally: registering the
                // handler would emit the cleanup as a catch and swallow the
                // user catch body (amcl i8 c763). A plan-backed finally keeps
                // the handler registered so the inline-cleanup fold can run
                // (hx360e GameInstall.readMagic, lnga ImageViewer).
                const plan = finallyPlans.find((candidate) => candidate.startPC === startPC && candidate.endPC === endPC);
                const sharedStartCatch = result.entries.some((candidate) => candidate.keep
                    && candidate.kind === "userCatch" && candidate.startPC === startPC);
                if (!plan && (sharedStartCatch || tryEndWritesHole(cfg, tryBlock))) {
                    push("classicFinally", false, { usesException, exits: exitingCatch, loopContinue });
                    continue;
                }
            } else if (catchHandler) {
                // A catch in a try body that still carries the classic finally
                // epilogue (`if (hole == X) throw X`) is skipped; the hole
                // sentinel belongs to the inlined finally of the success path.
                // A catch that warns and jumps back to the loop head (c1268's
                // "Failed to get manifest") is a continue, not a rethrow.
                if (tryEndWritesHole(cfg, tryBlock)
                    && !exitingCatch && !loopContinue
                    && !(catchOfSharedStart && usesException && isCatchHandler(handlerEntryBlock))) {
                    push("classicFinally", false, { usesException, exits: exitingCatch, loopContinue }); continue;
                }
            } else {
                // 编译器派发/词法清理 handler:没有可见工作,不接进图。
                push("unknown", false, { usesException, exits: exitingCatch, loopContinue });
                continue;
            }
            const kind: HandlerKind = finallyHandler && !usesException && !ignoredException && commitPC === null
                ? "finallyEpilogue"
                : ignoredException && !usesException ? "ignoredCatch" : "userCatch";
            const protectedEndPC = decideProtectedEnd(
                cfg, tryBlock, handlerEntryBlock, commitPC, tryCodeLength, catchOfSharedStart,
                bodyWork, finallyHandler, loopContinue);
            push(kind, true, { usesException, exits: exitingCatch, loopContinue, protectedEndPC });
            continue;
        }
        // 非 0 codeSize(13.0.1.0 的 yourpipe 等):沿用旧行为,handler 一律接图。
        const usesException = catchUsesException(handlerEntryBlock);
        const ignoredException = isIgnoredExceptionCatch(cfg, handlerEntryBlock);
        const loopContinue = continuesAtLoopHead(cfg, handlerEntryBlock, startPC, endPC);
        const exits = handlerExits(cfg, handlerEntryBlock, startPC, endPC);
        const finallyHandler = isFinallyHandler(cfg, handlerEntryBlock);
        const protectedEndPC = decideProtectedEnd(
            cfg, tryBlock, handlerEntryBlock, commitPC, tryCodeLength, false,
            false, finallyHandler, loopContinue);
        push(ignoredException ? "ignoredCatch" : "userCatch", true,
            { usesException, exits, loopContinue, protectedEndPC });
    }
    result.isAsyncFunction = isAsyncFunction;
    result.isGeneratorFunction = isGeneratorFunction;
    // 同一个 try 起点同时有用户 catch 和 v24 的 finally handler 时只保留用户 catch:
    // finally 由 TryFinally 的计划还原成 try/catch/finally。两个 helper 都接进图会把
    // 结构叠成 `try { try { … } catch { cleanup; throw } } catch { … }`
    // (SettingsPanel.clearCache)。计划重建不出来时保留 finallyEpilogue,
    // 异常路径的清理不能丢。
    const userCatchStarts = new Set(result.entries
        .filter((entry) => entry.keep && entry.kind === "userCatch")
        .map((entry) => entry.startPC));
    for (let i = result.entries.length - 1; i >= 0; i--) {
        const entry = result.entries[i];
        if (entry.kind === "finallyEpilogue" && userCatchStarts.has(entry.startPC)
            && finallyStartPCs.has(entry.startPC)) result.entries.splice(i, 1);
    }
    return result;}

/**
 * try 体可以吸收到哪个 pc:用户 catch 保护范围结束后不能继续合并
 * (d1268 的 copyDirRecursive 曾被 "no maven" catch 吞掉)。
 * await resume 派发不是用户 catch;超过 1024 字节的 try 通常包着循环闩
 * (loadLive),切割会让归约卡死;嵌套在更大 try 里的长范围也不切
 * (loadEvidence 的 95 字节 catch 被切后扫描循环被拉了出来)。
 */
function decideProtectedEnd(
    cfg: PandaIRCFG,
    tryBlock: PandaMethodTryBlock,
    handlerEntryBlock: PandaIRBasicBlock,
    commitPC: number | null,
    tryCodeLength: number,
    /** 该条目是"与 finally 共用起点"的用户 catch 范围 */
    catchOfSharedStart: boolean,
    /** handler 体在后续块里有可见工作(入口只有 `sta`,体里开了嵌套 try) */
    bodyWork = false,
    /** 调用方已经算过的 `isFinallyHandler`(避免对同一 handler 重复做有界扫描) */
    finallyHandler = isFinallyHandler(cfg, handlerEntryBlock),
    /** 调用方已经算过的 `continuesAtLoopHead` */
    loopContinue = continuesAtLoopHead(cfg, handlerEntryBlock, tryBlock.startPC, tryBlock.startPC + tryCodeLength),
): number | null {
    const startPC = tryBlock.startPC;
    const endPC = startPC + tryCodeLength;
    const newIgnored = !finallyHandler
        && (isIgnoredCatchByBody(cfg, handlerEntryBlock, startPC, endPC, false)
            || handlerWrapsNewError(cfg, handlerEntryBlock, startPC, endPC)
            || isEmptyContinueCatch(cfg, handlerEntryBlock, startPC, endPC));
    const userCatch = catchUsesException(handlerEntryBlock)
        || isIgnoredExceptionCatch(cfg, handlerEntryBlock)
        || isCatchHandler(handlerEntryBlock)
        || newIgnored
        // finally 落点不能按「handler 体有可见工作」裁剪:那会把 cleanup 当成 catch
        // 体接进区域图,再和 TryFinally 的计划叠成 try/catch/finally
        // (AppDatabase.close)。
        || (bodyWork && !finallyHandler)
        || (catchOfSharedStart && isIgnoringCatchHandler(handlerEntryBlock) && !finallyHandler)
        || commitPC !== null;
    const nestedWide = nestedInMuchLargerTry(cfg, tryBlock) && tryCodeLength > 64;
    if (!userCatch || nestedWide || isAsyncResumeHandler(cfg, handlerEntryBlock)) return null;
    if (!((tryCodeLength <= 1024 && handlerExits(cfg, handlerEntryBlock, startPC, endPC)) || loopContinue)) return null;
    // The mov an empty catch jumps over belongs to the success path.
    // The protected range has to cover it, or the assignment sits
    // after the try and runs on the exception path too.
    const joinTarget = newIgnored ? ignoredCatchJoinTarget(cfg, handlerEntryBlock, startPC, endPC) : null;
    if (joinTarget && completionReachesJoin(cfg, endPC, joinTarget)) return joinTarget.getStartPC();
    return commitPC ?? endPC;
}

export function checkIsAsyncException(block: PandaIRBasicBlock): boolean {
    for (const instruction of block.pandaInstructions) {
        if (instruction.kind === "async" && instruction.asyncType === "asyncfunctionreject") return true;
    }
    return false;
}

export function checkIsGeneratorException(block: PandaIRBasicBlock): boolean {
    for (const instruction of block.pandaInstructions) {
        if (instruction.kind === "createGeneratorObj" && instruction.opcode.name === "creategeneratorobj") return true;
    }
    return false;
}
