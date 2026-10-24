# xpanda 架构文档

> [English](./ARCHITECTURE.md) | 简体中文

鸿蒙 HarmonyOS `.abc`(Panda / ArkCompiler 字节码)反编译器,纯 TypeScript 实现(Node.js ≥ 18,零原生依赖)。指令集描述对应字节码版本 **24.0.0.0**;输出在低至 **13.0.1.0** 的样本上验证通过。

输入 `.abc` 字节码(或 `.hap` 应用包),输出可读的 JavaScript 源码。内置 AST 优化器负责清理寄存器临时变量、还原函数/类/控制流语法和模块(import/export)语法。

## 1. 总览

```text
.abc 文件(或 .hap → ZipFile → .abc 条目)
   │
   ▼
┌────────────────────── 反编译流水线(src/)────────────────────────┐
│ PandaFile        解析 Header / 索引区 / 类 / 字面量               │
│                  (Adler32 校验,偏移缓存)                          │
│   → PandaLexical       反汇编 + 词法环境栈 + 寄存器类型推断         │
│                        (按类执行,方法级惰性)                       │
│   → PandaDecompiler.decompileRaw                                  │
│       → MethodHandler      指令 → Babel AST 节点                   │
│       → StructureAnalysis  Region 归约 → if/while/try 语句树       │
│           (失败降级 SimpleAnalysis:线性输出 + goto/label)          │
│   → SimplifyExport     优化器流水线(定点迭代)                      │
│   → NodeFactory.generate  AST → JavaScript 文本                    │
└───────────────────────────────────────────────────────────────────┘
   │
   ▼
JavaScript 源码(落盘 / stdout / 编程 API)
```

主线程始终负责解析、反汇编、词法分析与 AST 构建;只有 *simplify* 阶段可以交给 worker 线程(见 §10)。

## 2. 目录结构与模块职责

| 路径 | 职责 |
|---|---|
| `src/codec/` | Leb128 / MUTF8 / Adler32 编解码 |
| `src/file/` | `.abc` 文件格式解析 |
| `src/hap/` | HAP 应用包适配:只读 ZIP(`ZipFile.ts`)+ `.abc` 条目 / `module.json` / `resources.index`(`HapFile.ts`) |
| `src/res/` | `resources.index` 解析(兼容 Restool 与 RestoolV2 格式)为可查询的资源项 |
| `src/disasm/` | 反汇编:生成的 opcode 表、统一指令模型、CFG、词法分析 |
| `src/decompiler/` | 结构化分析(Region 归约)、语句树、指令 handle、支配树、降级方案、try/finally 还原 |
| `src/codegen/` | `CodeGenerator` —— 包装 `src/ast/` 的轻封装 |
| `src/ast/` | Babel AST 构建与文本生成(`NodeFactory` / `NodeUtils` / `FormatCode`) |
| `src/simplify/` | 优化器流水线 |
| `src/parallel/` | 按类并行的 simplify worker 池 |
| `src/mcp/` | 把反编译器暴露给 AI agent 的 MCP Server(见 [MCP.md](./MCP.md)) |
| `src/PandaDecompiler.ts` | 对外总入口(单类编排) |
| `src/cli.ts` | 命令行入口:`decompile` 与 `unpack-index` 命令 |
| `scripts/gen-opcodes.ts` | 从 `resources/isa.yaml` 生成 `src/disasm/opcodes.ts` |
| `resources/isa.yaml` | ArkCompiler 指令集描述(v24.0.0.0) |
| `test/` | 集成测试、样本(`*.abc`、`*.hap`)与快照(`test/expected/*.js`) |

依赖方向:`cli / PandaDecompiler → decompiler → disasm → file → codec`;`decompiler / codegen → ast`;`SimplifyExport → simplify`;`parallel → PandaDecompiler / file`;`mcp / hap → res`。

## 3. 文件格式层 —— `src/file/`

### 3.1 解析流程(`PandaFile.ts`)

1. **Header**(`desc/Header.ts`):magic `PANDA\0\0\0`(8 字节),60 字节头,包含版本、文件大小、foreign class 偏移/大小、类索引偏移、lnp 信息、字面量数组与索引区偏移。
2. **校验和**:对字节 `[12, len)` 做 Adler32,掩码 `0x0fffffff`,与 `header.checksum` 比较。不匹配抛 `PandaParseException`("may be encrypted")。
3. **lnp 偏移表**:`numLnps` × 4 字节条目,包装为 `Offset` 对象。
4. **索引区**(`desc/IndexHeader.ts`,即 RegionHeader):`numIndexes` × 40 字节头,各自持有起止偏移与 class/method/field/proto 索引(size + offset)。自字节码 **12.0.1.0** 起 field/proto 索引以 `0xffffffff` 作废(两者均为 `null`)。另承载用于标记模块记录字面量数组的 module-literal 集合。
5. **Foreign classes**:顺序遍历 foreign class 区域;每个 `PandaClass` 记录已消费字节数以便推进。

