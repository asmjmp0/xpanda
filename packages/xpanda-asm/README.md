# xpanda-asm

加载 HarmonyOS `.abc`(Panda 字节码)文件,修改/新增实体后重新写回。用于静态 AOP、
字节码插桩、实验性工具链等场景。

## 用法

```ts
import { readFileSync, writeFileSync } from "fs";
import { PandaPatchFile, assemble } from "xpanda-asm";

const patchFile = PandaPatchFile.load(new Uint8Array(readFileSync("app.abc")));

// 1) 替换方法实现
const newCode = { numVregs: 3, numArgs: 2, instructions: Uint8Array.from([...]) };
patchFile.replaceMethodCode("L_GLOBAL;", "foo", newCode);

// 2) 新增方法(克隆已有方法的 proto/access flags)
const { methodId } = patchFile.addMethod("L_GLOBAL;", {
    name: "patched_bar",
    template: "foo",
    code: newCode, // 可选
});

// 3) 新增字符串(可用于 lda.str 等指令)
const { id } = patchFile.addStringId("L_GLOBAL;", "patched literal");

// 4) 在方法的任意指令边界插入汇编后的字节码
//    (自动修正相对跳转、try/catch 的 start/length/handlerPC;片段可以直接写参数寄存器)
patchFile.insertInstructions("L_GLOBAL;", "foo", 12, assemble("nop"));
patchFile.insertInstructions("L_GLOBAL;", "foo", 20, assemble(`
    ldai 1
    sta v7
`));

// 5) AOP 两段式:prepareMethodHead 返回随机 hook 名,patchMethodHead 内部
//    编译 hook(es2abc)→ 把 hook(class + module record)搬进目标 abc
//    → 给目标 module 追加 import 表项 → 插入函数头前导
const hookName = patchFile.prepareMethodHead("L&entry/src/main/ets/target&;", "#*#target");
patchFile.patchMethodHead(hookName, `import { ohos } from "ohop";
function ${hookName}(self, args) {
    console.log("recorded this/arguments:", self, args, ohos);
    return {};
}`, {
    // es2abc: 可选,缺省按操作系统自动定位 assets/bin/<os>/es2abc[.exe]
    // hook 里的 import:裸模块名按目标 abc 记录名后缀自动解析,
    // 也可以显式映射到运行时可解析的请求串
    moduleRequests: { ohop: "@normalized:N&&&entry/src/main/ets/common/ohop&" },
});

// 同一个 hook 挂多个函数:用同一个 hookGlobalName 多 prepare 几次,
// 然后 patchMethodHeads 一次编译/搬运、逐个插入
const multiHook = "aop_multi_hook";
patchFile.prepareMethodHead(className, "#*#targetA", { hookGlobalName: multiHook });
patchFile.prepareMethodHead(className, "#*#targetB", { hookGlobalName: multiHook });
const results = patchFile.patchMethodHeads(multiHook, `function ${multiHook}(self, args) { return {}; }`);

// 不同 hook:各自 prepare(随机名)后依次 patch;上一次 patch 的 hook 会保留
const firstHook = patchFile.prepareMethodHead(className, "#*#targetA");
const secondHook = patchFile.prepareMethodHead(className, "#*#targetB");
patchFile.patchMethodHead(firstHook, `function ${firstHook}(self, args) { return { res: 11 }; }`);
patchFile.patchMethodHead(secondHook, `function ${secondHook}(self, args) { return { res: 22 }; }`);

// 另一种写法:多个 hook 函数写在同一个源文件,一次编译、只搬一个 hook module,
// 每个 hook 各自 import 后挂到自己的目标方法;同一文件里的其它顶层函数
// 会作为该 module 的辅助函数一起搬走(与上面的示例二选一)
const bundledA = patchFile.prepareMethodHead(className, "#*#targetA");
const bundledB = patchFile.prepareMethodHead(className, "#*#targetB");
patchFile.patchHookBundle([bundledA, bundledB], `
function sharedHelper(args) { return args[0]; }
function ${bundledA}(self, args) { return { res: sharedHelper(args) }; }
function ${bundledB}(self, args) { return {}; }
`);

writeFileSync("app.patched.abc", patchFile.toBytes());
```

## 导出单个/多个 class 到新 abc

