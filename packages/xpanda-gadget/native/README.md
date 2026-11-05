# libxpanda_gadget.so — native layout

The native side is split by responsibility so each module has one reason to change.
`build.sh` cross-compiles it; `CMakeLists.txt` is the DevEco/hvigor integration.

```
src/
├── gadget.cpp              NAPI module entry + exported functions (start/stop/info/send/poll/executeJs/reset)
├── common/
│   ├── context.h/.cpp      process-wide SocketServer instance
│   ├── log.h               hilog macros (GADGET_LOG_INFO / GADGET_LOG_ERROR)
│   └── mini_json.h         minimal JSON scanner/escaping used by the protocol + console
├── napi/
│   └── napi_utils.h/.cpp   host ArkTS value conversions (string <-> JSON)
├── js/
│   ├── js_thread.h/.cpp    uv_async bridge: socket thread -> host JS thread
│   ├── jsvm.h/.cpp         JSVM lifecycle, script evaluation, probe
│   ├── jsvm_value.h/.cpp   JSVM value/exception conversions
│   └── module/
│       ├── console.h/.cpp     the console.* module injected into the gadget JSVM
│       ├── host_bridge.h/.cpp coordinator + JS assembly of ArkTS.hostGlobal/napi/patch
│       ├── host_global.h/.cpp host globalThis snapshot -> ArkTS.hostGlobal
│       ├── napi_bridge.h/.cpp ArkTS.napi, napi_load_module and the call proxy
│       ├── patch_bridge.h/.cpp ArkTS.patch.patchMethod runtime method patching
│       └── bridge_utils.h     shared JSVM helpers
└── socket/
    └── socket_server.h/.cpp abstract unix socket + NDJSON protocol dispatch
```

## Call flow

```
app bootstrap (func_main_0)
  └─ import libxpanda_gadget.so → start()
       ├─ js/module/host_bridge captures the host globalThis snapshot
       ├─ js/js_thread       creates the uv_async handle used by all socket requests
       └─ socket/socket_server binds localabstract:xpanda_gadget_<port>

socket client (gadget shell / gadget file)
  └─ {"type":"js"} → socket_server::handleLine
       └─ js/js_thread::executeOnJsThread
            └─ js/jsvm::evaluateInJsvm (on the host JS thread)
                 └─ console.* → js/module/console → broadcast {"type":"console"} + hilog
       → {"type":"result"} back to the client
```

`start({ wait: N })` binds the socket and then blocks the app's JS thread for at
most N milliseconds until a client connects; `gadget shell` / `gadget file`
connect and release the app. With no client it times out and startup continues.

The hop uses a `uv_async` handle on the host event loop instead of a
`napi_threadsafe_function`: OpenHarmony's module loader is not re-entrant from a
TSFN callback, so `napi_load_module_with_info` can SIGSEGV when it needs to
execute a local module there. The uv_async callback is a normal host event loop
callback, so `ArkTS.napi.loadModuleWithInfo` works from the gadget VM too.

## Host globalThis bridge

The host ArkTS runtime and the gadget JSVM are separate runtimes, so `globalThis`
cannot be shared as a live object. `start()` captures the host `globalThis`
(`captureHostGlobal`) and `ensureJsvm()` installs it into the JSVM
(`installHostBridge`). Property reads come from the snapshot; function and
constructor calls are forwarded to the host runtime through NAPI with
JSON-serializable arguments and results.

```js
ArkTS.hostGlobal              // plain snapshot object of the host globalThis
Object.keys(ArkTS.hostGlobal) // all host global names (740 incl. ArkTS on test_app)
ArkTS.hostGlobal.Text         // constructible proxy: typeof "function", has prototype
ArkTS.hostGlobal.parseInt     // callable proxy: arrow function, no prototype
ArkTS.hostGlobal.Math         // object member proxy: Math.max(4, 7) -> 7
ArkTS.hostGlobal.Infinity     // primitive copied as-is

ArkTS.hostGlobal.console.info("hello")   // forwarded to the host console

var promptAction = ArkTS.napi.loadModule("@ohos.promptAction");
promptAction.showToast({ message: "hello", duration: 3000 });
```

There are no helper methods. To list classes:

```js
Object.keys(ArkTS.hostGlobal).filter(function (name) {
    var v = ArkTS.hostGlobal[name];
    return typeof v === "function" && v.prototype;
});
```

There are two sides of `ArkTS.napi.loadModule`:

- **host ArkTS (injected script)**: `globalThis.ArkTS.napi.loadModule(path)` calls
  `napi_load_module` directly and returns the real module object, so the script
  can compose the toast itself:

  ```js
  var promptAction = globalThis.ArkTS.napi.loadModule("@ohos.promptAction");
  promptAction.showToast({ message: "hello", duration: 3000 });
  ```

  The gadget NAPI module also exports `loadModule(path)` /
  `loadModuleWithInfo(path, moduleInfo)` for `import gadget from "libxpanda_gadget.so"`.

- **gadget JSVM**: `ArkTS.napi.loadModule(path)` loads the host module and returns
  a live call proxy (`promptAction.showToast(...)`), routed through the same NAPI
  call bridge as `ArkTS.hostGlobal`.

Function/constructor arguments and results must be JSON-serializable; live host
objects, functions, `undefined` and circular values are not preserved.

Full API reference: [`../interface/ArkTS.ts`](../interface/ArkTS.ts).

## Adding a new JS module

Put it under `src/js/module/<name>.h/.cpp`, expose an `install<Name>(JSVM_Env)`
function, and call it from `ensureJsvm()` in `src/js/jsvm.cpp`. Add the source file
to both `build.sh` and `CMakeLists.txt`.