所有解析产物通过静态 `create(pandaFile, offset, …)` 工厂缓存在 `PandaFile.offsets`(一个 `Map<number, unknown>`)中 —— 同一偏移永远返回同一对象实例。

**偏移处理细节**:32 位值按小端 int32 读取;`-1` 表示 `0xffffffff`,其余一律掩码到 28 位(`& 0x0fffffff`)。Leb128 解码保持 Java `int` 语义(32 位有符号移位,`count < 5` 上限)。注意:资源层**刻意不**复用 28 位掩码(资源 ID 可达 `0x0300002E`)。

### 3.2 实体

- `clazz/PandaClass.ts`:名称、父类、accessFlags、字段、方法与模块元数据。解析是惰性的(`resolve()` 由标志位守护):interface/source-lang 标签、字段、方法。注解数据结构**直接抛异常**(不需要)。名为 `moduleRecordIdx` 的字段触发 `PandaClassModuleData` 创建。
  - 模块元数据:模块路径前缀(`@bundle:` / `@module:` / `@package:` / `@native:` / `@ohos:` / `@hms:` / `@app:` / `@normalized:`)、import(NAMESPACE / DEFAULT / SPECIFIER / SAME_SPECIFIER)、export(LOCAL / INDIRECT / ALL)。合成局部名 `"*default*"` 被重命名为 `panda_jmp0_reserved_export_default`。
- `method/PandaMethod.ts`:标签遍历(CODE / SOURCE_LANG / DEBUG_INFO / ANNOTATION),external 方法在读到 accessFlag 后即止。`disAssemble()` 以惰性 `require` 引入 `PandaDisAssembler` 打破循环依赖。`PandaMethodCode` 持有 numVregs / numArgs / codeSize / try 块 + 原始指令字节。
- `literal/PandaLiteralArray.ts` / `PandaLiteral.ts`:字面量数组(`u32 count` + tag/value 对)。真实对数为 `⌊count / 2⌋`;每个 tag 决定值宽度(STRING/METHOD/INTEGER… 4 字节,DOUBLE 8 字节,BOOL/ACCESSOR/NULLVALUE… 1 字节,METHODAFFILIATE 2 字节)。任何 `ARRAY_*` 标签提前终止循环。未知 tag 抛异常。
- `desc/PandaString.ts`:MUTF-8 字符串 —— leb128 `utf16Size`,其中 bit 0 兼作 ASCII 标志(`isAscii = (utf16Size & 1) === 1`,字节大小 = `utf16Size >> 1`),内容 NUL 结尾。
- `field/PandaField.ts`、`desc/PandaProto.ts`、`type/PandaType.ts`:字段/静态值与 shorty/proto 解析。

## 4. 容器与资源层 —— `src/hap/` + `src/res/`

- `hap/ZipFile.ts`:极简**只读** ZIP 读取器。从文件尾部定位 EOCD,遍历中央目录,拒绝加密条目,支持 **store** 与 **deflate**(经 `zlib.inflateRawSync`)。不支持 ZIP64,无按条目缓存。`ZipFile.isZip(data)` 嗅探 PK 签名 —— CLI 对任意 ZIP 容器都走 HAP 流程。
- `hap/HapFile.ts`:包装 `ZipFile`;暴露 `getAbcEntries()`(归档顺序的非目录 `*.abc` 条目)、`getModuleJson()`(解析失败返回 `null`)、`getResourcesIndexData()`(原始字节)与 `getResourceEntries()`(`resources/` 下的条目)。
- `res/ResourceIndexFile.ts`:解析**两种格式**的 `resources.index`。头部以 128 字节版本字符串开始;`"Restool …"` 选择旧版布局,其余(如 `"RestoolV2 …"`)选择新版三段式布局(KEYS / IDSS / DATA + 字符串池)。产出 `items: ResourceItem[]` —— 每个(资源 × 限定词配置)一项。
- `res/ResourceItem.ts`:名称、数字 ID、资源类型、限定词 key 参数、原始数据、`limitKey`(限定词目录名,如 `base` / `en_US` / `dark`)、`value`(字符串,PLURAL/STRARRAY 为 `string[]`)与 `typeName`。
- `res/ResourceUtils.ts` / `res/ResourceEnums.ts`:小端读取(u32 **不掩码** —— 见 §3.1)、NUL 截断的 UTF-8 辅助、限定词取值格式化、资源 key/type 枚举。

## 5. 编解码层 —— `src/codec/`

- `Leb128.ts`:有状态解码器,Java `int` 语义 —— 32 位有符号移位、5 字节上限、`-1` 结果以无符号 `0xffffffff` 暴露;另有静态有符号/无符号写入器。
- `MUTF8.ts`:解码在 NUL 处停止;校验 2/3 字节形式;编码器覆盖 ArkTS 实际产出的 BMP 子集。
- `Adler32.ts`:教科书式 mod-65521 实现(`(s2 << 16) | s1`)。

## 6. 反汇编层 —— `src/disasm/`

### 6.1 Opcode 表(`opcodes.ts`)—— 生成文件,勿手改