`PandaPatchFile.dumpClasses()`(或独立函数 `dumpClasses(data, names)`)把选中的类以及它们
引用到的类/方法复制成一个新的、独立的单 region `.abc`。类索引表、方法/字符串/literal
array 实体表、prototype 表都会重新生成,type id / method id / literal array 引用同步重映射;
输出反映当前 patch 会话的最新状态。

```ts
const result = patchFile.dumpClasses(["L&entry/src/main/ets/common/AppLog&;"]);
writeFileSync("AppLog.abc", result.data);
console.log(result.classes, result.dependencies);
```

限制:目前不支持带 bytecode 级父类/接口表的类(ArkTS 合并后的 abc 通常为 0)、
非 module 元数据的 VALUE 字段,以及 field-id 指令;遇到时会抛出 `Error`。

## AOP 工作流

目标 abc 先由你自己的构建流程产出(es2abc 编译的普通 abc 或 merge 后的应用包),然后:

```ts
const patchFile = PandaPatchFile.loadFile("app.abc");

const hookName = patchFile.prepareMethodHead(className, methodName);
patchFile.patchMethodHead(hookName, `function ${hookName}(self, args) {
    console.log("recorded this/arguments:", self, args);
    return {};
}`);

writeFileSync("app.patched.abc", patchFile.toBytes());
```

`patchMethodHead` 的行为(只有一种注入方式:**把 hook 作为 ES module 搬进目标 abc**):

1. `prepareMethodHead(className, methodName)` 校验目标(存在、非 generator;async 支持)并返回 hook 名;
   同一个 hook 名可以给多个方法各调用一次(显式传同一个 `hookGlobalName`);
2. `patchMethodHead(hookName, hookSource)`(单目标)、`patchMethodHeads(...)`(同一个 hook 挂多目标)
   或 `patchHookBundle([hookA, hookB, ...], hookSource)`(多个 hook 函数写在同一个源文件):
   - 读取目标 abc 的 bytecode 版本,映射到 es2abc 的 `--target-api-version`,用**相同版本**把 hook 源码
     编译成带独立 module record 的 abc(12.0.2.0→12、12.0.6.0→13、13.0.1.0→18、24.0.0.0→24;未知版本自动探测);
   - 把 **hook class 整体搬到目标 abc 的同一 region**:类实体 + 方法 + code + 字符串 + literal array
     (含嵌套)+ module record(import/export 表)全部重定位,class / method 索引表追加到文件末尾;
   - hook 源码里的入口函数会被自动改写成 `export function`(已导出/已 `export { name }` 则保持不变);
     `patchHookBundle` 会对列表里的每个 hook 分别导出,同一个源文件里的其它顶层函数作为辅助函数
     随 module 一起搬走;
   - 单 hook 的记录名是 `&xpanda/hook/<hookName>&`;bundle 只搬一个 module,记录名取
     `&xpanda/hook/<第一个 hook 名>&`,目标 module 为每个 hook 追加一条 import 表项,请求串为
     `@normalized:N&&&xpanda/hook/<记录名>&`(结果里的 `hookGlobalName` 就是各自的 `<hookName>`);
   - 给目标类所在 module 的 module record 追加 import 表项(指向 hook record);
     动态 hook 可以用 `setupClassName` 改成只给指定入口类追加 import;
   - 在方法头插入 `getunmappedargs → lda this → ldexternalmodulevar <import_idx> → callargs2 → if (res.arg) 写回参数寄存器 → if (res.res) return res.res`;
   - hook 自己的 `import ... from "x"`:显式 `moduleRequests` 映射优先;否则 `@...`/相对路径原样保留,
     裸模块名按目标 abc 的记录名后缀唯一匹配(如 `ohop` → `@normalized:N&&&.../ohop&`),
     匹配不到时原样保留(由运行时/显式映射负责);
3. 方法没有局部寄存器时自动**扩帧**并把参数寄存器整体后移(同步修正跳转、try/catch);
4. IC slot 从方法已有 slot 之后分配;
5. async 方法支持(见下方「异步函数 hook」):前导插在 `asyncfunctionenter; sta vCtx` 之后,
   早退路径用 `...; asyncfunctionresolve vCtx; return` 正确 resolve Promise;注入代码落在
   async 的 catch-all try 内,hook 抛异常会走 `asyncfunctionreject`;
6. generator 方法不支持(函数头在创建/恢复路径上的语义不同)。

要求:

