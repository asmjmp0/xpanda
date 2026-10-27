/**
 * 有向有值图,提供与 Guava MutableValueGraph<Node, Boolean>(stable 顺序)等价的最小 API。
 * 节点/边均保持插入序。
 *
 * 边值从 boolean 扩展为三种:`true`(跳转成立)、`false`(顺序执行)、
 * `exception`(异常边,只由 try 表产生)。异常边是"第三边":它不参与条件极性,
 * 但参与可达性、支配与死代码判定,因此 `successors()` / 度数返回三种边的并集,
 * 需要区分正常控制流的调用点使用 `normalSuccessors()`。
 *
 * 同一个 (a, b) 可以同时是普通边和异常边(受保护块的跳转目标恰好就是 handler),
 * 两种语义不能互相覆盖,所以异常边单独存放。
 * @Author: jmp0
 */
export type EdgeKind = "true" | "false" | "exception";

interface NodeEntry<T> {
    /** 普通边 true / false */
    succs: Map<T, EdgeKind>;
    /** 异常边(与普通边可并存) */
    exceptionSuccs: Set<T>;
    /** 普通前驱 */
    preds: Map<T, EdgeKind>;
    /** 异常前驱 */
    exceptionPreds: Set<T>;
}

export class ValueGraph<T> {
    private nodesMap = new Map<T, NodeEntry<T>>();

    addNode(node: T): void {
        if (!this.nodesMap.has(node)) {
            this.nodesMap.set(node, {
                succs: new Map(),
                exceptionSuccs: new Set(),
                preds: new Map(),
                exceptionPreds: new Set(),
            });
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
        for (const succ of entry.exceptionSuccs) {
            this.nodesMap.get(succ)?.exceptionPreds.delete(node);
        }
        for (const pred of entry.preds.keys()) {
            this.nodesMap.get(pred)?.succs.delete(node);
        }
        for (const pred of entry.exceptionPreds) {
            this.nodesMap.get(pred)?.exceptionSuccs.delete(node);
        }
        this.nodesMap.delete(node);
    }

    nodes(): T[] {
        return Array.from(this.nodesMap.keys());
    }

    putEdge(a: T, b: T, kind: EdgeKind): void {
        if (kind === "exception") {
            this.putExceptionEdge(a, b);
            return;
        }
        this.addNode(a);
        this.addNode(b);
        // 重新 put 时保持原有顺序(Guava stable 语义):Map.set 对已存在的 key 不改变位置
        this.nodesMap.get(a)!.succs.set(b, kind);
        this.nodesMap.get(b)!.preds.set(a, kind);
    }

    putEdgeValue(a: T, b: T, value: boolean): void {
        this.putEdge(a, b, value ? "true" : "false");
    }

    /** 显式异常边:受保护的块/区域 → handler。与普通边并存,不覆盖。 */
    putExceptionEdge(a: T, b: T): void {
        this.addNode(a);
        this.addNode(b);
        this.nodesMap.get(a)!.exceptionSuccs.add(b);
        this.nodesMap.get(b)!.exceptionPreds.add(a);
    }

    removeEdge(a: T, b: T): void {
        const ea = this.nodesMap.get(a);
        ea?.succs.delete(b);
        ea?.exceptionSuccs.delete(b);
        const eb = this.nodesMap.get(b);
        eb?.preds.delete(a);
        eb?.exceptionPreds.delete(a);
    }

    /** 边的种类;普通边优先,仅有异常边时返回 "exception" */
    edgeKind(a: T, b: T): EdgeKind | undefined {
        const entry = this.nodesMap.get(a);
        if (!entry) return undefined;
        const normal = entry.succs.get(b);
        if (normal !== undefined) return normal;
        return entry.exceptionSuccs.has(b) ? "exception" : undefined;
    }

    /** 条件边值,不存在或仅有异常边时返回 undefined */
    edgeValue(a: T, b: T): boolean | undefined {
        const kind = this.nodesMap.get(a)?.succs.get(b);
        if (kind === undefined) return undefined;
        return kind === "true";
    }

    /** 保证存在条件边,否则抛错(对应 Java Optional.get) */
    edgeValueOrThrow(a: T, b: T): boolean {
        const v = this.edgeValue(a, b);
        if (v === undefined) throw new Error(`edge (${a}) -> (${b}) is not a conditional edge`);
        return v;
    }

    isExceptionEdge(a: T, b: T): boolean {
        return this.nodesMap.get(a)?.exceptionSuccs.has(b) ?? false;
    }

    /** 全部后继(普通边 + 异常边,插入序,同一目标只出现一次) */
    successors(node: T): T[] {
        const entry = this.nodesMap.get(node);
        if (!entry) return [];
        const out: T[] = Array.from(entry.succs.keys());
        for (const succ of entry.exceptionSuccs) {
            if (!entry.succs.has(succ)) out.push(succ);
        }
        return out;
    }

    /** 正常控制流后继(true / false) */
    normalSuccessors(node: T): T[] {
        return Array.from(this.nodesMap.get(node)?.succs.keys() ?? []);
    }

    /** 异常后继(含与普通边并存的目标) */
    exceptionSuccessors(node: T): T[] {
        return Array.from(this.nodesMap.get(node)?.exceptionSuccs ?? []);
    }

    /** 全部前驱(普通边 + 异常边,插入序,同一来源只出现一次) */
    predecessors(node: T): T[] {
        const entry = this.nodesMap.get(node);
        if (!entry) return [];
        const out: T[] = Array.from(entry.preds.keys());
        for (const pred of entry.exceptionPreds) {
            if (!entry.preds.has(pred)) out.push(pred);
        }
        return out;
    }

    normalPredecessors(node: T): T[] {
        return Array.from(this.nodesMap.get(node)?.preds.keys() ?? []);
    }

    exceptionPredecessors(node: T): T[] {
        return Array.from(this.nodesMap.get(node)?.exceptionPreds ?? []);
    }

    inDegree(node: T): number {
        return this.predecessors(node).length;
    }

    outDegree(node: T): number {
        return this.successors(node).length;
    }

    /** 与 Guava Traverser.forGraph(g).depthFirstPostOrder(entry) 等价(含异常边) */
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
