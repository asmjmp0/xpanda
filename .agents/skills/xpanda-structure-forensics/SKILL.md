---
name: xpanda-structure-forensics
description: Use when decompiled output for a HarmonyOS .abc/.hap class is structurally wrong or missing - a try/catch/finally that vanished, a continuation duplicated into a catch, a dropped catch body, a wrong loop shape, code only reachable from an exception path that is absent, or a "why is this not restored" report pointing at a line of output. Traces which pipeline stage dropped the structure (try classification, region-graph reachability, region reduction, AST finally layouts, simplify) and fixes it with a narrow gated rule verified against a measured full-sample blast radius.
---

# Xpanda structure forensics

A missing `try` is never "the decompiler forgot a keyword". Something upstream
decided the code was unreachable, or a layout refused a shape and the fallback was
to emit the pieces flat. This skill is the loop for finding that decision.

Use it for **structure**: try/catch/finally, loop shape, duplicated or dropped
continuations, missing catch/cleanup bodies, code that exists in the source but not
in the output.

Not for: register naming, formatting, dead-store noise, or optimizer detail when the
structure is already right.

## 1. Ground truth first

Never design a rule from the decompiled text alone - you need the shape the compiler
was asked to produce.

1. Map the class to its source (`L&entry/src/main/ets/r5/l8&;` →
   `LZZLHY/amcl` `MyApplication/entry/...`), and the decompiled function
   (`local_0_15`, `s771`, `verifyExportJar`) to the bytecode method (`#*#q776`) by a
   distinctive string literal inside it.
2. Write down the expected shape, e.g.
   `try { stat; crc } finally { close(opened) }` inside `for (const entry of entries)`.
3. Note what the output actually has (e.g. `stat; crc; close(opened)` flat inside the
   loop, so the exception path leaks the descriptor). That difference is the claim you
   will verify at the end.

## 2. Collect the bytecode evidence

Use `scripts/abc-inspect.ts` (run from the repo root):

```bash
yarn tsx .agents/skills/xpanda-structure-forensics/scripts/abc-inspect.ts \
  packages/xpanda-core/test/resources/amcl1.0.6.abc "L&entry/src/main/ets/r5/l8&;" '#*#q776' --entries --plans --cfg 14500 14620
```

Record these facts before touching code:

| Question | Why it matters |
| --- | --- |
| Does the try table have an entry for this finally? | no entry ⇒ no markers/plan possible (the compiler merged it into a neighbouring try) |
| Is the handler PC the try end (`end == handler`)? | shared sentinel / resume-dispatch shapes |
| Does the handler entry have 1 or 2 normal successors? | 2 ⇒ the resume dispatch is inside the handler entry (async) |
| Where is the guard (`ldhole` + `noteq`)? | its non-throw edge is either the continuation (forward) or a loop latch (backward) |
| Where does the cleanup copy live? | try-body tail (eager), for-of done branch, catch-body tail, loop-body tail |
| Which registers does the handler `sta` save? | the guard must compare *that* value, not "the first hole block" |

`--entries` prints the classification (`keep`, `kind`, `usesException`, `exits`,
`protectedEnd`), `--plans` the finally plans with their flags, `--cfg from [to]` the
blocks in a pc window with successors/predecessors and `hole-load` / `compare` marks,
and `--writes <reg>` the reaching definitions of a register plus their reader pcs (the
evidence for "can this write be dropped"). Two more entry points:

```bash
# which methods touch a string literal - maps a decompiled function to #*#method
yarn tsx .agents/skills/xpanda-structure-forensics/scripts/abc-inspect.ts \
  packages/xpanda-core/test/resources/amcl1.0.6.abc --find "解压条目CRC"

# list a class's methods with code size / try count (no method argument needed)
yarn tsx .agents/skills/xpanda-structure-forensics/scripts/abc-inspect.ts \
  packages/xpanda-core/test/resources/amcl1.0.6.abc "L&entry/src/main/ets/r5/l8&;" --list
```

`.hap` inputs read the single `.abc` automatically (pick one with `--abc <entry>`).
Class names accept `Lpkg/Name;`, `pkg/Name`, or a unique substring; method names
accept `#*#q776`, `q776`, or a unique substring. `--decompile` prints the whole
decompiled class for correlation with what the output actually shows.

### Ground truth for finally vs catch

`reference/es2abc` (24.0.0.0, macOS arm64) compiles the fixtures in
`fixtures/finally-shapes/`; the script dumps normalized assembly and summarizes each
function's try entries:

```bash
yarn tsx .agents/skills/xpanda-structure-forensics/scripts/compile-shapes.ts
# optional: --out <dir>   (defaults to <tmp>/xpanda-finally-shapes)
```

Read the dumped `.asm` for the exact handler. The classic hole-guard finally form is
the same on 13.0.1.0 (e.g. amcl `mods/o17` `execute`), so the 24.0.0.0 dump is valid
ground truth for this repo's 13.x samples too.

## 3. Find the stage that dropped it

Cheapest first. Stop at the first stage that explains the loss.

1. **`classifyTryEntries`** - `keep=false` means no region, no markers, nothing
   downstream can emit it. Also check `kind` (`classicFinally`, `pureRethrow`,
   `forOfClose`, `asyncReject`, `unknown`). A handler dropped here also takes its
   whole normal-flow closure with it.
2. **`RegionGraphBuilder.collectRegionBlocks`** - regions are created only from the
   entry and from *registered* handlers. A dropped catch/finally handler can orphan
   half a method (i15 `downloadCatalogArchive`: the user catch was dropped as a
   `classicFinally`, and with it the candidate loop, its back edge and the finally
   cleanup).
3. **Region reduction** - duplicated continuation (a shared join inlined into a
   branch), done-branch folding, `if (C) { A; TAIL } else { TAIL }`. Check the join's
   `inDegree` and which `reduceIfRegion` case matched.
4. **`applyPlans` layouts** - the failure reason names the shape:
   `cleanup not inside last statement`, `no usable end marker`,
   `guard marker missing or in another list`, `pc-located start in another list`,
   `cleanup not right after the try/catch`. Map the reason to a shape (see §6).
5. **simplify** - `foldEagerCatchToFinally`, `foldSentinelGuards`,
   `removeUnreachableStatements` (it prunes the `try/finally not restored` note when
   the method tail is `return`/`throw`), duplicate trailing block elimination.

## 4. Instrumentation recipes (temporary, never committed)

- **Pre-strip AST with markers**: in `applyFinallyPlans`, when a plan fails write
  `JSON.stringify(astNode)` to `/tmp/finally-ast-<startPC>.json`. Markers are string
  literals `__xpanda_finally_marker__<planId>_<role>`; walking the JSON for them shows
  the statement list length, index and ancestor statement chain for every role - that
  is how "guard marker in another list" becomes a concrete path.
- **Layout tracing**: tag each `applied = true` with a label
  (`regular` / `cleanup-after-try` / `handler-tail` / `loop-exhausted` / `eager` /
  `tail`) and print plan id, tag and reason.
- **Plan tracing**: print `start/end/cleanup/guard`, `matchedByRegister`,
  `endIsMethodTail`, `sharedSentinel`, and the guard-search branch taken.
- Guard everything behind `(globalThis as any).__XPANDA_DEBUG` and delete it before
  committing; keep the diagnostics out of the tree.

## 5. Design the rule - invariants that each cost a regression

- **A plan that cannot be applied must leave the AST untouched.** Dropping the try's
  normal-completion block (`suppress`) or inserting marker statements for a plan whose
  layout may fail changes the output anyway. Fallback plan modes should register **no
  roles at all** and locate their parts by pc (`locateTryStartByPC`,
  `statementInstructionPC`).
- **The failure note is a statement.** `applyFinallyPlans` appends a comment-only
  `EmptyStatement`; it can be pruned later, but while it exists it changes the method
  tail and perturbs simplify. For fallback modes, delete the plan from the failure set
  instead of adding the note (that was the `h1/q1` + `launch/c15` churn).
- **`buildFinallyPlans` is also consumed by `classifyTryEntries`.** Finally start pcs
  decide whether a shared-start user catch or the finally epilogue is kept, so new plan
  modes must be filtered there - except eager plans, whose start pc is still
  load-bearing (filtering them made hx360e `LogExport` keep both a catch and a finally).
- **Registers are reused** (`v6` is both the hole sentinel and a read buffer), so
  name-level liveness cannot decide deadness. Use `ValueAnalysis` (reaching
  definitions) or a structural flag; never reason from one shape.
- **Inlined cleanup copies are identical modulo registers and pool indexes.** Match by
  instruction *shape* (`instructionShape`: opcode + operands with numbers/register
  numbers normalised) or by pc range - never by register name.
- **One shape, one narrow gate.** Every gate in the code exists because a general rule
  broke a specific class; write the counter-example (class + method) into `AGENTS.md`
  next to the rule.

