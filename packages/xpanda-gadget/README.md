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
yarn xpanda gadget app.abc --entry "L&entry/src/main/ets/entryability/EntryAbility&;"

# 3a) Interactive JS shell (sets up hdc fport automatically, cleans it up on exit)
yarn xpanda gadget shell
#     commands: <js> | .info | .ping | .probe | .reset | .msg <json> | .help | .exit
#     multi-line blocks continue automatically; bare {"a":1} is retried as an expression
#     console.log / warn / error ... inside evaluated JS is streamed back to the shell

# 3b) Script watch mode: runs on start and again on every save (reconnects on the next save)
#     watch mode prints console.* output but not the script's return value; --once prints both
yarn xpanda gadget file script.js
yarn xpanda gadget file script.js --once        # run once and exit

# 3c) Or connect manually (forward hdc to the abstract socket)
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
| `start({ port? })` | Starts the socket (default name `xpanda_gadget_27041`) |
| `stop()` | Closes the socket and destroys the JSVM |
| `info()` | `{ pid, endpoint, running, js, version, uptimeMs }` |
| `send(value)` | Broadcasts `{"type":"msg","payload":<value>}` to every socket client |
| `poll()` | Pops one client message (`undefined` when empty) |
| `reset()` | Destroys the JSVM (recreated on the next evaluation, clearing all global state) |
| `executeJs(code)` | Evaluates JS in the gadget's JSVM and returns the result (throws on error) |

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
   JS thread through `napi_create_threadsafe_function` makes `CreateVM`/`CreateEnv`/`CompileScript`/
   `RunScript` work normally.
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
| `src/js/module/` | Modules injected into the gadget JSVM (`console`) |
| `src/socket/` | Abstract unix socket, accept/line reading, NDJSON protocol dispatch, inbox/broadcast |
| `build.sh` | Cross-compiles with `aarch64-unknown-linux-ohos-clang++` from `~/command-line-tools` |
| `CMakeLists.txt` | DevEco integration (copy into `<module>/src/main/cpp/`) |

All link dependencies are system libraries: `libace_napi.z.so`, `libjsvm.so`, `libhilog_ndk.z.so`
(libc++ is linked statically).

## TypeScript layout

| Path | Responsibility |
|---|---|
| `src/index.ts` | Public API barrel |
| `src/inject/` | `.abc` bootstrap injection: defaults/types, entry-class discovery, bootstrap source, `injectAbcBytes` |
| `src/hap/` | HAP repacking: CRC32 + minimal ZIP writer, abc-entry selection, `.so` embedding, `injectHapBytes` |
| `src/io.ts` | Node-only disk IO helpers for the CLI |

## Injection details (abc side)

- Entry class: explicit `--entry` > derived from module.json (mainElement/srcEntry) > any class in
  the abc with `func_main_0` (EntryAbility / pages/Index preferred).
- Bootstrap source (see `buildBootstrapSource`): `import gadget from "<soName>"; init()` with
  `try { gadget.start({port}) } catch` — a module-load failure does not break app startup.
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

Coverage: structural checks after abc injection (entry `func_main_0` calls init, the bootstrap
module record keeps the `@normalized:Y&&&...&` native module request), synthetic HAP injection
(abc written back + `.so` embedded + `module.json` byte-identical + ELF header checks), and aarch64
ELF checks for the prebuilt `.so`.

End-to-end (emulator/device): inject → re-sign → install → `aa start` → `hdc fport` → NDJSON client
(ping/info/js/msg/probe).
