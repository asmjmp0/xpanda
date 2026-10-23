import { PandaDecompileException } from "../PandaParseException";
import type { PandaIRCFG } from "../disasm/PandaIRCFG";
import type { PandaLexical } from "../disasm/PandaLexical";
import { DominatorGraph, LoopFinder } from "./DominatorGraph";
import { ValueGraph } from "./ValueGraph";
import { RegionGraphBuilder } from "./RegionGraphBuilder";
import { Region } from "./Region";
import {
    AndLogicalExpressionStatement,
    BreakStatement,
    ContinueStatement,
    GotoStatement,
    IfPandaStatement,
    LabelStatement,
    OrLogicalExpressionStatement,
    WhileStatement,
    DoWhileStatement,
} from "./statements";
import type { IPandaDecompileAble } from "./statements";
import type { PandaDecompilerMethodHandler } from "./MethodHandler";

/**
 * 基于 Region 归约的结构化分析(移植自 Java StructureAnalysis,701 行核心算法)
 * @Author: jmp0
 */
type LoopType = "DoWhile" | "While";
type ExitType = "CONTINUE" | "BREAK" | "GOTO";

interface LoopDescription {
    from: Region;
    to: Region;
    type: ExitType;
}

function conditionalStatementOf(type: ExitType, to: Region): IPandaDecompileAble {
    switch (type) {
        case "CONTINUE": return new ContinueStatement(null);
        case "BREAK": return new BreakStatement(null);
        case "GOTO": return new BreakStatement("from goto " + to.getName());
    }
}

export class StructureAnalysis {
    readonly regionGraph: ValueGraph<Region>;
    private entryRegion: Region;
    private doms: DominatorGraph;
    private readonly unresolvedCycles = new Set<Region>();
    private readonly pandaIRCFG: PandaIRCFG;

    constructor(pandaIRCFG: PandaIRCFG, entryBlock: any, lastBlock: any) {
        const builder = new RegionGraphBuilder(pandaIRCFG, entryBlock, lastBlock);
        const built = builder.build();
        this.regionGraph = built.regionGraph;
        this.entryRegion = built.entryRegion;
        this.removeSingleJumpRegion();
        this.simplifyConditionalSequence();
        this.doms = new DominatorGraph(this.regionGraph, this.entryRegion);
        this.pandaIRCFG = pandaIRCFG;
    }

    private removeSingleJumpRegion(): void {
        while (true) {
            const regions = this.regionGraph.depthFirstPostOrder(this.entryRegion);
            let result = false;
            for (const region of regions) {
                if (region.getType() === "Linear") {
                    const instructions = region.block!.pandaInstructions;
                    if (instructions.length === 1 && instructions[0].isJump()) {
                        const successor = getOnlyOneSuccessor(this.regionGraph, region);
                        if (!successor) break;
                        replacePredecessors(this.regionGraph, successor, region);
                        this.regionGraph.removeNode(region);
                        result = true;
                        break;
                    }
                }
            }
            if (!result) break;
        }
    }

    private fixConditionalSequenceContainNewLex(region: Region): Region {
        if (region.getStatements().length === 1) {
            const block = region.block!;
            const instruction = block.pandaInstructions[0];
            if (instruction.kind === "newLexEnv") {
                // 注意:splitBasicBlock 需要绝对 pc,不是指令长度
                const pc = instruction.pc + instruction.instructionSize();
                // newLexEnv 已经是块内最后一条指令时无需再切分
                if (!block.getByPC(pc)) return region;
                const [a, b] = block.splitBasicBlock(pc);
                const newLexRegion = new Region(a, "Linear");
                const nextRegion = new Region(b, region.getType());
                this.regionGraph.addNode(newLexRegion);
                this.regionGraph.addNode(nextRegion);
                replacePredecessors(this.regionGraph, newLexRegion, region);
                this.regionGraph.putEdgeValue(newLexRegion, nextRegion, false);
                for (const successor of this.regionGraph.successors(region)) {
                    const value = this.regionGraph.edgeValueOrThrow(region, successor);
                    this.regionGraph.putEdgeValue(nextRegion, successor, value);
                }
                this.regionGraph.removeNode(region);
                if (this.entryRegion === region) {
                    this.entryRegion = newLexRegion;
                }
                return nextRegion;
            }
        }
        return region;
    }

