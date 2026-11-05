# Lexical Environments in `.abc` and in xpanda

This note records how ArkCompiler's lexical environments actually behave, how
xpanda currently models them, and where the model diverges from the runtime.
It is the reference to consult before changing `PandaLexical`, the `newLexEnv` /
`popLexEnv` handlers, or any `local_*` / `sendable_*` cleanup pass.

Runtime references:

- `reference/arkcompiler_ets_runtime/ecmascript/lexical_env.h`
- `reference/arkcompiler_ets_runtime/ecmascript/interpreter/interpreter-inl.cpp`
- `reference/arkcompiler_ets_runtime/ecmascript/stubs/runtime_stubs.cpp`
- `reference/arkcompiler_ets_runtime/ecmascript/object_factory-inl.h`

## 1. Runtime data structures

A `LexicalEnv` is a tagged array:

- `PARENT_ENV_INDEX = 1` stores the parent environment (`lexical_env.h:25`).
- `SCOPE_INFO_INDEX = 2` stores debug/scope information.
- `RESERVED_ENV_LENGTH = 3`; user slots start at `index + 3`
  (`GetProperties` / `SetProperties`, `lexical_env.h:50-57`).
- The environment has exactly `numSlots` user slots. `ComputeSize(numSlots)`
  adds only the three reserved fields (`lexical_env.h:35-38`), and
  `ObjectFactory::NewLexicalEnv(numSlots)` allocates exactly that many slots
  (`object_factory-inl.h:146`).

There is no "grow on demand" and no aliasing between environments: a slot
number is only valid inside the environment it was allocated for.

A `SendableEnv` is a *separate* chain rooted at the module record, not in the
frame environment chain. `callruntime.newsendableenv` installs it on the module
record (`interpreter-inl.cpp:7796-7820`), and
`callruntime.ld/stsendablevar` hop its parent chain independently
(`interpreter-inl.cpp:7822-7890`). Regular `ldlexvar` never sees it.

## 2. Instruction semantics

### `newlexenv imm8 / wide.newlexenv imm16`

`interpreter-inl.cpp:4589-4617`:

```
let env = allocate(numVars);       // exactly numVars slots
env.parent = frame.env;
frame.env = env;
acc = env;
```

The frame's previous environment becomes the parent. The instruction does not
create a JavaScript block by itself; it just pushes a runtime environment.

`newlexenvwithname imm8, id16` (`interpreter-inl.cpp:4619-4646`) does the same
and additionally records a scope id for debug information. The scope id has no
effect on slot numbering.

### `poplexenv` / `deprecated.poplexenv`

`interpreter-inl.cpp:4654-4667`:

```
frame.env = frame.env.parent;
```

The popped environment object itself may still be referenced by closures that
captured it; it just stops being the current frame environment.

### `ldlexvar level, slot` / `stlexvar level, slot`

`interpreter-inl.cpp:6073-6214`:

```
env = frame.env;
for (i = 0; i < level; i++) env = env.parent;
value = env.slots[slot];           // stlexvar writes it
```

- `level = 0` is the environment currently installed in the frame.
- `level = n` is the n-th parent, **counting every runtime environment**,
  including environments created for classes, functions and blocks.
- `slot` is an index into that exact environment. It must be smaller than the
  `numVars` passed to the `newlexenv` that created it. Reading `level = 1,
  slot = 5` means "slot 5 of my immediate parent environment"; it never means
  "slot 5 of some outer environment" when the immediate parent is smaller.

### Function entry and closure capture

The interpreter initializes a call frame's environment from the callee
function's captured lexical environment:

```
state->env = thisFunc->GetLexicalEnv(thread);   // interpreter-inl.cpp:777
```

`definefunc` and `defineclasswithbuffer` capture the *current* frame
environment (`interpreter-inl.cpp:5151, 5174, 5197, 5219`). Class methods
therefore receive the environment stack at the point where the class was
defined, including the class's own environment when one was pushed with
`newlexenv` around the class definition.

Sendable functions and sendable classes are the exception. `RuntimeDefinefunc`
branches on `methodHandle->IsSendableMethod()`: the sendable branch creates the
function with the module's sendable env and sets its lexical env to
`emptySFunctionEnv` (`runtime_stubs-inl.h`). `RuntimeCreateSharedClass` takes no
lexical-env argument; `SendableClassDefiner::DefineSendableClassFromExtractor`
builds a fresh `SFunctionEnv`, stores the constructor in it, and
`CreateSFunctionFromTemplate` does the same for every instance and static method
(`class_info_extractor.cpp`). An `SFunctionEnv` is not a `LexicalEnv`
(`lexical_env.h`), so the defining frame's regular environment chain is not
reachable from a sendable method. `ldsendablevar` / `stsendablevar` still work:
the sendable module chain is copied through the module record at define time.