由 `scripts/gen-opcodes.ts` 依据 `resources/isa.yaml` 生成(`npm run gen:opcodes`)。包含 `BYTECODE_VERSION`、每条指令的标志位(`OPCODE_FLAG`,如 JUMP / CONDITIONAL / TYPE_ID / ACC_READ / ACC_WRITE)、格式参数大小与查找表(`OPCODES`、`OPCODE_BY_CODE`)。最后一条指令编码为 **251**;前缀指令编码为 `(idx << 8) | prefixByte`,因此首字节 `>= 251` 即为 2 字节 opcode。

### 6.2 统一指令模型(`PandaInstruction.ts`)

用一个指令类替代约 200 个 per-opcode 子类。每条指令携带:

- `kind` —— 语义标签(约 50 种:`mov`、`load`、`call`、`jumpEqual`……),由 `KIND_MAP`(opcode 名 → kind)与 opcode 标志位推导(`classifyKind`:带 JUMP 标志的映射为 `jumpDirect` / `jumpEqual`(jeqz)/ `jumpNotEqual`(jnez),其余归为 `jumpPlain`;未登记的名字回退 `unknown`)。
- 按格式名解析的参数(`IMM8_V8` 等):IMM4/V4 半字节打包、IMM64 按 float64 读取、ID 参数按 opcode 标志位解析为 String / Method / LiteralArray / Type / Field 引用。
- 按 kind 的语义字段 —— 如调用类指令暴露 `thisObj` / `callParams`;`defineClassWithBuffer` 把字面量数组解析为方法描述(含 sendable class 变体)。
- 跳转目标:`destinationPC = pc + 有符号 imm`(最后一个立即数参数)。`ldai` 与跳转偏移是有符号的,其余立即数均无符号。
- 寄存器参数:索引 `>= numVregs` 即参数(`p0..pN-3`);前三个槽位是 `func` / `new.target` / `this`,打印为保留名 `panda_jmp0_reserved_param_pN`。

**降级触发器**:`jeq` / `jne` / `jstricteq` / `jnstricteq` 家族(无 `z` 后缀的条件跳转编码)构造即抛异常。含这些指令的方法在词法分析阶段被跳过,后续输出为占位函数体。

### 6.3 CFG 构建(`PandaDisAssembler.ts`、`ir.ts`)

对指令字节做单遍扫描,产出以终止符切分的 `PandaIRBasicBlock`(入口块名为 `entry`,其余 `label_<pc>`),喂给 `PandaIRCFG`(块的 `ValueGraph`)。随后跑两个归一化 pass:`runSplitJumpPass`(在落在块中间的跳转目标处切块)与 `runSplitTryCatchPass`(在 try 起止与 handler 边界切块,并给覆盖到的块打上 catch 条目标记)。最后以规范的边值重建图。

**边语义**:`true` = 跳转方向,`false` = 顺序/fallthrough 方向。一切结构极性判定必须用 `edgeValueOrThrow` —— `successors()` 返回插入顺序,不代表边极性(见 §7.3)。

### 6.4 词法分析(`PandaLexical.ts`)

按类执行,从 `func_main_0` 播种,携带继承的词法环境栈递归进入嵌套函数(definefunc / defineclasswithbuffer / createobject-with-…):

- `computeEnvStacks` **沿 CFG 边从入口块传播**环境栈(线性 pc 序扫描会在含 `popLexEnv` 的循环上算错)。异常 handler 用 try 起点处的栈播种;播种与传播交替进行直至不动点(handler 子图里还可能嵌套 try)。
- 环境命名为 `local_<depth>` / `sendable_<depth>`;同一深度的多个环境追加 `_2` / `_3` 后缀,避免同名互相遮蔽(连续定义的多个 class 各自持有独立 lexenv)。
- `throw.undefinedifholewithname`(assert)指令驱动寄存器**类型推断**(`typeMap`)。
- 某个方法反汇编失败时跳过该方法,后续输出占位函数体。

## 7. 反编译层 —— `src/decompiler/`

### 7.1 指令 handle(`MethodHandler.ts`)

`HANDLES: Record<InstructionKind, Handle>` 按 kind 逐条分发;handle 返回 `true` 表示停止语句吸收(用于 `asyncfunctionenter` / `getresumemode`)。未注册的 kind 抛 `PandaDecompileException` —— 三条设计内降级路径之一。

职责:

- `insertFunctionPreamble` 声明 `v0..vN`、`acc` 与保留参数(`panda_jmp0_reserved_param_p2 = this`)。
- try/finally 标记:`handleBlock` 查询 `finallyRoles` 映射(由 `TryFinally` 构建),在 start/cleanup/guard/suppress 位置插入标记表达式/语句 —— 包括条件 `SequenceExpression` 内部(之后由 `applyFinallyPlans` 提升)。
- 嵌套函数字面量递归反编译。
- `reset()` 将生成名计数器清零;`PandaDecompiler.decompileRaw()` 每类调用一次,使生成名(`panda_jmp0_reserved_class_N`、匿名函数名)与处理顺序无关 —— 这是并行输出逐字一致的前提。

