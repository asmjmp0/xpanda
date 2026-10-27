import type { PandaIRBasicBlock } from "../disasm/PandaIRBasicBlock";
import type { PandaIRCFG } from "../disasm/PandaIRCFG";
import { PandaDecompileException } from "../PandaParseException";
import { ValueGraph } from "./ValueGraph";
import { Region, TryCatchHelperRegion } from "./Region";
import { buildFinallyPlans } from "./TryFinally";

/**
 * Region 图构建器(移植自 Java jmp0.abc.decompiler.structure.RegionGraphBuilder)
 * @Author: jmp0
 */
export class RegionGraphBuilder {
    private readonly graph: ValueGraph<PandaIRBasicBlock>;
    private readonly btor = new Map<PandaIRBasicBlock, Region>();
    private readonly regionGraph = new ValueGraph<Region>();
    private readonly entryBlock: PandaIRBasicBlock;
    private readonly lastBlock: PandaIRBasicBlock;
    /** handleEntryBlock -> tryEntryBlock */
    private readonly exceptionHandleBlocks = new Map<PandaIRBasicBlock, PandaIRBasicBlock>();
    /** tryEntryBlock -> 保护范围结束 pc(不含)。同一入口取更紧的范围。 */
    private readonly tryBodyEndPC = new Map<PandaIRBasicBlock, number>();
    private isAsyncFunction = false;
    private isGeneratorFunction = false;

