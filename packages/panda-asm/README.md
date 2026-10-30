# panda-asm

加载 HarmonyOS `.abc`(Panda 字节码)文件,修改/新增实体后重新写回。用于静态 AOP、
字节码插桩、实验性工具链等场景。

## 用法

```ts
import { readFileSync, writeFileSync } from "fs";
import { assemble } from "xpanda-core";
import { PandaPatchFile } from "panda-asm";

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
//    (自动修正相对跳转、try/catch 的 start/length/handlerPC、numVregs)
patchFile.insertInstructions("L_GLOBAL;", "foo", 12, assemble("nop"));
patchFile.insertInstructions("L_GLOBAL;", "foo", 20, assemble(`
    ldai 1
    sta v7
`));

// 5) AOP 两段式:prepareMethodHead 返回随机 hook 名,patchMethodHead 内部
//    编译 hook(es2abc)→ merge → 插入函数头前导
const hookName = patchFile.prepareMethodHead("L&entry/src/main/ets/target&;", "#*#target");
patchFile.patchMethodHead(hookName, `function ${hookName}(args) {
    console.log("recorded arguments:", args);
    return [1];
}`, { /* es2abc: 可选,缺省按操作系统自动定位 assets/bin/<os>/es2abc[.exe] */ });

// 同一个 hook 挂多个函数:用同一个 hookGlobalName 多 prepare 几次,
// 然后 patchMethodHeads 一次编译/merge、逐个插入
const multiHook = "aop_multi_hook";
patchFile.prepareMethodHead(className, "#*#targetA", { hookGlobalName: multiHook });
patchFile.prepareMethodHead(className, "#*#targetB", { hookGlobalName: multiHook });
const results = patchFile.patchMethodHeads(multiHook, `function ${multiHook}(args) { return [1]; }`);

// 不同 hook:各自 prepare(随机名)后依次 patch;上一次 patch 的 hook 会保留
const firstHook = patchFile.prepareMethodHead(className, "#*#targetA");
const secondHook = patchFile.prepareMethodHead(className, "#*#targetB");
patchFile.patchMethodHead(firstHook, `function ${firstHook}(args) { return [0, 11]; }`);
patchFile.patchMethodHead(secondHook, `function ${secondHook}(args) { return [0, 22]; }`);

writeFileSync("app.patched.abc", patchFile.toBytes());
```

## AOP 工作流

目标 abc 先由你自己的构建流程产出(es2abc 编译/merge 的应用包),然后:

```ts
const patchFile = PandaPatchFile.loadFile("app.abc");

const hookName = patchFile.prepareMethodHead(className, methodName);
patchFile.patchMethodHead(hookName, `function ${hookName}(args) {
    console.log("recorded arguments:", args);
    return [1];
}`);

writeFileSync("app.patched.abc", patchFile.toBytes());
```

`patchMethodHead` 的行为:

1. `prepareMethodHead(className, methodName)` 校验目标(存在、非 generator;async 支持)并返回 hook 名;
   同一个 hook 名可以给多个方法各调用一次(显式传同一个 `hookGlobalName`);
2. `patchMethodHead(hookName, hookSource)`(单目标)或 `patchMethodHeads(...)`(多目标,返回全部结果):
   - 把 hook 源码包装成 module,并自动追加 `globalThis.<hookName> = <hookName>;`;
   - 读取目标 abc 的 bytecode 版本,映射到 es2abc 的 `--target-api-version`;
   - 用**相同版本**编译 hook module(12.0.2.0→12、12.0.6.0→13、13.0.1.0→18、24.0.0.0→24;未知版本自动探测);
   - 用**相同版本**执行 es2abc abc-input merge(否则 merge 会把结果升级成工具默认版本,例如 13.0.1.0 → 24.0.0.0);
   - 合并后校验版本未变化,再在方法头插入 `getunmappedargs → 取全局 hook → callarg1 → res[0] === 0 → return res[1]`;
3. 方法没有局部寄存器时自动**扩帧**并把参数寄存器整体后移(同步修正跳转、try/catch);
4. IC slot 从方法已有 slot 之后分配;
5. async 方法支持(见下方「异步函数 hook」):前导插在 `asyncfunctionenter; sta vCtx` 之后,
   早退路径用 `...; asyncfunctionresolve vCtx; return` 正确 resolve Promise;注入代码落在
   async 的 catch-all try 内,hook 抛异常会走 `asyncfunctionreject`;
6. generator 方法不支持(函数头在创建/恢复路径上的语义不同)。

es2abc 查找顺序:显式 `{ es2abc }` → `XPANDA_ES2ABC` → 仓库 `assets/bin/<os>/es2abc[.exe]` → `PATH`。
目标 filesInfo 默认从 `L&...&;` record 推导(单 record 目标可直接用);多 record 应用请传
`patchMethodHead(..., { targetFilesInfo })`。真实应用中目标模块需要确保 hook module 已初始化
(注入代码按全局名查找),否则会抛 `ReferenceError`。

## Hook 返回协议

hook 返回一个二元组 `[code, value]`:

```ts
hook(arguments) -> [code, value]
```