    private simplifyConditionalSequence(): void {
        while (true) {
            const regions = this.regionGraph.depthFirstPostOrder(this.entryRegion);
            let result = false;
            for (const region0 of regions) {
                if (region0.getType() === "Condition") {
                    const pair = this.getDestNextPair(region0);
                    if (!pair) continue;
                    const [destRegion, nextRegion] = pair;
                    if (nextRegion.getType() === "Condition" && this.regionGraph.inDegree(nextRegion) === 1) {
                        const nextPair = this.getDestNextPair(nextRegion)!;
                        const nextDestRegion = nextPair[0];
                        const nextNextRegion = nextPair[1];
                        if (nextNextRegion === destRegion) {
                            // || 合并
                            const region = this.fixConditionalSequenceContainNewLex(region0);
                            const statement = new OrLogicalExpressionStatement(region, nextRegion);
                            replaceSuccessor(this.regionGraph, region, nextRegion);
                            region.clearStatements();
                            region.addStatement(statement);
                            region.logicalRegion = true;
                            this.regionGraph.removeNode(nextRegion);
                            result = true;
                            break;
                        } else if (nextDestRegion === destRegion) {
                            // && 合并
                            const region = this.fixConditionalSequenceContainNewLex(region0);
                            const statement = new AndLogicalExpressionStatement(region, nextRegion);
                            replaceSuccessor(this.regionGraph, region, nextRegion);
                            region.clearStatements();
                            region.addStatement(statement);
                            region.logicalRegion = true;
                            this.regionGraph.removeNode(nextRegion);
                            result = true;
                            break;
                        }
                    }
                }
            }
            if (!result) break;
        }
    }

    analysis(methodHandler: PandaDecompilerMethodHandler, pandaLexical: PandaLexical, astNode: any): void {
        let count = this.pandaIRCFG.pandaIRBasicBlocks.length;
        if (count > 500) {
            throw new PandaDecompileException("too many blocks！");
        }
        while (this.regionGraph.nodes().length !== 1 || this.isCyclic(this.regionGraph.nodes()[0])) {
            count++;
            const originNodeCount = this.regionGraph.nodes().length;
            const regions = this.regionGraph.depthFirstPostOrder(this.entryRegion);
            let result = false;
            for (const region of regions) {
                result = this.reduceAcyclic(region);
                if (!result && this.isCyclic(region)) {
                    result = this.reduceCyclic(region);
                }
                if (result) break;
            }
            if (!result) {
                const newNodeCount = this.regionGraph.nodes().length;
                if (originNodeCount === newNodeCount && newNodeCount > 1) {
                    if (this.unresolvedCycles.size > 0) {
                        for (const region of this.unresolvedCycles) {
                            const loopNodes = new LoopFinder(this.regionGraph, region, this.doms).loopNodes;
                            result = this.refineLoop(region, loopNodes);
                            this.unresolvedCycles.clear();
                            break;
                        }
                    }
                    if (!result) {
                        for (const region of regions) {
                            if (this.coalesceTailRegion(region, this.regionGraph.nodes())) {
                                result = true;
                                break;
                            }
                        }
                        if (!result && !this.fixIrreducibleByTailRegion() && count > 3000) {
                            throw new PandaDecompileException(this.pandaIRCFG.getPandaMethod().name.content + " can not reduce the graph");
                        }
                    }
                }
            }
            this.doms = new DominatorGraph(this.regionGraph, this.entryRegion);
        }
        this.regionGraph.nodes()[0].decompile(methodHandler, pandaLexical, astNode);
    }

    private reduceAcyclic(region: Region): boolean {
        switch (region.getType()) {
            case "Condition": return this.reduceIfRegion(region);
            case "Linear": return this.reduceSequence(region);
            case "Tail": return false;
        }
    }

