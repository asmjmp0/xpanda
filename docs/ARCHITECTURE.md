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
  PandaDecompiler.ts  对外总入口
  cli.ts        命令行入口
scripts/gen-opcodes.ts   isa.yaml → src/disasm/opcodes.ts 生成器
resources/isa.yaml       ArkCompiler 指令集描述(v24.0.0.0)
test/                    集成测试、样本与快照
docs/ARCHITECTURE.md     本文档
```

依赖方向:`cli / PandaDecompiler → decompiler → disasm → file → codec`;`decompiler / codegen → ast`;`SimplifyExport → simplify`。

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
  → [ReservedIdentifierSimplifier → TempVariableSimplify → ConditionSimplify → SyntaxRewriteSimplify → ClassSyntaxSimplify] × N
  → HighLevelGrammarSimplify
  → normalizeConditionTests / foldCompoundAssignments
```

每个 pass 返回 `boolean` 表示是否修改 AST;稳定后立即停止,最多 5 轮。

| 文件 | 职责 |
|---|---|
| `AstUtils.ts` | 纯表达式/可复制表达式判定、节点大小、无副作用遍历 |
| `NormalizeDeclarations.ts` | 归一化重复 `let` / import 声明,避免 Babel scope 冲突 |
| `ReservedIdentifierSimplifier.ts` | 还原 `panda_jmp0_reserved_*` 保留标识符 |
| `TempVariableSimplify.ts` | 临时变量复制传播、死存储消除、序列表达式清理、返回值折叠、函数提升、catch 参数隔离 |
| `ConditionSimplify.ts` | 提升 if test 中无条件求值的序列表达式、清理条件临时赋值、合并 null/undefined 判断 |
| `SyntaxRewriteSimplify.ts` | if 条件化简、if/else 归一化、`.call` 还原、函数表达式/数组字面量/内置函数优化 |
| `ClassSyntaxSimplify.ts` | getter/setter、prototype 方法、class 表达式还原 |
| `HighLevelGrammarSimplify.ts` | if → switch / 三目、while → for / for-of、optional chaining 等 |
| `CallResultSimplify.ts` | 处理 `callIns` 调用结果被下一条 `acc` 赋值覆盖的情况 |
| `UnusedCleanupSimplify.ts` | 安全兜底清理(未读取声明/无效果表达式),默认不在主流水线中重复执行 |

关键约束:

- 复制传播限制表达式大小(默认 24 节点)并设置每函数克隆预算,避免链式表达式指数膨胀;
- 复制传播、死存储和返回值折叠都经过 liveness 与作用域检查;
- 函数/类表达式只在安全位置搬移,避免重复执行带副作用的调用;
- 不在循环内频繁 `scope.crawl()`,大 AST 上保持线性分析。

## 7. 入口与使用

- **CLI `src/cli.ts`**:

```bash
npx tsx src/cli.ts decompile <file.abc> [-o outDir] [--no-simplify] [--stdout] [--quiet]
```

按类名(`Lpkg/Name;` → `pkg/Name.js`)落盘。

- **编程 API `src/index.ts`**:`PandaFile`、`PandaDecompiler`(`decompile` / `decompileClass` / `decompileClassRaw` / `saveFile`)、`PandaLexical`、`PandaDisAssembler`、opcode 表。
- 当前为顺序处理;大文件可用 `--no-simplify` 跳过优化器,或自行在外层按类并行。

## 8. 验证与测试

测试入口:`test/decompile.test.ts`。

- 反编译 `test/resources/md5.abc`、`test/resources/class.abc`;
- 与 `test/expected/md5.js`、`test/expected/class.js` 逐字比较;
- 使用 Babel 再次解析输出;
- `md5.abc` 输出会实际执行,校验 `md5("admin")` 与 Node `crypto` 一致;
- `bilibili_open.abc` 用于大文件手动回归。

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
