import { PandaParseException } from "../PandaParseException";
import type { PandaMethod } from "../file/method/PandaMethod";
import { PandaIRBasicBlock } from "./PandaIRBasicBlock";
import { ValueGraph } from "../decompiler/ValueGraph";
import { classifyTryEntries, type ExceptionTable } from "../decompiler/ExceptionTable";

/**
 * 方法级 CFG(移植自 Java jmp0.abc.disasm.block.PandaIRCFG)
 * 图的边值: true = 跳转成立方向,false = 顺序执行方向
 * @Author: jmp0
 */
export class PandaIRCFG {
    private readonly blockIndexMap = new Map<number, number>();
    readonly pandaIRBasicBlocks: PandaIRBasicBlock[];
    graph: ValueGraph<PandaIRBasicBlock>;
    /**
     * try 表分类结果;`graph` 里的异常边由它产生。
     * 一次反汇编只分类一次,区域图构建/降级分析复用同一份结论。
     */
    exceptionTable: ExceptionTable | null = null;

    constructor(basicBlocks: PandaIRBasicBlock[], readonly pandaMethod: PandaMethod) {
        this.pandaIRBasicBlocks = basicBlocks;
        for (let i = 0; i < basicBlocks.length; i++) {
            this.blockIndexMap.set(basicBlocks[i].getStartPC(), i);
        }
    }

    /** (重新)构建 CFG 图,在所有 Pass 处理完后调用 */
    rebuildGraph(): void {
        this.graph = new ValueGraph<PandaIRBasicBlock>();
        for (const basicBlock of this.pandaIRBasicBlocks) {
            this.graph.addNode(basicBlock);
        }
        for (let i = 0; i < this.pandaIRBasicBlocks.length; i++) {
            const preBlock = this.pandaIRBasicBlocks[i];
            if (i + 1 === this.pandaIRBasicBlocks.length) break;
            const nextBlock = this.pandaIRBasicBlocks[i + 1];
            const instruction = preBlock.getTerminator();

            if (instruction.isReturnIns() || instruction.isThrowIns()) continue;

            if (instruction.isJump()) {
                const pc = instruction.destinationPC;
                const destBlock = this.getBasicBlockByPC(pc);
                if (!destBlock) throw new PandaParseException("can not resolve pc: " + pc);
                this.graph.putEdgeValue(preBlock, destBlock, true);
                if (instruction.isConditional()) {
                    this.graph.putEdgeValue(preBlock, nextBlock, false);
                    continue;
                }
                continue;
            }
            this.graph.putEdgeValue(preBlock, nextBlock, false);
        }
    }

    /**
     * 显式异常边:受保护的块 → handler。异常边是控制流图的"第三边":
     * 它不参与条件极性(reduceSequence / getDestNextPair 只看 true/false),
     * 但参与可达性、支配与死代码判定。
     * 惰性构建:只有需要结构化/降级分析的方法才付出分类代价。
     */
    getExceptionTable(): ExceptionTable {
        if (this.exceptionTable) return this.exceptionTable;
        this.exceptionTable = classifyTryEntries(this);
        for (const entry of this.exceptionTable.entries) {
            if (!entry.keep || !entry.handlerEntryBlock) continue;
            const handler = entry.handlerEntryBlock;
            const blocks = this.pandaIRBasicBlocks;
            let index = this.blockIndexMap.get(entry.startPC);
            if (index === undefined) continue;
            for (; index < blocks.length; index++) {
                const block = blocks[index];
                if (block.getStartPC() >= entry.endPC) break;
                if (block.getStartPC() < entry.startPC) continue;
                if (block.getStartPC() + block.getSize() > entry.endPC) continue;
                if (block === handler) continue;
                this.graph.putExceptionEdge(block, handler);
            }
        }
        return this.exceptionTable;
    }

    getBasicBlockByPC(pc: number): PandaIRBasicBlock | null {
        const index = this.blockIndexMap.get(pc);
        return index === undefined ? null : this.pandaIRBasicBlocks[index];
    }

    getContainBasicBlockByPC(pc: number): PandaIRBasicBlock | null {
        for (const node of this.pandaIRBasicBlocks) {
            if (node.getStartPC() > pc) return null;
            if (node.getByPC(pc)) return node;
        }
        return null;
    }

    replaceBlock(idx: number, block: PandaIRBasicBlock): void {
        this.pandaIRBasicBlocks.splice(idx, 1, block);
    }

    addBlock(idx: number, block: PandaIRBasicBlock): void {
        this.pandaIRBasicBlocks.splice(idx, 0, block);
        for (const [pc, index] of this.blockIndexMap) {
            if (index >= idx) this.blockIndexMap.set(pc, index + 1);
        }
        this.blockIndexMap.set(block.getStartPC(), idx);
    }

    getBlockIndexPC(pc: number): number | null {
        const index = this.blockIndexMap.get(pc);
        return index === undefined ? null : index;
    }

    getEntryBlock(): PandaIRBasicBlock {
        return this.pandaIRBasicBlocks[0];
    }

    getLastBlock(): PandaIRBasicBlock {
        return this.pandaIRBasicBlocks[this.pandaIRBasicBlocks.length - 1];
    }

    getPandaMethod(): PandaMethod {
        return this.pandaMethod;
    }

    toString(): string {
        return this.pandaIRBasicBlocks.map((b) => b.toString()).join("");
    }
}
