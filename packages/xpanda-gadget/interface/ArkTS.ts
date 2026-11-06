/**
 * xpanda-gadget ArkTS interface reference.
 *
 * This file is documentation and type definitions only; it is not loaded at
 * runtime. It describes the `ArkTS` object available in the gadget JSVM
 * (`gadget shell` / `gadget file`) and the host-side `globalThis.ArkTS` /
 * `gadget.loadModule()` surface used by injected ArkTS scripts.
 *
 * Two different runtimes are involved:
 *
 *   1. Host ArkTS runtime
 *      - runs the app and any bootstrap / AOT-injected ArkTS modules
 *      - `globalThis.ArkTS.napi.loadModule(path)` returns the real host module
 *      - `gadget.loadModule(path)` is the same function on the gadget NAPI module
 *
 *   2. Gadget JSVM
 *      - a separate V8 isolate used by `gadget shell` / `gadget file`
 *      - `ArkTS.hostGlobal` is a snapshot of the host globalThis
 *      - calls are forwarded to the host through NAPI with JSON arguments
 *
 * @author jmp0
 */

/**
 * A primitive copied from the host globalThis.
 */
export type HostPrimitive = string | number | boolean | null | undefined | bigint;

/**
 * Callable proxy for a function from the host globalThis.
 *
 * Calling it forwards the call to the host with JSON-serializable arguments.
 * Function-valued globals are arrow functions, so they have no `prototype`.
 */
export interface HostFunctionProxy {
    (...args: unknown[]): unknown;
    /** Function name on the host. */
    readonly name: string;
}

/**
 * Constructible proxy for a class from the host globalThis.
 *
 * It is an ordinary function with a `prototype`, so `typeof value === "function"`
 * and `value.prototype` is an object. `new value(...)` forwards to the host
 * constructor; calling it without `new` forwards as a normal call.
 */
export interface HostClassProxy {
    new (...args: unknown[]): unknown;
    (...args: unknown[]): unknown;
    /** Class name on the host. */
    readonly name: string;
    /**
     * Host prototype proxy. Instance methods and accessors can be enumerated
     * with `Object.getOwnPropertyNames(value.prototype)`. `new value(...)`
     * still returns a JSON snapshot, so `instanceof` is not reliable.
     */
    readonly prototype: object;
}

/**
 * Member proxy for an object-valued host global (for example `Math` or
 * `console`). Property access returns the host value, a callable proxy, or a
 * nested object proxy, so chained calls such as `ArkTS.hostGlobal.Math.max(4, 7)`
 * are forwarded to the host. `ownKeys` is implemented as well.
 */
export interface HostObjectProxy {
    [key: string]: HostGlobalValue;
}

/**
 * A value stored in `ArkTS.hostGlobal`.
 */
export type HostGlobalValue = HostPrimitive | HostClassProxy | HostFunctionProxy | HostObjectProxy;

/**
 * Proxy for a host module returned by `ArkTS.napi.loadModule(path)`.
 *
 * Property reads return the host value (primitive), a callable proxy for
 * functions, or an object proxy for nested objects. Methods can be called
 * directly. `ownKeys` and `getOwnPropertyDescriptor` follow the host's real
 * enumerability, so `Object.keys()` / `JSON.stringify()` match normal JS
 * filtering; `Object.getOwnPropertyNames()` lists all own keys, including
 * non-enumerable ones (many `@ohos.deviceInfo` fields are non-enumerable).
 *
 * @example
 * const promptAction = ArkTS.napi.loadModule("@ohos.promptAction");
 * promptAction.showToast({ message: "hello", duration: 3000 });
 *
 * @example
 * const deviceInfo = ArkTS.napi.loadModule("@ohos.deviceInfo");
 * console.log(deviceInfo.brand, deviceInfo.osFullName, deviceInfo.sdkApiVersion);
 *
 * // Dump all own properties (including non-enumerable ones):
 * const names = Object.getOwnPropertyNames(deviceInfo);
 * const plain: Record<string, unknown> = {};
 * for (const name of names) plain[name] = deviceInfo[name];
 * console.log(JSON.stringify(plain, null, 2));
 *
 * @example
 * // Instance methods of an exported class:
 * const entryAbility = ArkTS.napi.loadModuleWithInfo(...);
 * console.log(Object.getOwnPropertyNames(entryAbility.default.prototype));
 */
