# xpanda-asm

Load HarmonyOS `.abc` (Panda bytecode) files, modify or add entities and write them back.
Intended for static AOP, bytecode instrumentation, experimental toolchains, and similar scenarios.

## Usage

```ts
import { readFileSync, writeFileSync } from "fs";
import { PandaPatchFile, assemble } from "xpanda-asm";

const patchFile = PandaPatchFile.load(new Uint8Array(readFileSync("app.abc")));

// 1) replace a method implementation
const newCode = { numVregs: 3, numArgs: 2, instructions: Uint8Array.from([...]) };
patchFile.replaceMethodCode("L_GLOBAL;", "foo", newCode);

// 2) add a method (clones the proto/access flags of an existing one)
const { methodId } = patchFile.addMethod("L_GLOBAL;", {
    name: "patched_bar",
    template: "foo",
    code: newCode, // optional
});

// 3) add a string (usable by lda.str and other instructions)
const { id } = patchFile.addStringId("L_GLOBAL;", "patched literal");

// 4) insert assembled bytecode at any instruction boundary
//    (fixes relative jumps and try/catch start/length/handlerPC; the fragment may write argument registers directly)
patchFile.insertInstructions("L_GLOBAL;", "foo", 12, assemble("nop"));
patchFile.insertInstructions("L_GLOBAL;", "foo", 20, assemble(`
    ldai 1
    sta v7
`));

// 5) two-phase AOP: prepareMethodHead returns a random hook name; patchMethodHead then
//    compiles the hook (es2abc) → moves the hook (class + module record) into the target abc
//    → appends an import entry to the target module → inserts the function prologue
const hookName = patchFile.prepareMethodHead("L&entry/src/main/ets/target&;", "#*#target");
patchFile.patchMethodHead(hookName, `import { ohos } from "ohop";
function ${hookName}(self, args) {
    console.log("recorded this/arguments:", self, args, ohos);
    return {};
}`, {
    // es2abc: optional; by default located automatically as assets/bin/<os>/es2abc[.exe]
    // imports in the hook: bare module names are resolved by suffix against the target abc's
    // record names, or map them explicitly to a runtime-resolvable request string
    moduleRequests: { ohop: "@normalized:N&&&entry/src/main/ets/common/ohop&" },
});

// One hook on several functions: prepare several times with the same hookGlobalName,
// then patchMethodHeads compiles/moves once and inserts one by one
const multiHook = "aop_multi_hook";
patchFile.prepareMethodHead(className, "#*#targetA", { hookGlobalName: multiHook });
patchFile.prepareMethodHead(className, "#*#targetB", { hookGlobalName: multiHook });
const results = patchFile.patchMethodHeads(multiHook, `function ${multiHook}(self, args) { return {}; }`);

// Different hooks: prepare each (random name), then patch in order; earlier hooks are preserved
const firstHook = patchFile.prepareMethodHead(className, "#*#targetA");
const secondHook = patchFile.prepareMethodHead(className, "#*#targetB");
patchFile.patchMethodHead(firstHook, `function ${firstHook}(self, args) { return { res: 11 }; }`);
patchFile.patchMethodHead(secondHook, `function ${secondHook}(self, args) { return { res: 22 }; }`);

// Alternative: put several hook functions in one source file — one compile, one hook module is
// moved; each hook is imported and attached to its own target, and other top-level functions in
// the same file move along as helpers of that module (mutually exclusive with the example above)
const bundledA = patchFile.prepareMethodHead(className, "#*#targetA");
const bundledB = patchFile.prepareMethodHead(className, "#*#targetB");
patchFile.patchHookBundle([bundledA, bundledB], `
function sharedHelper(args) { return args[0]; }
function ${bundledA}(self, args) { return { res: sharedHelper(args) }; }
function ${bundledB}(self, args) { return {}; }
`);

writeFileSync("app.patched.abc", patchFile.toBytes());
```

## Exporting one or more classes into a new abc

`PandaPatchFile.dumpClasses()` (or the standalone `dumpClasses(data, names)`) copies the selected
classes plus the classes/methods they reference into a new, standalone single-region `.abc`. The
class index table, method/string/literal-array entity tables and prototype table are regenerated,
and type ids / method ids / literal-array references are remapped; the output reflects the latest
state of the current patch session.

