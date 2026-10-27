# for-of、for-in、try/catch/finally、async、generator 的字节码共性

> [English](./BYTECODE_PATTERNS.md) | 简体中文

`es2abc` 如何把这几类控制流降成同一套“完成记录”，以及这对区域归约意味着什么。下面的形态来自本仓库的 `reference/es2abc`（默认字节码 **24.0.0.0**，同一份源码再用 `--target-api-version 18` 编出 **13.0.1.0**），用 `--dump-assembly` 导出，并对照 xpanda 从 `.abc` 里解析出的 try 表核对过。

```bash
reference/es2abc --dump-assembly --opt-level 2 --output out.abc patterns.js
reference/es2abc --dump-assembly --opt-level 2 --target-api-version 18 --output out13.abc patterns.js
```

`--opt-level 0` 保留同样的惯用法，只是给每个参数加了 `mov`，语句之间也多一轮拷贝。`--opt-level 2` 会删掉这些拷贝，但嵌套 `for-of` 例外：外层迭代器和它的 closing 标志会在几乎每条内层指令前用 `mov` 再写一遍（同一段嵌套循环从 `-O0` 的 265 行涨到 `-O2` 的 605 行）。按操作码和异常表来认，不要按固定的指令窗口来认。

两个字节码版本发出的**指令流和 try 表相同**。旧应用包里看到的差异（zhihu 13.0.1.0、yourpipe、hx360e）来自更老的工具链，不是这个编译器写进版本号的区别。

## 1. 共用协议

这些结构都是直线代码加上**无类型的 catch-all**。try 表里没有带类型的 `catch`（用户 `catch (e)`、`finally`、迭代器关闭、async/generator 包装的 `typeIdx` 都是 0）。

### 1.1 `codeSize` 一律是 0

这个编译器在 13.0.1.0 和 24.0.0.0 上把每条 catch 的 `codeSize` 都写成 0，包括真正的 `catch (e) { return e.message }`。派发只看 `handlerPC`。handler 的范围是“从 `handlerPC` 一直到控制流离开”，不是 try 表里的那个字段。

try **长度为 0** 才是“没有保护任何指令”。`for-of` 会留一条（`try [1, 1)`），是被优化掉的迭代器获取 try。这种直接跳过。

对 `RegionGraphBuilder` 的后果：`version[0] >= 24` 不能代表这套编码。这份 `es2abc` 在 API 18 上同样发出内联 finally 的形态（第 4 节）。把“`codeSize === 0` 的 finally handler 要不要接进区域图”绑在版本字节上，会把这个编译器刚产出的 13.0.1.0 文件的异常路径清理丢掉。按 handler 的指令分类。版本门槛只适合当作**旧工具链**的兼容提示：那些 13.0.1.0 文件确实把 `finally` 内联进了出口，handler 本身是空的。

### 1.2 完成记录：`hole` 加上“还没跑过”标志

`finally` 和 `for-of` / `for-await-of` 的突发出口用同一段收尾。`hole`（`ldhole`）表示**正常完成**。pending 寄存器里的其他值都是要重抛的异常。

```text
pending = <正常路径上是 hole，catch 路径上是异常>
if (ran === undefined) {          // ran 初值是 undefined；变成 hole 或 true 表示“已经跑过”
    ran = <true 或 hole>;
    <cleanup>;                    // finally 体，或者 iterator.return()
}
if (pending !== hole) throw pending;
<正常后续>;
```

`-O2` 经常在 cleanup **之后**把 `hole` 写进标志，而不是在之前写 `true`。判断式仍然是 `flag === undefined`。

正常路径不一定落到这段收尾。源码用 `return`（或 `for-of` 里的 `break`）离开时，编译器会在这个出口**前面再内联一份 cleanup**，收尾留给异常路径。两份拷贝就是 `foldEagerCatchToFinally` 已经在用的信号。

### 1.3 catch-all 按 PC 嵌套，最内层优先

try 范围按 PC 包含关系嵌套。内层 handler 经常落在外层 try 的 PC 范围**里面**，所以内层 handler 里的 `throw` 会被外层接住。`finally` 的重抛就是这样到达外层 `catch` 的；内联 `finally` 自己抛出时，也会这样重新进入那份共享收尾。

`-O2` 下 `try { return f() } finally { g() }` 的 PC（来自解析出的 try 表）：