- import 宿主类(缺省是目标类,动态 hook 可用 `setupClassName` 指定入口类)带 module record
  时直接追加 import;没有 module record(bundle-pack / 未合并 abc)时,
  会给类实体**硬加** `isCommonjs` + `moduleRecordIdx` 字段和一个空 module record。
  注意:运行时会因为出现 `moduleRecordIdx` 把整个 abc 当 merged abc 加载, bundle-pack 文件
  只有在确认加载方式仍成立时才这样用(更稳妥的是先合并/重新编译目标 abc);
- hook 宿主 region(setupClassName 指定时是入口类,否则是目标类)的 proto index table
  必须无效(bytecode >= 12.0.1.0);
- hook 源码必须声明 `function <hookName>(...)`(表达式形式不支持);`patchHookBundle` 里的每个 hook 名都要有同名函数
  (hook 函数写在固定文件里时,用 `prepareMethodHead(..., { hookGlobalName: "myHook" })` 让文件名与 hook 名一致,
  再把 `readFileSync(...)` 的内容作为 `hookSource` 传入);
- 缺省情况下目标类与 hook class 必须落在同一个 index region(`patchHookBundle` 的所有目标类也必须同 region,
  hook class 只搬一份);动态 hook 指定 `setupClassName` 后 hook class 搬进入口类所在 region,目标类不再受此限制;
- import 宿主的 module 不能带 namespace import(追加 regular import 会移动它们的环境下标);
- `localName` 是目标 module record 内的局部名:同一个类从 bundle 导入多个 hook 时不能共用一个自定义名,
  缺省按各自 hook 名生成。

es2abc 查找顺序:显式 `{ es2abc }` → `XPANDA_ES2ABC` → 仓库 `assets/bin/<os>/es2abc[.exe]` → `PATH`。

> 为什么搬整个 module record:hook 里的 `import` 编译成 `ldexternalmodulevar`,它按
> **当前函数所属 module record** 的 import 表解析。只搬 class 会让 hook 读到目标 module
> 的 import 表(错值/越界);把 module record 一起搬进目标 abc,并让目标 module 真正
> import 这个 record,hook 的 import 与顶层变量才能按模块语义求值。

## Hook 返回协议

hook 的签名是 `hook(this, arguments)`,返回一个对象,可以同时改写参数和提前返回:

```ts
hook(this, arguments) -> { arg?: any[]; res?: any }
```

`this` 是目标方法的接收者(实例方法/组件方法就是实例;模块级函数是 `undefined`)。

| 返回 | 行为 |
|---|---|
| `{ arg: [...] }` | **改写参数**:按顺序写回目标函数的参数寄存器(等价于 `[p0, p1] = arg`) |
| `{ res: value }` | **拦截**:目标函数直接返回 `value`,原函数体不执行 |
| `{ arg, res }` | 先改写参数,再拦截 |
| `{}` / `undefined` 字段 | **放行**:继续执行原函数 |

注入的前导等价于:

```js
const res = hook(this, arguments); // lda this → getunmappedargs → ldexternalmodulevar → callargs2
if (res.arg) {                 // ldobjbyname "arg" → callruntime.isfalse → jnez
    p0 = res.arg[0];           // ldai i → ldobjbyvalue → sta pN
    p1 = res.arg[1];
    // ... 目标的每个参数
}
if (res.res) {                 // ldobjbyname "res" → callruntime.isfalse → jnez
    return res.res;            // (async: asyncfunctionresolve vCtx; return)
}
// 否则落到原函数第一条指令
```

示例:

```ts
// 只记录,不改变行为
function hook(self, args) {
    console.log("this:", self, "args:", args);
    return {};
}

// 拦截:目标函数直接返回 42
function hook(self, args) {
    return { res: 42 };
}

// 改写参数:目标函数用 p0 = 10 / p1 = 20 执行原函数体
function hook(self, args) {
    return { arg: [10, 20] };
}
```

注意:

- hook 是**同步调用**的,不能返回 `Promise`;
- hook 收到的 `arguments` 是 `getunmappedargs` 的快照对象:有 `length` / 下标,但不是 Array 实例
  (没有 `join` 等 Array 方法);
- `this` 是目标函数的真实接收者(直接 `lda` 保留的 this 寄存器);模块级函数的 `this` 是 `undefined`;
- `arg` 按数组/类数组下标读取(`res.arg[i]`),不做迭代器解构;缺省元素写入 `undefined`;
  目标函数的每个参数都会被覆盖(参数个数 = `numArgs - 3`);