```ts
const result = patchFile.dumpClasses(["L&entry/src/main/ets/common/AppLog&;"]);
writeFileSync("AppLog.abc", result.data);
console.log(result.classes, result.dependencies);
```

Limitations: classes with a bytecode-level superclass/interface table are not supported yet (ArkTS
merged abcs usually have 0), nor VALUE fields outside module metadata, nor field-id instructions;
an `Error` is thrown when encountered.

## AOP workflow

The target abc is produced by your own build pipeline (a plain es2abc-compiled abc or a merged
application package), then:

```ts
const patchFile = PandaPatchFile.loadFile("app.abc");

const hookName = patchFile.prepareMethodHead(className, methodName);
patchFile.patchMethodHead(hookName, `function ${hookName}(self, args) {
    console.log("recorded this/arguments:", self, args);
    return {};
}`);

writeFileSync("app.patched.abc", patchFile.toBytes());
```

`patchMethodHead` behavior (there is only one injection mode: **move the hook into the target abc
as an ES module**):

1. `prepareMethodHead(className, methodName)` validates the target (exists, not a generator; async
   is supported) and returns the hook name; the same hook name may be prepared once per method
   (pass the same `hookGlobalName` explicitly);
2. `patchMethodHead(hookName, hookSource)` (single target), `patchMethodHeads(...)` (one hook on
   several targets) or `patchHookBundle([hookA, hookB, ...], hookSource)` (several hook functions
   in one source file):
   - reads the target abc's bytecode version, maps it to es2abc's `--target-api-version`, and
     compiles the hook source with the **same version** into an abc with its own module record
     (12.0.2.0→12, 12.0.6.0→13, 13.0.1.0→18, 24.0.0.0→24; unknown versions are probed automatically);
   - moves the **whole hook class into the same region** of the target abc: class entity + methods +
     code + strings + literal arrays (including nested ones) + module record (import/export tables)
     are all relocated, and the class/method index tables are appended to the end of the file;
   - the entry function in the hook source is rewritten to `export function` automatically
     (already-exported / `export { name }` forms are kept as-is); `patchHookBundle` exports each
     hook in the list separately, and other top-level functions in the same source file are moved
     along with the module as helper functions;
   - a single hook's record name is `&xpanda/hook/<hookName>&`; a bundle moves one module whose
     record name is `&xpanda/hook/<first hook name>&`, and the target module gets one import entry
     per hook with the request string `@normalized:N&&&xpanda/hook/<record name>&`
     (`hookGlobalName` in the result is each `<hookName>`);
   - appends an import entry (pointing at the hook record) to the module record of the target
     class's module; with dynamic hooks, `setupClassName` can restrict the import to a specified
     entry class;
   - inserts the prologue `getunmappedargs → lda this → ldexternalmodulevar <import_idx> → callargs2
     → if (res.arg) write back argument registers → if (res.res) return res.res`;
   - the hook's own `import ... from "x"`: an explicit `moduleRequests` mapping wins; otherwise
     `@...`/relative paths are kept verbatim, and bare module names are resolved by unique suffix
     match against the target abc's record names (e.g. `ohop` → `@normalized:N&&&.../ohop&`);
     unmatched names are kept verbatim (the runtime or an explicit mapping is responsible);
3. when a method has no local registers the frame is **grown** automatically and all argument
   registers are shifted (jumps and try/catch are fixed up);
4. IC slots are allocated after the method's existing slots;
5. async methods are supported (see "Async function hooks" below): the prologue is inserted after
   `asyncfunctionenter; sta vCtx`, early returns use `...; asyncfunctionresolve vCtx; return` to
   resolve the Promise correctly; injected code sits inside the async catch-all try, so a hook
   throwing goes through `asyncfunctionreject`;
6. generator methods are not supported (the function head has different semantics on the
   create/resume paths).

Requirements:

- the import host class (the target class by default; with dynamic hooks, the entry class given by
  `setupClassName`) gets the import appended directly when it has a module record; without one
  (bundle-pack / unmerged abc) the class entity is **force-extended** with `isCommonjs` +
  `moduleRecordIdx` fields and an empty module record. Note: the presence of `moduleRecordIdx` makes
  the runtime load the whole abc as a merged abc; only use this for bundle-pack files when you are
  sure the loading mode still holds (safer: merge/recompile the target abc first);
- the proto index table of the hook host region (the target class, or the entry class when
  `setupClassName` is given) must be invalid (bytecode >= 12.0.1.0);
- the hook source must declare `function <hookName>(...)` (expression forms are not supported);
  every hook name in `patchHookBundle` needs a same-named function (when hooks live in a fixed
  file, use `prepareMethodHead(..., { hookGlobalName: "myHook" })` to align the file name with the
  hook name, then pass the contents of `readFileSync(...)` as `hookSource`);
- by default the target class and the hook class must land in the same index region (all target
  classes of a `patchHookBundle` must also share one region; the hook class is moved only once);
  with dynamic hooks and `setupClassName`, the hook class moves into the entry class's region and
  the target classes are no longer constrained;
- the import host's module must not contain namespace imports (appending a regular import shifts
  their environment indices);
- `localName` is the local name inside the target module record: when one class imports several
  hooks from a bundle they cannot share a custom name; by default it is derived from each hook name.

es2abc lookup order: explicit `{ es2abc }` → `XPANDA_ES2ABC` → repository
`assets/bin/<os>/es2abc[.exe]` → `PATH`.

> Why the whole module record is moved: `import` in the hook compiles to `ldexternalmodulevar`,
> which resolves against the import table of the **module record the current function belongs to**.
> Moving only the class would make the hook read the target module's import table (wrong values /
> out of bounds); moving the module record into the target abc and making the target module
> actually import that record lets the hook's imports and top-level variables be evaluated with
> module semantics.

## Hook return protocol

The hook signature is `hook(this, arguments)` and it returns an object that can rewrite arguments
and return early at the same time:

```ts
hook(this, arguments) -> { arg?: any[]; res?: any }
```

`this` is the target method's receiver (the instance for instance/component methods; `undefined`
for module-level functions).

| Return | Behavior |
|---|---|
| `{ arg: [...] }` | **Rewrite arguments**: written back to the target function's argument registers in order (equivalent to `[p0, p1] = arg`) |
| `{ res: value }` | **Intercept**: the target function returns `value` directly; the original body is not executed |
| `{ arg, res }` | Rewrite arguments first, then intercept |
| `{}` / `undefined` fields | **Pass through**: continue with the original function |

The injected prologue is equivalent to:

```js
const res = hook(this, arguments); // lda this → getunmappedargs → ldexternalmodulevar → callargs2
if (res.arg) {                 // ldobjbyname "arg" → callruntime.isfalse → jnez
    p0 = res.arg[0];           // ldai i → ldobjbyvalue → sta pN
    p1 = res.arg[1];
    // ... every parameter of the target
}
if (res.res) {                 // ldobjbyname "res" → callruntime.isfalse → jnez
    return res.res;            // (async: asyncfunctionresolve vCtx; return)
}
// otherwise fall through to the target's first instruction
```

Examples:

```ts
// record only, do not change behavior
function hook(self, args) {
    console.log("this:", self, "args:", args);
    return {};
}

// intercept: the target function returns 42 directly
function hook(self, args) {
    return { res: 42 };
}

// rewrite arguments: the target body runs with p0 = 10 / p1 = 20
function hook(self, args) {
    return { arg: [10, 20] };
}
```

Notes:

- hooks are called **synchronously** and must not return a `Promise`;
- the `arguments` the hook receives is a snapshot object from `getunmappedargs`: it has `length`
  and indices, but is not an Array instance (no `join` and other Array methods);
- `this` is the real receiver of the target function (the this register kept by `lda`); for
  module-level functions `this` is `undefined`;
- `arg` is read by array/array-like index (`res.arg[i]`), with no iterator destructuring; missing
  elements are written as `undefined`; every parameter of the target is overwritten (parameter
  count = `numArgs - 3`);