| 返回 | 行为 |
|---|---|
| `[0, value]` | **拦截**:目标函数直接返回 `value`,原函数体不执行 |
| `[1]` / `[1, anything]` / 其它非 0 | **放行**:继续执行原函数,`value` 被忽略 |
| `[0]` / `[0, undefined]` | 拦截并返回 `undefined` |

判断条件是严格等于 `0`(即 `res[0] === 0`),所以 `[1]` 只表示“不拦截”,不需要第二个元素。

注入的前导等价于:

```js
const res = hook(arguments);   // getunmappedargs → tryldglobalbyname → callarg1
if (res[0] === 0) {            // ldobjbyvalue res[0] → ldai 0 → stricteq
    return res[1];             // ldobjbyvalue res[1] → return
}
// 否则落到原函数第一条指令
```

示例:

```ts
// 只记录,不拦截:目标函数行为不变
function hook(args) {
    console.log("args:", args);
    return [1];
}

// 拦截:目标函数直接返回 42
function hook(args) {
    return [0, 42];
}
```

注意:

- hook 是**同步调用**的,必须直接返回数组,不能返回 `Promise<[1]>`;
- `res[0]` 只认数字 `0`(`false` 等其它 falsy 值不会触发拦截);
- `[1]` 与 `[1, x]` 等价,`x` 不会被读取。

## 异步函数 hook

用法与同步函数完全相同(`prepareMethodHead` 会自动识别 async 函数),不需要额外参数:

```ts
// 目标:export async function fetchUser(id: string) { ... }
const hookName = patchFile.prepareMethodHead(className, "#*#fetchUser");
patchFile.patchMethodHead(hookName, `function ${hookName}(args) {
    const id = args[0];
    if (id === "test") return [0, { name: "mock" }]; // await fetchUser("test") -> { name: "mock" }
    return [1];                                      // 继续执行原异步函数
}`);
```

内部处理:

1. async 函数头是 `asyncfunctionenter; sta vCtx`,await 恢复时从 `suspendgenerator` 之后继续,
   **不会重跑函数头**;前导插在 `sta vCtx` 之后,每次调用只执行一次;
2. 临时寄存器避开 `vCtx`;
3. 早退路径会先 `asyncfunctionresolve vCtx` 再 `return`,所以 `[0, value]` 返回的是
   `Promise.resolve(value)`;
4. 注入代码位于 async 的 catch-all try 内,hook 抛异常会走 `asyncfunctionreject`,
   表现为 Promise rejection,而不是同步抛出。

限制:hook 本身是同步的,不能 `await`;需要异步逻辑时只能在 hook 里同步返回结果。
generator 函数不支持(函数头在创建/恢复路径上的语义不同)。

## 实现方式

append-only patcher:

- 原始字节不变,新实体追加到文件末尾(4 字节对齐);
- 定长指针原位改写(方法的 CODE tag、类索引表项);
- 需要改长度的实体(类实体,用于加方法)整体复制到末尾,再重定位引用它的索引表;
- 写回时更新 `file_size` 与 Adler32 checksum。

## 当前支持范围(v0)

- ✅ 替换方法代码(`replaceMethodCode`)
- ✅ 新增方法(`addMethod`,克隆已有方法的 proto/access flags)
- ✅ 新增字符串 / 字符串 id(`addString` / `addStringId`)
- ✅ 在任意指令边界插入汇编字节码(`insertInstructions`):自动修正相对跳转、try/catch 范围、numVregs
- ✅ AOP 函数头 hook:`prepareMethodHead` + `patchMethodHead(s)`,支持一个 hook 挂多个函数、多个 hook、async 函数
- ✅ 同一次会话里连续新增方法 / 追加字符串 / 替换代码 / 连续插入(代码模型会累积最新版本)
- ✅ 无修改时字节级 round-trip
- ✅ 已在 bytecode 11.0.2.0 / 12.0.2.0 / 13.0.1.0 / 24.0.0.0(merged abc)上验证
- ✅ 产物通过 xpanda 反编译 + es2abc(`--enable-abc-input`)二次解析

限制:

- ⏳ 新增类 / 新增 proto / 新增 literal array(后续)
- ⚠️ 替换代码/插入代码时保留原 debug info(行号可能过时,不影响执行)
- ⚠️ 插入的指令会真实执行:片段若改写 `acc`/寄存器,需要自行保证不破坏后续代码的寄存器状态
- ⚠️ 插入片段内部的相对跳转只能指向片段内部(或片段末尾);引用原有指令的跳转需要自行换算,当前直接拒绝
- ⚠️ `addMethod` 之后新方法不会出现在 `getMethodNames()` / `getMethodCode()` 里,需要重新 `PandaPatchFile.load(toBytes())`
- ⚠️ 多 index section 的文件只允许对最后一个 region 内的类 `addMethod`;其它 region 会抛错
- ⚠️ 依赖 xpanda-core 的只读解析器定位实体;带注解 tag 的类/方法实体暂不支持

## 汇编器(xpanda-core)

`panda-core` 的 `src/asm/Assembler.ts` 由 `gen-opcodes.ts` 生成的操作数布局驱动:

```ts
import { assemble, assembleInstruction, decodeInstructions } from "xpanda-core";

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
yarn workspace panda-asm test
```
