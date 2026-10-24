import { OPCODE_BY_CODE, LAST_INSTRUCTION_CODE } from "./opcodes";
import { PandaParseException } from "../PandaParseException";
import { PandaInstruction } from "./PandaInstruction";
import { PandaIRBasicBlock } from "./PandaIRBasicBlock";
import { PandaIRCFG } from "./PandaIRCFG";
import { runSplitJumpPass, runSplitTryCatchPass } from "./passes";
import type { PandaMethod } from "../file/method/PandaMethod";

/**
 * 反汇编器(移植自 Java jmp0.abc.disasm.PandaDisAssembler)
 * @Author: jmp0
 */
export class PandaDisAssembler {
    static disAssembly(method: PandaMethod): PandaIRCFG {
        const instructions = method.methodCode!.instructions;
        const basicBlocks: PandaIRBasicBlock[] = [];
        let currentInstructions: PandaInstruction[] = [];
        let pc = 0;
        while (pc < instructions.length) {
            const nowPC = pc;
            let op1 = instructions[pc++] & 0xff;
            if (op1 >= LAST_INSTRUCTION_CODE) {
                const op2 = instructions[pc++];
                op1 = op1 | ((op2 & 0xff) << 8);
            }
            const code = OPCODE_BY_CODE.get(op1);
            if (!code) {
                throw new PandaParseException("opcode: 0x" + op1.toString(16) + ", not recognized");
            }
            const paramSize = paramSizeOf(code.format);
            const instruction = new PandaInstruction(nowPC, code, instructions.subarray(pc, pc + paramSize), method);
            currentInstructions.push(instruction);
            if (instruction.isTerminator()) {
                if (basicBlocks.length === 0) {
                    basicBlocks.push(new PandaIRBasicBlock("entry", currentInstructions, method));
                } else {
                    basicBlocks.push(new PandaIRBasicBlock("label_" + currentInstructions[0].pc, currentInstructions, method));
                }
                currentInstructions = [];
            }
            pc += paramSize;
        }
        const ircfg = new PandaIRCFG(basicBlocks, method);
        runSplitJumpPass(ircfg);
        runSplitTryCatchPass(ircfg);
        ircfg.rebuildGraph();
        return ircfg;
    }
}

import { FORMAT_PARAM_SIZE } from "./opcodes";
function paramSizeOf(format: string): number {
    return FORMAT_PARAM_SIZE[format] ?? 0;
}