    private reduceCyclic(region: Region): boolean {
        const succs = this.regionGraph.successors(region);
        if (succs.length === 1 && this.reduceSequence(region)) {
            return true;
        }
        for (const succ of succs) {
            if (succ === region) {
                let loopStatement: IPandaDecompileAble;
                if (succs.length === 1) {
                    loopStatement = new WhileStatement(null, region);
                    region.setType("Tail");
                } else {
                    if (!this.regionGraph.edgeValueOrThrow(region, succ)) region.expInvert();
                    loopStatement = new DoWhileStatement(region);
                    region.setType("Linear");
                }
                region.clearStatements();
                region.addStatement(loopStatement);
                this.regionGraph.removeEdge(region, succ);
                this.regionGraph.removeEdge(succ, region);
                return true;
            }
        }
        if (region.getType() !== "Condition") return false;
        for (const succ of succs) {
            if (this.linearSuccessor(succ) === region && this.singlePredecessor(succ) === region) {
                if (!this.regionGraph.edgeValueOrThrow(region, succ)) region.expInvert();
                const loop = new WhileStatement(region, succ);
                region.setType("Linear");
                this.regionGraph.removeEdge(region, succ);
                this.regionGraph.removeEdge(succ, region);
                this.regionGraph.removeNode(succ);
                region.clearStatements();
                region.addStatement(loop);
                return true;
            }
        }
        if (this.unresolvedCycles.size === 0) {
            this.unresolvedCycles.add(region);
        }
        return false;
    }

    private isCyclic(n: Region): boolean {
        for (const region of this.regionGraph.predecessors(n)) {
            if (region === n || this.isBackEdge(region, n)) return true;
        }
        return false;
    }

    private isBackEdge(a: Region, b: Region): boolean {
        return this.doms.dominatesStrictly(b, a);
    }

    private refineLoop(head: Region, loopNodes: Set<Region>): boolean {
        head = this.ensureSingleEntry(head, loopNodes);
        const [follow, latch] = this.determineFollowLatch(head, loopNodes);
        if (follow === null && latch === null) return true;
        const lexicalNodes = this.getLexicalNodes(head, follow, loopNodes);
        const virtualized = this.virtualizeIrregularExits(head, latch, follow, lexicalNodes);
        if (virtualized) return true;
        for (const lexicalNode of lexicalNodes) {
            if (this.coalesceTailRegion(lexicalNode, lexicalNodes)) return true;
        }
        return false;
    }

    private fixIrreducibleByTailRegion(): boolean {
        const tailRegions: Region[] = [];
        for (const node of this.regionGraph.nodes()) {
            if (node.getType() === "Tail" && this.regionGraph.inDegree(node) > 1) {
                tailRegions.push(node);
            }
        }
        tailRegions.sort((o1, o2) => this.regionGraph.inDegree(o2) - this.regionGraph.inDegree(o1));
        if (tailRegions.length === 0) return false;
        const region = tailRegions[0];
        let nodeIndex = 0;
        for (const predecessor of this.regionGraph.predecessors(region)) {
            const value = this.regionGraph.edgeValueOrThrow(predecessor, region);
            const copyNode = region.copy();
            copyNode.setName(copyNode.getName() + "_" + nodeIndex++);
            this.regionGraph.addNode(copyNode);
            this.regionGraph.putEdgeValue(predecessor, copyNode, value);
        }
        this.regionGraph.removeNode(region);
        return true;
    }

    private reduceSequence(region: Region): boolean {
        const nextRegion = getOnlyOneSuccessor(this.regionGraph, region);
        if (!nextRegion) return false;
        if (this.regionGraph.inDegree(nextRegion) !== 1 || nextRegion === this.entryRegion) return false;
        region.setType(nextRegion.getType());
        if (nextRegion.getType() === "Condition") {
            region.conditionalExp = nextRegion.isConditionalExp();
            // 合并的是逻辑条件区域(if (A || B) / if (A && B))时,后续
            // coalesceTailRegion/reduceIfRegion 需要用它生成 test 表达式,
            // 否则会退化成只读 acc,丢掉 A/B 的计算。
            region.logicalRegion = nextRegion.isLogicalRegion();
        }
        region.addRegion(nextRegion);
        this.regionGraph.removeEdge(region, nextRegion);
        replaceSuccessor(this.regionGraph, region, nextRegion);
        if (nextRegion.isTryCatchHelperRegion()) {
            region.tryCatchHelperRegion = true;
        }
        this.regionGraph.removeNode(nextRegion);
        return true;
    }