```text
try [4, 17)  handler 17     // 内层：try 体 + 内联的 finally，handler 是 `sta e; throw e`
try [4, 23)  handler 23     // 外层：把内层的重抛也包进去，handler 是 hole 收尾

 4  lda f; call; sta result
10  lda g; call              // 内联的 finally，同时处在两个 try 里
14  lda result; return
17  sta e; throw             // 内层 handler；这条 throw 仍在 [4, 23) 内
23  sta pending              // 外层 handler
    if (flag === undefined) g()
    flag = hole
    if (pending !== hole) throw pending
    return undefined
```

内联的 `g()` 若抛出，内层 handler 重抛，外层收尾会再跑一次 `g()`。第二次调用已经在所有 try 之外，不会成环。还原成源码级 `try/finally` 会把两份 cleanup 收成一份；这和源码一致，也和 `g()` 正常返回的那些路径一致。

### 1.4 resume mode 是 async/generator 上的同一种分流

运行时枚举 `GeneratorResumeMode` / `AsyncGeneratorResumeMode`（`ecmascript/js_generator_object.h`）：

| 值 | 模式 |
|---|---|
| 0 | `RETURN` |
| 1 | `THROW` |
| 2 | `NEXT` |
| 3 | `UNDEFINED` |

`JSGeneratorState` / `JSAsyncGeneratorState`：`UNDEFINED=0`，`SUSPENDED_START=1`，`SUSPENDED_YIELD=2`，`EXECUTING=3`，`COMPLETED=4`。async generator 另有 `AWAITING_RETURN=5`。`setgeneratorstate 2` 是“即将 yield”；`setgeneratorstate 4` 是“已完成”。

每个挂起点都是直线代码，不是 CFG 上的三路分支：

```text
<值在 acc 里>
suspendgenerator gen
resumegenerator          // acc = 传给 next/throw/return 的值
sta resumed
getresumemode
sta mode
ldai 1                   // THROW
eq mode
jeqz normal
lda resumed
throw                    // 真正的 throw：只有这条边会进 catch-all
normal:
```

`RETURN`（0）是一条普通的条件 `return`，返回 resumed 值（若挂在 `for-of` 里，会先做迭代器关闭）。`NEXT`（2）顺序落下；resumed 值就是 `yield` / `await` 的结果。`THROW` 是真正的 `throw`，所以走函数最外层的 catch-all。结构化分析应该把 `THROW` 臂删成“await/yield 表达式会抛”，而不是生成 `try`。

### 1.5 隐藏参数

`f(a, b)` 会被编成 `(a0, a1, a2, a3, a4)`：`a0` 是函数对象，`a1` 是 `new.target`，`a2` 是 `this`，用户参数从 `a3` 开始。`creategeneratorobj` 吃的是 `a0`。`asyncfunctionenter` 把 async capability 分配到局部变量，不是参数。

## 2. 怎样才算真正的 `catch`

handler 入口几乎总是 `sta vX`（异常从 `acc` 进来）。分类看这个块，不要看 `codeSize`。

| Handler 形态 | 是什么 | 区域图 |
|---|---|---|
| `sta e; throw e`（中间只允许 `mov` / `poplexenv` / `nop`） | 纯重抛跳板。用来把 try 体的异常送进外层收尾，也用来包同步 generator 的函数体，以及包 `getpropiterator`。 | 丢掉。生成 `catch (e) { throw e }` 会破坏 `for-of` 和词法环境切分。 |
| `sta e; <读 e：属性 / 调用 / 字符串 / 全局>; …` | 用户 `catch`。 | 保留。接 `TryCatchHelperRegion`。 |
| `sta pending`，后面有 `pending !== hole`，并且有一条后继是 `throw pending` | `finally` 收尾，或者 `for-of` 的 `break`/`return` 关闭。 | `finally`：内联 finally 这种形态下要保留 handler，cleanup 才出得来，然后再把两份折回去。经典的“try 体里写 hole 再跳到 cleanup”仍交给 `TryFinally`，不进区域图。 |
| `sta e; asyncfunctionreject cap; return` | 包住**整个**函数体的 async 包装。 | 丢掉。函数是 `async`。 |
| `sta e; setgeneratorstate 4; asyncgeneratorreject gen; return` | async generator 包装。 | 丢掉。`asyncgeneratorreject` 不是 `asyncfunctionreject`；只认后者的分类器仍然必须拒绝这个形态，否则 generator 外面会出现一层用户 `catch`。 |
| `sta e; if (!closing) { it.return() }; throw e` | 循环体抛出时，`for-of` / `for-await-of` 的 IteratorClose。 | 丢掉。`for-of` 变换自己会在 `return`/`throw` 上关闭迭代器。 |
| try 长度为 0 | 被折掉的范围。 | 丢掉。 |