- `res.res` is tested by **truthiness** (`if (res.res)`), so returning `0` / `""` / `false` /
  `null` / `undefined` does not intercept (matching `if (res.res)` in source); to intercept falsy
  returns, change the protocol to `res.res !== undefined`;
- argument rewriting happens before the original body's first instruction, so default-parameter
  logic sees the new values.

## Dynamic hooks (GlobalPatch slots)

`{ dynamic: true }` replaces the hard-coded `ldexternalmodulevar` lookup in the method prologue
with `wide.ldpatchvar`. The slot is the VM-process-global `GlobalEnv.GlobalPatch` (`u16` index),
written by `wide.stpatchvar` and read by `wide.ldpatchvar`. Allocation starts at `0x1000` by
default to avoid the low slots used by the system hotfix compiler; the same hook name reuses the
same slot. A slot must stay within `0..0x7fff`: the on-device assembly interpreter passes this
immediate through as a signed 16-bit value, so `0x8000` and above are treated as a huge array
length and `stpatchvar` OOMs the process.

```ts
const hookName = patchFile.prepareMethodHead(className, methodName);
const result = patchFile.patchMethodHead(hookName, `function ${hookName}(self, args) {
    return {};
}`, { dynamic: true });

// result.patchSlot === 0x1000
// After module initialization any JS code can swap or disable the implementation:
//   globalThis[result.setterGlobalName](newFn);  // the name is xpanda_set_<hookName>
//   globalThis[result.setterGlobalName](undefined);
```

By default the setup is triggered by the **class owning the target method**: the target module
imports the hook module, guaranteeing the slot is written before the target method runs for the
first time. The setup can also be moved earlier to the HAP entry (e.g. `EntryAbility`), so the
target class is not involved and the slot is installed during app startup:

```ts
const result = patchFile.patchMethodHead(hookName, hookSource, {
    dynamic: true,
    // usually the hap entry class; only this class gets the hook import, and the hook class
    // moves into its region
    setupClassName: "L&entry/src/main/ets/entryability/EntryAbility&;",
});
```

With `setupClassName` specified, the target method's class **no longer gets the import appended**,
so target classes may be spread across index regions; the cost is that setup no longer follows the
target module's load — the entry module must finish evaluating before the hooked methods are called
(otherwise `wide.ldpatchvar` reads a `GlobalPatch` array that has not been expanded yet).

Extra bytecode after injection:

1. the hook module gains `export function <hookName>__set(fn)` whose body is replaced with
   `lda v3; wide.stpatchvar <slot>; returnundefined` (`numArgs` keeps the value es2abc produced,
   `numVregs` becomes 0);
2. the hook module ends with `xpanda_reserved_setup.xpanda_reserved_setup()` which installs every
   slot in the module: `ldlocalmodulevar` fetches the function → `wide.stpatchvar`, then
   `ldglobal; stobjbyname` puts the setter on `globalThis` (`trystglobalbyname` requires that name
   to already be a global binding, otherwise the runtime throws ReferenceError). By default the
   setup runs when the target module imports the hook module; with `setupClassName` the entry class
   imports it instead, so setup runs before the target methods (the entry module's evaluation order
   must satisfy this, see above);
3. the method prologue starts with `wide.ldpatchvar`. If the slot value is hole / `undefined` / any
   other falsy value the whole prologue is skipped and the original method runs as usual; otherwise
   it calls with the `{ arg, res }` protocol.

The decompiler renders these two instructions as `xpanda_reserved_patch[slot] = acc` /
`acc = xpanda_reserved_patch[slot]`. `xpanda_reserved_patch` is the runtime's `GlobalPatch` array;
when executing decompiled output in Node, provide an array under that name.

Limitations:

- the import host class (the target class by default, the entry class with `setupClassName`) must
  finish module initialization before the hooked method is called. The installation code runs
  during module initialization; executing `wide.ldpatchvar` while `GlobalPatch` is still an empty
  array is an out-of-bounds read;
- the table is per VM process. Unloading a system hotfix resets `GlobalPatch` to an empty array,
  and later loads are out-of-bounds again;
- the call site still has to be written into the abc. These two instructions cannot mount a hook on
  an unmodified method at runtime, nor replace the system's `ReplaceMethod`;
