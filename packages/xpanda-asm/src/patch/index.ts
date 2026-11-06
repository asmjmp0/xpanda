/**
 * Append-only .abc patch package: public facade plus internal capability layers.
 * @Author: jmp0
 */
export { PandaPatchFile } from "./PandaPatchFile";
export {
    PandaPatchError,
    generateHookName,
    PATCH_SLOT_BASE,
    patchSetterGlobalName,
    DEFAULT_INIT_FUNCTION,
} from "./PatchTypes";
export type {
    MethodCode,
    AddMethodOptions,
    AddMethodResult,
    AddStringIdResult,
    InsertInstructionsResult,
    PatchMethodHeadSourceOptions,
    PrepareMethodHeadOptions,
    InsertInstructionsOptions,
    PatchInitOptions,
    PatchInitResult,
    PatchModuleLoadOptions,
    PatchModuleLoadResult,
    PatchedModuleLoad,
    SkippedModuleLoad,
} from "./PatchTypes";
export type { CatchBlockInput, MethodCodeInput, TryBlockInput } from "../MethodCode";