export interface HostModuleProxy {
    [key: string]: HostGlobalValue;
}

/**
 * NAPI helpers exposed on `ArkTS.napi` in the gadget JSVM.
 */
export interface ArkTSNapi {
    /**
     * Load a host module through `napi_load_module` and return a live proxy.
     * The loaded module is kept alive with a NAPI reference until the JSVM is
     * reset/destroyed.
     *
     * Use this for system modules (`@ohos.*`, `@kit.*`, `@system.*`) or when the
     * current runtime context is enough to resolve the path. It carries no
     * bundle/module information, so app-local paths, HAR/ohpm packages and
     * cross-bundle modules may fail to resolve.
     *
     * @example
     * const promptAction = ArkTS.napi.loadModule("@ohos.promptAction");
     * promptAction.showToast({ message: "hello", duration: 3000 });
     *
     * @example
     * const deviceInfo = ArkTS.napi.loadModule("@ohos.deviceInfo");
     * console.log(deviceInfo.brand, deviceInfo.osFullName);
     */
    loadModule(path: string): HostModuleProxy;

    /**
     * Load a module through `napi_load_module_with_info` and return a live call
     * proxy.
     *
     * `moduleInfo` is `"<bundleName>/<moduleName>"` (for example
     * `"com.example.helloworld/entry"`). It tells the runtime which app/module
     * context to resolve the path in, so this variant supports local project
     * files, HAR/ohpm packages, cross-bundle modules and native libraries.
     * For local file paths the path must start with the module name.
     *
     * @example
     * // local project module: "entry/src/main/ets/foo"
     * const foo = ArkTS.napi.loadModuleWithInfo(
     *     "entry/src/main/ets/foo",
     *     "com.example.helloworld/entry"
     * );
     *
     * @example
     * // ohpm/HAR package
     * const json5 = ArkTS.napi.loadModuleWithInfo(
     *     "json5",
     *     "com.example.helloworld/entry"
     * );
     */
    loadModuleWithInfo(path: string, moduleInfo: string): HostModuleProxy;
}

/**
 * Runtime method patching for classes loaded from the host runtime.
 */
export interface ArkTSPatch {
    /**
     * Replace a host method with a function defined in the gadget VM.
     *
     * `module` is the proxy returned by `ArkTS.napi.loadModule` /
     * `loadModuleWithInfo` (or a path previously loaded with either helper).
     * `className` is the export key (`"default"` for a default export) or the
     * default class name (`"EntryAbility"`). Pass `null` to patch a module-level
     * export/function (for example `@ohos.file.fs.readTextSync`). `methodName`
     * is an instance method on the prototype, a static method on the class, or
     * the export name when `className` is `null`.
     *
     * Patching a module-level function changes the module object property;
     * callers that captured the function earlier (destructured imports, local
     * aliases) and native-internal callers are not affected.
     *
     * Inside `replacement`, `this` is a live host object proxy. Object/function
     * arguments are live proxies too; primitives are passed as-is. Host Promises
     * are exposed as thenables (`.then`/`await` work) and are forwarded back as
     * real host Promises when returned. ArrayBuffers are copied.
     * `this.__original(...)` calls the original method with the same `this` and
     * returns its live value (object/function/Promise).
     *
     * Patching the same class/method again replaces the previous replacement;
     * it does not wrap another layer. `this.__original` always calls the real
     * original method.
     *
     * Patches are reverted when the VM is reset/destroyed (`.reset` /
     * `gadget.stop`). Startup methods such as `onCreate` must be patched before
     * they run; use `xpanda-asm` for guaranteed startup hooks.
     */
    patchMethod(
        module: HostModuleProxy | string,
        className: string | null,
        methodName: string,
        replacement: (this: unknown, ...args: unknown[]) => unknown,
    ): boolean;
}

/**
 * The `ArkTS` object available in the gadget JSVM.
 */
