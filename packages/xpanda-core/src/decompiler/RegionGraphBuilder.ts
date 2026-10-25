import type { PandaIRBasicBlock } from "../disasm/PandaIRBasicBlock";
import type { PandaIRCFG } from "../disasm/PandaIRCFG";
import { PandaDecompileException } from "../PandaParseException";
import { ValueGraph } from "./ValueGraph";
import { Region, TryCatchHelperRegion } from "./Region";

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
                if (tryCodeLength === 0 || handleCodeLength === 0) continue;
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
