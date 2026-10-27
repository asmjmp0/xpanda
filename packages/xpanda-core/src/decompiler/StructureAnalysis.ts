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
    DoWhileStatement,
    GotoStatement,
    IfPandaStatement,
    LabelStatement,
    LinearPandaStatement,
    LogicalExpressionStatement,
    OrLogicalExpressionStatement,
    TryCatchPandaStatement,
    WhileStatement,
} from "./statements";
import type { IPandaDecompileAble } from "./statements";
import type { PandaDecompilerMethodHandler } from "./MethodHandler";

/**
 * 结构化输出展开规模上限(语句数)。
 *
 * 区域归约把共享 Tail 保留为 DAG 上的同一个 Region,decompile 时每条引用都会
 * 重新展开一遍,声明层数一多就是指数级放大:区域图只有 164 个节点、200 个
 * 基本块的方法也可能产出 283MB AST(amcl1.0.6.abc 的 `L&gamecontrol/.../z12`,
 * simplify 需要 10GB+ 内存且几分钟不结束)。超过上限时按设计降级到
 * SimpleAnalysis 线性输出,避免单类拖垮整个文件。
 */
const MAX_STRUCTURED_STATEMENTS = 30_000;

/**
 * 共享尾块消除的最大收敛轮数(实际嵌套深度远小于此值)。
 */
const MAX_TAIL_PRUNE_ROUNDS = 64;

/**
 * 单个方法参与结构化归约的基本块数上限。
 *
 * 超过上限的方法按设计降级到 SimpleAnalysis 线性输出:块数越多,归约和后续
 * simplify 的代价越高,而超大方法往往是编译器展开出来的巨型状态机,线性输出
 * 反而更容易读。上限取 2000:实测 969 个基本块的方法(Petrelgram 的
 * `entry/src/main/ets/util/formatMsgContent`)归约只需约 0.1s、输出规模也在
 * MAX_STRUCTURED_STATEMENTS 之内;真正病态的方法(嵌套 try/finally 展开、
 * 上千块的状态机)仍会在输出规模或轮数保护处降级。
 */
const MAX_STRUCTURED_BLOCKS = 2_000;

/**
 * 区域归约的最大轮数(与基本块数无关的兜底保护)。
 *
 * 每轮通常至少合并一个区域,轮数与块数同量级;但 `coalesceTailRegion` 这类
 * "重写区域图但不减少节点"的路径不会推进归约,必须在卡死前中止(方法降级
 * SimpleAnalysis),否则整个类会一直转下去。
 */
const MAX_REDUCTION_ROUNDS = 3_000;

/**
 * 基于 Region 归约的结构化分析(移植自 Java StructureAnalysis,701 行核心算法)
 * @Author: jmp0
 */
type LoopType = "DoWhile" | "While";
type ExitType = "CONTINUE" | "BREAK" | "GOTO" | "INLINE";

interface LoopDescription {
    from: Region;
    to: Region;
    type: ExitType;
}