### 7.2 语句树(`statements.ts`)

归约产出、再降为 Babel AST 的语句:`LinearPandaStatement`(→ handle 输出)、`IfPandaStatement`(test 区域带 `tryCatchHelperRegion` 时重解释为 `TryCatchPandaStatement`)、`WhileStatement`(始终输出为 `while (true)` + 头部 `if (test) break`)、`DoWhileStatement`、`BreakStatement` / `ContinueStatement`、`GotoStatement`(`tryFixGoto` 把简单情形转成带 label 的 `while (true)` 循环,否则输出 `xpanda_goto(name)`)、`LabelStatement`、`And/OrLogicalExpressionStatement`(把 `A || B` 渲染为 `(A求值, cond) || (B求值, cond)` 序列,且**不会**盲目向嵌套逻辑操作数追加 `acc`)、`TryCatchPandaStatement`(catch 参数是 `catchAcc`,绝不叫 `acc`;handler 开头 `acc = catchAcc` 把异常搬回累加器)。

### 7.3 结构化分析(`StructureAnalysis.ts`)—— Region 归约

构造:`RegionGraphBuilder` 把 CFG 转为 Region 图(`RegionType = Linear | Condition | Tail`)。ArkTS 为语言特性合成异常 handler —— **for-in、for-of、async 函数、generator** —— 这些被排除在区域图之外;真实 try 在 try 入口前拼接 `TryCatchHelperRegion`(false 边 → try 体,true 边 → handler;handler 区域获得 `exceptionLandingPad`)。`codeSize === 0` 的 try(空 catch)被跳过。死代码(入度 0 的块)被迭代剪除。

区域图上的归约循环:

1. 基本块 `> 500` → `PandaDecompileException("too many blocks!")` → 降级 `SimpleAnalysis`。
2. `reduceAcyclic`:Condition 区域 → `reduceIfRegion`(仅 if / if-else 汇合 / 双 Tail / try/catch 一条分支为死 Tail 时走 **`reduceTryCatchWithDeadBranch`**);Linear 区域 → `reduceSequence`(语句拼接,经 `simplifyConditionalSequence` 合并 `&&` / `||` 短路链,后者设置 `logicalRegion` 标志 —— 合并这类区域时该标志**必须传播**,否则后续阶段只能生成读 `acc` 的 test,丢掉 `A || B` 的计算)。
3. `reduceCyclic`:自环与单前驱回边 → while / do-while;其余登记为未解决环。
4. 停滞时:先用 `LoopFinder` / `refineLoop` 精化一个未解决环,否则 `coalesceTailRegion`(吸收 Tail 区域),否则 `fixIrreducibleByTailRegion` —— **Tail 复制**,把不可归约图变为可归约。迭代 `> 3000` 轮仍卡住 → `"can not reduce the graph"` → `SimpleAnalysis`。
5. `virtualizeIrregularExits`:把循环体内的词法出口转成 `continue` / `break` / 带 label 的 `goto`。条件出口只生成**一条**语句(`if (cond) break`);线性出口生成无条件语句。出口目标为死的出度 0 Tail(只有 `return` / `throw`)时视为"内联",经 `Region.copy()` 把 Tail 语句复制进该分支。

关键不变量:

- **条件极性来自边值,而非后继顺序**:`conditionalExp` 描述 fallthrough(false 边)条件(`jnez` → false 边为 `!acc`,`jeqz` → false 边为 `acc`)。`coalesceTailRegion` 与 `virtualizeIrregularExits` 必须用 `edgeValueOrThrow`;折叠 *true* 边上的 Tail 需要 `expInvert()` —— 对 `logicalRegion`(表达式本身就是 fallthrough 条件)则改用取反分支的 `IfPandaStatement`。
- `Region.copy()`(Tail 复制、出口内联)必须保留 `conditionalExp` / `logicalRegion` / `exceptionLandingPad` / `tryCatchHelperRegion`。
- `reduceIfRegion` 消费完 try/catch 两条分支后必须清除 `tryCatchHelperRegion` 标志;否则下一个条件区域被误判为 try/catch,成功路径会落进 `catch`。

### 7.4 降级分析(`SimpleAnalysis.ts`)

线性输出:`label_<pc>: { … }` 块,直接跳转输出 `decompiler_goto(label_N)`,条件跳转输出 `if (acc / !acc) decompiler_goto(…)`,catch 块带 `decompiler_exception_handled_by` / `acc = decompiler_exception_detail` 标记。结尾 `hoistLexicalDeclarations` 把词法 `let` 声明提升到函数顶部。降级输出以 `decompiler_goto` 标记为特征。

### 7.5 try/finally 还原(`TryFinally.ts`)