    private reduceIfRegion(region: Region): boolean {
        const pair = this.getDestNextPair(region);
        if (!pair) {
            region.setType("Linear");
            return true;
        }
        const destRegion = pair[0];
        const nextRegion = pair[1];
        const destSRegion = this.linearSuccessor(destRegion);
        const nextSRegion = this.linearSuccessor(nextRegion);
        if (nextRegion === destSRegion && !region.isTryCatchHelperRegion()) {
            region.addStatement(new IfPandaStatement(region, null, destRegion));
            this.regionGraph.removeEdge(region, destRegion);
            if (this.regionGraph.inDegree(destRegion) === 0) {
                this.regionGraph.removeNode(destRegion);
            }
            region.setType("Linear");
            return true;
        } else if (destRegion === nextSRegion && !region.isTryCatchHelperRegion()) {
            region.addStatement(new IfPandaStatement(region, nextRegion, null));
            this.regionGraph.removeEdge(region, nextRegion);
            if (this.regionGraph.inDegree(nextRegion) === 0) {
                this.regionGraph.removeNode(nextRegion);
            }
            region.setType("Linear");
            return true;
        } else if (destSRegion === nextSRegion && destSRegion !== null) {
            region.addStatement(new IfPandaStatement(region, nextRegion, destRegion));
            this.regionGraph.removeEdge(region, nextRegion);
            if (this.regionGraph.inDegree(nextRegion) === 0) {
                this.regionGraph.removeNode(nextRegion);
            }
            this.regionGraph.removeEdge(region, destRegion);
            if (this.regionGraph.inDegree(destRegion) === 0) {
                this.regionGraph.removeNode(destRegion);
            }
            this.regionGraph.putEdgeValue(region, destSRegion, false);
            region.setType("Linear");
            return true;
        } else if (destRegion.getType() === "Tail" && nextRegion.getType() === "Tail") {
            region.addStatement(new IfPandaStatement(region, nextRegion, destRegion));
            this.regionGraph.removeEdge(region, nextRegion);
            if (this.regionGraph.inDegree(nextRegion) === 0) {
                this.regionGraph.removeNode(nextRegion);
            }
            this.regionGraph.removeEdge(region, destRegion);
            if (this.regionGraph.inDegree(destRegion) === 0) {
                this.regionGraph.removeNode(destRegion);
            }
            region.setType("Tail");
            return true;
        }
        return false;
    }

    private linearSuccessor(region: Region): Region | null {
        if (region.getType() !== "Linear") return null;
        return getOnlyOneSuccessor(this.regionGraph, region);
    }

    private singlePredecessor(n: Region): Region | null {
        if (this.regionGraph.inDegree(n) !== 1) return null;
        return this.regionGraph.predecessors(n)[0];
    }

    private getDestNextPair(region: Region): [Region, Region] | null {
        if (this.regionGraph.outDegree(region) === 1) {
            return null;
        }
        const blockIterator = this.regionGraph.successors(region);
        const region1 = blockIterator[0];
        let destBlock: Region;
        let nextBlock: Region;
        if (this.regionGraph.edgeValueOrThrow(region, region1)) {
            destBlock = region1;
            nextBlock = blockIterator[1];
        } else {
            destBlock = blockIterator[1];
            nextBlock = region1;
        }
        return [destBlock, nextBlock];
    }

    private countIncomingEdges(n: Region, loopNodes: Set<Region>): number {
        return this.regionGraph.predecessors(n).filter((p) => !loopNodes.has(p)).length;
    }

    private ensureSingleEntry(head: Region, loopNodes: Set<Region>): Region {
        let cinMax = this.countIncomingEdges(head, loopNodes);
        for (const n of loopNodes) {
            const cin = this.countIncomingEdges(n, loopNodes);
            if (cin > cinMax) cinMax = cin;
        }
        return head;
    }

