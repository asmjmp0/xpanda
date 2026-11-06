# xpanda-gadget

A Frida-Gadget-style injector for HarmonyOS: bundle a gadget `.so` **together with the target
app** and use a bytecode init injection so the app loads it automatically at startup. The gadget
opens a socket that carries messages and executes JavaScript dynamically.

## How it works

```
injectHap / injectAbc (xpanda-gadget)
        │  xpanda-asm patchInit: moves a bootstrap ES module into the target abc and prepends
        │  ldexternalmodulevar + callarg0 to the entry class's func_main_0
        ▼
APP start → func_main_0 → init()
        │  import gadget from "@normalized:Y&&&libxpanda_gadget.so&"   ← runtime native-module request
        ▼
libxpanda_gadget.so (packaged in the HAP under libs/arm64-v8a/; the installer extracts it to libs/arm64/)
        │  dlopen constructor → napi_module_register("xpanda_gadget")
        ▼
abstract unix socket "xpanda_gadget_<port>" + JSVM (on the host JS thread, v8, built with --jitless)
```

The result is a modified HAP: **bytecode with the startup hook + `libs/<abi>/libxpanda_gadget.so`**.
No external process or root is required; re-sign the package before installing.

## Usage

```bash
# 1) Build the gadget .so (uses the LLVM cross toolchain from ~/command-line-tools)
yarn workspace xpanda-gadget build:so        # → assets/arm64-v8a/libxpanda_gadget.so

# 2) Inject
yarn xpanda gadget <file.abc|file.hap> -o outDir
yarn xpanda gadget app.hap --port 27041 --abi arm64-v8a
yarn xpanda gadget app.hap --port 27041 --wait 5000   # hold startup up to 5s for a client
yarn xpanda gadget app.abc --entry "L&entry/src/main/ets/entryability/EntryAbility&;"

# 3a) Interactive JS shell (sets up hdc fport automatically, cleans it up on exit)
yarn xpanda gadget shell
#     commands: <js> | .info | .ping | .probe | .reset | .msg <json> | .help | .exit
#     multi-line blocks continue automatically; bare {"a":1} is retried as an expression
#     console.log / warn / error ... inside evaluated JS is streamed back to the shell
#     `ArkTS.hostGlobal` exposes the host globalThis snapshot; functions/objects call through

# 3b) Script watch mode: runs on start and again on every save (reconnects on the next save)
#     watch mode prints console.* output but not the script's return value; --once prints both
yarn xpanda gadget file script.js
yarn xpanda gadget file script.js --once        # run once and exit

# 3c) Start the app automatically when it is not running
yarn xpanda gadget shell --bundle com.example.helloworld -p 27041
yarn xpanda gadget file script.js --bundle com.example.helloworld -p 27041
#     --ability NAME   ability to launch (default EntryAbility)
#     --wait SEC       max wait for the app/gadget socket (default 20)

# 3d) Or connect manually (forward hdc to the abstract socket)
hdc fport tcp:27041 localabstract:xpanda_gadget_27041
nc localhost 27041
> {"id":1,"type":"info"}
< {"id":1,"type":"info","pid":1234,"endpoint":"localabstract:xpanda_gadget_27041","js":true,...}
> {"id":2,"type":"js","code":"1+1"}
< {"id":2,"type":"result","ok":true,"value":2}
> {"id":3,"type":"msg","payload":{"hello":"gadget"}}
< {"id":3,"type":"ok"}                      # lands in the ArkTS inbox, picked up by gadget.poll()
```

CLI options: `--port` `--entry` `--abc <entry>` `--all` (patch every abc) `--abi` `--so <path>`
`--so-name` (change the module request name) `--no-so` (bytecode only) `--stdout` `-q`.

## Exposed capabilities

**ArkTS side** (`import gadget from "libxpanda_gadget.so"`):

| Method | Description |
|---|---|
| `start({ port?, wait?, userModules?, moduleInfo? })` | Starts the socket (default name `xpanda_gadget_27041`); `wait` blocks startup until a client connects **and its first scripts have finished executing** (idle grace 500 ms) |
| `stop()` | Closes the socket and destroys the JSVM |
| `info()` | `{ pid, endpoint, running, js, version, uptimeMs }` |
| `send(value)` | Broadcasts `{"type":"msg","payload":<value>}` to every socket client |
| `poll()` | Pops one client message (`undefined` when empty) |
| `reset()` | Destroys the JSVM (recreated on the next evaluation, clearing all global state) |
| `executeJs(code)` | Evaluates JS in the gadget's JSVM and returns the result (throws on error) |
| `loadModule(path)` | Host-side `napi_load_module` wrapper (e.g. `@ohos.promptAction`) |
| `loadModuleWithInfo(path, info)` | Host-side `napi_load_module_with_info` wrapper |

