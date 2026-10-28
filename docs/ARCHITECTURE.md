# xpanda Architecture

> English | [简体中文](./ARCHITECTURE.zh-CN.md)

A decompiler for HarmonyOS `.abc` (Panda / ArkCompiler bytecode), implemented in pure TypeScript (Node.js ≥ 18, zero native dependencies). Bytecode version **24.0.0.0** is described by the ISA table; output is verified against samples down to **13.0.1.0**, and ArkTS 12 packages (`12.0.2.0`) decompile as well.

It takes `.abc` bytecode (or a `.hap` application package) as input and produces readable JavaScript source. A built-in AST optimizer cleans up register temporaries, restores function/class/control-flow syntax, and rebuilds module (import/export) syntax.

> Path convention: this repo is an npm-workspaces monorepo. Unless noted otherwise, `src/`, `scripts/`, `resources/` and `test/` in this document are relative to `packages/xpanda-core/`; the CLI lives in `packages/xpanda-cli/` and the MCP server in `packages/xpanda-mcp/`.

## 1. Overview

```text
.abc file (or .hap → ZipFile → .abc entries)
   │
   ▼
┌──────────────────── Decompilation pipeline (src/) ────────────────────┐
│ PandaFile        parse header / index regions / classes / literals    │
│                  (Adler32 checksum, offset cache)                     │
│   → PandaLexical       disassemble + lexical env stacks + register    │
│                        type inference (per class, lazy per method)    │
│   → PandaDecompiler.decompileRaw                                      │
│       → MethodHandler      instruction → Babel AST nodes              │
│       → StructureAnalysis  region reduction → if/while/try tree       │
│           (falls back to SimpleAnalysis: linear output + goto/label)  │
│   → SimplifyExport     optimizer pipeline (fixed-point iteration)     │
│   → NodeFactory.generate  AST → JavaScript text                       │
└───────────────────────────────────────────────────────────────────────┘
   │
   ▼
JavaScript source (files on disk / stdout / library API)
```

The main thread always performs parsing, disassembly, lexical analysis, and AST construction; only the *simplify* stage may be offloaded to worker threads (see §10).

## 2. Repository Layout

| Path | Responsibility |
|---|---|
| `src/codec/` | Leb128 / MUTF8 / Adler32 codecs |
| `src/file/` | `.abc` file format parsing |
| `src/hap/` | HAP application package adapter: read-only ZIP (`ZipFile.ts`) + `.abc` entries / `module.json` / `resources.index` (`HapFile.ts`) |
| `src/res/` | `resources.index` parsing (Restool & RestoolV2 formats) into queryable resource items |
| `src/disasm/` | Disassembly: generated opcode table, unified instruction model, CFG, lexical analysis |
| `src/decompiler/` | Structure analysis (region reduction), statement tree, instruction handlers, dominator graph, reaching-definition value analysis, fallback analysis, try/finally restoration; `ExceptionTable.ts` classifies every try-table entry (user catch / ignored / empty-join / finally epilogue / protocol glue) and drives the CFG exception edges |
| `src/ast/` | Babel AST construction & text generation (`NodeFactory` / `NodeUtils` / `FormatCode`) |
| `src/simplify/` | Optimizer pipeline |
| `src/parallel/` *(moved to xpanda-cli)* | Per-class parallel simplify worker pool (worker_threads / os — Node-only, lives in `packages/xpanda-cli/src/parallel/`) |
| `packages/xpanda-mcp/src/` | MCP server exposing the decompiler to AI agents (see [MCP.md](./MCP.md)) |
| `packages/xpanda-web/src/` | Browser UI (React + Vite, pure frontend) decompiling in the browser (see §13) |
| `src/PandaDecompiler.ts` | Public entry point (per-class orchestration) |
| `packages/xpanda-cli/src/cli.ts` | CLI entry: `decompile` and `unpack-index` commands |
| `scripts/gen-opcodes.ts` | Generates `src/disasm/opcodes.ts` from `resources/isa.yaml` |
| `resources/isa.yaml` | ArkCompiler instruction set description (v24.0.0.0) |
| `test/` | Integration tests, samples (`*.abc`, `*.hap`), snapshots (`test/expected/*.js`) |

Dependency direction: `cli / PandaDecompiler → decompiler → disasm → file → codec`; `decompiler → ast`; `SimplifyExport → simplify`; `parallel → PandaDecompiler / file`; `mcp / hap → res`; `web → PandaDecompiler / hap`.

## 3. File Format Layer — `src/file/`

### 3.1 Parse flow (`PandaFile.ts`)

1. **Header** (`desc/Header.ts`): magic `PANDA\0\0\0` (8 bytes), 60-byte header with version, file size, foreign class offset/size, class index offset, lnp info, literal arrays, and index section offset.
2. **Checksum**: Adler32 over bytes `[12, len)`, masked with `0x0fffffff`, compared against `header.checksum`. Mismatch throws `PandaParseException` ("may be encrypted").
3. **lnp offset table**: `numLnps` × 4-byte entries wrapped in `Offset` objects.
4. **Index regions** (`desc/IndexHeader.ts`, "RegionHeader"): `numIndexes` × 40-byte headers, each holding start/end offsets and class/method/field/proto index (size + offset). From bytecode **12.0.1.0** the field/proto indexes are invalidated with `0xffffffff` (both become `null`). Also hosts the module-literal set used to mark module-record literal arrays.
5. **Foreign classes**: sequential walk of the foreign class area; each `PandaClass` records the bytes consumed so it can advance.

All parse products are cached in `PandaFile.offsets` (a `Map<number, unknown>`) via static `create(pandaFile, offset, …)` factories — the same offset always returns the same object instance.

**Offset quirks**: 32-bit values are read as little-endian int32; `-1` means `0xffffffff`, everything else is masked to 28 bits (`& 0x0fffffff`). Leb128 decoding keeps Java `int` semantics (32-bit signed shifts, `count < 5` cap). Note: the resource layer deliberately does **not** reuse the 28-bit mask (resource IDs can reach `0x0300002E`).

### 3.2 Entities

- `clazz/PandaClass.ts`: name, super class, access flags, fields, methods, and module metadata. Resolution is lazy (`resolve()` guarded by a flag): interface/source-lang tags, fields, methods. Annotation data structures **throw** (not needed). A field named `moduleRecordIdx` triggers `PandaClassModuleData` creation.
  - Module metadata: module paths (`@bundle:` / `@module:` / `@package:` / `@native:` / `@ohos:` / `@hms:` / `@app:` / `@normalized:` prefixes), imports (NAMESPACE / DEFAULT / SPECIFIER / SAME_SPECIFIER), exports (LOCAL / INDIRECT / ALL). The synthetic local name `"*default*"` is renamed to `panda_jmp0_reserved_export_default`.
