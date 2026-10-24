import { PandaParseException } from "../PandaParseException";
import type { PandaIRCFG } from "./PandaIRCFG";
import { PandaIRBasicBlock } from "./PandaIRBasicBlock";

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

export function runSplitTryCatchPass(ircfg: PandaIRCFG): boolean {
    const tryDescMap = collectTryDescriptors(ircfg);
    if (tryDescMap.size === 0) return false;
    for (const [pair, handlePCList] of tryDescMap) {
        const catchBlockList: PandaIRBasicBlock[] = [];
        for (const i of handlePCList) {
            const b = ircfg.getBasicBlockByPC(i);
            if (b) catchBlockList.push(b);
        }
        const [startPC, endPC] = pair;
        const idx = ircfg.getBlockIndexPC(startPC);
        if (idx === null) continue;
        for (let i = idx; i < ircfg.pandaIRBasicBlocks.length; i++) {
            const block = ircfg.pandaIRBasicBlocks[i];
            if (block.getStartPC() >= startPC && block.getStartPC() + block.getSize() <= endPC) {
                block.setCatchInfo(catchBlockList);
            }
        }
    }
    return true;
}

function collectTryDescriptors(ircfg: PandaIRCFG): Map<[number, number], number[]> {
    const splitPCList = new Set<number>();
    const tryBlocks = ircfg.getPandaMethod().methodCode?.pandaMethodTryBlocks;
    const tryDescMap = new Map<[number, number], number[]>();
    if (tryBlocks) {
        for (const tryBlock of tryBlocks) {
            const tryStartPC = tryBlock.startPC;
            const tryEndPC = tryStartPC + tryBlock.length;
            splitPCList.add(tryStartPC);
            splitPCList.add(tryEndPC);
            const catchBlocks = tryBlock.pandaMethodCatchBlocks;
            if (!catchBlocks) continue;
            const catchPCList: number[] = [];
            for (const catchBlock of catchBlocks) {
                const handlerPC = catchBlock.handlerPC;
                const catchEndPC = handlerPC + catchBlock.codeSize;
                splitPCList.add(handlerPC);
                const lastBlock = ircfg.pandaIRBasicBlocks[ircfg.pandaIRBasicBlocks.length - 1];
                if (catchEndPC <= lastBlock.getTerminator().pc) splitPCList.add(catchEndPC);
                catchPCList.push(handlerPC);
            }
            tryDescMap.set([tryStartPC, tryEndPC], catchPCList);
        }
    }
    for (const pc of splitPCList) {
        splitBlockByPc(ircfg, pc);
    }
    return tryDescMap;
}