export interface ArkTS {
    /**
     * Snapshot of the host ArkTS `globalThis`, captured by `gadget.start()`.
     * One property per host global; there are no helper methods.
     *
     * The snapshot contains the host's own global property names (740 on the
     * test app, including the gadget's own `ArkTS`) and nothing else:
     *
     *   - primitives are copied as-is;
     *   - classes become HostClassProxy values;
     *   - other functions become HostFunctionProxy values;
     *   - objects become HostObjectProxy values.
     *
     * @example
     * // All host global names:
     * Object.keys(ArkTS.hostGlobal);
     *
     * @example
     * // Classes (ordinary functions have a prototype):
     * Object.keys(ArkTS.hostGlobal).filter(function (name) {
     *     const value = ArkTS.hostGlobal[name];
     *     return typeof value === "function" && value.prototype;
     * });
     *
     * @example
     * // Member calls:
     * ArkTS.hostGlobal.console.info("hello");
     * ArkTS.hostGlobal.Math.max(4, 7); // 7
     */
    readonly hostGlobal: Record<string, HostGlobalValue>;

    /** Host module loading helpers. */
    readonly napi: ArkTSNapi;

    /** Runtime method patching helpers. */
    readonly patch: ArkTSPatch;

    /**
     * Static user-module metadata, installed into this JSVM by `gadget.start()`
     * (xpanda gadget >= 1.1): the injected bootstrap bakes a compile-time module
     * list at patch time and passes it as the `userModules` start option; the
     * native side attaches `metadata` directly to this `ArkTS` object (no
     * globalThis assignment; re-installed after `.reset`).
     *
     * @example
     * for (const m of ArkTS.metadata.getAllUserModule()) {
     *     console.log(m.record, "->", m.exports.join(", "));
     * }
     *
     * @example
     * // Load a baked record's live exports (wrappers + moduleInfo handled):
     * const entry = ArkTS.metadata.loadUserModule(ArkTS.metadata.getAllUserModule()[0].record);
     */
    readonly metadata?: {
        /** `"<bundleName>/<moduleName>"` of the patched HAP (when baked). */
        readonly moduleInfo?: string;
        /** Every module record of the patched abc and its exported object names. */
        getAllUserModule(): Array<{ record: string; exports: string[] }>;
        /**
         * Load a baked record's live exports. Accepts the record as returned by
         * `getAllUserModule()` — the `&...&` record wrappers are stripped and
         * the baked `moduleInfo` is used automatically. Falls back to
         * `napi_load_module` when no moduleInfo was baked.
         */
        loadUserModule(record: string): HostModuleProxy;
    };

    /**
     * Register the global module-load callback. There is only one listener:
     * registering again replaces the previous callback, so reloading a script
     * does not stack listeners and no manual unsubscribe is required.
     *
     * Only modules that load **after registration** are reported: already-loaded
     * modules are not replayed.
     *
     * `module.record` is the module record name as stored in the abc, e.g.
     * `"&entry/src/main/ets/pages/Index&"`. The callback runs on the host event
     * loop, after the module was marked evaluated, so its exports can be loaded
     * safely with `ArkTS.metadata.loadUserModule(module.record)`.
     *
     * Only modules of the patched abc are observable. Modules that throw during
     * evaluation do not produce an event. The returned function clears the
     * listener if it is still the active one (optional; replacement is enough).
     *
     * @example
     * ArkTS.onModuleLoaded(function (module) {
     *     console.log("loaded", module.record);
     * });
     */
    onModuleLoaded(callback: (module: { record: string }) => void): () => void;
}

/**
 * Host-side NAPI helpers installed on `globalThis.ArkTS` by `gadget.start()`.
 *
 * Unlike the JSVM proxies, these return the real host module object, so plain
 * ArkTS/JS property access works normally.
 */
export interface HostArkTSNapi {
    /**
     * Calls `napi_load_module` and returns the module exports.
     *
     * Best for system modules (`@ohos.*`, `@kit.*`, `@system.*`); no
     * bundle/module context is supplied.
     */
    loadModule(path: string): unknown;

    /**
     * Calls `napi_load_module_with_info` and returns the module exports.
     *
     * `moduleInfo` is `"<bundleName>/<moduleName>"`. Use this for local project
     * paths, HAR/ohpm packages and cross-bundle modules.
     */
    loadModuleWithInfo(path: string, moduleInfo: string): unknown;
}

