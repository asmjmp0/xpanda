import type { PandaIRBasicBlock } from "../disasm/PandaIRBasicBlock";

/**
 * Primitive shape queries shared by the exception/handler classifiers.
 *
 * `ExceptionTable`, `RegionGraphBuilder` and `TryFinally` all recognise
 * compiler-generated handlers and finally epilogues by instruction shape. The
 * same predicates used to be copied into each module; keeping them here makes
 * sure a fix to one classifier also applies to the others.
 * @Author: jmp0
 */

/** `ldhole` / `load ... HOLE`: the sentinel value used by finally lowering. */
export function isHoleLoadInstruction(instruction: any): boolean {
    return instruction?.opcode?.name === "ldhole"
        || (instruction?.kind === "load" && instruction.loadType === "HOLE");
}

/** Block contains a finally sentinel (`hole`) load. */
export function blockLoadsHole(block: PandaIRBasicBlock): boolean {
    return block.pandaInstructions.some(isHoleLoadInstruction);
}

/** Block ends in `throw` and loads `register` beforehand (`lda vX; throw`). */
export function blockThrowsRegister(block: PandaIRBasicBlock, register: string): boolean {
    const instructions = block.pandaInstructions;
    if (instructions[instructions.length - 1]?.kind !== "throw") return false;
    return instructions.some((instruction) => instruction.kind === "load"
        && instruction.loadType === "OBJECT"
        && instruction.loadParam?.toString() === register);
}

const ASYNC_DISPATCH_OPCODES: readonly string[] = [
    "asyncfunctionawaituncaught",
    "suspendgenerator",
    "resumegenerator",
    "asyncfunctionreject",
];

/**
 * Compiler async/generator resume dispatch instruction.
 *
 * `getresumemode` only appears inside a handler body (it selects the resume
 * arm), so it is opt-in: the handler-entry scan in `isAsyncResumeHandler` must
 * keep its original opcode set.
 */
export function isAsyncDispatchInstruction(instruction: any, includeResumeMode = false): boolean {
    const name = instruction?.opcode?.name;
    if (includeResumeMode && name === "getresumemode") return true;
    return ASYNC_DISPATCH_OPCODES.includes(name);
}