- `res.res` 按**真值**判断(`if (res.res)`),所以返回 `0` / `""` / `false` / `null` / `undefined`
  不会拦截(与源码里的 `if (res.res)` 一致);需要拦截 falsy 返回值时把协议改成
  `res.res !== undefined` 的判断;
- 参数改写发生在原函数体的第一条指令之前,函数体的默认参数逻辑会看到新值。

## 动态 hook（GlobalPatch 槽）

`{ dynamic: true }` 把方法头对 hook 函数的查找从写死的 `ldexternalmodulevar` 换成
`wide.ldpatchvar`。槽是虚拟机进程全局的 `GlobalEnv.GlobalPatch`（`u16` 下标），
`wide.stpatchvar` 写入、`wide.ldpatchvar` 读出。默认从 `0x1000` 起分配，避开系统热修编译器
常用的低位；同一个 hook 名复用同一个槽。槽必须落在 `0..0x7fff`：设备上的汇编解释器把这条
立即数按有符号 16 位送进 runtime，`0x8000` 及以上会被当成巨大的数组长度，`stpatchvar` 直接把进程打 OOM。

```ts
const hookName = patchFile.prepareMethodHead(className, methodName);
const result = patchFile.patchMethodHead(hookName, `function ${hookName}(self, args) {
    return {};
}`, { dynamic: true });

// result.patchSlot === 0x1000
// 模块初始化之后，任意 JS 可以换实现或关闭:
//   globalThis[result.setterGlobalName](newFn);  // 名字是 xpanda_set_<hookName>
//   globalThis[result.setterGlobalName](undefined);
```

setup 的触发点在缺省情况下是**目标方法所属的类**:目标 module 会 import hook 模块,
从而保证目标方法第一次执行前槽已经写好。也可以把 setup 提前到 hap 入口(例如
`EntryAbility`),这样目标类不参与 hook,槽在应用启动阶段就安装好:

```ts
const result = patchFile.patchMethodHead(hookName, hookSource, {
    dynamic: true,
    // 通常是 hap 入口类;只给这个类追加 hook import,hook class 也搬进它所在的 region
    setupClassName: "L&entry/src/main/ets/entryability/EntryAbility&;",
});
```

指定 `setupClassName` 后目标方法所在类**不再追加 import**,因此目标类可以分散在不同的
index region;代价是 setup 不再跟随目标 module 加载,入口 module 必须先于被 hook 方法的
调用完成求值(否则 `wide.ldpatchvar` 会读一张还没扩容的 `GlobalPatch` 数组)。

注入后多出来的字节码:

1. hook 模块里追加 `export function <hookName>__set(fn)`，方法体被换成
   `lda v3; wide.stpatchvar <slot>; returnundefined`（`numArgs` 沿用 es2abc 编出来的值，`numVregs` 收成 0）；
2. hook 模块末尾的 `xpanda_reserved_setup.xpanda_reserved_setup()` 统一安装本模块里的全部槽：
   `ldlocalmodulevar` 取出函数 → `wide.stpatchvar`，再 `ldglobal; stobjbyname` 把 setter 挂到
   `globalThis`（`trystglobalbyname` 要求这个名字已经是全局绑定，否则运行时直接 ReferenceError）。
   缺省由目标 module import 这个 hook 模块触发 setup;指定 `setupClassName` 时改由该入口类 import,
   从而保证 setup 在目标方法之前执行(入口 module 的求值顺序需要满足,见上方说明)；
3. 方法头先 `wide.ldpatchvar`。槽值是 hole / `undefined` / 其它 falsy 时跳过整个前导，原方法照常执行；
   否则仍按 `{ arg, res }` 协议调用。

反编译把这两条指令写成 `xpanda_reserved_patch[槽] = acc` / `acc = xpanda_reserved_patch[槽]`。`xpanda_reserved_patch` 就是运行时那张 `GlobalPatch` 数组；在 Node 里执行反编译结果时，给这个名字准备一个数组即可。

限制:

- import 宿主类(缺省是目标类,指定 `setupClassName` 时是入口类)必须在被 hook 的方法调用前
  完成模块初始化。安装代码在模块初始化时跑;`GlobalPatch` 还是空数组时执行 `wide.ldpatchvar` 是越界读；