`-O2` 下的用户 `catch` 就是 catch-all 下面的源码体。没有 `hole`。

循环里的空 `catch {}` 是特例：handler 就是闩本身（`i++; goto head`），正常出口是一条单指令 `jmp` 跳到同一个块。两条路径在那里汇合，所以 `jmp` 就是 catch 体、必须保留为异常 landing pad（`wireEmptyJoinCatches`）；而“常量日志后 `return`”那个分类器不能沿 handler 的回边走进循环体，否则同一个 try 会被接上第二个 helper（`amcl n4/o8` 的 `clearDisplayListeners`）。

```text
.catchall body_begin, body_end, handler
handler:
    sta e
    lda e
    ldobjbyname message
    return
```

## 3. `for-of` 与 `for-await-of`

### 3.1 循环头

循环本身是普通的 CFG 回边。迭代耗尽**不会**关闭迭代器（`done` 为真时规范不调用 `IteratorClose`）。

```text
lda iterable
getiterator
sta it
ldobjbyname next
sta nextFn
ldfalse
sta closing          // 一旦开始关闭就变成 true，避免第二次 return()

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
    <循环后面的代码>     // 没有 iterator.return()
```

`for await`：

```text
getasynciterator          // 代替 getiterator
lda nextFn
callthis0 it
asyncfunctionawaituncaught cap
suspendgenerator cap
resumegenerator / getresumemode / THROW 则 throw
throw.ifnotobject res
ldobjbyname done
…
```

这条路径上的 `iterator.return()` 同样要 await。整个函数是 async 函数，所以第 5 节的包装在循环外面。

`continue` 是跳回 `loop` 的 `jmp`。不碰 `closing`，也不调用 `return()`。

### 3.2 `throw` 路径上的关闭

循环体自己有一条 catch-all。handler 是 closing 标志加上 `iterator.return`，而这次 `return()` 调用还有一条**嵌套** catch-all：入口直接落到 `throw saved`，不保存新异常（这条路径上传播的是原来的循环体异常）。3.3 的 `break` / `return` 路径会把 `return()` 抛出的异常写进 `hole` 的 pending 寄存器。

```text
body catch:
    sta saved
    if (closing) throw saved
    ret = it.return
    if (ret === undefined) throw saved
    ret.call(it)              // 嵌套 catch-all → throw saved
    throw saved
```

### 3.3 `break` / `return` 路径上的关闭

这是仍要关闭迭代器的正常完成。编译器把关闭内联到原来的出口前面，并用 `hole` 收尾，让 `return()` 自己抛出的异常替换掉原来的完成值。它在调用**之前**就把 `closing = true`，并把 `it` 和 `closing` 溢写到外层 throw-handler 会读的局部变量里，这样 `return()` 抛出时不会关闭第二次。

```text
closing = true
pending = hole
ret = it.return
if (ret !== undefined) ret.call(it)     // 它的 catch-all 做 `pending = exception`
if (pending !== hole) throw pending
throw.ifnotobject retResult             // 规范：return() 的结果必须是对象
<原来的 break 或 return 值>
```

外层 `for-of` 的带标签 `break` 是同样的关闭，只是嵌套：先内层关闭，再外层关闭，然后才是外层循环后面的代码。`-O2` 会在几乎每条内层指令前用 `mov` 把外层的 `it` / `closing` 抄进内层循环，好让内层 handler 的 live-in 是显式的。不要去匹配这些 `mov`；它们是溢写。

### 3.4 还原时认什么