- `method/PandaMethod.ts`: tag walk (CODE / SOURCE_LANG / DEBUG_INFO / ANNOTATION), external methods stop after the access flag. `disAssemble()` lazily requires `PandaDisAssembler` to break a circular import. `PandaMethodCode` holds numVregs / numArgs / codeSize / try blocks + raw instruction bytes.
- `literal/PandaLiteralArray.ts` / `PandaLiteral.ts`: literal arrays (`u32 count` + tag/value pairs). The real pair count is `⌊count / 2⌋`; each tag defines its value width (4B for STRING/METHOD/INTEGER…, 8B for DOUBLE, 1B for BOOL/ACCESSOR/NULLVALUE…, 2B for METHODAFFILIATE). Any `ARRAY_*` tag terminates the loop early. Unknown tags throw.
- `desc/PandaString.ts`: MUTF-8 strings — leb128 `utf16Size` where bit 0 doubles as an ASCII flag (`isAscii = (utf16Size & 1) === 1`, byte size = `utf16Size >> 1`), NUL-terminated content.
- `field/PandaField.ts`, `desc/PandaProto.ts`, `type/PandaType.ts`: field/static-value and shorty/proto resolution.

## 4. Container & Resource Layer — `src/hap/` + `src/res/`

- `hap/ZipFile.ts`: minimal **read-only** ZIP reader. Locates the EOCD from the tail, walks the central directory, rejects encrypted entries, supports **store** and **deflate** (via the pure-JS `fflate` `inflateSync`, so the reader runs in Node and browsers alike). No ZIP64, no per-entry cache. `ZipFile.isZip(data)` sniffs the PK signatures — the CLI routes any ZIP container to the HAP flow.
- `hap/HapFile.ts`: wraps a `ZipFile`; exposes `getAbcEntries()` (non-directory `*.abc` entries in archive order), `getModuleJson()` (parsed or `null`), `getResourcesIndexData()` (raw bytes), and `getResourceEntries()` (entries under `resources/`).
- `res/ResourceIndexFile.ts`: parses `resources.index` in **both** formats. The header starts with a 128-byte version string; `"Restool …"` selects the legacy layout, anything else (e.g. `"RestoolV2 …"`) the new three-segment layout (KEYS / IDSS / DATA + string pool). Produces `items: ResourceItem[]` — one item per (resource × qualifier config).
- `res/ResourceItem.ts`: name, numeric id, resource type, qualifier key params, raw data, `limitKey` (qualifier directory name such as `base` / `en_US` / `dark`), `value` (string, or `string[]` for plural/string-array), and `typeName`.
- `res/ResourceUtils.ts` / `res/ResourceEnums.ts`: little-endian reads (u32 unmasked — see §3.1), NUL-trimmed UTF-8 helpers, qualifier value formatting, and the resource key/type enums.

## 5. Codec Layer — `src/codec/`

- `Leb128.ts`: stateful decoder with Java `int` semantics — 32-bit signed shifts, 5-byte cap, `-1` results exposed as unsigned `0xffffffff`; also static signed/unsigned writers.
- `MUTF8.ts`: decoder stops at NUL; validates 2-/3-byte forms; encoder covers the BMP subset actually produced by ArkTS.
- `Adler32.ts`: textbook mod-65521 implementation (`(s2 << 16) | s1`).

## 6. Disassembly Layer — `src/disasm/`

### 6.1 Opcode table (`opcodes.ts`) — generated, do not edit

Generated by `scripts/gen-opcodes.ts` from `resources/isa.yaml` (`npm run gen:opcodes`). Contains `BYTECODE_VERSION`, per-opcode flags (`OPCODE_FLAG`, e.g. JUMP / CONDITIONAL / TYPE_ID / ACC_READ / ACC_WRITE), format parameter sizes, and lookup maps (`OPCODES`, `OPCODE_BY_CODE`). The last instruction code is **251**; prefix instructions are encoded as `(idx << 8) | prefixByte`, so a first byte `>= 251` starts a 2-byte opcode.

### 6.2 Unified instruction model (`PandaInstruction.ts`)

One instruction class instead of ~200 per-opcode subclasses. Every instruction carries:

- `kind` — a semantic label (~50 kinds: `mov`, `load`, `call`, `jumpEqual`, …) derived from `KIND_MAP` (opcode name → kind) and opcode flags (`classifyKind`: JUMP-flagged opcodes map to `jumpDirect` / `jumpEqual` (jeqz) / `jumpNotEqual` (jnez), everything else becomes `jumpPlain`; unmapped names fall back to `unknown`).
- Parameters parsed by the format name (`IMM8_V8`, …): IMM4/V4 nibble packing, IMM64 read as float64, and ID parameters resolved by opcode flags into String / Method / LiteralArray / Type / Field references.
- Semantic fields per kind — e.g. calls expose `thisObj` / `callParams`; `defineClassWithBuffer` parses its literal array into method descriptions (including the sendable-class variant).
- Jump destination: `destinationPC = pc + signed imm` (the last immediate parameter). `ldai` and jump offsets are signed; all other immediates are unsigned.
- Register parameters: an index `>= numVregs` is a parameter (`p0..pN-3`); the first three slots are `func` / `new.target` / `this` and are printed as reserved names `panda_jmp0_reserved_param_pN`.

**Degradation trigger**: the `jeq` / `jne` / `jstricteq` / `jnstricteq` family (unconditional-jump encodings without a `z` suffix) throw at construction. Methods containing them are skipped during lexical analysis and later emitted as placeholder bodies.

**ArkTS 12 field definitions**: bytecode `12.0.2.0` defines class fields with `definefieldbyname imm, string_id, v` (later toolchains dropped it in favour of `definefieldname`). It is mapped to the `storeObject` kind, so `static_initializer` / ArkUI state fields are emitted as `obj.field = acc` like `definepropertybyname` — without the mapping every class that declares a field throws `definefieldbyname not handled!` and the whole class is lost.

### 6.3 CFG construction (`PandaDisAssembler.ts`, `ir.ts`)

A single pass over the instruction bytes produces terminator-delimited `PandaIRBasicBlock`s (entry block named `entry`, others `label_<pc>`), which feed a `PandaIRCFG` (a `ValueGraph` of blocks). Two normalizing passes then run: `runSplitJumpPass` (split blocks at jump targets that fall mid-block) and `runSplitTryCatchPass` (split at try start/end and handler boundaries; it no longer tags blocks with catch entries — ownership is expressed by graph edges). Finally the graph is rebuilt with canonical edge values.

**Edge semantics**: three kinds — `true` = jump-taken direction, `false` = sequential/fallthrough, `exception` = try-table edge from a protected block to its handler. `successors()` / degrees return the union (an `(a,b)` pair may be both a normal and an exception edge, and the two never overwrite each other); structural polarity decisions use `normalSuccessors()` / `edgeValueOrThrow`, never `successors()` order.