### `callruntime.ldsendableclass level`

`CALLRUNTIME_LDSENDABLECLASS` starts at `frame.env`, hops `level` parents that
must all be `LexicalEnv`s, then requires the landing object to be an
`SFunctionEnv` and returns its constructor (`interpreter-inl.cpp:7747`,
`RuntimeLdSendableClass` in `runtime_stubs-inl.h`). `level` is the number of
regular environments between the current frame environment and the sendable
function's `SFunctionEnv`, not a slot index and not "the nearest class in the
source text".

### Async functions and generators

`suspendgenerator` saves the whole frame, including the current lexical
environment, into a `GeneratorContext`:

```
context->SetLexicalEnv(thread, thread->GetCurrentLexenv());
```

(`runtime_stubs.cpp:3985`, called from `RuntimeSuspendGenerator`,
`runtime_stubs-inl.h:1342-1377`).

When execution resumes, `GeneratorReEnterInterpreter` starts at the saved
bytecode offset with the saved environment
(`interpreter-inl.cpp:808-880`, `state->env = context->GetLexicalEnv(thread)`).
It does **not** re-run the function prologue and does not rebuild the
environment chain.

Consequences for decompilation:

- A forward CFG walk from the method entry is only valid until the first
  suspension.
- The environment at a resume label is the environment at the matching
  `suspendgenerator`, not the environment the prologue would have at that PC.
- `poplexenv` instructions still execute on every path that reaches them; an
  async function does not make `poplexenv` a no-op.

## 3. What xpanda currently does

### 3.1 Environment analysis (`PandaLexical`)

`PandaLexical.analyzeWithPandaMethod` runs a forward dataflow over the CFG:

- Each method starts with the `inheritedStack` captured at its definition
  point (for ordinary class methods this includes the module and class
  environments).
- Methods of a sendable class start from an `sfunction` marker plus the
  inherited *sendable* chain: their regular chain starts at depth 0 because the
  defining frame's regular environments are not reachable from `SFunctionEnv`.
- `newLexEnv` pushes a `LexEnvInfo { name, kind }`.
- `popLexEnv` removes the top regular environment unless the stack is already
  at the method's entry level (`startLevel`), and records the popped
  environment's name for the AST pass.
- `loadLex` / `storeLex` resolve `level` by walking the regular or sendable
  chain and record the target environment's `name`; the emitted identifier is
  `name + "_" + slot`. No out-of-range fallback is applied: a slot is only
  valid inside the environment the `level` points at.
- `callruntime.ldsendableclass` resolves `level` against the regular chain. It
  names the class only when the hop lands exactly on the method's `sfunction`
  marker; otherwise the marker is left for the post-structure fallback (the
  nearest AST class). The immediate is no longer discarded.

Environment names are generated per method with a counter
(`local_<depth>`, `local_<depth>_<instance>`), so two environments created by
different `newlexenv` instructions in one method get different names.

Remaining deviations:

1. Exception-handler blocks still ignore `poplexenv`. A handler is seeded with
   the stack at the try start, but the runtime enters it with the stack at the
   throw point, which may contain environments pushed inside the protected
   range that the seed does not know about. Ignoring the handler's own pop is
   the conservative fallback until handler stacks are seeded from the throw
   point (or from the union of possible throw states).
2. Resume points after `suspendgenerator` are not seeded from the saved
   environment yet. The forward walk models the prologue path; a method whose
   bytecode is resumed at a label whose environment was saved by
   `suspendgenerator` can still get a wrong `level`/`slot` there. This has not
   been observed in the current samples after the async-tail pop fix, but it is
   a known limitation of the model, not a semantic guarantee.

The previous `ignorePop` shortcut for blocks containing `asyncfunctionresolve`
and a terminating `return` has been removed. It was wrong for normal tails:
`amcl1.0.6.abc` `L&entry/src/main/ets/r2/f5&;` `#~@2<#importResourceFiles`
PC 1435 has `poplexenv`, then PC 1538 has `ldlexvar level=1 slot=5`. With the
pop ignored the stack was `[module, class, method]`, so `level=1` named the
class environment (one slot, 0) and the output contained an undeclared
`local_1_5`. With the pop applied the stack is `[module, class]`, `level=1`
names the module environment, and the read is module slot 5 (`local_0_5`),
which matches the bytecode.
3. `startLevel` prevents popping below the method's inherited environment
   depth. This matches the usual "a function cannot pop its closure
   environment" rule, but it is an assumption, not something checked against
   the bytecode. If a method's bytecode legitimately pops into an inherited
   environment (for example a synthesized async entry), the guard hides it.