## 6. The finally-shape catalogue

| Shape | Bytecode tell | Handled by |
| --- | --- | --- |
| classic | try end writes `ldhole` and jumps to the cleanup; handler `sta`s then falls into it | `applyPlans` regular layout |
| nested | the outer cleanup contains the inner finally's own sentinel | guard matched by the handler's saved register (`comparesHoleWith`, `guardComparesSavedValue`) |
| eager | `end == handler`, handler has 2 successors (resume dispatch), cleanup inlined before an exiting `return` | `FinallyPlan.eagerCleanup`, `locateInlinedCleanupStart`, `applyEagerCleanupFinally` |
| catch-tail | try/catch and try/finally share a start; the cleanup lands at the catch body's tail | `isHandlerWiring` + handler-tail layout |
| loop-exhausted | cleanup inside the for-of `done` branch, body ends with `acc = save; throw acc` | `applyLoopExhaustedFinally` |
| loop-tail | cleanup/guard folded into the `do { … } while` test, guard's non-throw edge is a back edge | `FinallyPlan.tailCleanupRange`, `applyTailCleanupFinally` (13.0.1.0 only) |

### finally vs catch signatures (es2abc ground truth)

| | finally | catch (with cleanup + rethrow) |
| --- | --- | --- |
| try entries | two for the same start: `start..bridge` (pure rethrow) + `start..cleanup` | one |
| handler entry | `sta pending` | `sta e` |
| cleanup copy | often wrapped in `if (<resumeFlag> == undefined)` | handler body directly |
| epilogue | `ldhole; sta; noteq; if (pending != hole) throw pending; <resolve/return>` | `lda e; throw` |
| normal path | one inlined copy of the same cleanup before the exit | none |

A handler with the `ldhole`/`noteq` rethrow guard **is a finally**, even when the try
body covers the whole method and the normal-path copy sits far from the handler
(amcl `mods/o17` `execute`). Do not demote it to a catch just because
`buildFinallyPlans` produced no plan - fix the plan detection instead. With multiple
exits the normal-path cleanup copy is shared: the exits jump to one copy, and the
copy may start in a tiny `vX = undefined` block before the real cleanup, so shape
matching must walk forward across blocks and skip the `if (<resumeFlag>)` guard.

Loops are the other half: a for-of with an early `continue`/`return` is lowered to
`do { r = it.next(); if (r.done) { … } … } while (…)` or `while (true) { … if (r.done) break; }`;
`restoreIteratorLoops` / `checkAndTransformToForOfStatement` recognise those, and a
finally cleanup parked in the done branch or the loop tail is what makes them look
unrecoverable.

## 7. Verify with a measured blast radius

1. `yarn test` (snapshots + Babel re-parse + cli serial/parallel consistency).
2. `yarn typecheck`.
3. Full sample: decompile `packages/xpanda-core/test/resources/amcl1.0.6.abc` to
   `/tmp/out-new` (serial or `-j 4`) and diff against a baseline build of the same
   tree without your change. Review **every** changed class; an unexplained diff means
   the rule is too broad. Keep the changed-class count in the commit message.
4. Update snapshots only for intended shape changes, and re-read the hunks (a `return`
   moving out of a try/finally is expected; a `new Error(...)` duplication is not).
5. Add a targeted regression to `packages/xpanda-core/test/decompile.test.ts`
   (`verifyAmcl*` + an entry in `amclClassTests`) with the exact fragment that was
   missing, and a whole-class snapshot when the class is the point of the fix.
6. Record shape + gates + counter-examples in `AGENTS.md` ("Pitfalls and Notes"),
   bump the affected package versions, and commit with the sample class/method and the
   measured blast radius.

## 8. Pitfalls quick list

- `regionGraph.successors()` order is meaningless for polarity; use
  `edgeValueOrThrow(region, succ)`.
- Exception-only regions are not in the depth-first order; `collectRegionBlocks` roots
  them explicitly.
- `Region.decompile()` expands shared nodes by reference - a shared tail duplicates at
  every reference site.
- `getNextSibling()` / `getPrevSibling()` return a path whose `node` is `null` past the
  list end; guard with `cursor.node`.
- Decompiled AST nodes have no `start`/`end`; decide containment with path ancestry,
  not positions.
- A marker object can be gone from the tree (its copy was deleted); re-find by marker
  value before concluding "marker not found".
- `hole` is the compiler's finally sentinel, not a source identifier; `acc = hole != hole`
  style residue means the sentinel write was dropped somewhere.