ArkTS 13 把 `finally` 编译成状态机(hole 哨兵、cleanup 块、重抛守卫)。`buildFinallyPlans` 按**结构特征**识别 —— 不按块大小:try 结束块写入 hole 哨兵并跳到 cleanup;handler 以 `sta` 开始且不立即 throw;稍后某个 hole 比较块带 throw 后继即为守卫。PC 顺序严格校验。角色(start / cleanup / guard / suppress)成为 `__xpanda_finally_marker__` 字符串,由 `MethodHandler` 插入;`applyFinallyPlans` 按三种布局改写(同一语句列表 / 嵌套列表尾部 / try+真 catch 形态)为 `try { … } finally { … }`。无法定位的 plan 留下 `/* xpanda: try/finally not restored */` 注释;标记一律剥离。

### 7.6 图工具

- `ValueGraph.ts`:保持插入顺序、边带布尔值的有向图;`edgeValueOrThrow`、DFS 后序。
- `DominatorGraph.ts`:迭代式支配树计算(Cooper-Harvey-Kennedy 风格),带 100000 次迭代安全超时;`dominatesStrictly`;`LoopFinder` 求自然环。

## 8. AST 构建与代码生成 —— `src/ast/` + `src/codegen/`

- `codegen/CodeGenerator.ts`:轻封装,暴露 `NodeFactory` / `NodeUtils`(取代 Java 版的 GraalVM JS 桥)。
- `ast/NodeFactory.ts`:Babel 节点构造。`parse` 用 `sourceType: "module"` + `allowUndeclaredExports`;`generate` 跑 jsesc-minimal + `FormatCode`。`identifierNode(name, type?)` 把类型附加为尾随块注释(类型提示以注释形式保留)。`tryStatementNode` 把 catch 参数命名为 **`catchAcc`**,避免遮蔽累加器。async / generator 标志挂在 `body.extra` 上。
- `ast/NodeUtils.ts`:语句插入(合法时解包进 `SequenceExpression`)、序列表达式辅助、async/generator 标记、`setReturnTypeCall`(`callIns` 标记,由 `CallResultSimplify` 消费)、`covert2SingleBlock`(在 `panda_jmp0_reserved_lex_begin` 哨兵处折 popLexEnv)、`tryFixGoto`。
- `ast/FormatCode.ts`:只影响输出文本的折行。超过 **120 字符**的行在顶层(深度 0)`||` / `&&` / `??` 处拆分,新行以操作符开头(ASI 安全)。含顶层三目的行不折;模板字符串、引号、注释与正则字面量被跟踪,内部内容保持完整。

## 9. 优化器流水线 —— `src/simplify/`

`SimplifyExport.simplify()` 先跑定点迭代核心,再跑固定的尾部序列。每个 pass 返回 `boolean`("是否修改了 AST"),定点循环在一整轮无修改时立即停止(上限 **5** 轮)。

```text
normalizeDeclarations
  → CallResultSimplify
  → [ ReservedIdentifierSimplifier → TempVariableSimplify → AccCallSimplify
      → EnumSimplify → ConditionSimplify → SyntaxRewriteSimplify
      → ClassSyntaxSimplify → ObjectLiteralSimplify ] × ≤5(定点)
  → HighLevelGrammarSimplify
  → TempVariableSimplify.foldShortCircuitAssignments
  → NullishCoalescingSimplify
  → AccCallSimplify.simplifySequences
  → ConditionSimplify.foldMaterializedTestArtifacts
  → TempVariableSimplify.foldReturnAssignments
  → TempVariableSimplify.foldConditionAssignments
  → SyntaxRewriteSimplify.foldSequencedTestPrefixes
  → SyntaxRewriteSimplify.normalizeConditionTests
  → TempVariableSimplify.foldConditionAssignments   (第二次)
  → SyntaxRewriteSimplify.normalizeConditionTests   (第二次)
  → SyntaxRewriteSimplify.hoistTestPrefixes
  → SyntaxRewriteSimplify.foldCompoundAssignments
  → HighLevelGrammarSimplify.simplifyTail
  → SyntaxRewriteSimplify.foldConstantConditions
  → SyntaxRewriteSimplify.foldSentinelGuards
  → SyntaxRewriteSimplify.removeUnreachableStatements
  → SyntaxRewriteSimplify.removeOrphanJumps
  → TempVariableSimplify.removeUnusedLexicalDeclarations
```

尾部为何这样排序:

- `HighLevelGrammarSimplify` 在定点迭代**之后**合成高级语法(三目、`switch`、`??`),所以消费这些形态的折叠 pass 必须在其后运行(短路赋值折叠、nullish 还原、返回值/条件折叠)。
- `AccCallSimplify.simplifySequences` 还原只出现在条件 `SequenceExpression` 里的方法装载链;刻意放在复制传播之后,避免中间形态被别名传播误读。
- `foldConditionAssignments` / `normalizeConditionTests` 跑**两次**:二者互为对方暴露新形态(`normalizeConditionTests` 把布尔三目折成 `X = Y && Z`,暴露新的别名链)。
- `foldCompoundAssignments` 放在后面,避免提前改写成 `+=` 干扰活跃性 / 复制传播。
- `simplifyTail` 在**所有**条件折叠之后运行:守卫三目(`x ? x.k : undefined` → `x?.k`)、累加器死枢纽拷贝(`acc = E; v = acc`)、for-of 的 `while (true)` + `break` 形态(含提升的 `it.next` 方法装载归一化)、连续 `if (disc === v) { return … }` 守卫链 → `switch`(else-if 形态先由 `flattenElseAfterExit` 展开成守卫子句;要求 case 标签至少 **3** 个,2 个标签的短链保持 `if`;旧的 if/else → switch 路径同阈值,只给 null/undefined 对保留 2 个 case 供 `??` 还原)都在此刻才物化。最后以 `removeUnusedTempDeclarations` 清理残留的 `vN` / `acc` 声明。
- 收尾清理依次移除常量条件分支、try/finally 与 for-of 收尾残留的哨兵守卫、不可达语句、游离的 `continue`/`break`,以及未使用的词法块槽位。

### Pass 一览

| 文件 | 职责 |
|---|---|
| `ISimplify.ts` | Pass 接口:`simplify(node): boolean` |
| `AstUtils.ts` | 无 traverse 的线性 AST 工具(临时名识别、纯度/可复制判定、节点大小、读写收集)。在大 AST 上避免 `scope.crawl()`。 |
| `NormalizeDeclarations.ts` | 在任何 Babel traverse 之前去重重复 `let` 声明、处理 import 与声明冲突(防止 "Duplicate declaration" 崩溃)。 |
| `ReservedIdentifierSimplifier.ts` | 还原 `panda_jmp0_reserved_*` 名字(`param_p0/p1/p2` → `this` / 函数或类名 / `new.target`、export default、lex 哨兵)。入口自引用语句只有**整条就是赋值**时才删。 |
| `TempVariableSimplify.ts` | 最重的 pass:按作用域活跃性做复制传播 + 死存储消除。预算:传播表达式 ≤ **24** 节点、单次运行克隆预算 **120000**。处理 `finally` 出口活跃读取、非纯表达式只在真正最后一次使用时搬移、循环 test 临时变量折叠(`foldLoopTestTemps`、`foldDoWhileTestAssignments`)、按奇偶性处理自取反链、累加器链(二元/成员调用/成员装载,如 `X = E; X = X.trim()`)、Hub 别名与旧值读取重定向(`foldTempAliasAssignments`);并暴露流水线尾部使用的静态入口(`foldShortCircuitAssignments`、`foldReturnAssignments`、`foldAccumulatorAssignments`、`foldConditionAssignments`、`removeUnusedLexicalDeclarations`)。 |
| `AccCallSimplify.ts` | 还原 `recv = acc; acc = acc.m; acc.call(recv, …)` → `recv.m(...)`;`simplifySequences` 处理条件序列里的同一形态。 |
| `EnumSimplify.ts` | 把 ArkTS enum 惰性初始化字节码模式还原为对象字面量(含反向映射对象)。 |
| `ConditionSimplify.ts` | 把 if test 中无条件求值的序列前缀提升出来、清理物化条件临时变量(`foldMaterializedTestArtifacts`)、折叠语句级自取反链、合并 null/undefined 判断。刻意不处理循环。 |
| `SyntaxRewriteSimplify.ts` | test 化简、if/else 归一化、`.call` 还原、函数表达式提升;以及静态尾部辅助(`foldSequencedTestPrefixes`、`flattenElseAfterExit`、`normalizeConditionTests`、`hoistTestPrefixes`、`foldCompoundAssignments`、`foldConstantConditions`、`foldSentinelGuards`、`removeUnreachableStatements`、`removeOrphanJumps`)。 |
| `ClassSyntaxSimplify.ts` | 从 `__defineGetter__` 风格赋值还原 getter/setter 与 prototype/static 方法语法,兼容裸对象(`v1.__defineGetter__(…)`)与复制传播内联后的 `acc.prototype.__defineGetter__(…)` 两种形态;单表达式 class 还原。 |
| `ObjectLiteralSimplify.ts` | 合并 `createobjectwithbuffer` 模板对象与相邻字面量字段赋值(`obj = {k: null}; obj.k = E` → `{k: E}`);要求初值是字面量、字段顺序一致、未被闭包捕获。安全时把 `obj = {…}; return obj` 内联为 `return {…}`。 |
| `HighLevelGrammarSimplify.ts` | 主遍历:while → for / for-in / for-of、提前 return 的 do-while → for-of、if → 三目(自底向上;return 链保留 `else if`)、if → switch(nullish 合成)、可选链还原;`simplifyTail`(见上;含连续 if-return 守卫链 → `switch`)。 |
| `NullishCoalescingSimplify.ts` | 还原 switch 降级的 `??`(`v = obj.k; switch (obj.k) { case null: case undefined: v = d }` → `v = obj.k ?? d`);仅限判别式为纯成员表达式。 |
| `CallResultSimplify.ts` | 移除 `callIns` 标记、且被下一条 `acc` 写入立即覆盖的调用结果。 |
| `UnusedCleanupSimplify.ts` | 基于读取集的死代码清理;**当前流水线未注册**(留作安全兜底)。 |

