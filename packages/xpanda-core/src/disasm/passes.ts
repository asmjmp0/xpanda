import { PandaParseException } from "../PandaParseException";
import type { PandaIRCFG } from "./PandaIRCFG";

/**
 * CFG 预处理 Pass(移植自 Java SplitJumpPandaIRCFGPass / SplitTryCatchPandaIRCFGPass)
 * @Author: jmp0
 */

export function splitBlockByPc(ircfg: PandaIRCFG, pc: number): void {
    if (ircfg.getBasicBlockByPC(pc)) return;
    const block = ircfg.getContainBasicBlockByPC(pc);
    if (!block) throw new PandaParseException("getContainBasicBlockByPC not found!");
    const [a, b] = block.splitBasicBlock(pc);
    const idx = ircfg.getBlockIndexPC(block.getStartPC());
    if (idx === null) throw new PandaParseException("this.blockIndexMap not found!");
    ircfg.replaceBlock(idx, a);
    ircfg.addBlock(idx + 1, b);
}

export function runSplitJumpPass(ircfg: PandaIRCFG): boolean {
    const splitPCList = new Set<number>();
    for (const basicBlock of ircfg.pandaIRBasicBlocks) {
        const instruction = basicBlock.getTerminator();
        if (instruction.isJump()) {
            const pc = instruction.destinationPC;
            if (ircfg.getBasicBlockByPC(pc)) continue;
            const destBlock = ircfg.getContainBasicBlockByPC(pc);
            if (!destBlock) throw new PandaParseException("can not resolve pc: " + pc);
            splitPCList.add(pc);
        }
    }
    for (const pc of splitPCList) {
        splitBlockByPc(ircfg, pc);
    }
    return splitPCList.size > 0;
}

/**
 * CFG 预处理 pass:按 try 表边界切块。
 *
 * 只负责切块:try 起点/终点、每个 handler 入口(以及非零 codeSize 的 handler 终点)
 * 必须是基本块边界。受保护块与 handler 的归属改由 CFG 上的显式异常边表达
 * (PandaIRCFG.getExceptionTable),不再在块上挂 catchBlockList。
 * @Author: jmp0
 */
export function runSplitTryCatchPass(ircfg: PandaIRCFG): boolean {
    const splitPCList = collectTryBoundaryPCs(ircfg);
    if (splitPCList.size === 0) return false;
    for (const pc of splitPCList) {
        splitBlockByPc(ircfg, pc);
    }
    return true;
}

function collectTryBoundaryPCs(ircfg: PandaIRCFG): Set<number> {
    const splitPCList = new Set<number>();
    const tryBlocks = ircfg.getPandaMethod().methodCode?.pandaMethodTryBlocks;
    if (!tryBlocks) return splitPCList;
    for (const tryBlock of tryBlocks) {
        const tryStartPC = tryBlock.startPC;
        const tryEndPC = tryStartPC + tryBlock.length;
        splitPCList.add(tryStartPC);
        splitPCList.add(tryEndPC);
        for (const catchBlock of tryBlock.pandaMethodCatchBlocks ?? []) {
            const handlerPC = catchBlock.handlerPC;
            const catchEndPC = handlerPC + catchBlock.codeSize;
            splitPCList.add(handlerPC);
            const lastBlock = ircfg.pandaIRBasicBlocks[ircfg.pandaIRBasicBlocks.length - 1];
            if (catchEndPC <= lastBlock.getTerminator().pc) splitPCList.add(catchEndPC);
        }
    }
    return splitPCList;
}
