/**
 * xpanda-asm 公共入口。
 * @Author: jmp0
 */
export { PandaPatchFile, PandaPatchError, generateHookName, patchSetterGlobalName, PATCH_SLOT_BASE, DEFAULT_INIT_FUNCTION } from "./patch";
export type {
    MethodCode,
    AddMethodOptions,
    AddMethodResult,
    AddStringIdResult,
    InsertInstructionsResult,
    PatchMethodHeadSourceOptions,
    PrepareMethodHeadOptions,
    MethodCodeInput,
    TryBlockInput,
    CatchBlockInput,
    PatchInitOptions,
    PatchInitResult,
    PatchModuleLoadOptions,
    PatchModuleLoadResult,
    PatchedModuleLoad,
    SkippedModuleLoad,
} from "./patch";
export { dumpClasses } from "./ClassDump";
export type { DumpClassesResult } from "./ClassDump";
export { encodeMethodCode } from "./MethodCode";
export { encodeStringEntity, encodeMutf8, readUleb128, writeUleb128 } from "./codec";
export {
    assemble,
    assembleInstruction,
    decodeInstructions,
    encodeInstructionWithOpcode,
    instructionSize,
} from "./Assembler";
export type {
    AssembleOptions,
    DecodedInstruction,
    OperandInput,
} from "./Assembler";