function conditionalStatementOf(type: "CONTINUE" | "BREAK" | "GOTO", to: Region): IPandaDecompileAble {
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
        this.normalizeSingleSuccessorConditions();
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
                        // An exception landing pad that is only a jump is an empty
                        // catch. Folding it makes the catch edge land on the shared
                        // tail, and reduction then copies that tail into the catch.
                        if (region.isExceptionLandingPad()) continue;
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

    /**
     * removeSingleJumpRegion 可能把 Condition 的一个分支折到另一个分支的目标上,
     * 使区域只剩一条出边。Condition 区域必须保持两条出边,否则 getDestNextPair
     * 返回 null:simplifyConditionalSequence 旧实现直接解引用会让整个方法降级
     * SimpleAnalysis。与 RegionGraphBuilder 构建后的清理保持一致,退化为 Linear。
     */
    private normalizeSingleSuccessorConditions(): void {
        for (const region of this.regionGraph.nodes()) {
            if (region.getType() === "Condition" && this.regionGraph.outDegree(region) === 1) {
                region.setType("Linear");
            }
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
                        const nextPair = this.getDestNextPair(nextRegion);
                        if (!nextPair) continue;
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

    /**
     * 估算一棵 Region 结构按 decompile() 展开后的语句数量(超过 limit 时提前返回
     * limit + 1)。语句对象与 Region 都按引用共享,所以按出现次数累加、对同一
     * 节点做记忆化:区域图节点数很小,但展开后的树可以是指数级的。
     * `test` 区域只在生成条件表达式时读取,不参与结构展开;`Block` 等字段不是
     * IPandaDecompileAble,自然被忽略。
     */
    private estimateStructuredStatements(root: Region, limit: number): number {
        const memo = new Map<object, number>();
        const statementSize = (statement: any): number => {
            if (!statement) return 0;
            if (statement instanceof Region) return regionSize(statement);
            const cached = memo.get(statement);
            if (cached !== undefined) return cached;
            // 先占位,防止异常的自引用结构把估算拖进无限递归
            memo.set(statement, 0);
            let total = 1;
            if (statement instanceof TryCatchPandaStatement) {
                total += statementSize((statement as any).tryBody) + statementSize((statement as any).catchBody);
            }
            if (statement instanceof IfPandaStatement) {
                total += statementSize((statement as any).consequent) + statementSize((statement as any).alternate);
                total += statementSize((statement as any).tryCatchPandaStatement);
            } else if (statement instanceof WhileStatement) {
                total += listSize((statement as any).headStms) + listSize((statement as any).bodyStms);
            } else if (statement instanceof DoWhileStatement) {
                total += listSize((statement as any).bodyStms);
            } else if (statement instanceof LogicalExpressionStatement) {
                total += statementSize((statement as any).first) + statementSize((statement as any).second);
            }
            total = Math.min(total, limit + 1);
            memo.set(statement, total);
            return total;
        };
        const listSize = (statements: IPandaDecompileAble[] | null | undefined): number => {
            if (!statements) return 0;
            let total = 0;
            for (const statement of statements) {
                total += statementSize(statement);
                if (total > limit) break;
            }
            return total;
        };
        const regionSize = (region: Region): number => {
            const cached = memo.get(region);
            if (cached !== undefined) return cached;
            memo.set(region, 0);
            let total = 0;
            for (const statement of region.getStatements()) {
                total += statementSize(statement);
                if (total > limit) break;
            }
            total = Math.min(total, limit + 1);
            memo.set(region, total);
            return total;
        };
        return regionSize(root);
    }

    /**
     * 语句图按引用展开后是否成环。
     *
     * `Region.decompile()` 每遇到一个 Region 就再展开它当前的语句,所以只要某个
     * Region(或语句)的展开子树里又引用到它自己,decompile 就会无限递归:浅时抛
     * RangeError 让方法降级,深时直接爆栈/OOM 拖死整个进程。归约阶段已经用
     * `statementsReferenceRegion` 拒绝会产生环的 reduceSequence 合并,这里再兜底
     * 检查一次,发现环就抛异常走 SimpleAnalysis 降级。
     *
     * 迭代实现:展开后的树可以有几千层,递归遍历本身就会爆栈;memo 以对象身份去重,
     * 复杂度是唯一节点数(与 estimateStructuredStatements 一致)。
     */
    private findStructuredCycle(root: Region): string | null {
        const childrenOf = (node: IPandaDecompileAble): IPandaDecompileAble[] => {
            if (node instanceof Region) return node.getStatements();
            if (node instanceof IfPandaStatement) {
                return [(node as any).consequent, (node as any).alternate, (node as any).tryCatchPandaStatement]
                    .filter(Boolean) as IPandaDecompileAble[];
            }
            if (node instanceof WhileStatement) {
                return [...((node as any).headStms ?? []), ...((node as any).bodyStms ?? [])] as IPandaDecompileAble[];
            }
            if (node instanceof DoWhileStatement) return ((node as any).bodyStms ?? []) as IPandaDecompileAble[];
            if (node instanceof TryCatchPandaStatement) {
                return [(node as any).tryBody, (node as any).catchBody].filter(Boolean) as IPandaDecompileAble[];
            }
            if (node instanceof LogicalExpressionStatement) {
                return [(node as any).first, (node as any).second] as IPandaDecompileAble[];
            }
            return [];
        };
        const label = (node: IPandaDecompileAble): string => {
            const block = (node as any).block;
            const where = block && typeof block.getStartPC === "function" ? "@" + block.getStartPC() : "";
            if (node instanceof Region) return "Region(" + node.getName() + where + ")";
            return (node.constructor?.name ?? "?") + where;
        };
        // 0/1/2 = 未访问 / 正在展开 / 已完成
        const state = new Map<object, number>();
        const path: IPandaDecompileAble[] = [];
        const frames: Array<{ node: IPandaDecompileAble; children: IPandaDecompileAble[]; next: number }> = [];
        const enter = (node: IPandaDecompileAble): void => {
            state.set(node, 1);
            path.push(node);
            frames.push({ node, children: childrenOf(node), next: 0 });
        };
        enter(root);
        while (frames.length > 0) {
            const frame = frames[frames.length - 1];
            if (frame.next >= frame.children.length) {
                state.set(frame.node, 2);
                frames.pop();
                path.pop();
                continue;
            }
            const child = frame.children[frame.next++];
            const childState = state.get(child) ?? 0;
            if (childState === 1) {
                const cycleStart = path.indexOf(child);
                const cycle = path.slice(cycleStart).concat(child);
                // 只报最近 20 层,避免超长消息
                return cycle.slice(Math.max(0, cycle.length - 20)).map(label).join(" -> ");
            }
            if (childState === 0) enter(child);
        }
        return null;
    }

    analysis(methodHandler: PandaDecompilerMethodHandler, pandaLexical: PandaLexical, astNode: any): void {
        const blockCount = this.pandaIRCFG.pandaIRBasicBlocks.length;
        if (blockCount > MAX_STRUCTURED_BLOCKS) {
            throw new PandaDecompileException("too many blocks！");
        }
        let rounds = 0;
        while (this.regionGraph.nodes().length !== 1 || this.isCyclic(this.regionGraph.nodes()[0])) {
            rounds++;
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
                        if (!result && !this.fixIrreducibleByTailRegion() && rounds > MAX_REDUCTION_ROUNDS) {
                            throw new PandaDecompileException(this.pandaIRCFG.getPandaMethod().name.content + " can not reduce the graph");
                        }
                    }
                }
            }
            this.doms = new DominatorGraph(this.regionGraph, this.entryRegion);
        }
        const root = this.regionGraph.nodes()[0];
        // 只在按引用展开会超过规模上限时才做共享尾块消除:普通方法保持原有结构
        // (AST 级 TailMergeSimplify 已经能处理常见形状),避免改变正常输出。
        if (this.estimateStructuredStatements(root, MAX_STRUCTURED_STATEMENTS) > MAX_STRUCTURED_STATEMENTS) {
            this.pruneRedundantTailBranches(root);
        }
        const structuredStatements = this.estimateStructuredStatements(root, MAX_STRUCTURED_STATEMENTS);
        if (structuredStatements > MAX_STRUCTURED_STATEMENTS) {
            throw new PandaDecompileException(
                this.pandaIRCFG.getPandaMethod().name.content + " structured output too large");
        }
        const cycle = this.findStructuredCycle(root);
        if (cycle !== null) {
            throw new PandaDecompileException(
                this.pandaIRCFG.getPandaMethod().name.content + " cyclic structured statement graph: " + cycle);
        }
        root.decompile(methodHandler, pandaLexical, astNode);
    }

    /**
     * 共享尾块消除(区域级,decompile 之前)。
     *
     * ArkTS 把“可选字段校验”lower 成多条跳向同一个 next 标签的条件跳转,归约后
     * 每个字段检查都会变成同一个形状:
     *
     *   if (字段存在) { ...; if (校验失败) { return err; } else { NEXT } } else { NEXT }
     *
     * NEXT 是区域图里共享的 Tail,两条 else 指向同一个 Region 对象。`Region.decompile()`
     * 按引用展开,每层都把这个共享尾再输出一遍,几十层就是 2^N 条语句
     * (amcl1.0.6.abc 的 z12 类 w1359 / t1359:205 / 264 个基本块 → 39.3 万 / 7.5 万条
     * 语句、283MB / 63MB AST)。而这段代码在源码里本来就是“if (…) { … } NEXT”:
     * 两个 else 都只是落空,可以提到 if 之后只保留一份:
     *
     *   if (字段存在) { ...; if (校验失败) { return err; } } NEXT
     *
     * 变换与后续语句无关:尾块放在同一条语句列表里紧跟 if 之后,原来走 else 的路径
     * 和从分支末尾落空的路径都仍然只执行一次,acc 的取值也相同,所以循环体、嵌套
     * 分支里都成立。只在区域归约完成之后、estimate/decompile 之前做,避免展开成
     * 天文数字的 AST;估计阶段不需要它也能算对,但已经来不及回收内存。
     */
    private pruneRedundantTailBranches(root: Region): void {
        const refCount = this.countEmittedReferences(root);
        for (let round = 0; round < MAX_TAIL_PRUNE_ROUNDS; round++) {
            if (!this.pruneTailInNode(root, refCount, new Set<Region>())) break;
        }
    }

    /**
     * 统计展开树里每个节点的直接引用次数。只按唯一节点向下走(共享 Region 的
     * 子树只统计一次),用来保证被改写的语句/分支确实只在一处出现,避免同一份
     * IfPandaStatement 在别的落空位置被一起改掉。
     */
    private countEmittedReferences(root: Region): Map<object, number> {
        const refCount = new Map<object, number>();
        const visited = new Set<object>();
        const count = (node: IPandaDecompileAble | null): void => {
            if (!node) return;
            refCount.set(node, (refCount.get(node) ?? 0) + 1);
            if (visited.has(node)) return;
            visited.add(node);
            for (const child of this.emittedChildren(node)) count(child);
        };
        count(root);
        return refCount;
    }

    private emittedChildren(node: IPandaDecompileAble): IPandaDecompileAble[] {
        if (node instanceof Region) return node.getStatements();
        if (node instanceof IfPandaStatement) {
            return [
                (node as any).consequent,
                (node as any).alternate,
                (node as any).tryCatchPandaStatement,
            ].filter(Boolean);
        }
        if (node instanceof WhileStatement) {
            return [...((node as any).headStms ?? []), ...((node as any).bodyStms ?? [])];
        }
        if (node instanceof DoWhileStatement) return [...((node as any).bodyStms ?? [])];
        if (node instanceof TryCatchPandaStatement) {
            return [(node as any).tryBody, (node as any).catchBody].filter(Boolean);
        }
        return [];
    }

    /** 自底向上处理:先收掉分支深处的重复尾,外层 if 才能看到变成单分支的分支末尾。 */
    private pruneTailInNode(node: IPandaDecompileAble, refCount: Map<object, number>, visited: Set<Region>): boolean {
        if (node instanceof Region) {
            if (visited.has(node)) return false;
            visited.add(node);
            return this.pruneTailInList(node.getStatements(), refCount, visited);
        }
        if (node instanceof IfPandaStatement) {
            if ((node as any).tryCatchPandaStatement) return false;
            let changed = false;
            const consequent = (node as any).consequent;
            const alternate = (node as any).alternate;
            if (consequent instanceof Region) changed = this.pruneTailInNode(consequent, refCount, visited) || changed;
            if (alternate instanceof Region) changed = this.pruneTailInNode(alternate, refCount, visited) || changed;
            return changed;
        }
        if (node instanceof WhileStatement) {
            let changed = this.pruneTailInList((node as any).headStms ?? [], refCount, visited);
            changed = this.pruneTailInList((node as any).bodyStms ?? [], refCount, visited) || changed;
            return changed;
        }
        if (node instanceof DoWhileStatement) {
            return this.pruneTailInList((node as any).bodyStms ?? [], refCount, visited);
        }
        return false;
    }

    private pruneTailInList(list: IPandaDecompileAble[], refCount: Map<object, number>, visited: Set<Region>): boolean {
        let changed = false;
        for (const statement of list) {
            if (statement instanceof Region || statement instanceof IfPandaStatement
                || statement instanceof WhileStatement || statement instanceof DoWhileStatement) {
                changed = this.pruneTailInNode(statement, refCount, visited) || changed;
            }
        }
        for (let index = 0; index < list.length; index++) {
            if (this.pruneSharedTailOfIf(list, index, refCount)) changed = true;
        }
        return changed;
    }

    /**
     * `if (C) { ...; if (D) { X } else { NEXT } } else { NEXT }` → `if (C) { ...; if (D) { X } } NEXT`。
     * 分支末尾的重复尾有两种形态:内层 if 的 else 指向 NEXT,或分支列表最后一项就是
     * NEXT 这个 Region(上一层刚提上来的)。
     */
    private pruneSharedTailOfIf(list: IPandaDecompileAble[], index: number, refCount: Map<object, number>): boolean {
        const statement = list[index];
        if (!(statement instanceof IfPandaStatement)) return false;
        if ((statement as any).tryCatchPandaStatement) return false;
        const consequent = (statement as any).consequent;
        const alternate = (statement as any).alternate;
        if (!(consequent instanceof Region) || !(alternate instanceof Region)) return false;
        if (consequent === alternate) return false;
        if (alternate.isTryCatchHelperRegion()) return false;
        if ((refCount.get(statement) ?? 0) !== 1 || (refCount.get(consequent) ?? 0) !== 1) return false;
        const tail = consequent.getStatements();
        if (tail.length === 0) return false;
        const last = tail[tail.length - 1];
        if (last instanceof IfPandaStatement) {
            if ((last as any).tryCatchPandaStatement) return false;
            if ((last as any).alternate !== alternate) return false;
            if ((refCount.get(last) ?? 0) !== 1) return false;
            // 只有“失败分支一定离开当前结构”时才能把 else 提到 if 之后:
            // 否则原本从内层 then 落空会继续执行分支之后的代码,提上去之后就会
            // 多执行一次尾块(zhihu ContentDetailPages 的三元赋值就是这么被改坏的)。
            if (!this.branchAlwaysExits((last as any).consequent)) return false;
            (last as any).alternate = null;
        } else if (last === alternate) {
            tail.pop();
        } else {
            return false;
        }
        (statement as any).alternate = null;
        list.splice(index + 1, 0, alternate);
        return true;
    }

    /**
     * 分支是否一定在自身内部离开当前结构(return/throw/break/continue/goto,
     * 或两个分支都如此的 if)。区域按最后一条语句判断:能走到末尾时一定会离开。
     */
    private branchAlwaysExits(node: IPandaDecompileAble | null): boolean {
        if (!node) return false;
        if (node instanceof Region) {
            const statements = node.getStatements();
            if (statements.length === 0) return false;
            return this.branchAlwaysExits(statements[statements.length - 1]);
        }
        if (node instanceof IfPandaStatement) {
            if ((node as any).tryCatchPandaStatement) return false;
            return this.branchAlwaysExits((node as any).consequent)
                && this.branchAlwaysExits((node as any).alternate);
        }
        if (node instanceof BreakStatement || node instanceof ContinueStatement || node instanceof GotoStatement) {
            return true;
        }
        if (node instanceof LinearPandaStatement) {
            const terminator = (node as any).block?.getTerminator?.();
            return terminator?.kind === "return" || terminator?.kind === "throw";
        }
        return false;
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

    /** reference 子树里是否引用了 target(用于阻止会产生语句图环的合并) */
    private statementsReferenceRegion(nextRegion: Region, target: Region): boolean {
        const seen = new Set<object>();
        const visit = (node: any): boolean => {
            if (!node || seen.has(node)) return false;
            seen.add(node);
            if (node instanceof Region) {
                return node === target || node.getStatements().some(visit);
            }
            if (node instanceof IfPandaStatement) {
                return visit((node as any).consequent) || visit((node as any).alternate)
                    || visit((node as any).tryCatchPandaStatement);
            }
            if (node instanceof WhileStatement) {
                return [ ...((node as any).headStms ?? []), ...((node as any).bodyStms ?? [])].some(visit);
            }
            if (node instanceof DoWhileStatement) return ((node as any).bodyStms ?? []).some(visit);
            if (node instanceof LogicalExpressionStatement) return visit((node as any).first) || visit((node as any).second);
            if (node instanceof TryCatchPandaStatement) {
                return visit((node as any).tryBody) || visit((node as any).catchBody);
            }
            return false;
        };
        return nextRegion.getStatements().some(visit);
    }

    private reduceSequence(region: Region): boolean {
        const nextRegion = getOnlyOneSuccessor(this.regionGraph, region);
        if (!nextRegion) return false;
        if (this.regionGraph.inDegree(nextRegion) !== 1 || nextRegion === this.entryRegion) return false;
        // 合并后 region 的语句里会出现对 region 自己的引用(语句图成环),
        // decompile 按引用展开会无限递归;这种合并不能做,留给循环归约处理。
        if (this.statementsReferenceRegion(nextRegion, region)) return false;
        // try 入口只能吸收保护范围之内的块。范围后的真实语句是 try/catch 的
        // 续接(d1268 的 copyDirRecursive);纯跳转块可以并进来,让 try 与 catch
        // 仍汇合到同一个后继。
        if (region.tryBodyEndPC !== null && nextRegion.block
            && nextRegion.block.getStartPC() >= region.tryBodyEndPC
            && !isTransparentJump(nextRegion)
            && !jumpsBackward(this.regionGraph, region, nextRegion)) return false;
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
            // 条件已经被消费成 if/try-catch 语句,不能把 helper 标志留给后续归约
            // (否则该区域吸收下一段代码后会再次被当成 try/catch,把普通条件输出成 try/catch)
            region.tryCatchHelperRegion = false;
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
        } else if ((destRegion.getType() === "Tail" && nextRegion.getType() === "Tail")
            || (this.regionGraph.outDegree(destRegion) === 0 && this.regionGraph.outDegree(nextRegion) === 0)) {
            // 两条分支都已终止(return/throw)。区域类型可能不是 Tail:顺序归约
            // 吸收过后继、后继又被删掉时会留下 outDegree === 0 的 Linear 区域,
            // 这里按终止分支处理,try/catch 整体成为 Tail。
            region.addStatement(new IfPandaStatement(region, nextRegion, destRegion));
            region.tryCatchHelperRegion = false;
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
        } else if (region.isTryCatchHelperRegion() && this.reduceTryCatchWithDeadBranch(region, destRegion, nextRegion, destSRegion, nextSRegion)) {
            return true;
        }
        return false;
    }

    /**
     * try/catch 的一条分支不再顺序执行(return/throw/continue/break,即 out-degree 0 的 Tail),
     * 另一条分支继续执行时,整个 try/catch 之后的落点就是继续分支的后继。
     *
     * 形态来自嵌套 try/catch 归约后的循环体:
     *   try { ... } catch (e) { ... continue }   →  catch 分支成了 Tail,尝试分支是回边
     *   try { ... throw } catch (e) { ... }      →  尝试分支成了 Tail,catch 分支是回边
     * 这些分支不会像 case 3 那样汇合到同一个后继,也不会像 case 4 那样都是 Tail,
     * 缺少这条归约时区域图会卡在 6 个节点反复重试,最终抛 "can not reduce the graph"。
     */
    private reduceTryCatchWithDeadBranch(
        region: Region,
        destRegion: Region,
        nextRegion: Region,
        destSRegion: Region | null,
        nextSRegion: Region | null,
    ): boolean {
        const destDead = destRegion.getType() === "Tail" && this.regionGraph.outDegree(destRegion) === 0;
        const nextDead = nextRegion.getType() === "Tail" && this.regionGraph.outDegree(nextRegion) === 0;
        if (!destDead && !nextDead) return false;
        // 两条分支必须只被这个 try/catch 使用,才能安全地把语句搬进 TryCatchPandaStatement
        if (this.singlePredecessor(destRegion) !== region || this.singlePredecessor(nextRegion) !== region) {
            return false;
        }
        // 继续执行的分支可能还没归约成 Linear(例如内层的 tryCatchHelper),留给下一轮定点迭代
        const continuation = destDead ? nextSRegion : destSRegion;
        if (continuation === null) return false;
        // 参数顺序固定为 (consequent = false 边 = try 体, alternate = true 边 = catch 体)
        region.addStatement(new IfPandaStatement(region, nextRegion, destRegion));
        // 与 reduceIfRegion 的 case 3/4 一样,语句生成后 helper 标志必须清掉
        region.tryCatchHelperRegion = false;
        this.regionGraph.removeEdge(region, nextRegion);
        this.regionGraph.removeNode(nextRegion);
        this.regionGraph.removeEdge(region, destRegion);
        this.regionGraph.removeNode(destRegion);
        this.regionGraph.putEdgeValue(region, continuation, false);
        region.setType("Linear");
        return true;
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
                    } else if (s.getType() === "Tail" && this.regionGraph.outDegree(s) === 0) {
                        // 出口目标是不会再顺序执行的 Tail(通常只剩 return/throw):
                        // 没有 goto 可用,break 又只会跳到循环的 follow,语义就错了。
                        // 直接把 Tail 的语句复制到这条出口分支上。
                        loopDescriptions.push({ from: n, to: s, type: "INLINE" });
                    } else {
                        // 同一条边只生成一个语句:条件区域生成 if (break //goto),
                        // 线性区域生成无条件 break。两者都生成时,条件区域会先变成
                        // if (...) break,再被追加一条无条件 break,循环体永远只执行一次。
                        loopDescriptions.push({ from: n, to: s, type: n.getType() === "Condition" ? "GOTO" : "BREAK" });
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
                // INLINE 复制一份 Tail 语句作为 if 分支,不能直接引用目标区域
                // (它还有别的前驱,后续还会被合并/改名)。
                const target = desc.type === "INLINE" ? to.copy() : conditionalStatementOf(desc.type, to);
                const onTrueEdge = this.regionGraph.edgeValueOrThrow(from, to);
                if (onTrueEdge && from.isLogicalRegion()) {
                    // 逻辑区域(`&&` 合并)的表达式是 fallthrough 条件,expInvert 不生效,
                    // true 边上的出口用取反分支表达。
                    from.addStatement(new IfPandaStatement(from, null, target));
                } else {
                    if (onTrueEdge) from.expInvert();
                    from.addStatement(new IfPandaStatement(from, target, null));
                }
                from.setType("Linear");
            } else if (from.getType() === "Linear") {
                if (desc.type === "INLINE") {
                    from.addRegion(to.copy());
                    from.setType("Tail");
                } else {
                    from.addStatement(conditionalStatementOf(desc.type, to));
                    from.setType("Tail");
                }
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
                if (this.regionGraph.edgeValueOrThrow(n, tail)) {
                    if (n.isLogicalRegion()) {
                        // 逻辑区域(`&&` 合并)的表达式本身就是 fallthrough 条件,expInvert 对
                        // generateTestExpression 不生效。true 边上的 Tail 必须用取反分支表达:
                        // `if (!(A && B)) tail`,normalizeConditionTests 再折成 `if (!A || !B) tail`。
                        n.addStatement(new IfPandaStatement(n, null, tail));
                    } else {
                        n.expInvert();
                        n.addStatement(new IfPandaStatement(n, tail, null));
                    }
                } else {
                    n.addStatement(new IfPandaStatement(n, tail, null));
                }
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

function isTransparentJump(region: Region): boolean {
    const block = region.block;
    if (!block || region.getStatements().length !== 1) return false;
    return block.pandaInstructions.length === 1 && block.getTerminator().kind === "jumpDirect";
}

/** 后继跳回更早的块:这是循环闩,必须允许合并,否则图归约停住。 */
function jumpsBackward<T extends Region>(graph: ValueGraph<T>, region: T, next: T): boolean {
    const start = region.block?.getStartPC();
    if (start === undefined) return false;
    for (const successor of graph.successors(next)) {
        if (successor === region) return true;
        const pc = successor.block?.getStartPC();
        if (pc !== undefined && pc <= start) return true;
    }
    return false;
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
