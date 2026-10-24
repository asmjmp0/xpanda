/**
 * 有向有值图,提供与 Guava MutableValueGraph<Node, Boolean>(stable 顺序)等价的最小 API。
 * 节点/边均保持插入序。
 * @Author: jmp0
 */
export class ValueGraph<T> {
    private nodesMap = new Map<T, { succs: Map<T, boolean>; preds: Set<T> }>();

    addNode(node: T): void {
        if (!this.nodesMap.has(node)) {
            this.nodesMap.set(node, { succs: new Map(), preds: new Set() });
        }
    }

    hasNode(node: T): boolean {
        return this.nodesMap.has(node);
    }

    removeNode(node: T): void {
        const entry = this.nodesMap.get(node);
        if (!entry) return;
        for (const succ of entry.succs.keys()) {
            this.nodesMap.get(succ)?.preds.delete(node);
        }
        for (const pred of entry.preds) {
            this.nodesMap.get(pred)?.succs.delete(node);
        }
        this.nodesMap.delete(node);
    }

    nodes(): T[] {
        return Array.from(this.nodesMap.keys());
    }

    putEdgeValue(a: T, b: T, value: boolean): void {
        this.addNode(a);
        this.addNode(b);
        const ea = this.nodesMap.get(a)!;
        // 重新 put 时保持原有顺序(Guava stable 语义)
        if (ea.succs.has(b)) {
            ea.succs.set(b, value);
        } else {
            ea.succs.set(b, value);
        }
        this.nodesMap.get(b)!.preds.add(a);
    }

    removeEdge(a: T, b: T): void {
        this.nodesMap.get(a)?.succs.delete(b);
        this.nodesMap.get(b)?.preds.delete(a);
    }

    /** 边值,不存在返回 undefined */
    edgeValue(a: T, b: T): boolean | undefined {
        return this.nodesMap.get(a)?.succs.get(b);
    }

    /** 保证存在边,否则抛错(对应 Java Optional.get) */
    edgeValueOrThrow(a: T, b: T): boolean {
        const v = this.edgeValue(a, b);
        if (v === undefined) throw new Error(`edge (${a}) -> (${b}) not exists`);
        return v;
    }

    successors(node: T): T[] {
        return Array.from(this.nodesMap.get(node)?.succs.keys() ?? []);
    }

    predecessors(node: T): T[] {
        return Array.from(this.nodesMap.get(node)?.preds ?? []);
    }

    inDegree(node: T): number {
        return this.nodesMap.get(node)?.preds.size ?? 0;
    }

    outDegree(node: T): number {
        return this.nodesMap.get(node)?.succs.size ?? 0;
    }

    /** 与 Guava Traverser.forGraph(g).depthFirstPostOrder(entry) 等价 */
    depthFirstPostOrder(start: T): T[] {
        const visited = new Set<T>();
        const out: T[] = [];
        const visit = (n: T) => {
            if (visited.has(n)) return;
            visited.add(n);
            for (const s of this.successors(n)) visit(s);
            out.push(n);
        };
        visit(start);
        return out;
    }
}
