# ArkTS lowering of for-of, for-in, try/catch/finally, async, and generators

> English | [简体中文](./BYTECODE_PATTERNS.zh-CN.md)

How `es2abc` lowers the control-flow forms that share one completion protocol, and what that means for region reduction. The shapes below were produced by the `reference/es2abc` binary in this repo (default bytecode **24.0.0.0**, and the same sources again with `--target-api-version 18` → **13.0.1.0**), dumped with `--dump-assembly` and checked against the try table xpanda parses out of the `.abc`.

```bash
reference/es2abc --dump-assembly --opt-level 2 --output out.abc patterns.js
reference/es2abc --dump-assembly --opt-level 2 --target-api-version 18 --output out13.abc patterns.js
```

`--opt-level 0` keeps the same idioms and adds a `mov` of every parameter plus extra copies between statements. `--opt-level 2` deletes those copies, except inside nested `for-of`: the outer iterator and its closing flag are spilled with `mov` before almost every inner instruction (one nested loop grew from 265 lines at `-O0` to 605 at `-O2`). Match opcodes and the exception table, not a fixed instruction window.

The two bytecode versions emitted **the same instruction stream and the same try table**. Differences seen in older application `.abc` files (zhihu 13.0.1.0, yourpipe, hx360e) come from an older toolchain, not from the version number this compiler writes.

## 1. Shared protocol

Every one of these forms is ordinary straight-line code plus **untyped catch-all** entries. There is no typed `catch` in the table (`typeIdx` is 0 for user `catch (e)`, `finally`, iterator close, and async/generator wrappers alike).

### 1.1 `codeSize` is always 0

On both 13.0.1.0 and 24.0.0.0 this compiler stores `codeSize = 0` on every catch entry, including a real `catch (e) { return e.message }`. Dispatch uses `handlerPC` only. The handler's extent is "from `handlerPC` until control leaves", not the field in the try table.

A zero **try length** is different and does mean "nothing protected". `for-of` emits one (`try [1, 1)`), left over from a collapsed acquisition try. Skip those.

Consequence for `RegionGraphBuilder`: `version[0] >= 24` is not a proxy for this encoding. This `es2abc` writes the inlined-finally shape (section 4) at API 18 as well. Gating "register the `codeSize === 0` finally handler" on the version byte drops the exception-path cleanup for files this compiler just produced as 13.0.1.0. Classify the handler by its instructions. Keep the version gate only as a compatibility hint for **older** toolchains whose 13.0.1.0 files really do inline `finally` and leave an empty handler.

### 1.2 Completion record: `hole` plus a "not yet run" flag

`finally` and the abrupt exits of `for-of` / `for-await-of` use the same epilogue. `hole` (`ldhole`) means **normal completion**. Any other value in the pending register is an exception to rethrow.

```text
pending = <hole on the normal path, the exception on the catch path>
if (ran === undefined) {          // ran starts as undefined; hole or true means "already ran"
    ran = <true or hole>;
    <cleanup>;                    // finally body, or iterator.return()
}
if (pending !== hole) throw pending;
<normal continuation>;
```

`-O2` often stores `hole` into the flag **after** the cleanup instead of storing `true` before it. The test is still `flag === undefined`.

The normal path does not always fall into this epilogue. When the source exits with `return` (or `break` out of `for-of`), the compiler **inlines a second copy of the cleanup in front of that exit** and leaves the epilogue for the exception path. The two copies are the signal `foldEagerCatchToFinally` already uses.

### 1.3 Nested catch-alls, innermost wins

Try ranges nest by PC inclusion. The inner handler is frequently **inside** the outer try's PC range, so a `throw` in the inner handler is caught by the outer entry. That is how a `finally` rethrow reaches an outer `catch`, and how a `throw` from an inlined `finally` re-enters the shared epilogue.

`try { return f() } finally { g() }` at `-O2`, PCs from the parsed try table:

```text
try [4, 17)  handler 17     // inner: body + inlined finally, handler is `sta e; throw e`
try [4, 23)  handler 23     // outer: includes the inner rethrow, handler is the hole epilogue

 4  lda f; call; sta result
10  lda g; call              // inlined finally, still inside BOTH tries
14  lda result; return
17  sta e; throw             // inner handler; the throw is still inside [4, 23)
23  sta pending              // outer handler
    if (flag === undefined) g()
    flag = hole
    if (pending !== hole) throw pending
    return undefined
```

If the inlined `g()` throws, the inner handler rethrows and the outer epilogue runs `g()` again. The second call sits outside every try, so it cannot loop. Restoring source `try/finally` collapses the two copies back into one cleanup; that matches the source, and it is what the bytecode does on the paths where `g()` returns normally.

### 1.4 Resume mode is the async/generator form of the same split

Runtime enum `GeneratorResumeMode` / `AsyncGeneratorResumeMode` (`ecmascript/js_generator_object.h`):

| Value | Mode |
|---|---|
| 0 | `RETURN` |
| 1 | `THROW` |
| 2 | `NEXT` |
| 3 | `UNDEFINED` |

`JSGeneratorState` / `JSAsyncGeneratorState`: `UNDEFINED=0`, `SUSPENDED_START=1`, `SUSPENDED_YIELD=2`, `EXECUTING=3`, `COMPLETED=4`. Async generators add `AWAITING_RETURN=5`. `setgeneratorstate 2` is "about to yield"; `setgeneratorstate 4` is "completed".

Every suspend point is straight-line code, not a three-way CFG branch:

```text
<value in acc>
suspendgenerator gen
resumegenerator          // acc = value passed to next/throw/return
sta resumed
getresumemode
sta mode
ldai 1                   // THROW
eq mode
jeqz normal
lda resumed
throw                    // real throw: this is the only edge that hits a catch-all
normal:
```

`RETURN` (0) is an ordinary conditional `return` of the resumed value (and, inside `for-of`, an iterator close first). `NEXT` (2) falls through; the resumed value is the result of `yield` / `await`. `THROW` is a real `throw`, so it uses the function's outer catch-all. Structured analysis should delete the `THROW` arm as "the await/yield expression throws", not emit a `try`.

### 1.5 Hidden arguments

A function `f(a, b)` is compiled as `(a0, a1, a2, a3, a4)`: `a0` is the function object, `a1` is `new.target`, `a2` is `this`, and user parameters start at `a3`. `creategeneratorobj` takes `a0`. `asyncfunctionenter` allocates the async capability into a local; it is not an argument.

## 2. What is a real `catch`

Handler entry is almost always `sta vX` (the exception arrives in `acc`). Classify that block; do not trust `codeSize`.

| Handler shape | What it is | Region graph |
|---|---|---|
| `sta e; throw e` (only `mov` / `poplexenv` / `nop` in between) | Pure rethrow bridge. Wraps a try body so the outer epilogue sees the exception, wraps a sync generator body, wraps `getpropiterator`. | Drop. Emitting `catch (e) { throw e }` breaks `for-of` and lexenv splitting. |
| `sta e; <reads e: property / call / string / global>; …` | User `catch`. | Keep. `TryCatchHelperRegion`. |
| `sta pending` then later `pending !== hole` with a `throw pending` successor | `finally` epilogue, or the `break`/`return` close of `for-of`. | `finally`: on the inlined-finally shape, keep the handler so the cleanup is emitted, then fold the two copies. Classic hole-in-the-body shape stays with `TryFinally` and stays out of the region graph. |
| `sta e; asyncfunctionreject cap; return` | Async function wrapper around the **whole** body. | Drop. The function is `async`. |
| `sta e; setgeneratorstate 4; asyncgeneratorreject gen; return` | Async generator wrapper. | Drop. `asyncgeneratorreject` is not `asyncfunctionreject`; a classifier that only recognizes the latter must still reject this shape, or a user `catch` appears around the generator. |
| `sta e; if (!closing) { it.return() }; throw e` | `for-of` / `for-await-of` IteratorClose on a `throw` from the body. | Drop. The `for-of` transform re-closes on `return`/`throw` itself. |
| `try` length 0 | Collapsed range. | Drop. |

