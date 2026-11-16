import { PandaParseException } from "../PandaParseException";
import { PandaIRBasicBlock } from "../disasm/PandaIRBasicBlock";
import { PandaIRCFG } from "../disasm/PandaIRCFG";
import { runSplitJumpPass, runSplitTryCatchPass } from "../disasm/passes";
import type { PandaMethod } from "../file/method/PandaMethod";
import { decodeStaticInstruction, StaticPandaInstruction } from "./StaticPandaInstruction";

/**
 * ArkTS-Sta bytecode disassembler. Kept separate from the dynamic
 * PandaDisAssembler because the ISA and the entity-id resolution differ.
 *
 * @Author: jmp0
 */
export class StaticPandaDisAssembler {
    static disAssembly(method: PandaMethod): PandaIRCFG {
        const bytes = method.methodCode!.instructions;
        const basicBlocks: PandaIRBasicBlock[] = [];
        let currentInstructions: StaticPandaInstruction[] = [];
        let previousInstruction: StaticPandaInstruction | null = null;
        let pc = 0;
        while (pc < bytes.length) {
            const nowPC = pc;
            const { instruction, nextPC } = decodeStaticInstruction(pc, bytes, method);
            if (!instruction) {
                throw new PandaParseException("static opcode at " + nowPC + " not recognized");
            }
            if (previousInstruction
                && previousInstruction.kind === "newObj"
                && !previousInstruction.newInit
                && instruction.kind === "call"
                && instruction.callMethod?.name.content === "<ctor>"
                && previousInstruction.destObj
                && instruction.callThis
                && previousInstruction.destObj.index === instruction.callThis.index) {
                previousInstruction.newInit = instruction;
                instruction.skip = true;
            }
            previousInstruction = instruction;
            currentInstructions.push(instruction);
            if (instruction.isTerminator()) {
                if (basicBlocks.length === 0) {
                    basicBlocks.push(new PandaIRBasicBlock("entry", currentInstructions as any, method));
                } else {
                    basicBlocks.push(new PandaIRBasicBlock("label_" + currentInstructions[0].pc, currentInstructions as any, method));
                }
                currentInstructions = [];
            }
            pc = nextPC;
        }
        const ircfg = new PandaIRCFG(basicBlocks, method);
        runSplitJumpPass(ircfg);
        runSplitTryCatchPass(ircfg);
        ircfg.rebuildGraph();
        return ircfg;
    }
}
