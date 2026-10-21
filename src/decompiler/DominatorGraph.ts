import { PandaDecompileException } from "../PandaParseException";
import { ValueGraph } from "./ValueGraph";
import type { Region } from "./Region";

/**
 * 支配树(移植自 Java jmp0.abc.decompiler.structure.DominatorGraph)
 * @Author: jmp0
 */
export class DominatorGraph {
    private idoms = new Map<Region, Region | null>();
    private reversePostOrder = new Map<Region, number>();

    constructor(private readonly graph: ValueGraph<Region>, entry: Region) {
        this.build(entry);
        this.idoms.set(entry, null);
    }

    private build(entryNode: Region): void {
        this.idoms.set(entryNode, entryNode);
        this.reversePostOrder = reversePostorderNumbering(this.graph, entryNode);
        const nodes: Region[] = [];
        const byOrder = new Map<number, Region>();
        for (const [region, order] of this.reversePostOrder) {
            byOrder.set(order, region);
        }
        for (let i = 0; i < byOrder.size; i++) {
            const r = byOrder.get(i);
            if (r) nodes.push(r);
        }
        let changed: boolean;
        do {
            changed = false;
            for (const b of nodes) {
                if (b === entryNode) continue;
                let newIdom: Region | null = null;
                for (const p of this.graph.predecessors(b)) {
                    if (this.idoms.has(p)) {
                        if (newIdom === null) {
                            newIdom = p;
                        } else {
                            newIdom = this.intersect(p, newIdom);
                        }
                    }
                }
                const oldIdom = this.idoms.get(b) ?? null;
                if ((oldIdom === null || oldIdom !== newIdom) && newIdom !== null) {
                    this.idoms.set(b, newIdom);
                    changed = true;
                }
            }
        } while (changed);
    }

    private intersect(b1: Region, b2: Region): Region {
        let i1 = b1;
        let i2 = b2;
        let c = 0;
        while (i1 !== i2) {
            while ((this.reversePostOrder.get(i1) ?? 0) > (this.reversePostOrder.get(i2) ?? 0)) {
                if (++c > 100000) throw new PandaDecompileException("Dominator graph calculation timed out.");
                i1 = this.idoms.get(i1)!;
                if (i1 === undefined || i1 === null) return i2;
            }
            while ((this.reversePostOrder.get(i2) ?? 0) > (this.reversePostOrder.get(i1) ?? 0)) {
                if (++c > 100000) throw new PandaDecompileException("Dominator graph calculation timed out.");
                i2 = this.idoms.get(i2)!;
                if (i2 === undefined || i2 === null) return i1;
            }
        }
        return i1;
    }

    dominatesStrictly(dominator: Region, d: Region): boolean {
        let cur = d;
        while (this.idoms.has(cur) && this.idoms.get(cur) !== null) {
            const iDom = this.idoms.get(cur)!;
            if (iDom === dominator) return true;
            cur = iDom;
        }
        return false;
    }
}

function reversePostorderNumbering(graph: ValueGraph<Region>, entryNode: Region): Map<Region, number> {
    const ret = new Map<Region, number>();
    const postOrder = graph.depthFirstPostOrder(entryNode);
    const total = graph.nodes().length;
    for (const region of postOrder) {
        ret.set(region, total - ret.size - 1);
    }
    return ret;
}

/**
 * 循环节点查找(移植自 Java LoopFinder)
 */
export class LoopFinder {
    private nodeColorHashMap = new Map<Region, "Gray" | "Black">();
    readonly loopNodes = new Set<Region>();

    constructor(private readonly graph: ValueGraph<Region>, private readonly entry: Region, doms: DominatorGraph) {
        for (const predecessor of graph.predecessors(entry)) {
            if (doms.dominatesStrictly(entry, predecessor)) {
                if (!this.nodeColorHashMap.has(predecessor)) {
                    this.backwardVisit(predecessor);
                }
            } else if (predecessor === entry) {
                this.loopNodes.add(predecessor);
            }
        }
        const color = this.nodeColorHashMap.get(entry);
        if (color === "Gray") {
            this.forwardVisit(entry);
        }
    }

    private backwardVisit(node: Region): void {
        this.nodeColorHashMap.set(node, "Gray");
        if (node === this.entry) return;
        for (const predecessor of this.graph.predecessors(node)) {
            if (!this.nodeColorHashMap.has(predecessor)) {
                this.backwardVisit(predecessor);
            }
        }
    }

    private forwardVisit(node: Region): void {
        this.nodeColorHashMap.set(node, "Black");
        this.loopNodes.add(node);
        for (const successor of this.graph.successors(node)) {
            if (this.nodeColorHashMap.get(successor) === "Gray") {
                this.forwardVisit(successor);
            }
        }
    }
}