    private determineFollowLatch(head: Region, loopNodes: Set<Region>): [Region | null, Region | null] {
        const headSucc = this.regionGraph.successors(head);
        // 循环头有两条边时,出环的那条就是 follow(while 的终止条件)。
        // 回边(latch)上还可能带着 break/throw 之类的另一条出边,不能拿它当 follow:
        // 那会把 while 的正常终止条件误判成“不规则出口”,virtualizeIrregularExits 会
        // 在循环头插 break 并把循环头改成 Tail,循环体剩下的子图随后被从入口切掉。
        let headerFollow: Region | null = null;
        if (headSucc.length === 2) {
            if (!loopNodes.has(headSucc[0])) {
                headerFollow = headSucc[0];
            } else if (!loopNodes.has(headSucc[1])) {
                headerFollow = headSucc[1];
            }
            if (headerFollow !== null) {
                for (const latch of this.regionGraph.predecessors(head)) {
                    if (this.isBackEdge(latch, head) && this.linearSuccessor(latch) === head) {
                        return [headerFollow, latch];
                    }
                }
            }
        }

        for (const latch of this.regionGraph.predecessors(head)) {
            if (this.isBackEdge(latch, head)) {
                const latchSuccs = this.regionGraph.successors(latch);
                if (latchSuccs.length === 2) {
                    const outside = latchSuccs.find((successor) => !loopNodes.has(successor));
                    if (outside) {
                        // 回边上的另一条出边若是 return/throw(Tail),那是循环体内的提前退出,
                        // 不是循环的 follow;此时循环头出环的那条边(非 Tail)才是 while 正常结束后
                        // 的落点。两者都是 Tail 时保持旧行为(do...while 的终止边在回边上)。
                        const follow = outside.getType() === "Tail"
                            && headerFollow !== null && headerFollow.getType() !== "Tail"
                            ? headerFollow
                            : outside;
                        return [follow, latch];
                    }
                }
            }
        }
        // 无法确定 follow/latch,插入 goto
        for (const latch of this.regionGraph.predecessors(head)) {
            if (this.isBackEdge(latch, head)) {
                this.addLabelToRegion(head);
                latch.addStatement(new GotoStatement(head));
                this.regionGraph.removeEdge(latch, head);
                if (this.regionGraph.outDegree(latch) === 1) {
                    latch.setType("Linear");
                } else {
                    latch.setType("Tail");
                }
                return [null, null];
            }
        }
        return [null, null];
    }

    private getLexicalNodes(head: Region, follow: Region, loopNodes: Set<Region>): Set<Region> {
        const excluded = new Set<Region>();
        this.findReachableRegions(follow, head, excluded);
        const lexNodes = new Set<Region>();
        const wl: Region[] = Array.from(loopNodes);
        let i = 0;
        let size = wl.length;
        while (true) {
            for (; i < size; i++) {
                const node = wl[i];
                // 必须把 全部 后继加入工作队列:循环体里每个条件的两条分支都可能通往词法节点。
                // 典型例子是 for...of 体内带 continue/return 时,ArkTS 会在每条退出路径上内联一份
                // iterator.close 序列(条件和回边交织)。只跟第一个后继时,另一条分支上的节点不会
                // 进入 lexNodes,virtualizeIrregularExits 会把它们当成"不规则出口"插入 break/goto
                // 并把区域改成 Tail,把整段子图从入口切掉,后续 DFS 永远归约不到它。
                if (loopNodes.has(node)) {
                    lexNodes.add(node);
                    for (const successor of this.regionGraph.successors(node)) {
                        if (!lexNodes.has(successor) && !wl.includes(successor)) {
                            wl.push(successor);
                        }
                    }
                } else if (this.doms.dominatesStrictly(head, node) && !excluded.has(node)) {
                    lexNodes.add(node);
                    for (const successor of this.regionGraph.successors(node)) {
                        if (!lexNodes.has(successor) && !wl.includes(successor)) {
                            wl.push(successor);
                        }
                    }
                }
            }
            if (i === wl.length) break;
            size = wl.length;
        }
        return lexNodes;
    }

    private findReachableRegions(n: Region, head: Region, regions: Set<Region>): void {
        regions.add(n);
        for (const succ of this.regionGraph.successors(n)) {
            if (!regions.has(succ) && succ !== head) {
                this.findReachableRegions(succ, head, regions);
            }
        }
    }

