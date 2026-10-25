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
            // 24.0.0.0 起 try 表把真正的 catch 处理器也写成 codeSize === 0,
            // 旧行为会把 catch 体整段剪掉(LogExport.readLogTail 的 hilog.error
            // 分支曾完全消失)。ArkTS 13 的 codeSize 语义相同,但那里的处理器
            // 与 for-of / await resume 派发混在一起,接入区域图会破坏已验证的
            // 归约结果,因此只在 24+ 上启用按 handler 特征注册。
            const registerZeroSizeCatch = isNewHandlerEncoding(pandaIRCFG);
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
                if (handleCodeLength === 0) {
                    if (!registerZeroSizeCatch) continue;
                    if (this.isPureRethrowHandler(handleEntryBlock)) continue;
                    if (finallyStartPCs.has(tryBlock.startPC)) continue;
                    // finally 处理器也要接进来:24.0.0.0 把 finally 内联在出口前,
                    // 异常路径的清理只能靠它的 handler 输出,再由
                    // foldEagerCatchToFinally 还原成 try/finally。
                    if (!this.isFinallyHandler(handleEntryBlock) && !this.isCatchHandler(handleEntryBlock)) continue;
                }
                this.exceptionHandleBlocks.set(handleEntryBlock, tryEntryBlock);
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
                            for (const region1 of this.regionGraph.successors(region).slice()) {
                                if (region1.block && region1.block.getTerminator().isThrowIns()) {
                                    this.regionGraph.removeNode(region1);
                                    region.setType("Linear");
                                }
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

        for (const [handleEntry, tryEntry] of this.exceptionHandleBlocks) {
            const tryEntryRegion = this.btor.get(tryEntry)!;
            const handleEntryRegion = this.btor.get(handleEntry)!;
            const tryCatchRegion = new TryCatchHelperRegion(tryEntryRegion, handleEntryRegion);
            this.regionGraph.addNode(tryCatchRegion);
            for (const predecessor of this.regionGraph.predecessors(tryEntryRegion).slice()) {
                const value = this.regionGraph.edgeValueOrThrow(predecessor, tryEntryRegion);
                this.regionGraph.removeEdge(predecessor, tryEntryRegion);
                this.regionGraph.putEdgeValue(predecessor, tryCatchRegion, value);
            }
            this.regionGraph.putEdgeValue(tryCatchRegion, tryEntryRegion, false);
            this.regionGraph.putEdgeValue(tryCatchRegion, handleEntryRegion, true);
        }

        // 只经由被跳过的异常处理器才能到达的块在正常控制流里是不可达的:
        // ArkTS 13 的 finally handler 带 codeSize === 0(RegionGraphBuilder 跳过),
        // 其下游清理代码没有来自区域图的前驱。上面的 inDegree 死代码删除删不掉它们
        // ——若这段代码内部带环(例如 finally 里的 for-of 关闭循环),环上的节点
        // inDegree > 0,于是作为孤岛留在图里;而 analysis 只从 entryRegion 出发归约,
        // 永远遍历不到孤岛,图就再也收不成一个节点,最后抛 "can not reduce the graph"
        // 降级到 SimpleAnalysis(amcl1.0.6.abc 的 commons/h1/w1 w91)。
        // 归约本身只可能产出从 entryRegion 可达的语句,所以按可达性再清理一遍。
        const entryRegion = this.btor.get(this.entryBlock)!;
        const reachable = new Set(this.regionGraph.depthFirstPostOrder(entryRegion));
        const unreachableRegions = this.regionGraph.nodes().filter((region) => !reachable.has(region));
        // 不可达集合里出现异常 landing pad 说明这里是真的 catch 代码(只是 helper 也
        // 不在 entry 可达集里),删掉会丢失分支语义;保持旧行为降级 SimpleAnalysis 更安全。
        if (unreachableRegions.some((region) => region.isExceptionLandingPad())) {
            throw new PandaDecompileException(
                this.pandaIRCFG.getPandaMethod().name.content + " unreachable exception handler regions");
        }
        for (const region of unreachableRegions) this.regionGraph.removeNode(region);

        return { regionGraph: this.regionGraph, entryRegion: this.btor.get(this.entryBlock)! };
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
     * 真正的 catch 处理器:入口 `sta vX`,并在 handler 入口基本块里做可见工作
     * (读字符串 / 模块变量 / 属性,或发起调用)。编译器生成的 for-of / await
     * resume 派发 handler 只做寄存器恢复和条件跳转,不具备这些特征,不能接进区域图。
     * 空 catch 仍然按旧行为跳过。
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