Inside the shell, `ArkTS.hostGlobal` is a snapshot of the host ArkTS `globalThis`:
one property per host global (`ArkTS.hostGlobal.Text`, `ArkTS.hostGlobal.Object`,
...). Property reads are snapshotted; function/constructor calls are forwarded to
the host with JSON-serializable arguments. Classes are the function-valued
entries with a `prototype`:

```js
Object.keys(ArkTS.hostGlobal).filter(function (name) {
    var v = ArkTS.hostGlobal[name];
    return typeof v === "function" && v.prototype;
});
```

```js
ArkTS.hostGlobal.console.info("hello")  // forward to the host console
ArkTS.hostGlobal.Math.max(4, 7)         // 7

var promptAction = ArkTS.napi.loadModule("@ohos.promptAction");
promptAction.showToast({ message: "hello", duration: 3000 });
```

In a **host ArkTS injection script**, the same `napi_load_module` is available as
`globalThis.ArkTS.napi.loadModule(path)` (or `gadget.loadModule(path)` after
importing the gadget `.so`); it returns the real host module object.

`ArkTS.napi.loadModuleWithInfo(path, moduleInfo)` also works from the shell for
app-local modules. The target must be declared under
`buildOption.arkOptions.runtimeOnly` (`sources` / `packages`) in the module's
`build-profile.json5`. Socket requests are executed on the host event loop
(uv_async), so the module loader does not run from a TSFN callback and local
module execution is safe.

### Runtime method patching

`ArkTS.patch.patchMethod(module, className, methodName, replacement)` replaces
a host class method with a function defined in the gadget VM:

```js
var m = ArkTS.napi.loadModuleWithInfo(
    "entry/src/main/ets/entryability/EntryAbility",
    "com.example.helloworld/entry"
);

ArkTS.patch.patchMethod(m, "EntryAbility", "onDestroy", function () {
    console.warn("before onDestroy");
    this.__original();          // call the original with the same `this`
    console.warn("after onDestroy");
    return "patched";
});
```

- `module`: a module proxy (or a path previously loaded by `loadModule` /
  `loadModuleWithInfo`);
- `className`: the export key (`"default"`) or the default class name
  (`"EntryAbility"`);
- `methodName`: an instance method on the prototype, or a static method on the
  class;
- `replacement`: `this` is a live host object proxy; object/function arguments
  are live proxies, primitives are passed as-is; host Promises are thenables
  (`.then`/`await`) and are forwarded back as real host Promises; ArrayBuffers
  are copied;
- patching the same class/method again replaces the previous replacement
  instead of stacking; `this.__original` always calls the real original;
- patches are reverted when the VM is reset/destroyed (`.reset` /
  `gadget.stop`). Startup methods such as `onCreate` must be patched before they
  run; use `xpanda-asm` for guaranteed startup hooks.

Pass `null` as `className` to patch a module-level function or a system API:

```js
var fs = ArkTS.napi.loadModule("@ohos.file.fs");

ArkTS.patch.patchMethod(fs, null, "readTextSync", function (path) {
    console.warn("readTextSync", path);
    return this.__original(path);
});
```

This replaces the property on the host module object. Callers that already
captured the function (destructured imports or local aliases) and native-internal
callers are not intercepted, and the module export must be writable.

System APIs returning live objects or Promises are supported too. For example,
this wraps `@ohos.net.http` from the shell while preserving the real
`HttpRequest` and its Promise:

```js
var http = ArkTS.napi.loadModule("@ohos.net.http");

ArkTS.patch.patchMethod(http, null, "createHttp", function () {
    var req = this.__original();                 // live HttpRequest
    var originalRequest = req.request;           // stable after reassignment
    req.request = function () {
        var args = Array.prototype.slice.call(arguments);
        console.warn("[NET]", args[0]);
        return originalRequest(...args);         // real Promise/callback form
    };
    return req;
});
```

### Module-load events

Injection instruments every module record's `func_main_0` tail (`xpanda-asm`
`patchModuleLoadCallbacks`) and calls a bootstrap listener with the module record name.
The gadget JSVM exposes the events:

```js
var off = ArkTS.onModuleLoaded(function (module) {
    console.log("loaded", module.record); // e.g. "&entry/src/main/ets/pages/Index&"
});

off(); // unsubscribe
```

- callbacks run on the host event loop after `func_main_0` returned, so the module is
  fully evaluated and `ArkTS.metadata.loadUserModule(module.record)` is safe;
- only modules that load **after registration** are reported; already-loaded modules
  are not replayed;
- there is one global listener: registering again replaces the previous callback, so
  watch-mode script reloads do not stack listeners;
- only modules in the patched abc are observable; a module that throws during
  evaluation produces no event;
- pass `--no-module-load` to `xpanda gadget` (or `moduleLoad: false`) to skip the
  instrumentation; modules with namespace imports or multiple `returnundefined`
  sites are reported in `InjectAbcResult.moduleLoad.skipped`.

**Socket protocol** (NDJSON, one JSON per line): `js` (execute JS) / `msg` (bidirectional
messages) / `info` / `ping` / `probe` (JSVM health check). The gadget also pushes
`{"type":"console","level":"log","text":"..."}` for every `console.*` call made inside the JSVM
(`level` is one of `log` / `info` / `debug` / `warn` / `error` / `trace`); the same lines go to
hilog under the `xpanda-gadget` tag.

## Why the gadget needs its own JSVM (instead of the host ArkTS runtime)

Measured on the API 26 emulator with `com.example.helloworld`:

1. **The host runtime forbids dynamic evaluation**: `napi_run_script` is a stub (returns OK without
   executing, result is null); `eval` / `new Function` throw
   `TypeError: Not support eval. Forbidden using new Function()/Function().` — ArkTS does not allow
   compiling source at runtime by design.
2. **The JSVM library itself is usable**: loading `libjsvm.so` in the app domain succeeds with all
   symbols present, and `OH_JSVM_GetVMInfo` reports `engine=v8 version=14.4.258.16`.
3. **The VM must be created on the host JS thread**: calling `OH_JSVM_CreateVM` on a private pthread
   silently kills the process (no crash log). Routing both creation and execution onto the app's own
   JS thread through a `uv_async` handle on the host event loop makes `CreateVM`/`CreateEnv`/
   `CompileScript`/`RunScript` work normally. A TSFN callback would also work for evaluation, but
   OpenHarmony's module loader is not re-entrant there: `napi_load_module_with_info` can SIGSEGV
   when it has to execute a local module, so the bridge uses uv_async instead.
4. **A new env requires explicit scopes**: `OpenVMScope` → `OpenEnvScope` → `OpenHandleScope`,
   otherwise the first `CreateStringUtf8` crashes.