认循环头（`getiterator` 或 `getasynciterator`、提升出来的 `next`、`throw.ifnotobject`、`done`、`value`、回边）。凡是提到 `it.return` 或 `closing` 标志的 catch-all 都是编译器胶水，留在区域图外面。耗尽那条边是循环的 follow。循环体里的 `break` / `return` / `throw` 还原成源码语句即可；JS 的 `for-of` 自己会在 `return` 和 `throw` 上关闭迭代器。字节码在 `break` 上**也会**调用 `return()`。还原成 `for (x of xs) { if (t) break }` 之后，`break` 不关闭迭代器是宿主语言的语义，和源码级 `for-of` 一致。循环已经是 `for-of` 之后，不必再把字节码里那次显式 `return()` 留在输出里。

## 4. `for-in`

不是迭代器协议。没有 `return`，没有 `hole`，`break` 和 `return` 都不关闭。

```text
lda obj
getpropiterator
sta it
// 一条 catch-all 只包住这次获取；handler 是 `sta e; throw e`

loop:
    getnextpropname it
    sta key
    eq undefined, key
    jnez done
    <body>
    jmp loop
done:
```

获取时的 catch-all 就是第 2 节的纯重抛跳板。丢掉。循环条件是 `getnextpropname` 得到 `undefined`。循环体里的提前 `return` 就是一条普通 `return`，没有清理。还原成 `for (k in obj)`。

## 5. `try` / `catch` / `finally`

三种嵌套，全是 catch-all：

**`try/catch`。** 一个范围盖住 try 体。handler 是用户代码（第 2 节）。没有 `hole`。

**`try/finally`。** 两个范围，起始 PC 相同。

- 内层范围 = try 体；如果体里有 `return`，再加上内联的 cleanup。handler = `sta e; throw e`。
- 外层范围 = 内层范围**加上**那次重抛。handler = `hole` 收尾，cleanup 就是 `finally` 体。

体里没有 `return` 时，cleanup **不会**内联；正常路径带着 `pending = hole` 跳到收尾（`tryFinallyNoReturn`）。`finally` 体只有一份，正常完成和突发完成共用。

**`try/catch/finally`。** 内层 handler 是用户 `catch`，它在自己的 `return` 前内联 `finally`。外层 handler 仍是 `hole` 收尾，负责 catch 体抛出、以及内联 `finally` 抛出。

**`try { try { … } finally { g() } } catch (e)`。** `finally` 收尾里的 `throw pending` 落在用户 catch 的范围里，所以重抛出来的异常变成 `e`。`hole` 路径不 throw，也不会进用户 `catch`。

**`finally` 包住 `try/catch`。** try 的 `return` 和 catch 的 `return` 都会先内联 `g()`；外层收尾留给两份拷贝里抛出的异常。

`for-of` 体里的 `try` 是嵌在体范围里的 catch-all。`for-of` 的关闭 catch-all 包住整个循环体，所以也包住这个内层 `try`。从循环体抛出时，最相关的 handler 是用户 `catch`；从用户 `catch` 里（或它后面）再抛，才会落到迭代器关闭。内层 try/catch 按普通 try 归约，外层关闭继续当成 `for-of` 胶水。

## 6. `async` / `await`

```text
asyncfunctionenter
sta cap
// catch-all 盖住下面的整个函数体，不盖住 enter 本身
<body>
    <expr>
    asyncfunctionawaituncaught cap
    suspendgenerator cap
    resumegenerator / getresumemode
    if (mode === THROW) throw resumed
    <使用 resumed>
<asyncfunctionresolve cap>
return

handler:
    sta e
    asyncfunctionreject cap
    return
```

这条 catch-all 不是用户 `try`。handler 只有 `asyncfunctionreject` + `return` 时把它剥掉。每个 `await` 都是 1.4 的 resume 分流；`THROW` 臂让被拒绝的 await 走到 `asyncfunctionreject`。`RegionGraphBuilder` 在看到这层包装（`isAsyncFunction`）之后已经会删掉这条臂。

async 函数里的 `try/catch/finally` 就是第 4 节的形态，表达式能抛的地方都可以插入 await 的 resume 分流，最外层再加 async 包装。`finally` 仍然用 `hole`。`try` 里的 `return` 会先内联 `finally`，然后是 `asyncfunctionresolve`，不是一条裸的 `return`。

## 7. Generator

同步 generator，一次 yield：