### 3.2 Environment naming and closures

Names are generated per method. The same runtime environment therefore gets
one name in the function that creates it and a different name in a nested
function that captures it only if the nested function recomputes the name from
its own depth. Closures that are analyzed with the inherited stack keep the
parent's `LexEnvInfo.name`, so their references are consistent. A nested
function that is analyzed independently (or after a resume) can disagree with
the defining function; this is why names must be tied to environment identity,
not recomputed from a depth number.

### 3.3 AST emission

`MethodHandler` lowers the instructions as follows:

- `newlexenv` emits
  `panda_jmp0_reserved_lex_begin_<environment>;` and `let local_...;` into the
  current AST node. The marker is tagged with the environment instance name.
- `poplexenv` calls `NodeUtils.covert2SingleBlock(node, poppedEnvironment)`:
  it finds the marker of the environment that was actually popped and moves
  the statements after it into a new `BlockStatement`, so the JavaScript block
  approximately represents that environment's lifetime.
- `ldlexvar` / `stlexvar` become reads/writes of the generated name, and
  `ldsendableclass` becomes the resolved class binding when `level` lands on
  the sendable `SFunctionEnv`.

Problems with this approximation:

- When the popped environment's marker is not in the current statement list
  (the pop was structured into a branch or nested block, or an exception
  handler seed cannot name it), `covert2SingleBlock` falls back to closing the
  last marker in the list to preserve the historical block shape. Generated
  names are unique per instance, so the post-pass scope normalization keeps
  this safe, but the block boundary is then only approximate.
- A `newlexenv` inside a condition-test region is decompiled into a
  `SequenceExpression`. `NodeUtils.insertNodeToBody` has no statement slot
  there, so a `let local_...;` declaration used to be dropped silently while
  its assignments and reads survived (the `amcl z12` `z421` case:
  `local_1_0 = p1` with no declaration). `MethodHandler.insertStatement` now
  hoists such declarations into the owning function body; an initializer is
  kept in the sequence as an assignment so its evaluation order is unchanged.
- A JavaScript block is a static lexical scope, while an environment can be
  pushed on one branch and popped on another. A single declaration site
  cannot always represent the runtime scope exactly. Generated names are
  unique per environment instance, so widening a declaration to the common
  ancestor block is semantically safe; narrowing or sharing one name between
  two different environment instances is not.
  `normalizeLexicalSlotScopes`
  (`decompiler/post-pass/NormalizeLexicalSlotScopes.ts`, part of the
  post-structure pass pipeline in
  `decompiler/post-pass/PostProcessPass.ts`) does this only when a reference
  lies outside the declaration's block.
- Per-iteration loop environments are deliberately handled later by
  `LoopEnvSimplify`: it recognizes the compiler's environment rotation at the
  latch and moves the base declaration into the loop scope. Any pass that
  hoists all `local_*` declarations to the function body unconditionally
  defeats that restoration and makes closures observe the last iteration's
  values. `normalizeLexicalSlotScopes` therefore only moves a declaration when
  a reference really is outside its block; a declaration used only inside the
  loop body stays there.

### 3.4 Binding cleanup

`TempVariableSimplify.removeUnusedDeclarations` and
`removeUnusedLexicalDeclarations` delete declarations based on Babel bindings
and current-AST occurrence counts. Babel `referencePaths` are stale after
structural rewrites (nodes are moved, cloned or replaced), so cleanup must
check the current AST, not only the binding lists. A declaration must never be
removed while an identifier with the same name is still present in the
function subtree.

Capture detection must also look at class field initializers and static
blocks. They have no function parent, so a reference moved from a static
initializer function into `static minLevel = local_0_0` looks "uncaptured" to
`getFunctionParent()`-only checks; that was the `yourpipe` `AppLogStore`
deletion. `isCapturedBinding` now treats references in `ClassProperty` values
and static blocks as captured, while class headers (`extends v0`, decorators,
keys) do not count — counting those would block module-level class folding.

## 4. Model implemented now, and remaining work