User `catch` at `-O2` is just the source body under a catch-all. No `hole`.

An empty `catch {}` inside a loop is the special case: the handler is the latch block itself (`i++; goto head`), and the normal exit is a one-instruction `jmp` onto that same block. Both paths join there, so the `jmp` is the catch body and stays an exception landing pad (`wireEmptyJoinCatches`); the classifier that looks for "constant log then `return`" must not follow the handler's back edge into the loop body, or the same try gets a second helper (`amcl n4/o8` `clearDisplayListeners`).

```text
.catchall body_begin, body_end, handler
handler:
    sta e
    lda e
    ldobjbyname message
    return
```

## 3. `for-of` and `for-await-of`

### 3.1 Loop head

The loop itself is a normal CFG cycle. Exhaustion does **not** close the iterator (the spec does not call `IteratorClose` when `done` is true).

```text
lda iterable
getiterator
sta it
ldobjbyname next
sta nextFn
ldfalse
sta closing          // true once a close is in progress; prevents a second return()

loop:
    lda nextFn
    callthis0 it
    sta res
    throw.ifnotobject res
    ldobjbyname done
    callruntime.istrue
    jnez exhausted
    lda res
    ldobjbyname value
    sta elem
    <body>
    jmp loop
exhausted:
    <code after the loop>     // no iterator.return()
```

`for await`:

```text
getasynciterator          // instead of getiterator
lda nextFn
callthis0 it
asyncfunctionawaituncaught cap
suspendgenerator cap
resumegenerator / getresumemode / throw-if-THROW
throw.ifnotobject res
ldobjbyname done
…
```

`iterator.return()` on that path is awaited the same way. The function is an async function, so section 5's wrapper sits outside the loop.

`continue` is a `jmp` back to `loop`. It does not touch `closing` and does not call `return()`.

### 3.2 Close on `throw`

The body is its own catch-all. The handler is the closing flag plus `iterator.return`, and that `return()` call has a **nested** catch-all whose entry falls through to `throw saved` without storing the new exception (the original body exception is what propagates on this path). The `break` / `return` path in section 3.3 does store a throw from `return()` into the `hole` pending register.

```text
body catch:
    sta saved
    if (closing) throw saved
    ret = it.return
    if (ret === undefined) throw saved
    ret.call(it)              // nested catch-all → throw saved
    throw saved
```

### 3.3 Close on `break` / `return`

These are normal completions that still have to close. The compiler inlines the close in front of the original exit and uses the `hole` epilogue so a throw from `return()` replaces the completion. It sets `closing = true` **before** the call, and spills `it` and `closing` into locals the outer throw-handler will read, so a throw from `return()` does not close twice.

```text
closing = true
pending = hole
ret = it.return
if (ret !== undefined) ret.call(it)     // its catch-all does `pending = exception`
if (pending !== hole) throw pending
throw.ifnotobject retResult             // spec: return() result must be an object
<original break or return value>
```

A labelled `break` of an outer `for-of` is the same close, nested: the inner close runs, then the outer close, then the code after the outer loop. At `-O2` the outer `it` / `closing` pair is copied into the inner loop with `mov` before nearly every instruction so the inner handler's live-ins are explicit. Do not pattern-match those `mov`s; they are spills.

### 3.4 What to restore

