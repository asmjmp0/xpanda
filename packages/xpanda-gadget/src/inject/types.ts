/**
 * Options/results for .abc-level bootstrap injection.
 * @Author: jmp0
 */

export interface InjectAbcOptions {
    /** TCP port the gadget socket server listens on; baked into the bootstrap. Default 27041. */
    port?: number;
    /**
     * Block app startup until a client connects, at most this many milliseconds.
     * Baked into the bootstrap as `gadget.start({ wait: ... })`. Default 0 (do not wait).
     */
    waitMs?: number;
    /**
     * Module request name of the gadget NAPI library; must match the file name embedded
     * under the HAP libs directory (nm_modname strips the lib prefix / .so suffix).
     * Default `libxpanda_gadget.so`.
     */
    soName?: string;
    /**
     * Entry class whose func_main_0 calls the gadget bootstrap
     * (e.g. `L&entry/src/main/ets/entryability/EntryAbility&;`).
     * Default: discovered by `findEntryClassCandidates`.
     */
    entryClass?: string;
    /** es2abc executable used by xpanda-asm; default resolves like xpanda-asm (assets/bin/...). */
    es2abc?: string;
    /** es2abc --target-api-version override; default derived from the target abc version. */
    targetApiVersion?: number;
    /** Keep xpanda-asm's compile temp directory (debugging). */
    keepTemp?: boolean;
}

export interface InjectAbcResult {
    /** Patched abc bytes. */
    data: Uint8Array;
    /** Module request name of the gadget library the bootstrap imports. */
    soName: string;
    /** Entry class that now calls the bootstrap. */
    entryClass: string;
    /** Generated bootstrap module name (record `&xpanda/hook/<moduleName>&`). */
    moduleName: string;
    /** Exported init function name. */
    initName: string;
    /** Bootstrap import index inside the entry module record. */
    importIndex: number;
    /** Entry class candidates considered during discovery (most preferred first). */
    candidates: string[];
    /** The bootstrap source that was compiled and moved into the abc. */
    bootstrapSource: string;
}