### 关键约束

- 复制传播受大小与克隆预算限制,避免指数膨胀(`v2 = v1 + v1; v3 = v2 + v2; …`)。
- 死存储、序列清理与返回值折叠都经过活跃性与作用域检查。**捕获判定必须同时看 `binding.referencePaths` 与 `binding.constantViolations`** —— "只写不读"的闭包捕获对只读检查不可见。
- 名字级活跃性分不清临时变量的新旧版本:`X = RHS` 且 RHS 只读一次 `X` 时,这次读取是**旧值的最后一次使用**;不可复制的右值只允许搬进调用接收者位置。
- 非纯表达式(`call` / `new` / 函数 / 类)只在真正最后一次使用时搬移 —— 例外是 `definitelyWritesBeforeRead`:两个分支都在读取前覆盖该变量时,赋值可以下沉进 if test。
- 累加器 `acc` 不是源码变量:`acc = !acc` 可能来自 `callruntime.isfalse`,也可能来自条件物化;折叠按取反链奇偶性处理,不能只删一层。
- 不能只依据过期的引用记录删语句:克隆出来的表达式与已删语句的绑定要求在当前 AST 上重数(跳过嵌套函数;闭包捕获被显式保护)。

## 10. 并行 simplify —— `src/parallel/`

- 入口:`decompileClassesParallel(decompiler, classes, { jobs, onClassDone, onWarning })`;CLI 用 `-j N` 开启(`-j 0` = 自动:`max(1, min(4, cpus - 1))`,见 `resolveJobs`)。
- **分工**:主线程解析、反汇编、词法分析、构建 AST(`decompileClassAst`);worker 接收自包含的 AST JSON,只跑 `SimplifyExport.simplify` + `NodeFactory.generate`。大样本上该分工约占总时长的 1% vs 99%。
- **调度**:合格类(含 `func_main_0`)按估算权重 —— 方法 `codeSize` 总和 —— 降序排序,空闲 worker 即派发(大任务优先,减少尾部等待)。结果按类索引回填,输出顺序与完成顺序无关。
- **确定性**:`PandaDecompiler.decompileRaw()` 每类复位生成名计数器,因此单类输出是该类的纯函数 —— 串行与并行输出逐字节一致(有回归测试)。
- **失败处理**:worker 出错时该类降级为主线程 simplify;**连续失败 2 次**后剩余类全部禁用 worker。worker 的 stdout/stderr 被接管,`--quiet` 保持安静。
- **内存**:worker 默认老生代上限 3 GB(`XPANDA_WORKER_HEAP_MB`);单个超大类的 simplify 峰值约 1.4 GB —— 不建议超过 4 个 worker。

## 11. 入口与使用

### 11.1 `PandaDecompiler.ts`

| 方法 | 行为 |
|---|---|
| `decompile(pandaFile)` | 全部类,simplify;返回以横幅注释分段的按类结果。 |
| `decompileRawAll(pandaFile)` | 全部类,不 simplify。 |
| `decompileClass(cls)` | 单类,raw + 进程内 simplify。 |
| `decompileClassRaw(cls)` | 单类,直接生成(不 simplify)。 |
| `decompileClassAst(cls)` | 单类 AST JSON(让 simplify 能在 worker 执行的拆分点);无 `func_main_0` 或反汇编失败时返回 `""`。 |
| `simplifyInProcess(astJson)` | `JSON.parse` → `SimplifyExport.simplify` → `NodeFactory.generate`;解析失败返回 `""`。 |
| `saveFile(outDir, cls, content)`(静态) | demangle `Lpkg/Name;` → `pkg/Name.js`(中间段成为目录)。 |

`decompileRaw` 按如下顺序组装一个类:import(来自模块元数据)→ 头注释 → 导出变量 `let` 声明 → `func_main_0` 方法体(StructureAnalysis,失败降级 SimpleAnalysis)→ export。

### 11.2 CLI —— `src/cli.ts`

```bash
npx tsx src/cli.ts decompile <file.abc|file.hap> [-o outDir] [--no-simplify] [--stdout] [--quiet] [-j N]
npx tsx src/cli.ts unpack-index <resources.index> [-o outDir] [--stdout]
```

- 任意 ZIP 容器(以 `ZipFile.isZip` 判定,不限于 `.hap`)走 HAP 流程:打印 `module.json` 摘要,把每个 `.abc` 条目反编译到 `outDir/<条目路径>/`,写出 `resources.json`,并解出 `resources/` 资源文件(对条目名做路径穿越防护)。
- 进度与诊断走 **stderr**,保证 `--stdout` 是合法 JavaScript;单类失败只记日志并跳过,绝不中断整体。
- `--quiet` 临时替换 `console.log` 以静默流水线日志。

### 11.3 编程 API —— `src/index.ts`