    constructor(private readonly pandaIRCFG: PandaIRCFG, entryBlock: PandaIRBasicBlock, lastBlock: PandaIRBasicBlock) {
        this.graph = pandaIRCFG.graph;
        this.entryBlock = entryBlock;
        this.lastBlock = lastBlock;
        if (pandaIRCFG.getPandaMethod().hasException()) {
            // ArkTS 13 经典形状的 finally(正常完成块写 hole 哨兵再跳到 cleanup)由
            // TryFinally 在 AST 上还原成 try/finally,不能接进区域图
            // (landing pad 会破坏可归约性)。
            const finallyStartPCs = new Set(buildFinallyPlans(pandaIRCFG).map((plan) => plan.startPC));
            // ArkTS 13 / 24 的 try 表都可能有 codeSize === 0 的处理器;旧行为会把
            // 真正的 catch 体整段剪掉(LogExport.readLogTail 的 hilog.error 分支、
            // Petrelgram 的 305 个 catch 都曾消失)。这里按 handler 结构注册真正的
            // catch;始终不可达的 handler 由下面的迭代接线跳过。
            const registerFinallyHandlers = isNewHandlerEncoding(pandaIRCFG);
            for (const tryBlock of pandaIRCFG.getPandaMethod().methodCode!.pandaMethodTryBlocks!) {
                // fixme 与 Java 一致只取第一个 catch
                const catchBlock = tryBlock.pandaMethodCatchBlocks[0];
                const tryEntryBlock = pandaIRCFG.getBasicBlockByPC(tryBlock.startPC)!;
                const tryCodeLength = tryBlock.length;
                const handleEntryBlock = pandaIRCFG.getBasicBlockByPC(catchBlock.handlerPC)!;
                const handleCodeLength = catchBlock.codeSize;
                if (this.checkIsForInException(tryEntryBlock)) continue;
                if (this.checkIsForOfException(tryEntryBlock, handleEntryBlock)) continue;
                if (checkIsAsyncException(handleEntryBlock)) {
                    this.isAsyncFunction = true;
                    continue;
                }
                if (checkIsGeneratorException(tryEntryBlock)) {
                    this.isGeneratorFunction = true;
                    continue;
                }
                if (tryCodeLength === 0) continue;
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
                const commitPC = handleCodeLength === 0
                    ? this.skippedCommitEnd(handleEntryBlock, tryBlock.startPC + tryCodeLength) : null;
                if (handleCodeLength === 0) {
                    if (this.isPureRethrowHandler(handleEntryBlock)) continue;
                    // 用户 catch 会把入口 `sta` 保存的异常再读出来(传给日志、读
                    // .message、再抛)。它和 finally 计划、内层 finally 的 hole
                    // 可以共用同一个 try 范围,不能因为这些特征被整段丢掉
                    // (amcl t11/a12 的 f1268 写文件失败、c1268 清单失败)。
                    const usesException = this.catchUsesException(handleEntryBlock);
                    const ignoredException = this.isIgnoredExceptionCatch(handleEntryBlock);
                    // 用户 catch 若每条路径都 return/throw,即使保护范围里有内层
                    // finally 的 hole,接进图也不会把循环后续代码拆进 catch
                    // (f1268 写 version.json 失败)。跳回循环头的 catch 是 continue
                    // (c1268 清单失败),单独注册,不按“回到 try 内”丢掉。
                    const loopContinue = this.continuesAtLoopHead(
                        handleEntryBlock, tryBlock.startPC, tryBlock.startPC + tryBlock.length);
                    const exitingCatch = (usesException || ignoredException || commitPC !== null)
                        && this.handlerExits(handleEntryBlock, tryBlock.startPC, tryBlock.startPC + tryBlock.length);
                    if (finallyStartPCs.has(tryBlock.startPC) && !exitingCatch) continue;
                    if (this.isFinallyHandler(handleEntryBlock) && !usesException) {
                        // 24.0.0.0 把 finally 内联在出口前,异常路径的清理只能靠它的
                        // handler 输出,再由 foldEagerCatchToFinally 还原成 try/finally。
                        // 13.0.1.0 的 handler-based finally 保持旧行为(内联 cleanup)。
                        if (!registerFinallyHandlers) continue;
                    } else if (this.isCatchHandler(handleEntryBlock) || ignoredException || commitPC !== null) {
                        // 13.0.1.0 的经典 finally 收尾还留在 try 体里(`if (hole == X)
                        // throw X`)。回到 try 内的 catch 仍然跳过。
                        // A catch that warns and jumps back to the loop head (c1268's
                        // "Failed to get manifest") is a continue, not a rethrow.
                        // The hole sentinel inside the try belongs to the inlined
                        // finally of the success path, not to this catch.
                        if (!registerFinallyHandlers && this.hasSentinelGuard(tryBlock)
                            && !exitingCatch && !loopContinue) continue;
                    } else {
                        continue;
                    }
                }
                this.exceptionHandleBlocks.set(handleEntryBlock, tryEntryBlock);
                // A user catch protects exactly its try-table range. Statements that
                // start at or after that end must not merge into the try body
                // (d1268's copyDirRecursive was swallowed by the "no maven" catch).
                // An await resume dispatch is not a user catch. A try longer than
                // 1024 bytes usually wraps a loop latch (loadLive); cutting it
                // stalls region reduction. A range nested inside a much larger try
                // is also left uncut when it is longer than 64 bytes: cutting
                // loadEvidence's 95-byte catch pulled the scan loop out and folded
                // the row array into an empty literal. Shorter inner catches are
                // still cut, or c763's 30-byte catch swallows the finally
                // continuation. Pure rethrow / poplexenv handlers get no end.
                const userCatch = this.catchUsesException(handleEntryBlock)
                    || this.isIgnoredExceptionCatch(handleEntryBlock)
                    || this.isCatchHandler(handleEntryBlock)
                    || commitPC !== null;
                const nestedWide = this.nestedInMuchLargerTry(tryBlock) && tryCodeLength > 64;
                const loopContinue = this.continuesAtLoopHead(
                    handleEntryBlock, tryBlock.startPC, tryBlock.startPC + tryCodeLength);
                if (userCatch && !nestedWide
                    && !this.isAsyncResumeHandler(handleEntryBlock)
                    && ((tryCodeLength <= 1024
                        && this.handlerExits(handleEntryBlock, tryBlock.startPC, tryBlock.startPC + tryCodeLength))
                        || loopContinue)) {
                    // The mov an empty catch jumps over belongs to the success path.
                    // The protected range has to cover it, or the assignment sits
                    // after the try and runs on the exception path too.
                    const endPC = commitPC ?? tryBlock.startPC + tryCodeLength;
                    const previousEnd = this.tryBodyEndPC.get(tryEntryBlock);
                    if (previousEnd === undefined || endPC < previousEnd) {
                        this.tryBodyEndPC.set(tryEntryBlock, endPC);
                    }
                }
            }
        }
    }

