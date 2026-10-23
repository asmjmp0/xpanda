# xpanda 架构文档

> 鸿蒙 HarmonyOS `.abc`(Panda / ArkCompiler 字节码)反编译器,纯 TypeScript 实现(Node.js ≥ 18,零原生依赖)。
>
> 输入 `.abc` 字节码,输出可读的 JavaScript 源码;内置 AST 优化器负责清理寄存器临时变量、还原函数/类/控制流和模块语法。

## 1. 总览

```text
.abc 文件
   │
   ▼
┌──────────────────────── 反编译流水线(src/)────────────────────────┐
│ PandaFile        解析 Header / 索引 / 类 / 方法 / 字面量(Adler32) │
│   → PandaDisAssembler   字节码 → 指令对象(opcode 表)              │
│   → PandaIRCFG          基本块 CFG + SplitJump/SplitTryCatch       │
│   → PandaLexical        词法环境与虚寄存器类型推断                  │
│   → MethodHandler       指令 → Babel AST 节点                      │
│   → StructureAnalysis   Region 归约 → if/while/try 语句树          │
│       (失败降级 SimpleAnalysis:线性输出 + goto/label)              │
│   → CodeGenerator       NodeFactory/NodeUtils 操作 AST             │
│   → SimplifyExport      优化器流水线                                │
└──────────────────────────────────────────────────────────────────┘
   │
   ▼
JavaScript 源码(CLI 落盘 / stdout / 编程 API)
```

## 2. 目录结构与模块职责

```text
src/
  codec/        Leb128 / MUTF8 / Adler32 编解码
  file/         .abc 文件格式解析
  disasm/       反汇编:opcode 表、统一指令模型、CFG、词法分析
  decompiler/   结构化分析、语句树、指令 handle、支配树、降级方案
  codegen/      CodeGenerator(包装 ast/ 的 NodeFactory/NodeUtils)
  ast/          Babel AST 构建(NodeFactory/NodeUtils)
  simplify/     优化器流水线
  parallel/     按类并行的 worker 调度(worker 内只跑 simplify)
  PandaDecompiler.ts  对外总入口
  cli.ts        命令行入口
scripts/gen-opcodes.ts   isa.yaml → src/disasm/opcodes.ts 生成器
resources/isa.yaml       ArkCompiler 指令集描述(v24.0.0.0)
test/                    集成测试、样本与快照
docs/ARCHITECTURE.md     本文档
```

依赖方向:`cli / PandaDecompiler → decompiler → disasm → file → codec`;`decompiler / codegen → ast`;`SimplifyExport → simplify`;`parallel → PandaDecompiler / file`。

## 3. 文件格式层 `src/file/`

- `PandaFile.ts`:解析总入口。校验 magic `PANDA\0\0\0` 与 Adler32 → `desc/Header.ts` → lnp 偏移表 → 多个 `desc/IndexHeader.ts`(RegionHeader,含 class/method/field/proto 索引)→ foreign classes。
- `clazz/PandaClass.ts`:类结构(名称、父类、accessFlags、字段、方法、import/export 模块元数据)。
- `method/PandaMethod.ts`:方法与指令体、try/catch 描述。
- `literal/PandaLiteralArray.ts` / `PandaLiteral.ts`:字面量数组(tag + value),供对象/类定义读取初始化数据。
- `field/PandaField.ts`:字段与静态值;`moduleRecordIdx` 触发模块字面量标记。
- `desc/PandaString.ts`:MUTF8 字符串(leb128 长度 + NUL 终止)。
- `desc/PandaProto.ts` / `type/PandaType.ts`:方法 shorty 原型与字段类型。
- 解析对象按偏移缓存在 `PandaFile.offsets`,避免重复解析。

格式细节:32 位偏移读取后使用 `0x0FFFFFFF` 掩码(28 位),`-1` 表示 `0xffffffff`,Leb128 保持 32 位有符号移位语义。

## 4. 反汇编层 `src/disasm/`