**Handler classification** (`ExceptionTable.ts`, lazily via `PandaIRCFG.getExceptionTable()`): every try-table entry is classified from the handler's instructions — user `catch`, ignored-exception catch, empty-join catch, inlined-finally epilogue, classic hole-sentinel finally, pure rethrow bridge, for-in acquisition, for-of close, async reject dispatch, generator resume arm, or no protected range. Classification is **shape-based and version-independent**: current `es2abc` writes `codeSize === 0` for real catches on 13.0.1.0 as well as 24.0.0.0, so there is no "new handler encoding" version switch. The classifier also decides the protected-range cut (`protectedEndPC`) and is the single source of truth for `RegionGraphBuilder`. Only kept entries produce exception edges; protocol handlers get none, so they can never be reduced as `try` statements.

- **Empty catch** (`try { … } catch {}`): the compiler makes the handler PC the block the success path continues at. `isEmptyJoinHandler` walks the single-`jmp` bridge from the try end to the handler and requires the success path to actually jump *over* it; when the handler starts exactly at the try end, the block is a catch body shared with an internal branch (`AppUpdateClient.checkLatestRelease`) unless it is a terminal `return`/`throw` block (the compiler merged the catch's own exit with the continuation, `AppLog.append`). `RegionGraphBuilder` replaces such a handler with a block-less `Linear` region pointing at the continuation, so the continuation is not copied into the catch.
- **Ignored-exception shapes** (`isIgnoredCatchByBody` / `isEmptyContinueCatch` / `handlerWrapsNewError`): constant/flag catches, catches that do work and rejoin, `mov; jmp` loop-continue catches, and `catch { throw new Error(…) }` whose `newobjrange` sits after register spills. They require no normal predecessor on the handler (a shared continuation is already emitted there) and reject `sta` entries, `throw`s (except the wrap shape), `ldhole` sentinels and await-resume dispatches.
- **Handler-based finally**: registered as a `finallyEpilogue` (emitted as `try { … } catch (e) { cleanup; throw e }` and folded by `foldEagerCatchToFinally`) unless it has **no plan and** either wraps a user catch (same start, longer range) or writes the `hole` suppress block at the try end (`tryEndWritesHole`); those stay with `TryFinally`, because registering the handler would emit the cleanup as a catch and swallow the user catch (`c763`).

A zero-size handler's body can start in the next basic block (blocks are split at try-range starts), so `handlerBodyHasVisibleWork` follows the handler's forward body (fallthrough/conditional edges only) before classifying it `unknown`; `isCatchAndWrapHandler` recognizes `catch (e) { throw new Error(…) }` (restore `mov`s + `newobjrange` + `throw`). Both are gated by `handlerReadsTryValues`: when the handler observably reads a register written inside the protected range, the AST optimizer cannot keep the compiler's per-throw-point register saves alive (no exception edges in liveness), so the catch would print the wrong value version and stays unregistered.

### 6.4 Lexical analysis (`PandaLexical.ts`)

Per-class analysis seeded from `func_main_0`, recursing into nested functions (definefunc / defineclasswithbuffer / createobject-with-…) with an inherited lexical-environment stack:

- `computeEnvStacks` propagates the environment stack **along CFG edges from the entry block** (a linear pc-order scan mis-computes loops containing `popLexEnv`). Exception handlers are seeded with the stack at the try start; seeding and propagation alternate until fixpoint (handlers may be nested inside handler subgraphs).
- Environments are named `local_<depth>` / `sendable_<depth>`; multiple environments at the same depth get `_2` / `_3` suffixes so identical names cannot shadow each other (consecutive classes each get their own lexenv).
- `throw.undefinedifholewithname` (assert) instructions drive register **type inference** (`typeMap`).
- If disassembly of one method fails, that method is skipped and later decompiled as a placeholder body.

## 7. Decompilation Layer — `src/decompiler/`

### 7.1 Instruction handlers (`MethodHandler.ts`)

`HANDLES: Record<InstructionKind, Handle>` dispatches one kind at a time; a handle returning `true` stops statement absorption (used by `asyncfunctionenter` / `getresumemode`). An unregistered kind throws `PandaDecompileException` — one of the three designed degradation paths.

Responsibilities:

- `insertFunctionPreamble` declares `v0..vN`, `acc`, and the reserved parameters (`panda_jmp0_reserved_param_p2 = this`).
- Try/finally markers: `handleBlock` consults the `finallyRoles` map (built by `TryFinally`) and inserts marker expressions/statements at start/cleanup/guard/suppress positions — including inside condition `SequenceExpression`s (later hoisted by `applyFinallyPlans`).
- Nested function literals are decompiled recursively.
- `reset()` zeroes the generated-name counter; `PandaDecompiler.decompileRaw()` calls it once per class so names (`panda_jmp0_reserved_class_N`, anonymous function names) are independent of processing order — the precondition for byte-identical parallel output.

### 7.2 Statement tree (`statements.ts`)

Statements produced by reduction before being lowered to Babel AST: `LinearPandaStatement` (→ handler output), `IfPandaStatement`, `WhileStatement` (always emitted as `while (true)` with a head `if (test) break`), `DoWhileStatement`, `BreakStatement` / `ContinueStatement`, `GotoStatement` (`tryFixGoto` converts simple cases into labeled `while (true)` loops, otherwise `xpanda_goto(name)`), `LabelStatement`, `And/OrLogicalExpressionStatement` (render `A || B` as `(A-eval, cond) || (B-eval, cond)` sequences while *not* blindly appending `acc` to nested logical operands), and `TryCatchPandaStatement` (catch parameter is `catchAcc`, never `acc`; the handler starts with `acc = catchAcc` to move the exception back into the accumulator; an inlined-finally epilogue carries `kind = "finallyEpilogue"` and marks the emitted `TryStatement` with `extra.xpandaTryKind`).

### 7.3 Structure analysis (`StructureAnalysis.ts`) — region reduction

Construction: `RegionGraphBuilder` converts the CFG into a Region graph (`RegionType = Linear | Condition | Tail`; a try region keeps the `Condition` type so every loop/dominance/tail heuristic sees exactly the old helper shape, and is distinguished by the `tryRegion` descriptor). Genuine try blocks get a **Try region** spliced in front of the try entry:

- normal edge (`false`) → try body;
- **exception edge** → handler (the third edge, `ValueGraph.putExceptionEdge`);
- `tryRegion = { catchEndPC, kind: "catch" | "finallyEpilogue" }`, with the body/handler read from the graph edges (multiple try entries can share one start, so a descriptor-held reference would go stale).

Protocol handlers that ArkTS emits for for-in, for-of, async functions and generators are classified out and never spliced. Region nodes are created only for blocks reachable from the entry along normal flow plus kept handlers and their normal-flow closure (`collectRegionBlocks`), so protocol glue and its downstream cleanup never enter the graph as islands. Catch-table `codeSize === 0` is not an emptiness signal for current `es2abc`: that compiler writes 0 for every handler, on 13.0.1.0 and 24.0.0.0 alike, and which handlers enter the graph is decided from the handler body. Try wiring is iterative and reachability-aware: a helper nested inside another catch only becomes reachable after the outer one is connected, and an outer handler that lands on a block already wrapped by an inner try enters the **wrapper** (`regionEntry`) — wiring it to the body would leave the wrapper without a predecessor, prune it, and stall reduction (amcl `l10 loadJournal_`). The shared lowering of `for-of` / `for-in` / `try` / `async` / generators is written up in [Bytecode patterns](./BYTECODE_PATTERNS.md). Blocks outside that set are never turned into regions; the in-degree sweep and the entry-reachability sweep that follow are safety nets (they also drop regions whose try could not be wired).

Reduction loop over the region graph:

1. `> 2000` basic blocks (`MAX_STRUCTURED_BLOCKS`) → `PandaDecompileException("too many blocks!")` → falls back to `SimpleAnalysis`.
2. `reduceAcyclic`: Condition regions with a `tryRegion` → `reduceTryRegion` (try body vs handler: converging / both-tail / **`reduceTryCatchWithDeadBranch`** when one side is a dead out-degree-0 tail); other Condition regions → `reduceIfRegion`; Linear regions → `reduceSequence` (statement concatenation, merging `&&` / `||` short-circuit chains via `simplifyConditionalSequence`, which sets the `logicalRegion` flag — that flag **must be propagated** when such regions merge, otherwise later stages can only generate `acc`-based tests and lose the `A || B` computation). `reduceIfRegion` keeps a branch target that is the enclosing try/catch's shared continuation as the successor instead of inlining it as an `else` (`pastTryEnd`, when the try's own handler also flows into that target); otherwise the continuation is copied into the try body and emitted again after the `if` (amcl n4/o8 `start`).
3. `reduceCyclic`: self-loops and single-predecessor back edges → while / do-while; anything else is registered as an unresolved cycle.
4. When progress stalls: refine one unresolved cycle (`LoopFinder` / `refineLoop`), else `coalesceTailRegion` (absorb tail regions), else `fixIrreducibleByTailRegion` — **tail duplication** to make irreducible graphs reducible. If still stuck after `> 3000` rounds (`MAX_REDUCTION_ROUNDS`, counted independently of the block count) → `"can not reduce the graph"` → `SimpleAnalysis`.
5. `virtualizeIrregularExits`: turns lexical exits out of loops into `continue` / `break` / labeled `goto`. Condition exits emit **exactly one** statement (`if (cond) break`); linear exits an unconditional one. Exits whose target is a dead out-degree-0 Tail (`return` / `throw` only) are "inlined" by copying the tail's statements into the branch via `Region.copy()`.
6. `estimateStructuredStatements`: estimates how many statements `decompile()` will emit (shared `Region`s are re-emitted per reference, so this is a tree size, not a DAG size). A method over `MAX_STRUCTURED_STATEMENTS` (30k) first gets `pruneRedundantTailBranches`: `if (C) { …; if (D) { X } else { NEXT } } else { NEXT }` → `if (C) { …; if (D) { X } } NEXT`. This is the shape ArkTS emits for optional-field validators; it unfolds into 2^N statements otherwise (amcl1.0.6.abc's z12 `#*#w1359` 393k / `#*#t1359` 75k → 310 / 451 after pruning). The rewrite requires the inner `then` branch to always leave the structure (`branchAlwaysExits`: `return` / `throw` / `break` / `continue` / `goto`, or an `if` whose both branches do), otherwise paths falling out of the inner `then` would start executing the hoisted tail. Mutated nodes are single-reference-checked, and the pass only runs for already-over-limit methods, so ordinary output is unchanged. If the estimate is still over the limit → `"structured output too large"` → `SimpleAnalysis`.

Critical invariants:

- **Conditional polarity comes from edge values, not successor order**: `conditionalExp` describes the fallthrough (false-edge) condition (`jnez` → false edge is `!acc`, `jeqz` → false edge is `acc`). `coalesceTailRegion` and `virtualizeIrregularExits` must use `edgeValueOrThrow`; folding a tail on the *true* edge requires `expInvert()` — and for `logicalRegion`s (whose expression is already the fallthrough condition) an inverted-branch `IfPandaStatement` instead. A Try region's handler lives on an exception edge, which has no polarity: `edgeValueForPolarity` treats it as the old helper's `true` edge.
- `Region.copy()` (tail duplication, inlined exits) must preserve `conditionalExp` / `logicalRegion` / `exceptionLandingPad` / `tryRegion`.
- A Try region is consumed only by `reduceTryRegion`, which reads its body/handler from the edges and replaces them with `TryCatchPandaStatement`; the descriptor is cleared (`tryRegion = null`) at that moment, so the region can never be mistaken for a `try` again (this replaces the old mutable `tryCatchHelperRegion` flag).

### 7.4 Fallback analysis (`SimpleAnalysis.ts`)

Linear output: `label_<pc>: { … }` blocks, `decompiler_goto(label_N)` for direct jumps, `if (acc / !acc) decompiler_goto(…)` for conditional jumps, and `decompiler_exception_handled_by` / `acc = decompiler_exception_detail` markers in catch blocks. Ends with `hoistLexicalDeclarations` lifting lexical `let` declarations to the function top. Degraded output is recognizable by the `decompiler_goto` marker.

### 7.5 try/finally restoration (`TryFinally.ts`)

ArkTS 13 compiles `finally` into a state machine (hole sentinel, cleanup block, rethrow guard). The 24+ inlined form is attributed to the Try region (`kind = "finallyEpilogue"`) and emitted as `try { … } catch (e) { cleanup; throw e }`, which the tail pass `foldEagerCatchToFinally` turns into `try/finally` once the optimizer has made the two cleanup copies textually identical (structured conditional cleanup is flattened first and compared statement by statement; declarations and abrupt completions in the cleanup stay as a catch). Whether a hole-guard handler is registered as an epilogue or left to `TryFinally` is also shape-based: only a **plan-less** finally that wraps a user catch (same start, longer range) or writes the hole suppress block at the try end stays classic, because registering that handler would emit the cleanup as a catch and swallow the user catch (`c763`); a plan-backed finally keeps its handler so the fold or the handler-tail layout can restore it. The classic hole-in-body form still goes through `buildFinallyPlans`, which identifies it **structurally** — not by block sizes: the try-end block writes the hole sentinel and jumps to cleanup; the handler starts with `sta` and does not throw immediately; a later hole-compare block with a throw successor is the guard. PC ordering is strictly validated, and a guard that compares the *saved* register is preferred over "the first hole block", which is how nested finallys are told apart. Roles (start / cleanup / guard / suppress) become `__xpanda_finally_marker__` strings inserted by `MethodHandler`; a `suppress` role drops the try-end block outright. `applyFinallyPlans` then picks a layout from the marker positions:

| Layout | Shape | Plan flag / layout function |
|---|---|---|
| regular | try start / cleanup / guard in one statement list | — |
| nested tails | cleanup+guard at the tail of nested lists, hoisted after the enclosing statement | — |
| try + real catch | the same try start carries a user catch — either the catch's tail holds the cleanup (truncate the catch, attach the `finally`) or the cleanup follows the `try/catch` (wrap it) | — |
| duplicated body tails | a shared always-exiting tail was expanded into both `if` branches; `hoistDuplicatedFinallyTails` dedups it and the plan is retried | — |
| loop exhausted | cleanup parked in the `for-of` done branch, body ends with the sentinel `throw` — the branch tail becomes `break`, the wrap is a real `try/finally` | `applyLoopExhaustedFinally` |
| loop tail | cleanup/guard folded into the do-while test; sliced by instruction pc, loop-test scaffolding left in place (13.0.1.0 only) | `tailCleanupRange` |
| loop body-tail guard | cleanup at the loop body tail, guard is a statement group whose non-throw edge is a bare `jmp` to the loop head (sentinel compare materialized into the test): wrap the try body, drop the guard scaffolding, turn the test into `true` (13.0.1.0 only) | `loopTailGuard` |
| eager | cleanup inlined before an exiting `return`, no hole-writing suppress block; the copy is found by instruction *shape* and moved into the `finally` | `eagerCleanup` |

Any plan that cannot be placed leaves a `/* xpanda: try/finally not restored [plan …] */` comment (eager and `tailCleanupRange` plans produce none — they lose no code); markers are always stripped. The two loop-tail modes are gated to version < 24 (on 24+ the registered handler is folded by `foldEagerCatchToFinally`, and taking them there nests an extra try/catch), require the guard to be the *first* hole block, and the body-tail form additionally requires the after-branch block to contain nothing but the `jmp` — a loop-increment block means real body code follows, so the classic layouts must still win. Current `es2abc` also inlines `finally` before every `return` and keeps a second copy in a `hole` epilogue handler; that shape, and the same epilogue used by `for-of` close, is described in [Bytecode patterns](./BYTECODE_PATTERNS.md).

### 7.6 Value analysis (`ValueAnalysis.ts`)

Reaching definitions over the CFG: for every block and register it keeps the set of reaching definitions (normal edges only — an exception landing pad has no normal predecessor, so its in-set stays empty and must be read conservatively), and answers "which definition does this read see" (`definitionsAtRead`) and "who reads this definition" (`readersOf` / `isReadOutside`). `instructionAccess` collects the explicit register operands (destObj / srcObj / loadParam / callParams / …); `acc` is just another register.

Registers are heavily reused (`v6` is both the hole sentinel and a read buffer), so name-level checks cannot separate value versions. The first consumer is the finally guard: when the syntactic `comparesHoleWith` test fails (the register is copied in another block, or the guard reads a φ of {hole, exception}), `guardComparesSavedValue` decides it by value. It is also the natural base for the SSA direction in §16 — today the AST optimizer still re-derives value versions from usage patterns, and the `suppress` decision is deliberately all-or-nothing because a name-level answer would drop stores the code after the finally still reads.

### 7.7 Graph utilities

- `ValueGraph.ts`: insertion-ordered directed graph with three edge kinds (`true` / `false` / `exception`); normal and exception edges between the same pair coexist. `edgeValueOrThrow` (conditional edges), `normalSuccessors` / `exceptionSuccessors` / `exceptionPredecessors`, `edgeKind`, DFS post-order.
- `DominatorGraph.ts`: iterative dominator computation (Cooper-Harvey-Kennedy style) with a 100000-iteration safety timeout; `dominatesStrictly`; `LoopFinder` for natural loops.

## 8. AST Construction — `src/ast/`

- `ast/NodeFactory.ts`: Babel node constructors. `parse` uses `sourceType: "module"` with `allowUndeclaredExports`; `generate` runs jsesc-minimal + `FormatCode`. `identifierNode(name, type?)` attaches the type as a trailing block comment (type hints survive as comments). `tryStatementNode` names the catch parameter **`catchAcc`** so it never shadows the accumulator. Async / generator flags ride on `body.extra`.
- `ast/NodeUtils.ts`: statement insertion (unwrapped into `SequenceExpression` where legal), sequence-expression helpers, async/generator marking, `setReturnTypeCall` (the `callIns` marker consumed by `CallResultSimplify`), `covert2SingleBlock` (popLexEnv folding at the `panda_jmp0_reserved_lex_begin` sentinel), `tryFixGoto`.
- `ast/FormatCode.ts`: output-only line wrapping. Lines longer than **120 chars** are split at top-level (depth 0) `||` / `&&` / `??`, with the new line starting on the operator (ASI-safe). Lines containing a top-level ternary are never split; template strings, quotes, comments, and regex literals are tracked so their contents stay intact.

## 9. Optimizer Pipeline — `src/simplify/`

`SimplifyExport.simplify()` runs a fixed-point core followed by a fixed tail sequence. Every pass returns `boolean` ("did I change the AST?") and the fixed-point loop stops as soon as a full round changes nothing (max **5** rounds).

```text
normalizeDeclarations
  → CallResultSimplify
  → [ ReservedIdentifierSimplifier → TempVariableSimplify → AccCallSimplify
      → EnumSimplify → ConditionSimplify → SyntaxRewriteSimplify
      → ClassSyntaxSimplify → ObjectLiteralSimplify ] × ≤5 (fixed point)
  → HighLevelGrammarSimplify
  → TempVariableSimplify.foldShortCircuitAssignments
  → NullishCoalescingSimplify
  → AccCallSimplify.simplifySequences
  → ConditionSimplify.foldMaterializedTestArtifacts
  → TempVariableSimplify.foldReturnAssignments
  → TempVariableSimplify.foldConditionAssignments
  → SyntaxRewriteSimplify.foldSequencedTestPrefixes
  → SyntaxRewriteSimplify.normalizeConditionTests
  → TempVariableSimplify.foldConditionAssignments   (2nd pass)
  → SyntaxRewriteSimplify.normalizeConditionTests   (2nd pass)
  → SyntaxRewriteSimplify.hoistTestPrefixes
  → SyntaxRewriteSimplify.foldCompoundAssignments
  → HighLevelGrammarSimplify.simplifyTail
  → TempVariableSimplify.foldNextReadAssignments
  → SyntaxRewriteSimplify.foldConstantConditions
  → SyntaxRewriteSimplify.foldSentinelGuards
  → SyntaxRewriteSimplify.removeUnreachableStatements
  → SyntaxRewriteSimplify.removeOrphanJumps
  → TempVariableSimplify.removeUnusedLexicalDeclarations
```

Why the tail is ordered this way:

- `HighLevelGrammarSimplify` synthesizes high-level grammar (ternaries, `switch`, `??`) **after** the fixed point, so the folding passes that consume those shapes must run afterwards (short-circuit assignment folding, nullish restoration, return/condition folding).
- `AccCallSimplify.simplifySequences` restores method-load chains that only occur inside condition `SequenceExpression`s; it deliberately runs after copy propagation so intermediate forms are not mis-read by alias propagation.
- `foldConditionAssignments` / `normalizeConditionTests` run **twice**: each exposes new shapes for the other (`normalizeConditionTests` folds boolean ternaries into `X = Y && Z`, which exposes new alias chains).
- `foldCompoundAssignments` runs late so `+=` rewrites cannot disturb liveness / copy propagation.
- `simplifyTail` runs after *all* condition folding: guard ternaries (`x ? x.k : undefined` → `x?.k`), dead accumulator hub copies (`acc = E; v = acc`), the `while (true)` + `break` form of for-of (including normalization of hoisted `it.next` method loads), both the early-return and the `break` form of the do-while → for-of lowering, and consecutive `if (disc === v) { return … }` guard chains → `switch` (the else-if form is first expanded into guard clauses by `flattenElseAfterExit`; at least **3** case labels are required, so 2-label chains stay as `if`; the older if/else → switch path uses the same threshold except for the null/undefined pair restored to `??`) only materialize at that point. It finishes with `removeUnusedTempDeclarations` for leftover `vN` / `acc` declarations.
- `foldNextReadAssignments` follows `simplifyTail` because the accumulator hubs it folds (`acc = v20?.client; v6 = asRecord(acc)`) are created by the optional-chain / `??` restoration that just ran; it substitutes the value into the single later read when the temp is dead afterwards and the move preserves evaluation order.
- The final cleanup steps remove constant-condition branches, leftover try/finally & for-of close sentinels, unreachable statements, orphaned `continue`/`break`, and unused lexical block slots.

### Pass reference

| File | Responsibility |
|---|---|
| `ISimplify.ts` | Pass interface: `simplify(node): boolean` |
| `AstUtils.ts` | No-traverse linear AST utilities (temp-name recognition, purity / copyability predicates, node size, read/write collection). Avoids `scope.crawl()` on large ASTs. |
| `NormalizeDeclarations.ts` | Dedupes duplicate `let` declarations and import/declaration clashes before any Babel traverse (prevents "Duplicate declaration" crashes). |
| `ReservedIdentifierSimplifier.ts` | Restores `panda_jmp0_reserved_*` names (`param_p0/p1/p2` → `this` / function-or-class name / `new.target`, export defaults, lex sentinels). Entry self-reference statements are only deleted when the statement *is* the assignment. |
| `TempVariableSimplify.ts` + `temp/` | The heavy pass: copy propagation + dead-store elimination with per-scope liveness. The public entry point lives here; implementation is split by responsibility under `temp/` (`copy-propagation.ts`, `liveness.ts`, `assignment-folds.ts`, `condition-folds.ts`, `test-folds.ts`, plus `queries.ts` / `context.ts` / `env.ts` / `types.ts` / `base.ts`). Budgets: propagated expression ≤ **24** nodes, clone budget **120000** per run. Handles `finally` live-out reads, moves non-pure expressions only at their true last use, folds loop-test temporaries (`foldLoopTestTemps`, `foldDoWhileTestAssignments`), turns constant-test loops with a leading `if (COND) break` guard back into `while (COND)` (`foldWhileTrueBreakGuards`, after condition folding and skipping for / for-of / for-in lowering shapes), short-circuit materialization chains (`X = E; if (X/!X) { X = B }` and the empty-then `if (X) {} else X = B` form), self-negation chains by parity, accumulator chains (binary, member-call and member-load chains such as `X = E; X = X.trim()`), hub aliases with read redirection (`foldTempAliasAssignments`), and exposes the static entry points used by the pipeline tail (`foldShortCircuitAssignments`, `foldReturnAssignments`, `foldAccumulatorAssignments`, `foldNextReadAssignments`, `foldConditionAssignments`, `removeUnusedLexicalDeclarations`). |
| `AccCallSimplify.ts` | Restores `recv = acc; acc = acc.m; acc.call(recv, …)` → `recv.m(...)`; `simplifySequences` does the same inside condition sequences. |
| `EnumSimplify.ts` | Restores ArkTS enum lazy-initialization bytecode patterns into object literals (plus the reverse-mapping object). |
| `ConditionSimplify.ts` | Hoists unconditionally-evaluated sequence prefixes out of if tests, cleans materialized condition temporaries (`foldMaterializedTestArtifacts`), folds statement-level self-negation chains, merges null/undefined checks. Loops are deliberately excluded. |
| `SyntaxRewriteSimplify.ts` | Test simplification, if/else normalization, `.call` restoration, function-expression hoisting; plus the static tail helpers (`foldSequencedTestPrefixes`, `flattenElseAfterExit`, `normalizeConditionTests`, `hoistTestPrefixes`, `foldCompoundAssignments`, `foldConstantConditions`, `foldSentinelGuards`, `removeUnreachableStatements`, `removeOrphanJumps`). |
| `ClassSyntaxSimplify.ts` | Restores getter/setter and prototype/static method syntax from `__defineGetter__`-style assignments, both bare (`v1.__defineGetter__(…)`) and copy-propagated (`acc.prototype.__defineGetter__(…)`); single-expression class restoration. |
| `ObjectLiteralSimplify.ts` | Merges `createobjectwithbuffer` template objects with adjacent literal-field assignments (`obj = {k: null}; obj.k = E` → `{k: E}`); requires literal initial values, matching field order, and no closure capture. Inlines `obj = {…}; return obj` when safe. |
| `HighLevelGrammarSimplify.ts` | Main traversal: while → for / for-in / for-of, early-return / break do-while → for-of, if → ternary (bottom-up; return chains keep `else if`), if → switch (nullish synthesis), optional-chain restoration; `simplifyTail` (see above; includes consecutive if-return guard chains → `switch`). |
| `NullishCoalescingSimplify.ts` | Restores switch-lowered `??` (`v = obj.k; switch (obj.k) { case null: case undefined: v = d }` → `v = obj.k ?? d`); only for pure member-expression discriminators. |
| `CallResultSimplify.ts` | Removes `callIns`-marked call results that are immediately overwritten by the next `acc` write. |
| `UnusedCleanupSimplify.ts` | Read-set-based dead-code cleanup; **not registered** in the current pipeline (kept as a safety net). |

### Key constraints

- Copy propagation is size- and clone-budget-limited to avoid exponential blowup (`v2 = v1 + v1; v3 = v2 + v2; …`).
- The catch body keeps the pre-try copy-propagation environment (so `catch { if (v14) v14.destroy() }` can fold to the pre-try value), but pre-try identifier aliases are dropped when the try body writes their target (`invalidateIdentifierAliases`): `v0 = acc` before the try must stay `v0` in the catch, because `acc` has been reassigned by the time the handler runs (`p16 acquire`: `closeSync(v0)` was folded to `closeSync(acc)`, closing the `tryLock` function instead of the fd).
- Dead stores, sequence cleanup, and return folding all go through liveness and scope checks. **Capture detection must consider both `binding.referencePaths` and `binding.constantViolations`** — write-only closure captures are invisible to read-only checks.
- Name-level liveness cannot distinguish old/new versions of a temporary: when `X = RHS` and RHS reads `X` exactly once, that read is the *last use of the old value*; non-copyable right-hand sides may only move into a call-receiver position.
- Non-pure expressions (`call` / `new` / functions / classes) move only at their true last use — except the `definitelyWritesBeforeRead` case where both branches overwrite the variable before reading it, allowing the assignment to sink into the if test.
- The accumulator `acc` is not a source variable: `acc = !acc` can come from `callruntime.isfalse` *or* from condition materialization; folds handle negation chains by parity, not by deleting one layer.
- Statements must not be deleted based on stale reference bookkeeping: cloned expressions and deleted-statement bindings require a recount over the current AST (skipping nested functions; closure captures are protected explicitly).

## 10. Parallel Simplification — `packages/xpanda-cli/src/parallel/`

- Entry: `decompileClassesParallel(decompiler, classes, { jobs, onClassDone, onWarning })`; the CLI enables it with `-j N` (`-j 0` = auto: `max(1, min(4, cpus - 1))`, see `resolveJobs`).
- **Split**: the main thread parses, disassembles, runs lexical analysis, and builds the AST (`decompileClassAst`); workers receive self-contained AST JSON and only run `SimplifyExport.simplify` + `NodeFactory.generate`. On a large sample this split is roughly 1% vs 99% of total time.
- **Scheduling**: eligible classes (those with `func_main_0`) are sorted by estimated weight — total method `codeSize` — descending, then dispatched to idle workers (large-first reduces tail latency). Results are written back by class index, so output order is independent of completion order.
- **Determinism**: `PandaDecompiler.decompileRaw()` resets the generated-name counter per class, therefore single-class output is a pure function of that class — serial and parallel outputs are byte-identical (regression-tested).
- **Failure handling**: a worker error demotes that class to in-process simplify; **two consecutive worker failures** disable workers for the remaining classes. Worker stdout/stderr are piped so `--quiet` stays quiet.
- **Memory**: workers default to a 3 GB old-generation cap (`XPANDA_WORKER_HEAP_MB`); a single very large class can peak around 1.4 GB during simplify — more than 4 workers is not recommended.

## 11. Entry Points

### 11.1 `PandaDecompiler.ts`

| Method | Behavior |
|---|---|
| `decompile(pandaFile)` | All classes, simplified; returns per-class sections wrapped in banner comments. |
| `decompileRawAll(pandaFile)` | All classes, no simplify. |
| `decompileClass(cls)` | One class, raw + in-process simplify. |
| `decompileClassRaw(cls)` | One class, AST generated directly (no simplify). |
| `decompileClassAst(cls)` | One class as AST JSON (the split point that lets simplify run in a worker); `""` when there is no `func_main_0` or disassembly failed. |
| `simplifyInProcess(astJson)` | `JSON.parse` → `SimplifyExport.simplify` → `NodeFactory.generate`; `""` on parse failure. |

`decompileRaw` assembles a class as: imports (from module metadata) → header comment → export-name `let` declarations → `func_main_0` body (StructureAnalysis, falling back to SimpleAnalysis) → exports.

### 11.2 CLI — `packages/xpanda-cli/src/cli.ts`

```bash
npx tsx packages/xpanda-cli/src/cli.ts decompile <file.abc|file.hap> [-o outDir] [--no-simplify] [--stdout] [--quiet] [-j N]
npx tsx packages/xpanda-cli/src/cli.ts unpack-index <resources.index> [-o outDir] [--stdout]
```

- Any ZIP container (detected by `ZipFile.isZip`, not just `.hap`) goes through the HAP flow: print `module.json` summary, decompile every `.abc` entry into `outDir/<entry-path>/`, write `resources.json`, and extract `resources/` files (with a path-traversal guard on entry names).
- Progress and diagnostics go to **stderr** so `--stdout` stays valid JavaScript; per-class failures are logged and skipped, never fatal.
- `--quiet` temporarily replaces `console.log` to silence pipeline logs.

### 11.3 Library API — `src/index.ts`

Exports `PandaFile`, `PandaClass`, `PandaMethod`, `PandaDecompiler`, `PandaLexical`, `PandaDisAssembler`, `PandaIRCFG` / `PandaIRBasicBlock`, the opcode tables, `NodeFactory` / `NodeUtils`, `SimplifyExport`, `ResourceIndexFile` / `ResourceItem` / `ResourceUtils`, `HapFile` / `ZipFile`, and the exception types.

The single entry `src/index.ts` is Node-free and browser-safe — browser bundles resolve the same `"xpanda-core"` import without any export conditions. The core (parser / disassembler / decompiler / optimizer / hap+zip / res) does no disk IO and spawns no workers: ZIP deflate uses pure-JS `fflate`, text decoding uses the standard `TextDecoder`. Node-only capabilities live in the consumer packages — file IO in `xpanda-cli` / `xpanda-mcp` (`src/io.ts` each), and the parallel simplify worker pool in `xpanda-cli` (`src/parallel/`).

Measured on a ~5.5 MB sample: parsing ≈ 36 ms, serial simplify ≈ 81 s, `-j 4` ≈ 49 s (≈ 1.66×). The bottleneck is per-class simplify memory/GC bandwidth, not parsing or disassembly.

## 12. MCP Server — `packages/xpanda-mcp/src/`

Exposes the decompiler to AI agents over stdio (see [MCP.md](./MCP.md) for setup and workflows). Key design points:

- `server.ts` rebinds `console.log/warn/error` to **stderr unconditionally** before any import — any stray stdout would corrupt the JSON-RPC stream.
- `registry.ts` keeps an LRU pool of at most **8** sessions (`AbcSession` = parsed `.abc`, `HapSession` = opened `.hap`). `fileId` embeds the file name + Adler32 checksum; loading the same path twice returns the cached session.
- Ten tools: `abc_load` / `abc_close`, `abc_list_classes` / `abc_get_class`, `abc_decompile_class` / `abc_export`, `abc_disassemble_method`, `abc_search_strings`, `hap_read_abc` / `hap_resources`.
- Large-output protection: single-class decompilation truncates at 50 KB (use `abc_export` instead); disassembly defaults to 1500 instructions (`maxInstructions` up to 5000).
- Degradation is observable: `abc_decompile_class` reports `degraded=true/false` so agents can switch to `abc_disassemble_method` automatically.

## 13. Web UI — `packages/xpanda-web/`

A React + Vite single-page app that runs the decompiler **entirely in the browser** (pure frontend — nothing is uploaded). It imports the same browser-safe `xpanda-core` single entry as Node consumers; Vite bundles the workspace-linked TS source directly (`main` points at `src/index.ts`, no precompile step — see `vite.config.ts`). Design points:

- **Loading** (`src/decompiler.ts`, `loadImage`): a picked/dropped file is read as `Uint8Array`; ZIP containers go through `HapFile` — every `.abc` entry becomes an `AbcSource` with its own `PandaFile`, plus a `module.json` summary — bare files are parsed as one `.abc`. Parse failures (checksum / magic) surface as per-file errors.
- **Decompile service**: `DecompileService` caches by `sourceId::className|mode` (`simplify` and `raw` share one cache); single-class and bulk decompilation go through the same instance. Decompilation runs synchronously on the main thread — `yieldToUI()` yields between classes so React can repaint (this is the UI counterpart of the CLI's `-j` pool; the core stays worker-free).
- **State wiring** (`src/App.tsx`): window-level drag & drop with enter/leave depth counting, a bulk loop over all class refs with live progress and cancel, and zip download via pure-JS `fflate` (`zipSync`) — multi-source paths mirror the CLI's hap output layout (`<abc entry path>/<Name>.js`).
- **Components** (`src/components/`): `Topbar` (file open, output-mode toggle), `BulkBar` (progress / cancel / download-all), `Sidebar` (class list with search + package grouping, cached classes highlighted), `CodePane` (output view, copy / download / re-decompile).
- **Highlighting** (`src/highlight.ts`): zero-dependency line-based JavaScript highlighter; `src/format.ts` shares the class-demangle rules with the CLI's `io.ts`.

```bash
npm run web                            # vite dev server → http://localhost:5173
npm run build --workspace xpanda-web   # production build
npm run preview --workspace xpanda-web # serve the build
```

## 14. Verification & Testing

Entry point: `test/decompile.test.ts`.

**Harness: one load per binary, one pass per binary, one decompile per class.**
`loadPandaFile()` / `loadHapOnce()` cache the parsed container keyed by file (and `.abc` entry); `parseAssembly()` runs at most once per file; `decompileClassOnce()` caches per-class output in a `WeakMap` (AGENTS rule 6 makes that a pure function). Class-level regressions are declared as `BinaryClassTest[]` tables (`zhihuClassTests`, `yourpipeClassTests`, `amclClassTests`, …) and executed by `runClassSuite()`, which walks `getAllClasses()` **once**, invokes every matching test on the spot, and fails if a declared test never matched. Cross-class assertions inside a test use `ctx.decompileNamed()` / `ctx.decompileContaining()`, backed by a name→class index built during the same pass — no repeated traversal. This keeps the suite at roughly 25 s (it was ~32 s when every test re-read the container and re-ran `parseAssembly()`).

- Decompiles `test/resources/md5.abc`, `class.abc`, `aes.abc`, `yourpipe0.7.0.abc`, and `zhihupp0.59.hap`; compares against snapshots in `test/expected/`; re-parses all output with Babel.
- `md5.abc` output is **executed** and `md5("admin")` is checked against Node `crypto`; `aes.abc` output runs an encrypt/decrypt self-check (and its snapshot pins conditional polarity: `Counter.increment` must be `!== 255`).
- `yourpipe0.7.0.abc` (5.4 MB) covers whole-class snapshots for tricky control flow (nested try/catch in loop bodies, nested-scope for-of, hoisted iterator loads).
- `zhihupp0.59.hap` (bytecode 13.0.1.0) is the regression set for logical-condition propagation, negation-chain folding, accumulator materialization, and try/finally restoration.
- A parallel-consistency test in `packages/xpanda-cli/test/parallel-consistency.test.ts` compares serial vs `-j` output byte-for-byte on selected classes.

```bash
npm test
npm run typecheck
```

Before updating snapshots in `test/expected/`, confirm the output change is *expected* — never overwrite snapshots just to make tests pass, and explain the delta in the commit message.

## 15. Constraints & Gotchas

1. **`src/disasm/opcodes.ts` is generated** — edit `resources/isa.yaml` and run `npm run gen:opcodes`; never hand-edit.
2. **Degradation paths are by design**, not bugs: a method with > 2000 basic blocks (`MAX_STRUCTURED_BLOCKS`), an unregistered instruction kind, or a `jeq`-family instruction all fall back to `SimpleAnalysis` (or a placeholder body) without aborting the class or file. An estimated structured expansion above `MAX_STRUCTURED_STATEMENTS` first gets the region-level shared-tail pruning (§7.3 step 6) and only degrades if it is still over the limit.
3. Prefix instructions occupy 2 bytes (first byte ≥ 251). New opcode kinds register under the first word of the isa.yaml `sig` (e.g. `wide.callrange`).
4. **Single-class output must be a pure function of that class** — no cross-class mutable state (global counters, offset-keyed mutable caches), or `-j` parallel output diverges from serial. Name counters reset per class.
5. **Conditional polarity is decided by CFG edge values**; `successors()` order is insertion order, never true/false order.
6. **Logical-condition flags must be propagated completely** (`logicalRegion` through `reduceSequence`; all four Region flags through `Region.copy()`), or `A || B` degrades to an `acc`-only test.
7. **Liveness + branch analysis before deleting or moving temporaries** — test-sequence folding and non-pure-expression moves can otherwise duplicate calls or change the final value of `acc`. When in doubt, optimize less rather than change semantics.
8. The `finally` handler's reads are live at *every* try exit; liveness models without exception edges must merge exit reads into `finalizerReads`, or try-block stores get deleted as dead.
9. Catch parameters must not be named `acc` (they shadow the accumulator); `NodeFactory.tryStatementNode` uses `catchAcc` and re-materializes `acc = catchAcc` at handler entry.
10. Runtime requires only Node.js ≥ 18; `typescript` / `tsx` are dev-only. Degraded output may contain `decompiler_goto`, `xpanda_goto`, or `export … from` forms that need matching parser settings to re-parse.

## 16. Roadmap

Two directions, both aimed at removing work that is currently pattern-matched out of the generated AST. They are tracked in the README roadmap as well.

1. **Keep improving structured output** (§7.3, §7.5). Region reduction still degrades to `SimpleAnalysis` on irreducible graphs and over-limit expansions, and a few `try/finally` plans still end as a `try/finally not restored` note. Work items: more reduction cases for shared/irreducible tails, fewer heuristics that depend on statement shape, and additional finally layouts for exception shapes that are currently unmodelled — each rule gated narrowly and measured on the whole `amcl1.0.6.abc` sample (changed-class count in the commit message).
2. **Add an SSA layer** (§7.6). There is no value-level IR between the CFG (§6.3) and decompilation (§7): register versions are re-derived from usage patterns by the AST optimizer (§9), which is why `vN = v0` spill chains and materialized-condition temporaries can survive into the output. An SSA form — def-use chains, φ nodes at joins, following the design of the [React Compiler](https://github.com/react/react/tree/main/compiler) — would let dead-store elimination, copy propagation and accumulator folding run once on the IR, before structuring, and would give structure analysis and the finally guards direct value-version answers instead of the conservative name-level checks they use today (`ValueAnalysis` is the first step in that direction).
