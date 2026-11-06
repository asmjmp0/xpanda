/**
 * Bootstrap module source emitted into the target abc.
 * @Author: jmp0
 */
import { MODULE_LOAD_LISTENER } from "./constants";
import { buildGetAllUserModuleSource, type UserModuleInfo } from "./user-module";

/**
 * Build the bootstrap module source. The default import of the gadget .so is mapped
 * (via `moduleRequests`) to the runtime's native-module request form
 * `@normalized:Y&&&lib<name>.so&` — the form DevEco/ets-loader emits for
 * `import x from "libxxx.so"`; the runtime resolves it through the app's dlopen
 * namespaces (ndk -> default -> moduleNs_default).
 *
 * `userModules` (collected by {@link collectUserModules} at patch time) is baked in
 * as a static `getAllUserModule()` function and passed to `gadget.start()` as the
 * `userModules` option; `moduleInfo` (`"<bundleName>/<moduleName>"`) is baked as
 * the `moduleInfo` option. The native side installs both as `ArkTS.metadata`
 * (`getAllUserModule()` / `moduleInfo` / `loadUserModule()`) in the gadget JSVM,
 * available to `gadget shell` / `gadget file` scripts; re-installed after `.reset`.
 */
export function buildBootstrapSource(
    port: number,
    soName: string,
    initName: string,
    waitMs = 0,
    userModules: UserModuleInfo[] = [],
    moduleInfo?: string,
): string {
    const wait = Number.isFinite(waitMs) && waitMs > 0 ? Math.floor(waitMs) : 0;
    const options = [`port: ${port}`];
    if (wait > 0) options.push(`wait: ${wait}`);
    options.push(`userModules: getAllUserModule()`);
    if (moduleInfo) options.push(`moduleInfo: ${JSON.stringify(moduleInfo)}`);
    const startOptions = `{ ${options.join(", ")} }`;
    return `import gadget from "${soName}";

${buildGetAllUserModuleSource(userModules)}

function ${initName}() {
    try {
        gadget.start(${startOptions});
        console.info("[xpanda-gadget] started (localabstract:xpanda_gadget_${port})");
    } catch (e) {
        console.error("[xpanda-gadget] start failed:", e);
    }
}

/**
 * Called at the end of every instrumented module's func_main_0 (the module-load
 * callback import added by xpanda-asm). The injector embeds a matching
 * libxpanda_gadget.so, so the native reporter is always present. The call is
 * deliberately unwrapped: a try/catch in this moved function hits an
 * ArkCompiler interpreter stub bug on the tested 13.0.1.0 runtime.
 */
function ${MODULE_LOAD_LISTENER}(record) {
    gadget.moduleLoaded(record);
}`;
}

/** Runtime request form for the gadget .so module import (see buildBootstrapSource). */
export function normalizedSoRequest(soName: string): string {
    return `@normalized:Y&&&${soName}&`;
}
