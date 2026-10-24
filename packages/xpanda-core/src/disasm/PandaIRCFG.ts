import { PandaParseException } from "../PandaParseException";
import type { PandaMethod } from "../file/method/PandaMethod";
import { PandaIRBasicBlock } from "./PandaIRBasicBlock";
import { ValueGraph } from "../decompiler/ValueGraph";

/**
 * 方法级 CFG(移植自 Java jmp0.abc.disasm.block.PandaIRCFG)
 * 图的边值: true = 跳转成立方向,false = 顺序执行方向
 * @Author: jmp0
 */
export class PandaIRCFG {
    private readonly blockIndexMap = new Map<number, number>();
    readonly pandaIRBasicBlocks: PandaIRBasicBlock[];
    graph: ValueGraph<PandaIRBasicBlock>;

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