- **`opcodes.ts`(生成文件,勿手改)**:由 `scripts/gen-opcodes.ts` 从 `resources/isa.yaml` 生成,包含指令名称/编码/格式/标志位。前缀指令编码 `(idx << 8) | prefixByte`;反汇编时首字节 `>= 251` 则读第二字节拼前缀。
- **`PandaInstruction.ts`(统一指令模型)**:一个指令类 + `kind` 语义标签(`mov/load/call/jumpEqual/...`),`kind` 由 `KIND_MAP` 与 flags(`JUMP/CONDITIONAL`)推导。参数解析按格式枚举名(`IMM8_V8` 等)驱动,包括 IMM4/V4 半字节打包、IMM64 读 double,以及 ID 按标志位解析为 String/Method/LiteralArray 引用。
- **跳转**:全部满足 `destinationPC = pc + 有符号 imm`;`jeq/jne/jstricteq/jnstricteq` 家族构造即抛异常,触发降级。
- **`PandaIRCFG.ts` / `PandaIRBasicBlock.ts`**:方法级 CFG。边值 `true` 表示跳转方向,`false` 表示顺序方向;`passes.ts` 提供 `SplitJump`(跳转目标切块)与 `SplitTryCatch`(try/handler 边界切块)。
- **`PandaLexical.ts`**:扫描 NewLexEnv/LoadLex/StoreLex/DefineFunc/DefineClass 等指令,记录词法层级并推断寄存器类型,同时惰性反汇编内嵌方法。

## 5. 反编译层 `src/decompiler/`

- **`MethodHandler.ts`**:指令分发(`HANDLES[kind]`)+ 函数前导(虚寄存器/acc/保留参数声明)+ 内嵌函数递归反编译。
- **`StructureAnalysis.ts`**:基于 Region 归约的结构化分析。
  - `RegionGraphBuilder`:CFG → Region 图,识别 for-in / for-of / async / generator 的合成 try-catch,为真实 try-catch 插入 `TryCatchHelperRegion`;
  - 删除单跳转 Region,合并 `&&` / `||` 短路链;
  - `reduceAcyclic` 处理 if/then/else、sequence 拼接;`reduceCyclic` 处理 while / do-while / 自环;
  - 复杂循环通过 `DominatorGraph`、`LoopFinder`、`refineLoop`、`virtualizeIrregularExits` 还原 continue/break/goto;
  - 不可归约图通过 Tail 复制修复;
  - `simplifyConditionalSequence` 生成的逻辑条件 Region 必须带 `logicalRegion`;`reduceSequence` 合并这类 Region 时要继续传播该标志,否则后续 `coalesceTailRegion` 只能用 `acc` 生成 test,丢掉 `A || B` 的计算;
  - `coalesceTailRegion` 判断是否取反时必须看 `edgeValueOrThrow()` 的 true/false 边,不能依赖 `ValueGraph.successors()` 的返回顺序;
  - `Region.copy()` 用于复制共享 Tail,必须保留 `conditionalExp` / `logicalRegion` / `exceptionLandingPad` / `tryCatchHelperRegion` 标志;
  - 超过 500 基本块或未处理的控制流会降级到 `SimpleAnalysis`。
- **`statements.ts`**:语句树(`If/While/DoWhile/Break/Continue/Goto/Label/TryCatch/LogicalExpression`),再回填为 Babel AST。
- **`SimpleAnalysis.ts`**:结构化失败时的线性降级输出,使用 `decompiler_goto` / label 模拟跳转。
- **`ValueGraph.ts` / `DominatorGraph.ts`**:稳定的有向图与支配树数据结构,供 Region 归约和循环分析使用。

## 6. 代码生成与优化 `src/codegen` + `src/ast` + `src/simplify`

- `codegen/CodeGenerator.ts`:轻包装,把 `NodeFactory`(Babel AST 构造)、`NodeUtils`(语句插入、序列表达式、async/generator 标记、goto 修复)暴露给反编译层。
- `ast/NodeFactory.ts`:Program/函数/类/表达式等 AST 节点构造,以及 `parse` / `generate` 工具。
- `ast/NodeUtils.ts`:AST 插入、序列表达式、goto/label、返回值标记等辅助操作。

### 优化器流水线

`src/simplify/SimplifyExport.ts` 采用**定点迭代**:

```text
NormalizeDeclarations
  → CallResultSimplify
  → [ReservedIdentifierSimplifier → TempVariableSimplify → AccCallSimplify → EnumSimplify → ConditionSimplify → SyntaxRewriteSimplify → ClassSyntaxSimplify] × N
  → HighLevelGrammarSimplify
  → TempVariableSimplify.foldReturnAssignments(returnsOnly)
  → TempVariableSimplify.foldConditionAssignments
  → normalizeConditionTests
  → SyntaxRewriteSimplify.hoistTestPrefixes
  → foldCompoundAssignments
```

每个 pass 返回 `boolean` 表示是否修改 AST;稳定后立即停止,最多 5 轮。

