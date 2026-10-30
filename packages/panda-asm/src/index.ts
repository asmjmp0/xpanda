/**
 * panda-asm 公共入口。
 * @Author: jmp0
 */
export { PandaPatchFile, PandaPatchError, generateHookName } from "./PandaPatchFile";
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
} from "./PandaPatchFile";
export { encodeMethodCode } from "./MethodCode";
export { encodeStringEntity, encodeMutf8, readUleb128, writeUleb128 } from "./codec";
