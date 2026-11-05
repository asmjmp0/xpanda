/**
 * Bootstrap module source emitted into the target abc.
 * @Author: jmp0
 */

/**
 * Build the bootstrap module source. The default import of the gadget .so is mapped
 * (via `moduleRequests`) to the runtime's native-module request form
 * `@normalized:Y&&&lib<name>.so&` — the form DevEco/ets-loader emits for
 * `import x from "libxxx.so"`; the runtime resolves it through the app's dlopen
 * namespaces (ndk -> default -> moduleNs_default).
 */
export function buildBootstrapSource(
    port: number,
    soName: string,
    initName: string,
    waitMs = 0,
): string {
    const wait = Number.isFinite(waitMs) && waitMs > 0 ? Math.floor(waitMs) : 0;
    const startOptions = wait > 0
        ? `{ port: ${port}, wait: ${wait} }`
        : `{ port: ${port} }`;
    return `import gadget from "${soName}";

function ${initName}() {
    try {
        gadget.start(${startOptions});
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