- 这张表是整个虚拟机一份。系统热修卸载会把 `GlobalPatch` 重新设成空数组，之后的 load 同样越界；
- 调用点仍然要先写进 abc。这两条指令不能给一个没改过的方法做运行时挂载，也不能代替系统的 `ReplaceMethod`；
- 换上去的函数要遵守同一个 `(self, args) -> { arg?, res? }` 协议；
- 已经 AOT 的方法要等重新加载或 deopt 才会执行插入的字节码，和静态 hook 一样。

## 初始化回调 init

init 和 hook 一样,**由用户写函数声明**,xpanda 只负责把它导出并安排调用。
init 函数必须声明在注入的 module 源码里:

```ts
function init() {
    globalThis.__patched = true;
    console.log("xpanda init");
}
```

### 只注入 init(不 hook 任何方法)

```ts
const result = patchFile.patchInit(`
    function init() {
        globalThis.__patched = true;
    }
`, {
    // 必填:入口类负责 import 初始化 module,并在 func_main_0 里调用 init
    setupClassName: "L&entry/src/main/ets/entryability/EntryAbility&;",
    // 可选:函数名,缺省 "init"
    // initName: "init",
});

// result.moduleName / result.initName / result.importIndex / result.codeOffset
```

注入内容:把 module(函数声明 + 它用到的 import/顶层变量)搬进入口类所在 region,
给入口类 module record 追加 init 函数的 import,并在入口类 `func_main_0` 开头插入
`ldexternalmodulevar <init>; callarg0`。没有 hook、没有 GlobalPatch 槽。

### hook + init

