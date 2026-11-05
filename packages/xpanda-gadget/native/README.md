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
│   ├── js_thread.h/.cpp    napi_threadsafe_function bridge: socket thread -> host JS thread
│   ├── jsvm.h/.cpp         JSVM lifecycle, script evaluation, probe
│   ├── jsvm_value.h/.cpp   JSVM value/exception conversions
│   └── module/
│       └── console.h/.cpp  the console.* module injected into the gadget JSVM
└── socket/
    └── socket_server.h/.cpp abstract unix socket + NDJSON protocol dispatch
```

## Call flow

```
app bootstrap (func_main_0)
  └─ import libxpanda_gadget.so → start()
       ├─ js/js_thread       creates the TSFN used by all socket requests
       └─ socket/socket_server binds localabstract:xpanda_gadget_<port>

socket client (gadget shell / gadget file)
  └─ {"type":"js"} → socket_server::handleLine
       └─ js/js_thread::executeOnJsThread
            └─ js/jsvm::evaluateInJsvm (on the host JS thread)
                 └─ console.* → js/module/console → broadcast {"type":"console"} + hilog
       → {"type":"result"} back to the client
```

## Adding a new JS module

Put it under `src/js/module/<name>.h/.cpp`, expose an `install<Name>(JSVM_Env)`
function, and call it from `ensureJsvm()` in `src/js/jsvm.cpp`. Add the source file
to both `build.sh` and `CMakeLists.txt`.