/**
 * Host-side `globalThis.ArkTS` installed by `gadget.start()`.
 *
 * @example
 * const promptAction = globalThis.ArkTS.napi.loadModule("@ohos.promptAction");
 * promptAction.showToast({ message: "hello", duration: 3000 });
 */
export interface HostArkTS {
    readonly napi: HostArkTSNapi;
}

/**
 * Information returned by `gadget.info()`.
 */
export interface GadgetInfo {
    pid: number;
    endpoint: string;
    running: boolean;
    js: boolean;
    jsError?: string;
    version: string;
    uptimeMs: number;
}

/**
 * Gadget NAPI module exports.
 *
 * The module is imported by the injected bootstrap as
 * `import gadget from "libxpanda_gadget.so"`.
 */
export interface GadgetModule {
    /**
     * Start the socket server and the JS-thread bridge.
     *
     * `wait` holds app startup until a client connects, and then keeps holding
     * until the scripts the client sends first have finished executing (idle
     * grace 500ms) or the timeout expires. It is normally baked in by
     * `xpanda gadget --wait MS`. `userModules` is the bootstrap-baked module
     * list; it is installed as `ArkTS.metadata.getAllUserModule()` in the
     * gadget JSVM.
     *
     * @example
     * gadget.start({ port: 27041 });
     * gadget.start({ port: 27041, wait: 5000 });
     */
    start(options?: {
        port?: number;
        wait?: number;
        userModules?: Array<{ record: string; exports: string[] }>;
        /** `"<bundleName>/<moduleName>"`, exposed as `ArkTS.metadata.moduleInfo`. */
        moduleInfo?: string;
    }): void;

    /** Stop the socket server and release the JSVM / module references. */
    stop(): void;

    /** Destroy the gadget JSVM (a fresh VM is created on the next eval). */
    reset(): void;

    /** Return pid / endpoint / version / uptime / JS readiness. */
    info(): GadgetInfo;

    /** Broadcast `{"type":"msg","payload":value}` to every socket client. */
    send(value: unknown): void;

    /** Pop one message sent by a socket client (`undefined` when empty). */
    poll(): unknown;

    /** Evaluate JavaScript in the gadget JSVM and return the result. */
    executeJs(code: string): unknown;

    /**
     * Internal: called by the injected bootstrap at the end of every
     * instrumented module's `func_main_0`. Users register for these events with
     * `ArkTS.onModuleLoaded` in the gadget JSVM instead.
     */
    moduleLoaded(record: string): void;

    /**
     * Host-side `napi_load_module` wrapper.
     *
     * Best for system modules (`@ohos.*`, `@kit.*`, `@system.*`).
     */
    loadModule(path: string): unknown;

    /**
     * Host-side `napi_load_module_with_info` wrapper.
     *
     * `moduleInfo` is `"<bundleName>/<moduleName>"`; needed for local project
     * paths, HAR/ohpm packages and cross-bundle modules.
     */
    loadModuleWithInfo(path: string, moduleInfo: string): unknown;
}

/**
 * # Call semantics
 *
 * - Function and constructor arguments are serialized with `JSON.stringify` on
 *   the JSVM side and parsed with `JSON.parse` on the host side.
 * - Return values are serialized with the host's JSON conversion and parsed back
 *   in the JSVM.
 * - Primitive values, arrays and plain objects survive round-tripping.
 * - Functions, `undefined` inside arguments, circular structures and live host
 *   object identity are not preserved.
 * - A host function returning `undefined` becomes `null` in the JSVM.
 * - A host object returned from a call is JSON-serialized; it is not a live
 *   handle. To keep calling host methods, load a module with
 *   `ArkTS.napi.loadModule()` and use its proxy instead.
 */

/**
 * # Snapshot lifetime
 *
 * - `ArkTS.hostGlobal` is captured once by `gadget.start()`. Host globals added
 *   after that point are not reflected.
 * - `ArkTS.napi.loadModule()` creates host NAPI references that stay valid until
 *   the JSVM is reset (`.reset` in the shell) or destroyed (`stop()`), when
 *   `releaseHostModules()` releases them.
 * - The host `globalThis.ArkTS` object is installed by `gadget.start()` and is
 *   available to injected ArkTS scripts after startup.
 */