有 hook 时,init 函数和 hook 函数写在**同一份 `hookSource`** 里,用 `init` 选项指定函数名:

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
    init: "init",   // 必须是 hookSource 里声明的函数
});
```

- **dynamic**:入口 module 先 import hook module(执行 `xpanda_reserved_setup` 写槽),
  然后 `func_main_0` 调用 init,即 **setup 完成后**再执行 init;
- **static**:入口 module 直接 import hook module 并在 `func_main_0` 调用 init;
- `init` 缺省:不注入 init import,也不插入调用;
- 指定 `init` 时**必须**同时指定 `setupClassName`(入口类),否则报错;
- init 函数和 hook 函数一样会被改写成 `export function`(已经是导出形式则保持);
- 静态 hook 也可以配合 `init` 使用 `setupClassName`;不配 `init` 时静态 hook 仍然不允许该选项;
- 入口类必须有 `func_main_0`;没有 module record 时仍按前面的规则硬加。

## 异步函数 hook

用法与同步函数完全相同(`prepareMethodHead` 会自动识别 async 函数),不需要额外参数:

```ts
// 目标:export async function fetchUser(id: string) { ... }
const hookName = patchFile.prepareMethodHead(className, "#*#fetchUser");
patchFile.patchMethodHead(hookName, `function ${hookName}(self, args) {
    const id = args[0];
    if (id === "test") return { res: { name: "mock" } }; // await fetchUser("test") -> { name: "mock" }
    return {};                                           // 继续执行原异步函数
}`);
```

内部处理:

1. async 函数头是 `asyncfunctionenter; sta vCtx`,await 恢复时从 `suspendgenerator` 之后继续,
   **不会重跑函数头**;前导插在 `sta vCtx` 之后,每次调用只执行一次;
2. 临时寄存器避开 `vCtx`;
3. 早退路径会先 `asyncfunctionresolve vCtx` 再 `return`,所以 `{ res: value }` 返回的是
   `Promise.resolve(value)`;
4. 注入代码位于 async 的 catch-all try 内,hook 抛异常会走 `asyncfunctionreject`,
   表现为 Promise rejection,而不是同步抛出。

限制:hook 本身是同步的,不能 `await`;需要异步逻辑时只能在 hook 里同步返回结果。
generator 函数不支持(函数头在创建/恢复路径上的语义不同)。

## 实现方式

append-only patcher:

- 原始字节不变,新实体追加到文件末尾(4 字节对齐);
- 定长指针原位改写(方法的 CODE tag、类索引表项);
- 需要改长度的实体(类实体,用于加方法 / 搬运 hook class)整体复制到末尾,再重定位引用它的索引表;
- 写回时更新 `file_size` 与 Adler32 checksum。

## 当前支持范围(v0)

- ✅ 替换方法代码(`replaceMethodCode`)
- ✅ 新增方法(`addMethod`,克隆已有方法的 proto/access flags)
- ✅ 新增字符串 / 字符串 id(`addString` / `addStringId`)
- ✅ 在任意指令边界插入汇编字节码(`insertInstructions`):自动修正相对跳转、try/catch 范围;片段可以写参数寄存器(`index >= numVregs`),不会改变帧布局
- ✅ AOP 函数头 hook:`prepareMethodHead` + `patchMethodHead(s)` / `patchHookBundle`,支持一个 hook 挂多个函数、多个 hook、多个 hook 写在同一个源文件、async 函数
- ✅ 动态 hook(`{ dynamic: true }`):方法头 `wide.ldpatchvar` 读 GlobalPatch 槽,hook 模块的 `xpanda_reserved_setup` 用 `wide.stpatchvar` 装初始函数,`globalThis.xpanda_set_<hook>` 运行时替换;可用 `setupClassName` 把 setup import 提前到 hap 入口类
- ✅ 初始化回调 init:可单独调用 `patchInit(moduleSource, { setupClassName })`(不 hook 方法),也可在 `patchMethodHead(s)` 里传 `init: "<函数名>"` 把 init 函数和 hook 函数写在同一份源码;dynamic 在 setup 之后、static 直接由入口类 `func_main_0` 调用
- ✅ AOP hook 统一走 module record 搬运:hook class 的 import/export 表随类整体搬进目标 abc,目标 module 追加 import,前导用 `ldexternalmodulevar` 调用(hook 内部的 import / 顶层变量可正常解析)
- ✅ 同一次会话里连续新增方法 / 追加字符串 / 替换代码 / 连续插入(代码模型会累积最新版本)
- ✅ 无修改时字节级 round-trip
- ✅ 已在 bytecode 11.0.2.0 / 12.0.2.0 / 13.0.1.0 / 24.0.0.0(merged abc)上验证
- ✅ 产物通过 xpanda 反编译 + es2abc(`--enable-abc-input`)二次解析

限制:

- ⏳ 新增任意类 / 新增 proto / 新增 literal array(目前仅 AOP 的 hook class 搬运支持 class/literal array 导入)
- ⚠️ hook class 搬运要求目标 proto index table 无效(>= 12.0.1.0),且 class 无父类/接口;没有 module record 的目标会被硬加 module 字段(bundle-pack 文件会因此被运行时按 merged 语义加载)
- ⚠️ hook module 的 import 需要能在目标 abc 的运行时里解析(裸模块名走记录名后缀匹配,或显式 `moduleRequests`)
- ⚠️ 替换代码/插入代码时保留原 debug info(行号可能过时,不影响执行)
- ⚠️ 插入的指令会真实执行:片段若改写 `acc`/寄存器,需要自行保证不破坏后续代码的寄存器状态
- ⚠️ 插入片段内部的相对跳转只能指向片段内部(或片段末尾);引用原有指令的跳转需要自行换算,当前直接拒绝
- ⚠️ `addMethod` 之后新方法不会出现在 `getMethodNames()` / `getMethodCode()` 里,需要重新 `PandaPatchFile.load(toBytes())`
- ⚠️ 多 index section 的文件只允许对最后一个 region 内的类 `addMethod`;其它 region 会抛错
- ⚠️ 依赖 xpanda-core 的只读解析器定位实体;带注解 tag 的类/方法实体暂不支持

## 汇编器(xpanda-asm)

本库的 `src/Assembler.ts` 由 `xpanda-core` 的 `gen-opcodes.ts` 生成的操作数布局驱动:

```ts
import { assemble, assembleInstruction, decodeInstructions } from "xpanda-asm";

assemble("nop");                                  // -> Uint8Array [0xd5]
assemble("ldai 1");                               // 立即数
assemble(`
  ldai 1
  sta v0
`);                                               // 多条指令
assembleInstruction("mov", [0, 1]);               // 0x44 0x10(自动选最小变体)
assembleInstruction("mov", [0, 1], { format: "V8_V8" });
decodeInstructions(bytes);                        // 结构化解码(用于插入时的跳转修正)
```

汇编器对 md5/class/aes 样本的每条指令做了解码→重汇编的逐字节 round-trip。

## 测试

```bash
yarn workspace xpanda-asm test
```
