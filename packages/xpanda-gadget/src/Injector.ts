/**
 * .abc-level gadget init injector.
 *
 * Uses xpanda-asm's `patchInit` to append a bootstrap ES module to the target abc
 * and make the entry class's `func_main_0` call it on startup. The bootstrap imports
 * the gadget NAPI module (`libxpanda_gadget.so`) whose module request is preserved
 * verbatim by xpanda-asm (no matching record), so the ArkTS runtime dlopens it from
 * the HAP libs directory on first import.
 * @Author: jmp0
 */
import { PandaPatchFile } from "xpanda-asm";

/** Gadget NAPI library file name (nm_modname is the name without lib prefix / .so suffix). */
export const GADGET_SO_NAME = "libxpanda_gadget.so";
/** Default TCP port, an homage to frida-server's default. */
export const DEFAULT_GADGET_PORT = 27041;
/** Default init function name injected into the entry class's func_main_0. */
export const DEFAULT_INIT_NAME = "init";

export interface InjectAbcOptions {
    /** TCP port the gadget socket server listens on; baked into the bootstrap. Default 27041. */
    port?: number;
    /**
     * Module request name of the gadget NAPI library; must match the file name embedded
     * under the HAP libs directory (nm_modname strips the lib prefix / .so suffix).
     * Default `libxpanda_gadget.so`.
     */
    soName?: string;
    /**
     * Entry class whose func_main_0 calls the gadget bootstrap
     * (e.g. `L&entry/src/main/ets/entryability/EntryAbility&;`).
     * Default: discovered by {@link findEntryClassCandidates}.
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

/**
 * Classes that own a `func_main_0` can act as the patchInit entry.
 * Entry-like names (EntryAbility / entry / pages/Index) are preferred so the
 * gadget starts as early in the app lifecycle as possible.
 */
export function findEntryClassCandidates(patchFile: PandaPatchFile): string[] {
    const withMain: string[] = [];
    for (const name of patchFile.getClassNames()) {
        if (patchFile.hasMethod(name, "func_main_0")) withMain.push(name);
    }
    const score = (name: string): number => {
        let s = 0;
        if (/EntryAbility/i.test(name)) s -= 8;
        if (/entryability/i.test(name)) s -= 4;
        if (/\/pages\/Index/i.test(name)) s -= 2;
        if (/(^|&)entry\//i.test(name)) s -= 1;
        return s;
    };
    return withMain.sort((a, b) => score(a) - score(b) || a.length - b.length);
}

/**
 * Build the bootstrap module source. The default import of the gadget .so is mapped
 * (via `moduleRequests`) to the runtime's native-module request form
 * `@normalized:Y&&&lib<name>.so&` — the form DevEco/ets-loader emits for
 * `import x from "libxxx.so"`; the runtime resolves it through the app's dlopen
 * namespaces (ndk -> default -> moduleNs_default).
 */
export function buildBootstrapSource(port: number, soName: string, initName: string): string {
    return `import gadget from "${soName}";

function ${initName}() {
    try {
        gadget.start({ port: ${port} });
        console.info("[xpanda-gadget] started (localabstract:xpanda_gadget_${port})");
    } catch (e) {
        console.error("[xpanda-gadget] start failed:", e);
    }
}`;
}

/** Runtime request form for the gadget .so module import (see buildBootstrapSource). */
export function normalizedSoRequest(soName: string): string {
    return `@normalized:Y&&&${soName}&`;
}

/** Patch an abc byte stream so app startup loads and starts the gadget. */
export function injectAbcBytes(data: Uint8Array, options: InjectAbcOptions = {}): InjectAbcResult {
    const port = options.port ?? DEFAULT_GADGET_PORT;
    const soName = options.soName ?? GADGET_SO_NAME;
    const initName = DEFAULT_INIT_NAME;
    const patchFile = PandaPatchFile.load(data);

    let entryClass = options.entryClass;
    const candidates: string[] = [];
    if (!entryClass) {
        for (const candidate of findEntryClassCandidates(patchFile)) candidates.push(candidate);
        entryClass = candidates[0];
    }
    if (!entryClass) {
        throw new Error(
            "no class with func_main_0 found; pass options.entryClass (the class that runs first, "
            + "e.g. L&entry/src/main/ets/entryability/EntryAbility&;)",
        );
    }
    if (!patchFile.hasMethod(entryClass, "func_main_0")) {
        throw new Error(`entry class ${entryClass} has no func_main_0`);
    }

    const bootstrapSource = buildBootstrapSource(port, soName, initName);
    const init = patchFile.patchInit(bootstrapSource, {
        setupClassName: entryClass,
        initName,
        es2abc: options.es2abc,
        targetApiVersion: options.targetApiVersion,
        keepTemp: options.keepTemp,
        // rewrite the raw specifier to the runtime's native-module request form
        moduleRequests: { [soName]: normalizedSoRequest(soName) },
        resolveModuleRequests: false,
    });

    return {
        data: patchFile.toBytes(),
        soName,
        entryClass,
        moduleName: init.moduleName,
        initName,
        importIndex: init.importIndex,
        candidates,
        bootstrapSource,
    };
}