流水线尾部有四步专门处理“条件/返回值形态”(最后再做 `foldCompoundAssignments`):

- `foldReturnAssignments`(returnsOnly):`HighLevelGrammarSimplify` 的三目合成(`if (C) { X = A } else { X = B }` → `X = C ? A : B`)发生在定点迭代之后,轮内的返回值折叠已经错过;这里补一轮 `X = E; return X` 折叠,并清理随之失去引用的声明;
- `foldConditionAssignments`:定点迭代结束后,`HighLevelGrammarSimplify` 可能把 `if (!X) { X = true } else { X = false }` 合成为 `X = !X`,与已有的 `X = !X`(`callruntime.isfalse`)形成新的取反链;这一步只做 `X = E; (X = !X)*; if (X/!X)` 折叠,不重新跑复制传播;
- `normalizeConditionTests`:再归一化 if/三元 test(`!!a`、`!binary`、`!逻辑表达式` 等);
- `hoistTestPrefixes`:把 `if (A || (v1 = 0, v2 = 2, B))` 里“只给临时变量赋常量字面量”的前缀提到 if 前,要求短路分支直接 return/throw、不读取这些临时变量,且不在带 `finally` 的 try 内。

| 文件 | 职责 |
|---|---|
| `AstUtils.ts` | 纯表达式/可复制表达式判定、节点大小、无副作用遍历 |
| `NormalizeDeclarations.ts` | 归一化重复 `let` / import 声明,避免 Babel scope 冲突 |
| `ReservedIdentifierSimplifier.ts` | 还原 `panda_jmp0_reserved_*` 保留标识符 |
| `EnumSimplify.ts` | 还原 ArkTS enum 的惰性初始化字节码模式为对象字面量(`v0 = function...; v1 = E; if (!E) {...}; v0(v1)` → `E = { ... }`) |
| `TempVariableSimplify.ts` | 临时变量复制传播、死存储消除、序列表达式清理、返回值折叠、函数提升、catch 参数隔离;支持条件取反链按奇偶性折叠、test 序列内死赋值/自取反折叠,并限制非纯表达式只在真正最后一次读取时搬移;`X = E; if (X/!X) { X = B; }` 物化链按值级 last-use 折叠为 `X = E &&/|| B`(连续 if 链经定点迭代合并成一条逻辑链),自取反链头 `X = !X` 留给尾部 `foldConditionAssignments` 按奇偶性处理 |
| `AccCallSimplify.ts` | 还原 `recv = acc; acc = acc.method; acc.call(recv, ...)` 为 `recv.method(...)`;调用外层的前缀一元运算(如 `v0 = !acc.call(...)`)会剥出后再包回 |
| `ConditionSimplify.ts` | 提升 if test 中无条件求值的序列表达式、清理条件临时赋值、折叠语句级自取反链、合并 null/undefined 判断 |
| `SyntaxRewriteSimplify.ts` | if 条件化简、if/else 归一化、`.call` 还原、函数表达式/数组字面量/内置函数优化;末尾提供 `hoistTestPrefixes` |
| `ClassSyntaxSimplify.ts` | getter/setter、prototype 方法、class 表达式还原 |
| `HighLevelGrammarSimplify.ts` | if → switch / 三目、while → for / for-of、optional chaining 等 |
| `CallResultSimplify.ts` | 处理 `callIns` 调用结果被下一条 `acc` 赋值覆盖的情况 |
| `UnusedCleanupSimplify.ts` | 安全兜底清理(未读取声明/无效果表达式),默认不在主流水线中重复执行 |

关键约束:

- 复制传播限制表达式大小(默认 24 节点)并设置每函数克隆预算,避免链式表达式指数膨胀;
- 复制传播、死存储和返回值折叠都经过 liveness 与作用域检查;
- 非纯表达式(`call` / `new` / 函数/类)只在真正最后一次读取时搬移;`if` 的 test 与分支体都读同一临时变量时必须保留原赋值,否则会把调用复制成两次;
- test 序列折叠要求被赋值的临时变量在 test 之后已死、test 外无其它读取、分支/序列前缀不会先读后写;循环 test 暂不处理;
- 函数/类表达式只在安全位置搬移,避免重复执行带副作用的调用;
- 不在循环内频繁 `scope.crawl()`,大 AST 上保持线性分析。

## 7. 入口与使用

- **CLI `src/cli.ts`**:

