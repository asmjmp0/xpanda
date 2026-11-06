/**
 * .abc-level gadget init injection.
 *
 * Uses xpanda-asm's `patchInit` to append a bootstrap ES module to the target abc
 * and make the entry class's `func_main_0` call it on startup. The bootstrap imports
 * the gadget NAPI module (`libxpanda_gadget.so`) whose module request is preserved
 * verbatim by xpanda-asm (no matching record), so the ArkTS runtime dlopens it from
 * the HAP libs directory on first import.
 * @Author: jmp0
 */
import { PandaPatchFile } from "xpanda-asm";
import { PandaFile } from "xpanda-core";
import { buildBootstrapSource, normalizedSoRequest } from "./bootstrap";
import { DEFAULT_GADGET_PORT, DEFAULT_INIT_NAME, GADGET_SO_NAME, MODULE_LOAD_LISTENER } from "./constants";
import { findEntryClassCandidates } from "./entry-class";
import type { InjectAbcOptions, InjectAbcResult } from "./types";
import { collectUserModules } from "./user-module";

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

    // User module records are baked into the bootstrap before patching; the patch
    // itself only appends, so a read-only view of the original bytes is enough
    // (module metadata is already resolved by the PandaFile constructor).
    const userModules = collectUserModules(new PandaFile(data));

    const bootstrapSource = buildBootstrapSource(port, soName, initName, options.waitMs ?? 0, userModules, options.moduleInfo);
    const instrumentModules = options.moduleLoad !== false;
    const init = patchFile.patchInit(bootstrapSource, {
        setupClassName: entryClass,
        initName,
        es2abc: options.es2abc,
        targetApiVersion: options.targetApiVersion,
        keepTemp: options.keepTemp,
        // rewrite the raw specifier to the runtime's native-module request form
        moduleRequests: { [soName]: normalizedSoRequest(soName) },
        resolveModuleRequests: false,
        exportFunctions: instrumentModules ? [MODULE_LOAD_LISTENER] : undefined,
    });

    let moduleLoad: InjectAbcResult["moduleLoad"] = {
        listenerName: MODULE_LOAD_LISTENER,
        patched: 0,
        skipped: [],
    };
    if (instrumentModules) {
        const hookResult = patchFile.patchModuleLoadCallbacks({
            listenerRecordName: init.moduleRecordName,
            listenerName: MODULE_LOAD_LISTENER,
        });
        moduleLoad = {
            listenerName: MODULE_LOAD_LISTENER,
            patched: hookResult.patched.length,
            skipped: hookResult.skipped,
        };
    }

    return {
        data: patchFile.toBytes(),
        soName,
        entryClass,
        moduleName: init.moduleName,
        initName,
        importIndex: init.importIndex,
        candidates,
        userModules,
        moduleLoad,
        bootstrapSource,
    };
}