    private virtualizeIrregularExits(header: Region, latch: Region, follow: Region, lexicalNodes: Set<Region>): boolean {
        let didVirtualize = false;
        const loopType = this.determineLoopType(header, latch, follow);
        const loopDescriptions: LoopDescription[] = [];
        for (const n of lexicalNodes) {
            for (const s of this.regionGraph.successors(n)) {
                if (s === header) {
                    if (n !== latch) {
                        loopDescriptions.push({ from: n, to: s, type: "CONTINUE" });
                    }
                } else if (!lexicalNodes.has(s)) {
                    if (s === follow) {
                        if ((loopType === "DoWhile" && n !== latch) || (loopType === "While" && n !== header)) {
                            loopDescriptions.push({ from: n, to: s, type: "BREAK" });
                        }
                    } else {
                        loopDescriptions.push({ from: n, to: s, type: "GOTO" });
                        loopDescriptions.push({ from: n, to: s, type: "BREAK" });
                    }
                }
            }
        }
        if (loopDescriptions.length > 0) didVirtualize = true;
        for (const desc of loopDescriptions) {
            const from = desc.from;
            const to = desc.to;
            if (desc.type === "GOTO") {
                this.addLabelToRegion(to);
            }
            if (from.getType() === "Condition") {
                if (this.regionGraph.edgeValueOrThrow(from, to)) from.expInvert();
                from.addStatement(new IfPandaStatement(from, conditionalStatementOf(desc.type, to), null));
                from.setType("Linear");
            } else if (from.getType() === "Linear") {
                from.addStatement(conditionalStatementOf(desc.type, to));
                from.setType("Tail");
            }
            if (this.regionGraph.hasNode(to)) {
                this.regionGraph.removeEdge(from, to);
                if (this.regionGraph.inDegree(to) === 0 && to !== this.entryRegion && to.getType() === "Tail") {
                    this.regionGraph.removeNode(to);
                }
            }
        }
        return didVirtualize;
    }

    private coalesceTailRegion(n: Region, regions: Iterable<Region>): boolean {
        const succs = this.regionGraph.successors(n);
        if (succs.length === 2 && n.getType() === "Condition" && !n.isTryCatchHelperRegion()) {
            const contains = (r: Region) => {
                if (Array.isArray(regions)) return regions.includes(r);
                return (regions as Set<Region>).has(r);
            };
            // 不能依赖 successors 的返回顺序(ValueGraph 按插入顺序返回,与 true/false 边无关)。
            // conditionalExp 描述的是 fallthrough(false 边)分支的条件:
            //   jnez 时 false 边为 !acc,jeqz 时 false 边为 acc;
            // 只有折叠 true 边(跳转目标)时才需要对条件取反。
            for (const tail of succs) {
                if (!contains(tail) || tail.getType() !== "Tail" || this.singlePredecessor(tail) !== n) continue;
                if (this.regionGraph.edgeValueOrThrow(n, tail)) n.expInvert();
                n.addStatement(new IfPandaStatement(n, tail, null));
                this.regionGraph.removeEdge(n, tail);
                this.regionGraph.removeNode(tail);
                n.setType("Linear");
                return true;
            }
        }
        return false;
    }

    private determineLoopType(header: Region, latch: Region, follow: Region): LoopType {
        if (!this.hasExitEdgeFrom(latch, follow)) return "While";
        if (!this.hasExitEdgeFrom(header, follow)) return "DoWhile";
        if (header.getStatements().length > 1) return "DoWhile";
        return "While";
    }

    private hasExitEdgeFrom(n: Region, follow: Region): boolean {
        for (const successor of this.regionGraph.successors(n)) {
            if (successor === follow) return true;
        }
        return false;
    }

    private addLabelToRegion(region: Region): void {
        if (region.getStatements()[0] instanceof LabelStatement) return;
        region.addFirstStatement(new LabelStatement(region));
    }
}

function getOnlyOneSuccessor<T>(graph: ValueGraph<T>, node: T): T | null {
    if (graph.outDegree(node) === 0) return null;
    return graph.successors(node)[0];
}

function replaceSuccessor<T>(graph: ValueGraph<T>, node: T, node2: T): void {
    for (const successor of graph.successors(node2)) {
        const value = graph.edgeValueOrThrow(node2, successor);
        graph.putEdgeValue(node, successor, value);
    }
}

function replacePredecessors<T>(graph: ValueGraph<T>, node: T, node2: T): void {
    for (const predecessor of graph.predecessors(node2)) {
        const value = graph.edgeValueOrThrow(predecessor, node2);
        graph.putEdgeValue(predecessor, node, value);
    }
}
