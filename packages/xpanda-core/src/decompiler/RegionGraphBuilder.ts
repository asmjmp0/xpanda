import type { PandaIRBasicBlock } from "../disasm/PandaIRBasicBlock";
import type { PandaIRCFG } from "../disasm/PandaIRCFG";
import { PandaDecompileException } from "../PandaParseException";
import { ValueGraph } from "./ValueGraph";
import { Region, TryRegion } from "./Region";
import type { TryEntry } from "./ExceptionTable";

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
    /** handler 入口 → try 条目 */
    private readonly exceptionHandlers = new Map<PandaIRBasicBlock, TryEntry>();
    /** tryEntryBlock -> 保护范围结束 pc(不含)。同一入口取更紧的范围。 */
    private readonly tryBodyEndPC = new Map<PandaIRBasicBlock, number>();
    private isAsyncFunction = false;
    private isGeneratorFunction = false;

    constructor(private readonly pandaIRCFG: PandaIRCFG, entryBlock: PandaIRBasicBlock, lastBlock: PandaIRBasicBlock) {
        this.graph = pandaIRCFG.graph;
        this.entryBlock = entryBlock;
        this.lastBlock = lastBlock;
        // 处理器判定集中在 ExceptionTable,这里只消费结论:哪些 try 条目接进
        // 区域图,以及 try 体的吸收边界。getExceptionTable() 同时补上 CFG 的显式异常边。
        const table = pandaIRCFG.getExceptionTable();
        this.isAsyncFunction = table.isAsyncFunction;
        this.isGeneratorFunction = table.isGeneratorFunction;
        for (const entry of table.entries) {
            if (!entry.keep || !entry.tryEntryBlock || !entry.handlerEntryBlock) continue;
            this.exceptionHandlers.set(entry.handlerEntryBlock, entry);
            if (entry.protectedEndPC !== null) {
                const previousEnd = this.tryBodyEndPC.get(entry.tryEntryBlock);
                if (previousEnd === undefined || entry.protectedEndPC < previousEnd) {
                    this.tryBodyEndPC.set(entry.tryEntryBlock, entry.protectedEndPC);
                }
            }
        }
    }

    build(): { regionGraph: ValueGraph<Region>; entryRegion: Region } {
        // 先补显式异常边:下面所有度数/可达性判断都依赖它。
        this.pandaIRCFG.getExceptionTable();
        // 字节码特征清理:只为"正常控制流可达的块"和"保留下来的 handler 及其
        // 正常流闭包"建立区域。编译器协议 handler(pure rethrow / for-of close /
        // async 拒绝派发 / for-in 取迭代器)不占区域,其下游清理代码也不会成为
        // 孤岛参与归约。这比逐个块做 in-degree 死代码删除更直接,也让后面的
        // 可达性兜底裁剪几乎没有事情可做。
        const regionBlocks = this.collectRegionBlocks();
        for (const node of this.graph.nodes()) {
            if (!regionBlocks.has(node) && node !== this.lastBlock) {
                continue;
            }
            const region = this.createRegion(node);
            if (this.exceptionHandlers.has(node)) {
                region.setExceptionLandingPadFlag();
            }
            this.btor.set(node, region);
            this.regionGraph.addNode(region);
        }

        for (const node of this.graph.nodes()) {
            if (!regionBlocks.has(node) && node !== this.lastBlock) {
                continue;
            }
            const from = this.btor.get(node)!;
            for (const successor of this.graph.normalSuccessors(node)) {
                const to = this.btor.get(successor);
                if (!to) continue;
                const value = this.graph.edgeValueOrThrow(node, successor);
                this.regionGraph.putEdgeValue(from, to, value);
            }
            if (this.graph.normalSuccessors(node).length === 0) {
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
        const pending = new Map(this.exceptionHandlers);
        let progress = true;
        while (pending.size > 0 && progress) {
            progress = false;
            for (const [handleEntry, entry] of Array.from(pending)) {
                const tryEntry = entry.tryEntryBlock!;
                const tryEntryRegion = this.btor.get(tryEntry);
                const handleEntryRegion = this.btor.get(handleEntry);
                if (!tryEntryRegion || !handleEntryRegion || tryEntryRegion === entryRegion) {
                    // 区域已被裁掉,或者是入口区域本身(没有前驱可以改接给 try 区域)
                    pending.delete(handleEntry);
                    this.exceptionHandlers.delete(handleEntry);
                    continue;
                }
                if (!this.isReachableRegion(entryRegion, tryEntryRegion)) continue;
                const endPC = this.tryBodyEndPC.get(tryEntry);
                if (endPC !== undefined) tryEntryRegion.tryBodyEndPC = endPC;
                const tryRegion = this.createTryRegion(
                    tryEntryRegion, handleEntryRegion, endPC ?? null,
                    entry.kind === "finallyEpilogue" ? "finallyEpilogue" : "catch");
                for (const predecessor of this.regionGraph.normalPredecessors(tryEntryRegion).slice()) {
                    const value = this.regionGraph.edgeValueOrThrow(predecessor, tryEntryRegion);
                    this.regionGraph.removeEdge(predecessor, tryEntryRegion);
                    this.regionGraph.putEdgeValue(predecessor, tryRegion, value);
                }
                this.regionGraph.putEdgeValue(tryRegion, tryEntryRegion, false);
                this.regionGraph.putExceptionEdge(tryRegion, handleEntryRegion);
                pending.delete(handleEntry);
                progress = true;
            }
        }
        for (const handleEntry of pending.keys()) this.exceptionHandlers.delete(handleEntry);

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
        if (unreachableRegions.some((region) => region.block && this.exceptionHandlers.has(region.block))) {
            throw new PandaDecompileException(
                this.pandaIRCFG.getPandaMethod().name.content + " unreachable exception handler regions");
        }
        for (const region of unreachableRegions) this.regionGraph.removeNode(region);
        return { regionGraph: this.regionGraph, entryRegion: this.btor.get(this.entryBlock)! };
    }

    /**
     * 参与区域图的块集合:
     *   1. 从入口沿普通控制流可达的块;
     *   2. 保留下来的 handler 入口,以及从它们沿普通边可达的块(catch 体、嵌套 try)。
     * 被跳过的协议 handler 不在集合里,它们连同下游清理代码一起被排除。
     */
    private collectRegionBlocks(): Set<PandaIRBasicBlock> {
        const allowed = new Set<PandaIRBasicBlock>();
        const visit = (start: PandaIRBasicBlock): void => {
            const stack: PandaIRBasicBlock[] = [start];
            while (stack.length > 0) {
                const block = stack.pop()!;
                if (allowed.has(block)) continue;
                allowed.add(block);
                for (const successor of this.graph.normalSuccessors(block)) stack.push(successor);
            }
        };
        visit(this.entryBlock);
        for (const entry of this.exceptionHandlers.values()) {
            if (entry.handlerEntryBlock) visit(entry.handlerEntryBlock);
        }
        return allowed;
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
        let regType: "Linear" | "Tail" | "Condition" = this.pandaIRCFG.graph.normalSuccessors(block).length === 0 ? "Tail" : "Linear";
        if (block.getTerminator().isConditional()) regType = "Condition";
        return new Region(block, regType);
    }

    /**
     * `try { call } catch {}`:try 体只有一次调用,后面跟一条 nop `jmp` 桥,
     * handler 恰好是桥的目标(或只恢复被调用约定破坏的寄存器)。
     * 两条路径在 join 汇合,所以 catch 体是那条空跳转,必须作为 landing pad 保留。
     * 该 try 条目可能已被主接线当作普通 catch 接进图,这里跳过(`isTryRegion`)。
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
            const bridgeSuccs = this.graph.normalSuccessors(bridgeBlock);
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
            if (bridgeRegion.isExceptionLandingPad() || tryRegion.isTryRegion()) continue;
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
                region.isTryRegion() && this.regionGraph.normalSuccessors(region)[0] === joinRegion);
            this.regionGraph.putEdgeValue(tryRegion, wrapping ?? joinRegion, false);
            const previousEnd = tryRegion.tryBodyEndPC;
            if (previousEnd === null || tryEnd < previousEnd) tryRegion.tryBodyEndPC = tryEnd;
            const helper = this.createTryRegion(tryRegion, bridgeRegion, tryEnd, "catch");
            for (const predecessor of predecessors) {
                const exceptionEdge = this.regionGraph.isExceptionEdge(predecessor, tryRegion);
                const value = exceptionEdge ? undefined : this.regionGraph.edgeValueOrThrow(predecessor, tryRegion);
                this.regionGraph.removeEdge(predecessor, tryRegion);
                if (exceptionEdge) {
                    this.regionGraph.putExceptionEdge(predecessor, helper);
                } else {
                    this.regionGraph.putEdgeValue(predecessor, helper, value!);
                }
            }
            this.regionGraph.putEdgeValue(helper, tryRegion, false);
            this.regionGraph.putExceptionEdge(helper, bridgeRegion);
        }
    }

    /** 构造显式 Try 区域:正常边 → try 体,异常边 → handler。 */
    private createTryRegion(
        body: Region,
        handler: Region,
        catchEndPC: number | null,
        kind: "catch" | "finallyEpilogue",
    ): Region {
        // 类型仍是 Condition:归约器里所有"条件区域"的图算法(循环/词法节点/尾块合并)
        // 必须与旧的 helper 完全一致;try 语义由 tryRegion 描述符单独分发。
        const region = new Region(null, "Condition");
        region.name = "try_" + body.getName() + "_" + handler.getName();
        region.tryRegion = new TryRegion(catchEndPC, kind);
        this.regionGraph.addNode(region);
        return region;
    }

    /** Handler movs are the inverse of spills in the try (`mov slot, r` / `mov r, slot`). */
    private isSpillRestore(handler: PandaIRBasicBlock, join: PandaIRBasicBlock, tryStart: number, tryEnd: number): boolean {
        if (handler === join || handler.pandaInstructions.length < 2) return false;
        if (this.graph.normalSuccessors(handler).length !== 1 || this.graph.normalSuccessors(handler)[0] !== join) return false;
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
    getEntryRegion(): Region {
        return this.btor.get(this.entryBlock)!;
    }
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