    build(): { regionGraph: ValueGraph<Region>; entryRegion: Region } {
        for (const node of this.graph.nodes()) {
            if (this.graph.inDegree(node) === 0 && node !== this.entryBlock
                && node !== this.lastBlock && !this.exceptionHandleBlocks.has(node)) {
                continue;
            }
            const region = this.createRegion(node);
            if (this.exceptionHandleBlocks.has(node)) {
                region.setExceptionLandingPadFlag();
            }
            this.btor.set(node, region);
            this.regionGraph.addNode(region);
        }

        for (const node of this.graph.nodes()) {
            if (this.graph.inDegree(node) === 0 && node !== this.entryBlock
                && node !== this.lastBlock && !this.exceptionHandleBlocks.has(node)) {
                continue;
            }
            const from = this.btor.get(node)!;
            for (const successor of this.graph.successors(node)) {
                const to = this.btor.get(successor);
                if (!to) continue;
                const value = this.graph.edgeValueOrThrow(node, successor);
                this.regionGraph.putEdgeValue(from, to, value);
            }
            if (this.graph.outDegree(node) === 0) {
                from.setType("Tail");
            }
        }

        // 删除死代码
        while (true) {
            let flag = false;
            for (const node of this.regionGraph.nodes()) {
                if (this.regionGraph.inDegree(node) === 0 && this.btor.get(this.entryBlock) !== node
                    && !node.isExceptionLandingPad()) {
                    this.regionGraph.removeNode(node);
                    flag = true;
                    break;
                }
                if (node.getType() === "Condition" && this.regionGraph.outDegree(node) === 1) {
                    node.setType("Linear");
                }
            }
            if (!flag) break;
        }

        if (this.isAsyncFunction) {
            for (const region of this.regionGraph.nodes().slice()) {
                if (!region.block) continue;
                for (const instruction of region.block.pandaInstructions) {
                    if (instruction.kind === "async" && instruction.asyncType === "asyncfunctionawaituncaught") {
                        if (region.getType() === "Condition") {
                            // reject 派发块把 await 的拒绝值再 throw 出去。跳转目标是
                            // 正常继续,它本身也可能以 throw 结束(`catch (e) { …; throw e }`
                            // 的 catch 体末尾),按“是不是 throw 块”判断会把 catch 的重抛
                            // 一起删掉(g9 executeInstall 的 catch 因此不再抛出)。
                            // 这里只删“throw 的正是 await 结果寄存器”的那条边。
                            const result = awaitResultRegister(region.block);
                            for (const region1 of this.regionGraph.successors(region).slice()) {
                                if (!region1.block || !region1.block.getTerminator().isThrowIns()) continue;
                                if (result !== null && !throwsRegister(region1.block, result)) continue;
                                this.regionGraph.removeNode(region1);
                                region.setType("Linear");
                            }
                        }
                    }
                }
            }
        }

        if (this.isGeneratorFunction) {
            for (const region of this.regionGraph.nodes().slice()) {
                if (!region.block) continue;
                for (const instruction of region.block.pandaInstructions) {
                    if (instruction.kind === "createGeneratorObj" && instruction.opcode.name === "creategeneratorobj") {
                        if (region.getType() === "Condition") {
                            for (const region1 of this.regionGraph.successors(region).slice()) {
                                if (!region1.block) continue;
                                if (region1.block.getTerminator().isReturnIns()) {
                                    this.regionGraph.removeNode(region1);
                                    region.setType("Linear");
                                } else if (region1.getType() === "Condition") {
                                    for (const region2 of this.regionGraph.successors(region1).slice()) {
                                        if (!region2.block) continue;
                                        if (region2.block.getTerminator().isThrowIns()) {
                                            this.regionGraph.removeNode(region2);
                                            region1.setType("Linear");
                                        } else {
                                            this.regionGraph.removeNode(region1);
                                            this.regionGraph.putEdgeValue(region, region2, true);
                                            region.setType("Linear");
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // 嵌套 try 的 handler 可能只在另一个 handler 的区域里才能到达(例如 catch
        // 里再套 try)。先连能到达的,再反复扫描:外层 handler 接进图之后,内层
        // try 入口才变成可达。始终不可达的(外层 finally/派发 handler 被跳过)
        // 不接进图,避免留下不可达的 landing pad 把整个方法逼到降级路径。
        const entryRegion = this.btor.get(this.entryBlock)!;
        const pending = new Map(this.exceptionHandleBlocks);
        let progress = true;
        while (pending.size > 0 && progress) {
            progress = false;
            for (const [handleEntry, tryEntry] of Array.from(pending)) {
                const tryEntryRegion = this.btor.get(tryEntry);
                const handleEntryRegion = this.btor.get(handleEntry);
                if (!tryEntryRegion || !handleEntryRegion || tryEntryRegion === entryRegion) {
                    // 区域已被裁掉,或者是入口区域本身(没有前驱可以改接给 helper)
                    pending.delete(handleEntry);
                    this.exceptionHandleBlocks.delete(handleEntry);
                    continue;
                }
                if (!this.isReachableRegion(entryRegion, tryEntryRegion)) continue;
                const endPC = this.tryBodyEndPC.get(tryEntry);
                if (endPC !== undefined) tryEntryRegion.tryBodyEndPC = endPC;
                const tryCatchRegion = new TryCatchHelperRegion(tryEntryRegion, handleEntryRegion);
                this.regionGraph.addNode(tryCatchRegion);
                for (const predecessor of this.regionGraph.predecessors(tryEntryRegion).slice()) {
                    const value = this.regionGraph.edgeValueOrThrow(predecessor, tryEntryRegion);
                    this.regionGraph.removeEdge(predecessor, tryEntryRegion);
                    this.regionGraph.putEdgeValue(predecessor, tryCatchRegion, value);
                }
                this.regionGraph.putEdgeValue(tryCatchRegion, tryEntryRegion, false);
                this.regionGraph.putEdgeValue(tryCatchRegion, handleEntryRegion, true);
                pending.delete(handleEntry);
                progress = true;
            }
        }
        for (const handleEntry of pending.keys()) this.exceptionHandleBlocks.delete(handleEntry);

        this.wireEmptyJoinCatches(entryRegion);

        // 只经由被跳过的异常处理器才能到达的块在正常控制流里是不可达的:
        // ArkTS 13 的 finally handler 带 codeSize === 0(RegionGraphBuilder 跳过),
        // 其下游清理代码没有来自区域图的前驱。上面的 inDegree 死代码删除删不掉它们
        // ——若这段代码内部带环(例如 finally 里的 for-of 关闭循环),环上的节点
        // inDegree > 0,于是作为孤岛留在图里;而 analysis 只从 entryRegion 出发归约,
        // 永远遍历不到孤岛,图就再也收不成一个节点,最后抛 "can not reduce the graph"
        // 降级到 SimpleAnalysis(amcl1.0.6.abc 的 commons/h1/w1 w91)。
        // 归约本身只可能产出从 entryRegion 可达的语句,所以按可达性再清理一遍。
        const reachable = new Set(this.regionGraph.depthFirstPostOrder(entryRegion));
        const unreachableRegions = this.regionGraph.nodes().filter((region) => !reachable.has(region));
        // 已经接进图的 landing pad 仍然不可达说明 helper 连错了(正常不应发生);
        // 被主动跳过的 handler 已经从 exceptionHandleBlocks 移除,其区域随其他
        // 不可达块一起剪掉。
        if (unreachableRegions.some((region) => region.block && this.exceptionHandleBlocks.has(region.block))) {
            throw new PandaDecompileException(
                this.pandaIRCFG.getPandaMethod().name.content + " unreachable exception handler regions");
        }
        for (const region of unreachableRegions) this.regionGraph.removeNode(region);
        return { regionGraph: this.regionGraph, entryRegion: this.btor.get(this.entryBlock)! };
    }

    private isReachableRegion(entry: Region, target: Region): boolean {
        const visited = new Set<Region>();
        const stack: Region[] = [entry];
        while (stack.length > 0) {
            const current = stack.pop()!;
            if (current === target) return true;
            if (visited.has(current)) continue;
            visited.add(current);
            for (const successor of this.regionGraph.successors(current)) stack.push(successor);
        }
        return false;
    }

    private createRegion(block: PandaIRBasicBlock): Region {
        // 与 Java RegionFactory 一致:先确定类型再构造 Region(Condition 分支需要在其构造器内初始化条件表达式)
        let regType: "Linear" | "Tail" | "Condition" = this.pandaIRCFG.graph.outDegree(block) === 0 ? "Tail" : "Linear";
        if (block.getTerminator().isConditional()) regType = "Condition";
        return new Region(block, regType);
    }

    /**
     * 纯 rethrow 处理器:`sta vX; [mov 恢复寄存器 / poplexenv]; lda vX; throw`。
     * 模块初始化的词法环境清理、for-of 的迭代器关闭清理、24.0.0.0 的 finally
     * 前置跳板都用这个形状,接进区域图只会多出一层语义等价的
     * `catch (e) { throw e }`,还会破坏 for-of 还原。
     */
    private isPureRethrowHandler(block: PandaIRBasicBlock): boolean {
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
    private isFinallyHandler(block: PandaIRBasicBlock): boolean {
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
                for (const successor of this.graph.successors(current)) {
                    if (throwsRegister(successor, savedName)) return true;
                }
            }
            for (const successor of this.graph.successors(current)) {
                if (!visited.has(successor)) queue.push(successor);
            }
        }
        return false;
    }

    /**
     * 入口 `sta vX` 保存的异常随后被使用: `mov dst, vX`,或 `lda vX` 且下一条
     * 不是 `throw`。`lda vX; throw` 只是重抛,不算用户 catch。
     */
    private catchUsesException(block: PandaIRBasicBlock): boolean {
        const first = block.pandaInstructions[0];
        if (!first || first.kind !== "store" || !first.destObj) return false;
        const saved = first.destObj.toString();
        const instructions = block.pandaInstructions;
        for (let i = 1; i < instructions.length; i++) {
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
    private skippedCommitEnd(entry: PandaIRBasicBlock, tryEnd: number): number | null {
        if (entry.pandaInstructions.length !== 1 || entry.pandaInstructions[0].kind !== "jumpDirect") return null;
        const targets = this.graph.successors(entry);
        if (targets.length !== 1) return null;
        const continuation = targets[0];
        if (continuation.getStartPC() < tryEnd) return null;
        const exit = this.pandaIRCFG.getBasicBlockByPC(tryEnd);
        if (!exit || exit.pandaInstructions.length !== 1 || exit.getTerminator().kind !== "jumpDirect") return null;
        const commits = this.graph.successors(exit);
        if (commits.length !== 1) return null;
        const commit = commits[0];
        if (commit.pandaInstructions.length !== 1 || commit.pandaInstructions[0].kind !== "mov") return null;
        const after = this.graph.successors(commit);
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
    private isIgnoredExceptionCatch(entry: PandaIRBasicBlock): boolean {
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
            for (const successor of this.graph.successors(block)) {
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
    private nestedInMuchLargerTry(tryBlock: { startPC: number; length: number }): boolean {
        const tries = this.pandaIRCFG.getPandaMethod().methodCode?.pandaMethodTryBlocks;
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
    private isAsyncResumeHandler(entry: PandaIRBasicBlock): boolean {
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
            for (const successor of this.graph.successors(block)) queue.push(successor);
        }
        return false;
    }

    /**
     * handler 的每条路径都离开 try 范围(return / throw / 落到范围外)。
     * 跳回 try 里面的 catch 会改变循环出口,结构化归约会把循环后的代码内联进循环体。
     */
    private handlerExits(entry: PandaIRBasicBlock, tryStart: number, tryEnd: number): boolean {
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
            const successors = this.graph.successors(block);
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
    private continuesAtLoopHead(entry: PandaIRBasicBlock, tryStart: number, tryEnd: number): boolean {
        if (!this.isCatchHandler(entry)) return false;
        const heads = new Set<PandaIRBasicBlock>();
        for (const block of this.pandaIRCFG.pandaIRBasicBlocks) {
            const pc = block.getStartPC();
            if (pc < tryStart || pc >= tryEnd) continue;
            for (const successor of this.graph.successors(block)) {
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
            for (const successor of this.graph.successors(block)) stack.push(successor);
        }
        return false;
    }

    /**
     * `try { mkdirSync / closeSync } catch {}`: the try is one block, the next
     * block is a nop `jmp` onto the following statement, and the handler is that
     * statement (or only the spill reloads the call clobbered, which the success
     * path skips). Both paths join, so the catch body is the nop jump.
     * A join that itself throws is a rethrow bridge, not an ignored call.
     */
    private wireEmptyJoinCatches(entryRegion: Region): void {
        const tries = this.pandaIRCFG.getPandaMethod().methodCode?.pandaMethodTryBlocks;
        if (!tries) return;
        for (const tryBlock of tries) {
            if (tryBlock.length === 0 || tryBlock.length > 200) continue;
            const catchBlock = tryBlock.pandaMethodCatchBlocks[0];
            if (!catchBlock || catchBlock.codeSize !== 0) continue;
            const tryEnd = tryBlock.startPC + tryBlock.length;
            const bridgeBlock = this.pandaIRCFG.getBasicBlockByPC(tryEnd);
            if (!bridgeBlock || bridgeBlock.pandaInstructions.length !== 1
                || bridgeBlock.getTerminator().kind !== "jumpDirect") continue;
            const bridgeSuccs = this.graph.successors(bridgeBlock);
            if (bridgeSuccs.length !== 1) continue;
            const joinBlock = bridgeSuccs[0];
            if (joinBlock.getStartPC() < tryEnd || joinBlock.getTerminator().kind === "throw") continue;
            const handlerBlock = this.pandaIRCFG.getBasicBlockByPC(catchBlock.handlerPC);
            if (!handlerBlock) continue;
            if (handlerBlock !== joinBlock
                && !this.isSpillRestore(handlerBlock, joinBlock, tryBlock.startPC, tryEnd)) continue;
            const tryEntryBlock = this.pandaIRCFG.getBasicBlockByPC(tryBlock.startPC);
            if (!tryEntryBlock) continue;
            const tryRegion = this.btor.get(tryEntryBlock);
            const bridgeRegion = this.btor.get(bridgeBlock);
            const joinRegion = this.btor.get(joinBlock);
            if (!tryRegion || !bridgeRegion || !joinRegion || tryRegion === entryRegion) continue;
            if (bridgeRegion.isExceptionLandingPad() || tryRegion.isTryCatchHelperRegion()) continue;
            if (!this.isReachableRegion(entryRegion, tryRegion)) continue;
            if (this.regionGraph.outDegree(tryRegion) !== 1
                || this.regionGraph.successors(tryRegion)[0] !== bridgeRegion) continue;
            const predecessors = this.regionGraph.predecessors(tryRegion);
            if (predecessors.length === 0) continue;
            bridgeRegion.setExceptionLandingPadFlag();
            this.regionGraph.removeEdge(tryRegion, bridgeRegion);
            // The join may already be the body of a later try/catch. Landing on
            // the raw body skips that catch (readJarMainClass: mkdir's success
            // path bypasses the decompress catch, and the empty jmp then absorbs
            // the helper, so the graph never collapses).
            const wrapping = this.regionGraph.predecessors(joinRegion).find((region) =>
                region.isTryCatchHelperRegion()
                && this.regionGraph.edgeValue(region, joinRegion) === false);
            this.regionGraph.putEdgeValue(tryRegion, wrapping ?? joinRegion, false);
            const previousEnd = tryRegion.tryBodyEndPC;
            if (previousEnd === null || tryEnd < previousEnd) tryRegion.tryBodyEndPC = tryEnd;
            const helper = new TryCatchHelperRegion(tryRegion, bridgeRegion);
            this.regionGraph.addNode(helper);
            for (const predecessor of predecessors) {
                const value = this.regionGraph.edgeValueOrThrow(predecessor, tryRegion);
                this.regionGraph.removeEdge(predecessor, tryRegion);
                this.regionGraph.putEdgeValue(predecessor, helper, value);
            }
            this.regionGraph.putEdgeValue(helper, tryRegion, false);
            this.regionGraph.putEdgeValue(helper, bridgeRegion, true);
        }
    }

    /** Handler movs are the inverse of spills in the try (`mov slot, r` / `mov r, slot`). */
    private isSpillRestore(handler: PandaIRBasicBlock, join: PandaIRBasicBlock, tryStart: number, tryEnd: number): boolean {
        if (handler === join || handler.pandaInstructions.length < 2) return false;
        if (this.graph.successors(handler).length !== 1 || this.graph.successors(handler)[0] !== join) return false;
        const spills = new Set<string>();
        for (const block of this.pandaIRCFG.pandaIRBasicBlocks) {
            const pc = block.getStartPC();
            if (pc < tryStart || pc >= tryEnd) continue;
            for (const instruction of block.pandaInstructions) {
                if (instruction.kind !== "mov" || !instruction.destObj || !instruction.srcObj) continue;
                spills.add(instruction.srcObj.toString() + "<-" + instruction.destObj.toString());
            }
        }
        for (const instruction of handler.pandaInstructions) {
            if (instruction.kind !== "mov" || !instruction.destObj || !instruction.srcObj) return false;
            if (!spills.has(instruction.destObj.toString() + "<-" + instruction.srcObj.toString())) return false;
        }
        return true;
    }

    /**
     * 真正的 catch 处理器:入口 `sta vX`,并在 handler 入口基本块里做可见工作
     * (读字符串 / 模块变量 / 属性,或发起调用)。编译器生成的 for-of / await
     * resume 派发 handler 只做寄存器恢复和条件跳转,不具备这些特征,不能接进区域图。
     */
    private isCatchHandler(block: PandaIRBasicBlock): boolean {
        if (block.pandaInstructions[0]?.kind !== "store") return false;
        return block.pandaInstructions.some((instruction) => {
            if (instruction.kind === "load") {
                return instruction.loadType === "STRING" || instruction.loadType === "GLOBAL";
            }
            if (instruction.kind === "loadObjectBy" || instruction.kind === "storeObject") return true;
            if (instruction.kind === "call") return true;
            return instruction.opcode.name === "ldexternalmodulevar" || instruction.opcode.name === "newobjrange";
        });
    }

    /** try 范围内是否有经典 finally 的 hole 哨兵(13.0.1.0 的收尾残留) */
    private hasSentinelGuard(tryBlock: { startPC: number; length: number }): boolean {
        const start = tryBlock.startPC;
        const end = start + tryBlock.length;
        for (const block of this.pandaIRCFG.pandaIRBasicBlocks) {
            const pc = block.getStartPC();
            if (pc < start || pc >= end) continue;
            if (block.pandaInstructions.some((instruction) => instruction.kind === "load" && instruction.loadType === "HOLE")) {
                return true;
            }
        }
        return false;
    }

    private checkIsForInException(block: PandaIRBasicBlock): boolean {
        let blocks = this.pandaIRCFG.graph.successors(block);
        if (blocks.length !== 1) return false;
        block = blocks[0];
        blocks = this.pandaIRCFG.graph.successors(block);
        if (blocks.length !== 1) return false;
        block = blocks[0];
        for (const instruction of block.pandaInstructions) {
            if (instruction.kind === "getIterator") return true;
        }
        return false;
    }

    private checkIsForOfException(tryBlock: PandaIRBasicBlock, catchBlock: PandaIRBasicBlock): boolean {
        if (tryBlock.pandaInstructions.length > 2) {
            const instruction = tryBlock.pandaInstructions[1];
            if (instruction.kind === "loadObjectBy") {
                const obj = instruction.ldObj;
                if (!obj) return false;
                const content = obj.toString();
                if (content === "\"return\"") return true;
            }
        }
        const blocks = this.pandaIRCFG.graph.successors(catchBlock);
        if (blocks.length !== 2) return false;
        const first = blocks[0];
        const second = blocks[1];
        if (first.getTerminator().kind !== "throw") return false;
        for (const instruction of second.pandaInstructions) {
            if (instruction.kind === "load" && instruction.loadType === "HOLE") return true;
        }
        return false;
    }

    getEntryRegion(): Region {
        return this.btor.get(this.entryBlock)!;
    }
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

/**
 * await 结果的寄存器:`resumegenerator` 之后第一次 `sta vX` 保存的就是恢复值,
 * reject 派发块再把它 throw 出去(`lda vX; throw`)。
 */
function awaitResultRegister(block: PandaIRBasicBlock): string | null {
    const instructions = block.pandaInstructions;
    for (let i = 0; i < instructions.length; i++) {
        const instruction = instructions[i];
        if (instruction.kind !== "generator" || (instruction as any).generatorType !== "resumegenerator") continue;
        for (let j = i + 1; j < instructions.length; j++) {
            if (instructions[j].kind !== "store") continue;
            const dest = (instructions[j] as any).destObj;
            return dest ? dest.toString() : null;
        }
        return null;
    }
    return null;
}

/** 24.0.0.0+ 的 try 表把真正的 catch 处理器也写成 codeSize === 0 */
function isNewHandlerEncoding(cfg: PandaIRCFG): boolean {
    const version = cfg.getPandaMethod().getPandaFile()?.header.version;
    return !!version && version[0] >= 24;
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