导出 `PandaFile`、`PandaClass`、`PandaMethod`、`PandaDecompiler`、`decompileClassesParallel` / `resolveJobs`、`PandaLexical`、`PandaDisAssembler`、`PandaIRCFG` / `PandaIRBasicBlock`、opcode 表、`NodeFactory` / `NodeUtils`、`SimplifyExport`、`ResourceIndexFile` / `ResourceItem` / `ResourceUtils`、`HapFile` / `ZipFile` 以及异常类型。

约 5.5 MB 样本实测:解析 ≈ 36 ms,串行 simplify ≈ 81 s,`-j 4` ≈ 49 s(≈ 1.66×)。瓶颈是单类 simplify 的内存/GC 带宽,而非解析或反汇编。

## 12. MCP Server —— `src/mcp/`

通过 stdio 把反编译器暴露给 AI agent(安装与工作流见 [MCP.md](./MCP.md))。设计要点:

- `server.ts` 在任何 import 之前**无条件**把 `console.log/warn/error` 重定向到 **stderr** —— 任何 stdout 泄漏都会破坏 JSON-RPC 流。
- `registry.ts` 维护最多 **8** 个会话的 LRU 池(`AbcSession` = 已解析 `.abc`,`HapSession` = 已打开 `.hap`)。`fileId` 内嵌文件名 + Adler32 校验和;同一路径重复加载直接复用会话。
- 十个工具:`abc_load` / `abc_close`、`abc_list_classes` / `abc_get_class`、`abc_decompile_class` / `abc_export`、`abc_disassemble_method`、`abc_search_strings`、`hap_read_abc` / `hap_resources`。
- 大输出保护:单类反编译超过 50 KB 截断(改用 `abc_export` 落盘);反汇编默认 1500 条指令(`maxInstructions` 上限 5000)。
- 降级可观测:`abc_decompile_class` 返回 `degraded=true/false`,agent 可自动切换到 `abc_disassemble_method` 阅读字节码。

## 13. 验证与测试

测试入口:`test/decompile.test.ts`。

- 反编译 `test/resources/md5.abc`、`class.abc`、`aes.abc`、`yourpipe0.7.0.abc` 与 `zhihupp0.59.hap`;与 `test/expected/` 快照比较;所有输出用 Babel 再解析。
- `md5.abc` 输出会**实际执行**,`md5("admin")` 与 Node `crypto` 比对;`aes.abc` 输出执行加解密自检(其快照钉住条件极性:`Counter.increment` 必须是 `!== 255`)。
- `yourpipe0.7.0.abc`(5.4 MB)覆盖复杂控制流的整类快照(循环体内嵌套 try/catch、嵌套作用域 for-of、提升的迭代器装载)。
- `zhihupp0.59.hap`(字节码 13.0.1.0)是逻辑条件传播、取反链折叠、累加器物化与 try/finally 还原的回归集。
- 并行一致性测试对选定类逐字节比较串行与 `-j` 输出。

```bash
npm test
npm run typecheck
```

更新 `test/expected/` 快照前,先确认输出变化**符合预期** —— 不要为了让测试通过而直接覆盖快照,并在提交说明中解释变化。

## 14. 约束与注意事项

1. **`src/disasm/opcodes.ts` 是生成文件** —— 改 `resources/isa.yaml` 后运行 `npm run gen:opcodes`,不要手改。
2. **降级路径是设计行为**,不是 bug:单方法 > 500 基本块、指令 kind 未注册、`jeq` 家族指令,三者都降级到 `SimpleAnalysis`(或占位函数体),不会中断整个类或文件。
3. 前缀指令占 2 字节(首字节 ≥ 251)。新增指令 kind 用 isa.yaml `sig` 的首词登记(如 `wide.callrange`)。
4. **单类输出必须是该类的纯函数** —— 不要引入跨类的可变状态(全局计数器、按偏移共享的可变缓存),否则 `-j` 并行结果与串行不一致。生成名计数器按类复位。
5. **条件极性由 CFG 边值决定**;`successors()` 顺序是插入顺序,不代表 true/false 边顺序。
6. **逻辑条件标志必须完整传播**(`logicalRegion` 经 `reduceSequence` 传播;四个 Region 标志经 `Region.copy()` 保留),否则 `A || B` 退化为只读 `acc` 的 test。
7. **删除/搬移临时变量前必须做活跃性与分支分析** —— 否则 test 序列折叠与非纯表达式搬移可能复制调用或改变 `acc` 的最终值。拿不准时宁可少优化,不能改变语义。
8. **finally 的读取在 try 的每个出口都活跃**;没有异常边的活跃性模型必须把出口读取并入 `finalizerReads`,否则 try 块内的存储会被当成死存储删除。
9. catch 参数不能叫 `acc`(会遮蔽累加器);`NodeFactory.tryStatementNode` 用 `catchAcc`,并在 handler 入口重新物化 `acc = catchAcc`。
10. 运行时只需 Node.js ≥ 18;`typescript` / `tsx` 仅开发期使用。降级输出可能包含 `decompiler_goto`、`xpanda_goto` 或 `export … from` 形态,再解析时需要对应的 parser 配置。