```bash
npx tsx src/cli.ts decompile <file.abc> [-o outDir] [--no-simplify] [--stdout] [--quiet] [-j N]
```

按类名(`Lpkg/Name;` → `pkg/Name.js`)落盘。

- **并行反编译 `src/parallel/`**:
  - 入口 `decompileClassesParallel(decompiler, classes, { jobs })`,CLI 用 `-j N` 开启(`-j 0` 自动 = CPU-1,上限 4);
  - 主线程负责解析 `.abc`、反汇编、词法分析与 AST 构建(大样本实测约占总耗时 1%),worker 只接收自包含的 AST JSON 并跑 simplify(单类耗时可占 99%);
  - 派发按类指令字节数从大到小、worker 空闲即派发,减少尾部等待;结果按类序回填,与完成顺序无关;
  - `PandaDecompiler.decompileRaw()` 每类复位 `MethodHandler` 生成名计数器(`panda_jmp0_reserved_class_N`),因此单类输出与处理顺序、jobs 数量无关,串行/并行逐字一致;
  - worker 崩溃时该类自动降级到主线程 simplify,连续失败 2 次后剩余类全部主线程串行;每 worker 默认堆上限 3GB(`XPANDA_WORKER_HEAP_MB`),单个超大类的 simplify 峰值约 1.4GB,并发数不宜超过 4。

- **编程 API `src/index.ts`**:`PandaFile`、`PandaDecompiler`(`decompile` / `decompileClass` / `decompileClassRaw` / `decompileClassAst` / `saveFile`)、`decompileClassesParallel` / `resolveJobs`、`PandaLexical`、`PandaDisAssembler`、opcode 表。
- 实测(约 5.5MB 的大样本):解析约 36ms、串行约 81s、`-j 4` 约 49s(约 1.66x);瓶颈是单类 simplify 的内存/GC 带宽,而非解析或反汇编。

## 8. 验证与测试

测试入口:`test/decompile.test.ts`。

- 反编译 `test/resources/md5.abc`、`test/resources/class.abc`;
- 与 `test/expected/md5.js`、`test/expected/class.js` 逐字比较;
- 使用 Babel 再次解析输出;
- `md5.abc` 输出会实际执行,校验 `md5("admin")` 与 Node `crypto` 一致;
- `aes.abc` 输出会执行加解密自检,并通过快照覆盖条件极性(`Counter.increment` 必须是 `!== 255`)和 test 序列死赋值清理;
- `zhihupp0.59.hap` 做 HAP 轻量回归;`AbsoluteUrlParser` / `ZhihuHttpClient` 是逻辑条件传播与取反链折叠的重点样本;
- 并行一致性回归从 `zhihupp0.59.hap` 里挑小类,比较串行与 worker 输出是否逐字一致。

```bash
npm test
npm run typecheck
```

修改优化器输出后,需要先确认变化符合预期,再更新 `test/expected/*.js` 快照。

## 9. 约束与注意事项

1. `src/disasm/opcodes.ts` 是生成文件,改 `resources/isa.yaml` 后运行 `npm run gen:opcodes`,不要手改。
2. 结构化 500 块上限、`jeq` 家族异常、未注册 handle → 三种降级路径均为设计行为。
3. 前缀指令占 2 字节;新增指令 kind 映射时使用 isa.yaml 的 `sig` 首词。
4. 运行时只需 Node.js ≥ 18;`typescript` / `tsx` 仅开发期使用。
5. 降级输出可能包含 `decompiler_goto`、`break` 作用域问题或 `export ... from` 语法,解析时需要对应的 parser 配置。
6. **单类输出必须是该类的纯函数**:不要引入跨类的可变状态(全局计数器、按偏移共享的可变缓存等),否则 `-j` 并行结果会与串行不一致。生成名计数器已按类复位。
7. **条件极性由 CFG 边值决定**:`ValueGraph.successors()` 是插入顺序,不是 true/false 边顺序;`coalesceTailRegion`、`reduceIfRegion` 等必须用 `edgeValueOrThrow()`。
8. **逻辑条件 Region 的标志必须完整传播**:`reduceSequence` 要传播 `logicalRegion`,`Region.copy()` 要保留全部条件/try-catch 标志,否则 `A || B` 会退化成只读 `acc`。
9. **删除/搬移临时变量前必须做 liveness 与分支检查**:test 序列折叠、非纯表达式搬移都可能改变 `acc` 的最终值或复制调用;宁可少优化,不能改变语义。