```text
creategeneratorobj a0
sta gen
ldundefined
suspendgenerator gen          // SUSPENDED_START，用户代码之前
resumegenerator
getresumemode
if (mode === RETURN) return resumed
if (mode === THROW)  throw resumed
// NEXT：函数体开始。第一次 resume 的值被丢掉。

createiterresultobj value, false
suspendgenerator gen
resumegenerator               // 这次的 resumed 值才是 `yield` 的结果
getresumemode
if (mode === RETURN) return resumed
if (mode === THROW)  throw resumed
// NEXT：顺序落下

return <完成值>               // 运行时把裸 return 包成 { done: true }
```

外层 catch-all 盖住整个函数体，handler 是 `sta e; throw e`。丢掉（`checkIsGeneratorException` 看的是 try 入口里的 `creategeneratorobj`）。不要因为有这层跳板就给 generator 套 `try`。真正的重抛跳板里若有 `poplexenv`，它仍然承担词法环境的记账；结构建完之后再在 AST 上拆掉，这就是 `removeRedundantRethrowCatches` 的职责。

`for-of` 里的 `yield` 把两套协议叠在一起。yield 点上的 resume mode `RETURN` 会走 3.3 的迭代器关闭，然后 `return` resumed 值。这就是挂在循环里时调用 `generator.return()`。mode `THROW` 会 throw，循环体的关闭 catch-all 再跑 `iterator.return()`。

### Async generator

`createasyncgeneratorobj`，然后是同样的初始挂起（这个编译器会算第一次 `getresumemode` 然后丢掉结果）。`yield` 是：

```text
setgeneratorstate 2           // SUSPENDED_YIELD
asyncgeneratorresolve gen, value, /*done*/ false
resumegenerator
getresumemode
if (mode === RETURN) { … 以 done:true 完成 … }
if (mode === THROW)  throw resumed
// NEXT：resumed 值是 yield 的结果
```

完成是 `setgeneratorstate 4`（`COMPLETED`）加上 `asyncgeneratorresolve gen, value, true`。外层 handler 是 `setgeneratorstate 4; asyncgeneratorreject`。generator 里的 `await` 就是 async 函数那套 resume 分流，对象是同一个 generator。

## 8. 和结构化分析怎么接

CFG 里没有干净的“try 菱形”。handler 没有控制流前驱，只能从 try 表到达。把每条 `codeSize === 0` 都建成区域，要么会把真正的 `catch` 体剪掉（它们看起来像死代码），要么会把迭代器关闭和 async reject 的胶水拉进可归约图，然后归约失败，或者在循环外面多套一层 `try`。

实际拆分：

1. **`codeSize === 0` 的 catch-all 也要解析。** 按 handler 分类，不要按版本字节。长度为 0 的 try 跳过。
2. **保留**用户 `catch`，以及“这份 handler 是 `finally` 体唯一一份拷贝”时的 `hole` 收尾（内联 finally 形态）。只给这些接 `TryCatchHelperRegion`。
3. **丢掉**纯重抛、`for-in` 的获取、`for-of` / `for-await-of` 的关闭 handler、async 的 `asyncfunctionreject` 包装、async generator 的 `asyncgeneratorreject` 包装。resume 分流的 `THROW` / `RETURN` 臂也丢掉，让挂起点归约成一个线性表达式。
4. **在 AST 上还原**，拷贝在那里是看得见的文本：
   - `for-of` / `for-await-of` / `for-in` 从循环头认，不从 catch-all 认。
   - `finally` 用内联 cleanup 和 `hole` 收尾对齐（`foldEagerCatchToFinally`）；更老的工具链则走“体里写 `hole` 再跳到 cleanup”的计划（`TryFinally`）。
   - `async function` / `function*` / `async function*` 从 `asyncfunctionenter` / `creategeneratorobj` / `createasyncgeneratorobj` 认，前提是包装用的 catch-all 已经去掉。
5. **不要用固定窗口去认嵌套 `for-of`。** `-O2` 会把外层迭代器溢写进内层循环。关键字是 `getiterator` / `getasynciterator` / `getpropiterator`、`getnextpropname`、`ldobjbyname done|value|return|next`、`ldhole`、`suspendgenerator`。

resume 分流和 `hole` 收尾是同一件事：一条路径是值，一条路径是 `throw`，第三条（`RETURN`，或者 `pending === hole`）是仍然要跑 cleanup 的正常完成。认出这一份收尾同时覆盖 `finally`、`for-of` 关闭和 generator 的 `.return()`，这三样才不会被归约成互不相干的 `try` 嵌套。