- the swapped-in function must follow the same `(self, args) -> { arg?, res? }` protocol;
- already-AOTed methods only execute the inserted bytecode after a reload or deopt, same as static
  hooks.

## Init callback

Like hooks, init is **a user-written function declaration**; xpanda only exports it and schedules
the call. The init function must be declared in the injected module source:

```ts
function init() {
    globalThis.__patched = true;
    console.log("xpanda init");
}
```

### Injecting init only (no method hooks)

```ts
const result = patchFile.patchInit(`
    function init() {
        globalThis.__patched = true;
    }
`, {
    // required: the entry class imports the init module and calls init from func_main_0
    setupClassName: "L&entry/src/main/ets/entryability/EntryAbility&;",
    // optional: function name, "init" by default
    // initName: "init",
});

// result.moduleName / result.initName / result.importIndex / result.codeOffset
```

What is injected: the module (function declarations + the imports/top-level variables it uses) is
moved into the entry class's region, the init function's import is appended to the entry module
record, and `ldexternalmodulevar <init>; callarg0` is inserted at the beginning of the entry
class's `func_main_0`. No hook, no GlobalPatch slot.

### hook + init

With hooks, the init function is written in the **same `hookSource`** as the hook functions and
selected via the `init` option:

```ts
const hookName = patchFile.prepareMethodHead(className, "#*#target");
patchFile.patchMethodHead(hookName, `
    function ${hookName}(self, args) { return {}; }

    function init() {
        globalThis.__hookInstalled = true;
    }
`, {
    dynamic: true,
    setupClassName: "L&entry/src/main/ets/entryability/EntryAbility&;",
    init: "init",   // must be a function declared in hookSource
});
```

- **dynamic**: the entry module imports the hook module first (running `xpanda_reserved_setup` to
  write slots), then `func_main_0` calls init — i.e. init runs **after setup**;
- **static**: the entry module imports the hook module directly and calls init from `func_main_0`;
- omitting `init`: no init import and no call are injected;
- specifying `init` **requires** `setupClassName` (the entry class), otherwise an error is raised;
- the init function is rewritten to `export function` like hook functions (already-exported forms
  are kept);
- static hooks may also use `setupClassName` together with `init`; without `init`, static hooks
  still do not allow that option;
- the entry class must have `func_main_0`; without a module record one is force-added by the rules
  above.

## Async function hooks

Usage is identical to synchronous functions (`prepareMethodHead` detects async automatically); no
extra options:

```ts
// target: export async function fetchUser(id: string) { ... }
const hookName = patchFile.prepareMethodHead(className, "#*#fetchUser");
patchFile.patchMethodHead(hookName, `function ${hookName}(self, args) {
    const id = args[0];
    if (id === "test") return { res: { name: "mock" } }; // await fetchUser("test") -> { name: "mock" }
    return {};                                           // continue with the original async function
}`);
```

Internal handling:

1. an async function head is `asyncfunctionenter; sta vCtx`; on await resume execution continues
   after `suspendgenerator` and **does not re-run the function head**; the prologue is inserted
   after `sta vCtx`, so it runs once per call;
2. temporary registers avoid `vCtx`;
3. early returns run `asyncfunctionresolve vCtx` before `return`, so `{ res: value }` returns
   `Promise.resolve(value)`;
4. injected code lives inside the async catch-all try; a hook throwing goes through
   `asyncfunctionreject`, i.e. a Promise rejection rather than a synchronous throw.

Limitations: the hook itself is synchronous and cannot `await`; async logic must be returned
synchronously. Generator functions are not supported (the function head has different semantics on
the create/resume paths).

## Implementation

append-only patcher:

- original bytes are untouched; new entities are appended to the end of the file (4-byte aligned);
- fixed-size pointers are rewritten in place (a method's CODE tag, class index table entries);
- entities whose length must change (class entities, for adding methods / moving hook classes) are
  copied to the end and the index tables referencing them are relocated;
- on write-back, `file_size` and the Adler32 checksum are updated.

## Current support (v0)

- ✅ Replace method code (`replaceMethodCode`)
- ✅ Add methods (`addMethod`, cloning an existing method's proto/access flags)
- ✅ Add strings / string ids (`addString` / `addStringId`)
- ✅ Insert assembled bytecode at any instruction boundary (`insertInstructions`): fixes relative
  jumps and try/catch ranges; fragments may write argument registers (`index >= numVregs`) without
  changing the frame layout
- ✅ AOP function-head hooks: `prepareMethodHead` + `patchMethodHead(s)` / `patchHookBundle`,
  supporting one hook on several functions, several hooks, several hooks in one source file, and
  async functions
- ✅ Dynamic hooks (`{ dynamic: true }`): the method prologue reads a GlobalPatch slot via
  `wide.ldpatchvar`, the hook module's `xpanda_reserved_setup` installs the initial function with
  `wide.stpatchvar`, and `globalThis.xpanda_set_<hook>` swaps it at runtime; `setupClassName` moves
  the setup import earlier to the hap entry class
- ✅ Init callback: call `patchInit(moduleSource, { setupClassName })` on its own (no method hooks),
  or pass `init: "<function name>"` to `patchMethodHead(s)` to write the init function in the same
  source as the hook functions; dynamic runs it after setup, static calls it directly from the
  entry class's `func_main_0`
- ✅ AOP hooks all go through module-record relocation: the hook class's import/export tables move
  with the class into the target abc, the target module gets an import entry, and the prologue
  calls it with `ldexternalmodulevar` (the hook's imports / top-level variables resolve normally)
- ✅ Multiple add-method / add-string / replace-code / insert operations in one session (the code
  model accumulates the latest version)
- ✅ Byte-exact round-trip when nothing is modified
- ✅ Verified on bytecode 11.0.2.0 / 12.0.2.0 / 13.0.1.0 / 24.0.0.0 (merged abc)
- ✅ Output re-parses through the xpanda decompiler and es2abc (`--enable-abc-input`)

Limitations:

- ⏳ Adding arbitrary classes / protos / literal arrays (only AOP hook-class movement supports
  class/literal-array imports so far)
- ⚠️ Hook-class movement requires the target proto index table to be invalid (>= 12.0.1.0) and the
  class to have no superclass/interfaces; targets without a module record get module fields
  force-added (bundle-pack files will then be loaded by the runtime with merged semantics)
- ⚠️ Hook module imports must resolve in the target abc's runtime (bare module names go through
  record-name suffix matching, or explicit `moduleRequests`)
- ⚠️ Replacing/inserting code keeps the original debug info (line numbers may be stale, execution
  is unaffected)
- ⚠️ Inserted instructions really execute: if a fragment rewrites `acc`/registers, it must preserve
  the register state needed by the following code
- ⚠️ Relative jumps inside an inserted fragment may only target the fragment itself (or its end);
  jumps into existing instructions must be recomputed by hand and are currently rejected
- ⚠️ After `addMethod` the new method does not appear in `getMethodNames()` / `getMethodCode()`;
  reload with `PandaPatchFile.load(toBytes())`
- ⚠️ Files with multiple index sections only allow `addMethod` for classes in the last region;
  other regions throw
- ⚠️ Entity locating relies on xpanda-core's read-only parser; class/method entities with
  annotation tags are not supported yet

## Assembler (xpanda-asm)

`src/Assembler.ts` in this library is driven by the operand layouts generated from `xpanda-core`'s
`gen-opcodes.ts`:

```ts
import { assemble, assembleInstruction, decodeInstructions } from "xpanda-asm";

assemble("nop");                                  // -> Uint8Array [0xd5]
assemble("ldai 1");                               // immediate
assemble(`
  ldai 1
  sta v0
`);                                               // multiple instructions
assembleInstruction("mov", [0, 1]);               // 0x44 0x10 (smallest variant chosen automatically)
assembleInstruction("mov", [0, 1], { format: "V8_V8" });
decodeInstructions(bytes);                        // structured decode (used for jump fixups when inserting)
```

The assembler round-trips every instruction of the md5/class/aes samples byte-for-byte through
decode → reassemble.

## Tests

```bash
yarn workspace xpanda-asm test
```