Recognize the loop head (`getiterator` or `getasynciterator`, hoisted `next`, `throw.ifnotobject`, `done`, `value`, back-edge). Treat every catch-all that mentions `it.return` or the `closing` flag as compiler glue and leave it out of the region graph. The exhausted edge is the loop follow. `break` / `return` / `throw` in the body become the source statements; the JS `for-of` closes the iterator on `return` and `throw` by itself, and `break` does not call `return()` in the restored source only if the transform drops the inlined close — the bytecode **does** close on `break`. The restored `for (x of xs) { if (t) break }` relies on the host language to skip `IteratorClose` for `break`, which is what the engine does for a source `for-of`. Matching the bytecode's explicit `return()` on `break` is not required once the loop is a `for-of`.

## 4. `for-in`

Not the iterator protocol. No `return`, no `hole`, no close on `break` or `return`.

```text
lda obj
getpropiterator
sta it
// a catch-all covers only this acquisition; the handler is `sta e; throw e`

loop:
    getnextpropname it
    sta key
    eq undefined, key
    jnez done
    <body>
    jmp loop
done:
```

The acquisition catch-all is the same pure-rethrow bridge as section 2. Drop it. The loop test is `getnextpropname` producing `undefined`. An early `return` inside the body is a plain `return` with no cleanup. Restore as `for (k in obj)`.

## 5. `try` / `catch` / `finally`

Three nestings, all catch-alls:

**`try/catch`.** One range over the try body. Handler is user code (section 2). No `hole`.

**`try/finally`.** Two ranges with the same start PC.

- Inner range = try body, plus the inlined cleanup if the body `return`s. Handler = `sta e; throw e`.
- Outer range = inner range **and** that rethrow. Handler = the `hole` epilogue, whose cleanup is the `finally` body.

When the body does not `return`, cleanup is **not** inlined; the normal path jumps to the epilogue with `pending = hole` (`tryFinallyNoReturn`). One copy of the `finally` body, shared by normal and abrupt completion.

**`try/catch/finally`.** The inner handler is the user `catch`, and it inlines `finally` before its own `return`. The outer handler is still the `hole` epilogue, for throws from the catch body and from the inlined `finally`.

**`try { try { … } finally { g() } } catch (e)`.** The `finally` epilogue's `throw pending` sits inside the user-catch range, so the rethrown exception becomes `e`. The `hole` path does not throw and does not enter the user `catch`.

**`finally` around `try/catch`.** Both the try `return` and the catch `return` inline `g()` first; the outer epilogue remains for a throw out of either copy.

A `try` inside a `for-of` body is a catch-all nested inside the body range. The `for-of` close catch-all wraps the body, so it also wraps that inner `try`. Outermost-relevant handler for a throw from the body is the user `catch`; a throw from the user `catch` (or from after it) hits the iterator close. Reduce the inner try/catch as a normal try, and keep treating the outer close as `for-of` glue.

## 6. `async` / `await`

```text
asyncfunctionenter
sta cap
// catch-all covers the entire body below, not the enter itself
<body>
    <expr>
    asyncfunctionawaituncaught cap
    suspendgenerator cap
    resumegenerator / getresumemode
    if (mode === THROW) throw resumed
    <use resumed>
<asyncfunctionresolve cap>
return

handler:
    sta e
    asyncfunctionreject cap
    return
```

The catch-all is not a user `try`. Strip it when the handler is only `asyncfunctionreject` + `return`. Each `await` is the resume-mode split from section 1.4; the `THROW` arm is what makes a rejected await hit `asyncfunctionreject`. `RegionGraphBuilder` already deletes that arm when it has seen the wrapper (`isAsyncFunction`).

`try/catch/finally` inside an async function is the section 4 shape, with an `await`'s resume split anywhere an expression can throw, and the async wrapper as the outermost catch-all. `finally` still uses `hole`. A `return` inside the `try` inlines `finally` and then `asyncfunctionresolve` instead of a bare `return`.

## 7. Generators

Sync generator, one yield:

```text
creategeneratorobj a0
sta gen
ldundefined
suspendgenerator gen          // SUSPENDED_START, before any user code
resumegenerator
getresumemode
if (mode === RETURN) return resumed
if (mode === THROW)  throw resumed
// NEXT: body starts. The value of this first resume is discarded.

createiterresultobj value, false
suspendgenerator gen
resumegenerator               // this resumed value IS the result of `yield`
getresumemode
if (mode === RETURN) return resumed
if (mode === THROW)  throw resumed
// NEXT: fall through

return <completion value>     // runtime wraps a bare return as { done: true }
```

The outer catch-all covers the whole body and its handler is `sta e; throw e`. Drop it (`checkIsGeneratorException` keys off `creategeneratorobj` in the try entry). Do not emit `try` around a generator just because that bridge exists. A `poplexenv` inside a real rethrow bridge is still load-bearing for lexenv bookkeeping; unwrap it in the AST pass after the structure is built, which is what `removeRedundantRethrowCatches` is for.

`yield` inside `for-of` combines both protocols. Resume mode `RETURN` at the yield runs the section 3.3 iterator close, then `return`s the resumed value. That is `generator.return()` while suspended inside the loop. Mode `THROW` throws, and the body's close catch-all runs `iterator.return()`.

### Async generator

`createasyncgeneratorobj`, then the same initial suspend (this compiler evaluates the first `getresumemode` and discards it). `yield` is:

```text
setgeneratorstate 2           // SUSPENDED_YIELD
asyncgeneratorresolve gen, value, /*done*/ false
resumegenerator
getresumemode
if (mode === RETURN) { … complete with done:true … }
if (mode === THROW)  throw resumed
// NEXT: resumed value is the yield result
```

Completion is `setgeneratorstate 4` (`COMPLETED`) plus `asyncgeneratorresolve gen, value, true`. The outer handler is `setgeneratorstate 4; asyncgeneratorreject`. `await` inside the generator is the async-function resume split, aimed at the same generator object.

## 8. How this lines up with structured analysis

The CFG does not contain a clean "try diamond". Handlers have no incoming control-flow edge; they are reachable only through the try table. Building a region for every `codeSize === 0` entry either drops real `catch` bodies (they look dead) or pulls iterator-close and async-reject glue into the reducible graph, which then fails to reduce or emits a `try` around a loop.

Practical split:

1. **Parse every catch-all with `codeSize === 0`.** Decide from the handler, not the version byte. Skip length-0 tries.
2. **Keep** user `catch` handlers, and keep the `hole` epilogue when it is the only copy of a `finally` body (the inlined-finally shape). Splice `TryCatchHelperRegion` only for those.
3. **Drop** pure rethrows, `for-in` acquisition, `for-of` / `for-await-of` close handlers, the async `asyncfunctionreject` wrapper, and the async-generator `asyncgeneratorreject` wrapper. Also drop the `THROW` / `RETURN` arms of a resume split so the suspend point reduces as a linear expression.
4. **Restore on the AST**, where the copies are visible as text:
   - `for-of` / `for-await-of` / `for-in` from the loop head, not from the catch-alls.
   - `finally` by matching the inlined cleanup with the `hole` epilogue (`foldEagerCatchToFinally`), or by the classic "body writes `hole` and jumps to cleanup" plan (`TryFinally`) for older toolchains.
   - `async function` / `function*` / `async function*` from `asyncfunctionenter` / `creategeneratorobj` / `createasyncgeneratorobj`, after the wrapper catch-all is gone.
5. **Do not pattern-match nested `for-of` on a rigid window.** `-O2` spills the outer iterator into the inner loop. Key off `getiterator` / `getasynciterator` / `getpropiterator`, `getnextpropname`, `ldobjbyname done|value|return|next`, `ldhole`, and `suspendgenerator`.

The resume split and the `hole` epilogue are the same idea: one path is the value, one path is a `throw`, and a third path (`RETURN`, or `pending === hole`) is normal completion that still runs cleanup. Recognizing that one epilogue covers `finally`, `for-of` close, and generator `.return()` is what keeps those three from being reduced as unrelated `try` nests.
