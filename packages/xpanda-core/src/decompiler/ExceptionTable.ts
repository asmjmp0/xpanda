import type { PandaIRCFG } from "../disasm/PandaIRCFG";
import type { PandaIRBasicBlock } from "../disasm/PandaIRBasicBlock";
import type { PandaMethodTryBlock } from "../file/method/PandaMethodTryBlock";
import { buildFinallyPlans } from "./TryFinally";

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
                if (throwsRegister(successor, savedName)) return true;
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
 * 忽略异常值的 catch:handler 不以 `sta` 开头。
 * `ldnull; return`、单条 `mov`(保留默认值),或常量日志后 return。
 * 单条 `jmp` 默认不接:它常常跳过成功路径上的一条赋值再汇合,盲目接进图
 * 会把汇合点拆坏。`skippedCommitEnd` 只认「跳过恰好一条 mov」这一种,
 * 并把那条 mov 留在 try 的成功路径里(y1267 的空 catch)。
 * 多条 `mov` 是 for-of close 的寄存器倒换,不能接进图。
 */
export function isIgnoredExceptionCatch(cfg: PandaIRCFG, entry: PandaIRBasicBlock): boolean {
    const first = entry.pandaInstructions[0];
    if (!first || first.kind === "store" || first.kind === "throw") return false;
    if (first.kind === "load" && first.loadType === "HOLE") return false;
    if (first.kind === "jumpDirect" || first.opcode.name === "jmp") return false;
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
    const seen = new Set<PandaIRBasicBlock>();
    const queue: PandaIRBasicBlock[] = [entry];
    let budget = 6;
    while (queue.length > 0 && budget-- > 0) {
        const block = queue.shift()!;
        if (seen.has(block)) continue;
        seen.add(block);
        for (const instruction of block.pandaInstructions) {
            if (instruction.kind === "throw") sawThrow = true;
            if (instruction.kind === "return") sawReturn = true;
            if (instruction.kind === "load" && instruction.loadType === "STRING") sawString = true;
        }
        for (const successor of cfg.graph.normalSuccessors(block)) {
            // A handler that jumps back into the loop (an empty catch whose
            // "continue" lands on the latch) is not a constant-log handler:
            // following the back edge would walk the whole loop body and find
            // its strings/returns (`o8.clearDisplayListeners`).
            if (successor.getStartPC() <= start) continue;
            queue.push(successor);
        }
    }
    return sawString && sawReturn && !sawThrow;
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
    const seen = new Set<PandaIRBasicBlock>();
    const queue: PandaIRBasicBlock[] = [entry];
    let budget = 6;
    while (queue.length > 0 && budget-- > 0) {
        const block = queue.shift()!;
        if (seen.has(block)) continue;
        seen.add(block);
        for (const instruction of block.pandaInstructions) {
            const name = instruction.opcode.name;
            if (name === "asyncfunctionawaituncaught" || name === "suspendgenerator"
                || name === "resumegenerator" || name === "asyncfunctionreject") return true;
        }
        for (const successor of cfg.graph.normalSuccessors(block)) queue.push(successor);
    }
    return false;
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

/**
 * 真正的 catch 处理器:有效入口 `sta vX`,并在 handler 入口基本块里做可见工作
 * (读字符串 / 模块变量 / 属性,或发起调用)。编译器生成的 for-of / await
 * resume 派发 handler 只做寄存器恢复和条件跳转,不具备这些特征,不能接进区域图。
 */
export function isCatchHandler(block: PandaIRBasicBlock): boolean {
    const { start } = handlerEffectiveEntry(block);
    if (block.pandaInstructions[start]?.kind !== "store") return false;
    return block.pandaInstructions.slice(start).some((instruction) => {
        if (instruction.kind === "load") {
            return instruction.loadType === "STRING" || instruction.loadType === "GLOBAL";
        }
        // tryldglobalbyname 是独立的 loadGlobal kind:`catch (e) { e instanceof Error
        // … }` 的入口块里只有它和 instanceof/比较,不带 STRING/GLOBAL 载入。
        if (instruction.kind === "loadGlobal") return true;
        if (instruction.kind === "loadObjectBy" || instruction.kind === "storeObject") return true;
        if (instruction.kind === "call") return true;
        return instruction.opcode.name === "ldexternalmodulevar" || instruction.opcode.name === "newobjrange";
    });
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
    return block.pandaInstructions.slice(start).some((instruction) => {
        if (instruction.kind === "load") {
            return instruction.loadType === "STRING" || instruction.loadType === "GLOBAL";
        }
        if (instruction.kind === "loadGlobal") return true;
        if (instruction.kind === "loadObjectBy" || instruction.kind === "storeObject") return true;
        if (instruction.kind === "call") return true;
        return instruction.opcode.name === "ldexternalmodulevar" || instruction.opcode.name === "newobjrange";
    });
}

/** try 范围内是否有经典 finally 的 hole 哨兵(13.0.1.0 的收尾残留) */
export function hasSentinelGuard(cfg: PandaIRCFG, tryBlock: { startPC: number; length: number }): boolean {
    const start = tryBlock.startPC;
    const end = start + tryBlock.length;
    for (const block of cfg.pandaIRBasicBlocks) {
        const pc = block.getStartPC();
        if (pc < start || pc >= end) continue;
        if (block.pandaInstructions.some((instruction) => instruction.kind === "load" && instruction.loadType === "HOLE")) {
            return true;
        }
    }
    return false;
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
    for (const instruction of second.pandaInstructions) {
        if (instruction.kind === "load" && instruction.loadType === "HOLE") return true;
    }
    return false;
}

/** 24.0.0.0+ 的 try 表把真正的 catch 处理器也写成 codeSize === 0 */
export function isNewHandlerEncoding(cfg: PandaIRCFG): boolean {
    const version = cfg.getPandaMethod().getPandaFile()?.header.version;
    return !!version && version[0] >= 24;
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
    const finallyPlans = buildFinallyPlans(cfg);
    const finallyStartPCs = new Set(finallyPlans.map((plan) => plan.startPC));
    // startPC -> finally 计划里最长的保护范围:用户 catch 与 finally 共用起点时,
    // catch 条目的范围一定比 finally 短(catch 在 finally 里面结束)。
    const finallyEndByStart = new Map<number, number>();
    for (const plan of finallyPlans) {
        const previous = finallyEndByStart.get(plan.startPC) ?? 0;
        if (plan.endPC > previous) finallyEndByStart.set(plan.startPC, plan.endPC);
    }
    const registerFinallyHandlers = isNewHandlerEncoding(cfg);
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
        // Bytecode 24.0.0.0 的处理器同样把 codeSize 写成 0(SDK 差异,
        // 异常派发只用 handlerPC)。codeSize 为 0 时无法用 try 表界定 handler,
        // 但 handler 本身是一个完整的基本块链:真正的 catch 必须接进区域图,
        // 否则 catch 体在正常控制流里不可达、会被整段剪掉
        // (LogExport.readLogTail 的 hilog.error 分支曾整个消失)。
        // 旧版本(13.0.1.0)保持原行为;24+ 上纯 rethrow 处理器和没有可见
        // 工作的编译器派发 handler 仍然跳过:
        //  - 纯 rethrow 处理器只是 finally 的异常跳板 / 词法环境清理;
        //  - 经典 finally(正常完成块里写 hole 哨兵再跳到 cleanup)交给
        //    TryFinally 还原。
        const commitPC = handleCodeLength === 0 ? skippedCommitEnd(cfg, handlerEntryBlock, endPC) : null;
        if (handleCodeLength === 0) {
            if (isPureRethrowHandler(handlerEntryBlock)) { push("pureRethrow", false); continue; }
            // 用户 catch 会把入口 `sta` 保存的异常再读出来(传给日志、读
            // .message、再抛)。它和 finally 计划、内层 finally 的 hole
            // 可以共用同一个 try 范围,不能因为这些特征被整段丢掉
            // (amcl t11/a12 的 f1268 写文件失败、c1268 清单失败)。
            const usesException = catchUsesException(handlerEntryBlock);
            const ignoredException = isIgnoredExceptionCatch(cfg, handlerEntryBlock);
            // 用户 catch 若每条路径都 return/throw,即使保护范围里有内层
            // finally 的 hole,接进图也不会把循环后续代码拆进 catch
            // (f1268 写 version.json 失败)。跳回循环头的 catch 是 continue
            // (c1268 清单失败),单独注册,不按“回到 try 内”丢掉。
            const loopContinue = continuesAtLoopHead(cfg, handlerEntryBlock, startPC, endPC);
            const finallyHandler = isFinallyHandler(cfg, handlerEntryBlock) && !usesException;
            // 用户 catch 与 finally 共用起点时,catch 条目的保护范围更短;只有这种
            // 条目才允许用“忽略异常、入口带寄存器恢复”的判据,否则会把大量
            // finally 落点误判成 catch(amcl 上 try 数量翻倍)。
            const catchOfSharedStart = (finallyEndByStart.get(startPC) ?? 0) > endPC;
            const catchHandler = isCatchHandler(handlerEntryBlock) || ignoredException || commitPC !== null
                || (catchOfSharedStart && isIgnoringCatchHandler(handlerEntryBlock) && !finallyHandler);
            const exitingCatch = (usesException || ignoredException || commitPC !== null)
                && handlerExits(cfg, handlerEntryBlock, startPC, endPC);
            // 用户 catch 可以和 finally 共用同一个 try 起点(源码 `try { … }
            // catch { … } finally { … }`):入口块里有可见工作(读 .message /
            // instanceof / 调日志)就说明它是 catch,不能因为起点同时是 finally
            // 起点就整段丢掉(ReplyDialog.handleImagePick 的 `[MPUP] error`
            // 分支曾整个消失)。
            if (finallyStartPCs.has(startPC) && !exitingCatch && !catchHandler) { push("classicFinally", false, { usesException, exits: exitingCatch, loopContinue }); continue; }
            if (finallyHandler) {
                // 24.0.0.0 把 finally 内联在出口前,异常路径的清理只能靠它的
                // handler 输出,再由 foldEagerCatchToFinally 还原成 try/finally。
                // 13.0.1.0 的 handler-based finally 保持旧行为(内联 cleanup)。
                if (!registerFinallyHandlers) { push("classicFinally", false, { usesException, exits: exitingCatch, loopContinue }); continue; }
            } else if (catchHandler) {
                // 13.0.1.0 的经典 finally 收尾还留在 try 体里(`if (hole == X)
                // throw X`)。回到 try 内的 catch 仍然跳过。
                // A catch that warns and jumps back to the loop head (c1268's
                // "Failed to get manifest") is a continue, not a rethrow.
                // The hole sentinel inside the try belongs to the inlined
                // finally of the success path, not to this catch.
                if (!registerFinallyHandlers && hasSentinelGuard(cfg, tryBlock)
                    && !exitingCatch && !loopContinue) { push("classicFinally", false, { usesException, exits: exitingCatch, loopContinue }); continue; }
            } else {
                // 编译器派发/词法清理 handler:没有可见工作,不接进图。
                push("unknown", false, { usesException, exits: exitingCatch, loopContinue });
                continue;
            }
            const kind: HandlerKind = finallyHandler && !usesException && !ignoredException && commitPC === null
                ? "finallyEpilogue"
                : ignoredException && !usesException ? "ignoredCatch" : "userCatch";
            const protectedEndPC = decideProtectedEnd(cfg, tryBlock, handlerEntryBlock, commitPC, tryCodeLength, catchOfSharedStart);
            push(kind, true, { usesException, exits: exitingCatch, loopContinue, protectedEndPC });
            continue;
        }
        // 非 0 codeSize(13.0.1.0 的 yourpipe 等):沿用旧行为,handler 一律接图。
        const usesException = catchUsesException(handlerEntryBlock);
        const ignoredException = isIgnoredExceptionCatch(cfg, handlerEntryBlock);
        const loopContinue = continuesAtLoopHead(cfg, handlerEntryBlock, startPC, endPC);
        const exits = handlerExits(cfg, handlerEntryBlock, startPC, endPC);
        const protectedEndPC = decideProtectedEnd(cfg, tryBlock, handlerEntryBlock, commitPC, tryCodeLength, false);
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
): number | null {
    const startPC = tryBlock.startPC;
    const endPC = startPC + tryCodeLength;
    const userCatch = catchUsesException(handlerEntryBlock)
        || isIgnoredExceptionCatch(cfg, handlerEntryBlock)
        || isCatchHandler(handlerEntryBlock)
        || (catchOfSharedStart && isIgnoringCatchHandler(handlerEntryBlock) && !isFinallyHandler(cfg, handlerEntryBlock))
        || commitPC !== null;
    const nestedWide = nestedInMuchLargerTry(cfg, tryBlock) && tryCodeLength > 64;
    const loopContinue = continuesAtLoopHead(cfg, handlerEntryBlock, startPC, endPC);
    if (!userCatch || nestedWide || isAsyncResumeHandler(cfg, handlerEntryBlock)) return null;
    if (!((tryCodeLength <= 1024 && handlerExits(cfg, handlerEntryBlock, startPC, endPC)) || loopContinue)) return null;
    // The mov an empty catch jumps over belongs to the success path.
    // The protected range has to cover it, or the assignment sits
    // after the try and runs on the exception path too.
    return commitPC ?? endPC;
}

/** 块内是否 `X == hole` / `X != hole` 比较(X 为 handler 保存的异常) */
function comparesHoleWith(block: PandaIRBasicBlock, register: string): boolean {
    const instructions = block.pandaInstructions;
    const holeIndex = instructions.findIndex((instruction) => instruction.kind === "load" && instruction.loadType === "HOLE");
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

/** 该基本块是否先 `lda vX` 再 `throw`(X 为 handler 保存的异常) */
function throwsRegister(block: PandaIRBasicBlock, register: string): boolean {
    const instructions = block.pandaInstructions;
    if (instructions[instructions.length - 1].kind !== "throw") return false;
    return instructions.some((instruction) => instruction.kind === "load"
        && instruction.loadType === "OBJECT"
        && (instruction as any).loadParam?.toString() === register);
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
