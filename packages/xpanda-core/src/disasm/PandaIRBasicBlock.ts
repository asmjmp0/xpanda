import { PandaParseException } from "../PandaParseException";
import type { PandaMethod } from "../file/method/PandaMethod";
import type { PandaInstruction } from "./PandaInstruction";

/**
 * 基本块(移植自 Java jmp0.abc.disasm.block.PandaIRBasicBlock)
 * @Author: jmp0
 */
export class PandaIRBasicBlock {
    readonly pandaInstructions: PandaInstruction[];
    catchBlockList: PandaIRBasicBlock[] | null = null;
    private readonly pandaInstructionHashMap = new Map<number, number>();

    constructor(readonly name: string, pandaInstructions: PandaInstruction[], readonly pandaMethod: PandaMethod) {
        this.pandaInstructions = pandaInstructions;
        for (let i = 0; i < this.pandaInstructions.length; i++) {
            this.pandaInstructionHashMap.set(this.pandaInstructions[i].pc, i);
        }
    }

    getTerminator(): PandaInstruction {
        return this.pandaInstructions[this.pandaInstructions.length - 1];
    }

    getStartPC(): number {
        return this.pandaInstructions[0].pc;
    }

    getSize(): number {
        const start = this.getStartPC();
        const terminator = this.getTerminator();
        return terminator.pc - start + terminator.instructionSize();
    }

    getByPC(pc: number): PandaInstruction | null {
        const idx = this.pandaInstructionHashMap.get(pc);
        return idx === undefined ? null : this.pandaInstructions[idx];
    }

    getPreInstructionByPc(pc: number): PandaInstruction | null {
        const idx = this.pandaInstructionHashMap.get(pc);
        if (idx !== undefined && idx !== 0) return this.pandaInstructions[idx - 1];
        return null;
    }

    setCatchInfo(catchBlockList: PandaIRBasicBlock[]): void {
        this.catchBlockList = catchBlockList;
    }

    getParent(): PandaMethod {
        return this.pandaMethod;
    }

    splitBasicBlock(pc: number): [PandaIRBasicBlock, PandaIRBasicBlock] {
        const idx = this.pandaInstructionHashMap.get(pc);
        if (idx === undefined) throw new PandaParseException(pc + " not found");
        const a = this.pandaInstructions.slice(0, idx);
        const b = this.pandaInstructions.slice(idx);
        return [
            new PandaIRBasicBlock(this.name, a, this.pandaMethod),
            new PandaIRBasicBlock("label_" + b[0].pc, b, this.pandaMethod),
        ];
    }

    toString(): string {
        const sb: string[] = [];
        sb.push(this.name);
        if (this.catchBlockList) {
            sb.push(" catch by [" + this.catchBlockList.map((b) => b.name).join("") + "]");
        }
        sb.push(":\n");
        for (const instruction of this.pandaInstructions) {
            sb.push("\t" + instruction.toString() + "\n");
        }
        return sb.join("");
    }
}
