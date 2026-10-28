import type { PandaIRCFG } from "../disasm/PandaIRCFG";
import type { PandaIRBasicBlock } from "../disasm/PandaIRBasicBlock";
import type { PandaMethodTryBlock } from "../file/method/PandaMethodTryBlock";
import { buildFinallyPlans, comparesHoleWith, type FinallyPlan } from "./TryFinally";
import { instructionAccess } from "./ValueAnalysis";
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
}

function scanHandlerBody(blocks: PandaIRBasicBlock[]): HandlerBodyFlags {
    const flags: HandlerBodyFlags = {
        work: false, call: false, throws: false, hole: false, dispatch: false, returns: false,
    };
    for (const block of blocks) {
        for (const instruction of block.pandaInstructions) {
            if (isCatchBodyWork(instruction)) flags.work = true;
            if (instruction.kind === "call" || instruction.opcode.name === "newobjrange") flags.call = true;
            if (instruction.kind === "throw") flags.throws = true;
            if (isHoleLoadInstruction(instruction)) flags.hole = true;
            if (isAsyncDispatchInstruction(instruction, true)) flags.dispatch = true;
            if (instruction.kind === "return" || instruction.opcode.name === "asyncfunctionresolve") flags.returns = true;
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
    if (flags.work) return !sharedStartKept && (flags.returns || rejoin);
    if (!flags.returns) {
        // Bare `jmp` empty catch to a forward join (`try { … } catch {}` then
        // more code). A `mov; jmp` handler restores the compiler's spills;
        // registering it would pull those saves/restores into the catch as
        // `v8 = v10` / `v8 = local_0_2` noise (`DraftMediaStore.inspectDir`,
        // `MovingPhotoCache.pruneCache`). A backward target is a loop latch
        // (continue) and stays out for the same reason (`GameInstall`).
        if (!rejoin || !joinTarget) return false;
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
): boolean {
    const instructions = entry.pandaInstructions;
    if (instructions.length !== 1 || instructions[0].kind !== "store") return false;
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
    const tryWrites = new Set<string>();
    for (const block of cfg.pandaIRBasicBlocks) {
        const pc = block.getStartPC();
        if (pc < tryStart || pc >= tryEnd) continue;
        for (const instruction of block.pandaInstructions) {
            const { def } = instructionAccess(instruction);
            if (def) tryWrites.add(def);
        }
    }
    if (tryWrites.size === 0) return false;
    const body = forwardBodyBlocks(cfg, entry, tryStart, tryEnd);
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
            if (instruction.kind !== "mov") {
                for (const use of uses) {
                    if (!defined.has(use) && tryWrites.has(use)) return true;
                }
            }
            if (def) defined.add(def);
        }
    }
    return false;
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
            const ignoredByBody = !finallyHandler && !sharedStartKept
                && (isIgnoredCatchByBody(cfg, handlerEntryBlock, startPC, endPC, sharedStartKept)
                    || (handlerWrapsNewError(cfg, handlerEntryBlock, startPC, endPC) && !readsTryValues())
                    || isEmptyContinueCatch(cfg, handlerEntryBlock, startPC, endPC));
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
            const bodyWork = handlerBodyHasVisibleWork(cfg, handlerEntryBlock, startPC, endPC)
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