1. **Runtime stack simulation (implemented).**
   - `newlexenv`: push the environment; the runtime parent is the frame
     environment at that PC.
   - `poplexenv`: pop one regular environment on normal paths. It is only
     ignored for exception-handler blocks, whose entry stack cannot be known
     from the try start alone.
   - `ld/stlexvar`: hop `level` parents and index `slot`; no out-of-range
     redirect to another environment.

2. **Resume points from suspend states (remaining).**
   - Pair every `suspendgenerator` with the resume dispatch labels that
     continue after it (via `resumegenerator` / `getresumemode`).
   - Use the environment stack at the suspend PC as the entry stack of the
     resumed PC.
   - Until this is implemented, a resume label that relies on a saved
     environment can still resolve a level/slot against the prologue stack.
     The normal async tails (including the `f5` case) are already correct.

3. **Stable environment identity (partially implemented).**
   - The identity is the `newlexenv` instruction plus the inherited chain, not
     the slot prefix string.
   - A nested function that captures an outer environment reuses the defining
     function's `LexEnvInfo` name because the analysis passes the inherited
     stack; a nested function's own `newlexenv` gets a new name.
   - Names only need to be unique within one function's output; the same name
     may be reused by sibling functions.

4. **Declarations for the environment lifetime (implemented as a fallback).**
   - `newlexenv` declarations are emitted where the instruction is structured;
     `normalizeLexicalSlotScopes` moves a declaration to the common ancestor
     block of all its references when a reference is outside the declaration
     block. Generated names are unique per instance, so this does not capture
     unrelated variables, and per-iteration declarations stay in their loop
     body for `LoopEnvSimplify`.
   - Markers are now tagged with the environment identity and `poplexenv`
     closes the matching marker. The last-marker fallback remains only for pops
     whose marker is not in the current statement list, because the structured
     block shape does not always match the runtime environment lifetime.

5. **Never drop a statement silently (implemented).**
   - `MethodHandler.insertStatement` hoists a `VariableDeclaration` that is
     written into a `SequenceExpression` to the owning function body and keeps
     its initializer in the sequence as an assignment, preserving evaluation
     order.

6. **Sendable function/class entry and `ldsendableclass` (implemented).**
   - Methods of a `callruntime.definesendableclass` class are analyzed with a
     fresh `SFunctionEnv` marker at the bottom of their regular chain; the
     inherited regular environment names are not visible to them.
   - `ldsendableclass level` is resolved by hopping the regular chain and
     reading the class name recorded on that `SFunctionEnv`. The immediate is
     no longer discarded.

7. **Deprecated lexical opcodes (implemented).**
   - `deprecated.poplexenv` pops like `poplexenv`.
   - `deprecated.stlexvar` stores its vreg operand (not `acc`) into the
     resolved slot.

## 5. Verification checklist

- `yarn test` (core snapshots, cli parallel consistency, mcp, asm).
- Decompile `amcl1.0.6.abc` with `-j 6` and scan every output file for
  generated identifiers (`local_*`, `sendable_*`) without a binding.
- Regression classes:
  - `amcl` `L&gamecontrol/src/main/ets/z12&1.0.0;` `z421` — declaration
    dropped by a condition-test `SequenceExpression`.
  - `amcl` `L&launch/src/main/ets/i15&1.0.0;` `downloadGiteeParallel` —
    environment block closed before later reads.
  - `amcl` `L&entry/src/main/ets/r2/f5&;` `importResourceFiles` — async tail
    `poplexenv` ignored, `level` shifted by one.
  - `amcl` `L&entry/src/main/ets/e4/k9&;` / `r5/s5&;` /
    `L&mods/src/main/ets/l17&1.0.0;` — declarations referenced from an outer
    scope.
  - `zhihu` `ContentFilterRuntimeStore.loadSnapshot` — per-iteration
    environment must stay inside the loop.
  - `yourpipe0.7.0.abc` `AppLogStore` — generated slot used in a nested
    function.
  - `install1.3.0.abc` `SendableStandardMessageCodec` — `ldsendableclass`
    levels 0/1 resolve to the class; `BackgroundBasicMessageChannel` —
    `IncomingSendableMessageHandler.onMessage` starts its regular environment
    at depth 0 (`local_0_*`), independent of the module-level `local_0_0`.
- Decompile `lnga1.2.6.abc`, `hx360e1.0.2.abc`, `yourpipe0.7.0.abc` and the
  zhihu HAP; scan for unbound generated identifiers.