5. The VM is initialized with `--jitless` (interpreter mode): the device has no `/dev/xpm` (the
   executable-memory permission device used by V8's JitFort), so the JIT path is unavailable.

## native/ layout

See [native/README.md](native/README.md) for the full module map and call flow.

| Path | Responsibility |
|---|---|
| `src/gadget.cpp` | NAPI module entry + exported functions (start/stop/info/send/poll/executeJs/reset) |
| `src/common/` | Process-wide socket instance, hilog helpers, mini JSON scanner |
| `src/napi/` | Host ArkTS value conversions (string <-> JSON) |
| `src/js/` | JSVM lifecycle/evaluation (`jsvm`), JSVM value conversions (`jsvm_value`), socket→JS thread bridge (`js_thread`) |
| `src/js/module/` | Modules injected into the gadget JSVM (`console`, host `globalThis` bridge) |
| `src/socket/` | Abstract unix socket, accept/line reading, NDJSON protocol dispatch, inbox/broadcast |
| `build.sh` | Cross-compiles with `aarch64-unknown-linux-ohos-clang++` from `~/command-line-tools` |
| `CMakeLists.txt` | DevEco integration (copy into `<module>/src/main/cpp/`) |

All link dependencies are system libraries: `libace_napi.z.so`, `libjsvm.so`, `libhilog_ndk.z.so`
(libc++ is linked statically).

## TypeScript layout

| Path | Responsibility |
|---|---|
| `src/index.ts` | Public API barrel |
| `src/inject/` | `.abc` bootstrap injection: defaults/types, entry-class discovery, user-module record enumeration, bootstrap source, `injectAbcBytes` |
| `src/hap/` | HAP repacking: CRC32 + minimal ZIP writer, abc-entry selection, `.so` embedding, `injectHapBytes` |
| `src/io.ts` | Node-only disk IO helpers for the CLI |
| `interface/ArkTS.ts` | Type reference for `ArkTS.hostGlobal` / `ArkTS.napi` and the host-side `ArkTS` / `gadget` API (documentation only) |

## ArkTS interface reference

[`interface/ArkTS.ts`](interface/ArkTS.ts) documents the JSVM `ArkTS.hostGlobal` /
`ArkTS.napi` surface and the host-side `globalThis.ArkTS` / `gadget.loadModule`
helpers, including call/conversion rules and limitations.

## Injection details (abc side)

- Entry class: explicit `--entry` > derived from module.json (mainElement/srcEntry) > any class in
  the abc with `func_main_0` (EntryAbility / pages/Index preferred).
- Bootstrap source (see `buildBootstrapSource`): `import gadget from "<soName>"; init()` with
  `try { gadget.start({port}) } catch` — a module-load failure does not break app startup.
- **User module metadata**: at patch time the injector enumerates every module record in the abc
  (record name + exported object names) and bakes it into the bootstrap as `getAllUserModule()`;
  the bootstrap passes the list to `gadget.start({ userModules })`, which installs
  `ArkTS.metadata.getAllUserModule()` **in the gadget JSVM** through the JSVM C API
  (nothing is assigned through `globalThis`, and `.reset` re-installs it). Shell / `gadget file`
  scripts call it directly:

  ```js
  var modules = ArkTS.metadata.getAllUserModule();
  // [{ record: "&entry/src/main/ets/pages/Index&", exports: ["Index", "default"] }, ...]

  // then load a record's live exports:
  var m = ArkTS.napi.loadModuleWithInfo("entry/src/main/ets/pages/Index", "com.example.app/entry");
  ```

  The list is compile-time data from the patched abc, not the runtime module cache; `export *`
  re-exports have no name and contribute no entries.
- **Module-load instrumentation** (default): `patchModuleLoadCallbacks` imports
  `xpandaModuleLoaded` into every module record and calls it right before the final
  `returnundefined`; the bootstrap forwards each record to `gadget.moduleLoaded`, and the
  native layer queues it for `ArkTS.onModuleLoaded`. `--no-module-load` disables this.
- The `.so` module request is rewritten to the runtime's native-module form
  `@normalized:Y&&&lib<name>.so&` (what DevEco/ets-loader produces for `import x from "libxxx.so"`).
- **HAP entries are packaged with STORE** (matching DevEco): the installer was observed to skip
  deflated `libs/` entries; only stored ones are extracted to `libs/arm64/` on device.
- The generated bootstrap module record name is `&xpanda/hook/<moduleName>&`.

## Limitations and caveats

- **Re-signing**: a repacked HAP loses its signature; re-sign it with DevEco / hap-signer before
  installing.
- **ABI**: the prebuilt `.so` is arm64-v8a only; emulators (x86_64) cannot load it — change the
  target in `build.sh` if needed.
- **The socket has no authentication**, and the port/name are baked into the bootstrap; remove the
  injected artifacts after debugging and never ship a gadget-instrumented package to production.
- The JSVM is isolated from the host ArkTS runtime (a separate VM) and cannot access host objects;
  use a JS bridge or extend the NAPI/ANI bridge if host reflection is needed.
- `console.*` inside the gadget VM is streamed to `gadget shell` / `gadget file` clients and hilog.
  The **app's own** `console` output is emitted by the host ArkTS runtime and is not captured by the
  gadget; read it with `hdc hilog`.
- `let/const` in `executeJs` are scoped to a single script (same as DevTools; redeclaration errors);
  use `globalThis.xxx = ...` for persistent state.
- patchInit constraints are inherited from xpanda-asm: the entry class needs `func_main_0`; a
  bundle-pack abc without a module record gets `isCommonjs` + `moduleRecordIdx` force-added (which
  changes loading semantics — use with care).

## Tests

```bash
yarn workspace xpanda-gadget test
```

Coverage: structural checks after abc injection (entry `func_main_0` calls init, every module
`func_main_0` ends with the `ArkTS.onModuleLoaded` listener call, the bootstrap module record keeps
the `@normalized:Y&&&...&` native module request), synthetic HAP injection (abc written back +
`.so` embedded + `module.json` byte-identical + ELF header checks), and aarch64 ELF checks for the
prebuilt `.so`.

End-to-end (emulator/device): inject → re-sign → install → `aa start` → `hdc fport` → NDJSON client
(ping/info/js/msg/probe).
