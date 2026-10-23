# AGENTS.md

本文件为 AI 编码代理提供本仓库的工作指南。

## 项目是什么

**xpanda** —— 鸿蒙 HarmonyOS `.abc`(Panda / ArkCompiler 字节码)反编译器,**纯 TypeScript** 实现(Node.js ≥ 18)。支持字节码版本 `24.0.0.0`(向后兼容 13.0.1.0)。架构详情见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 环境要求

- Node.js ≥ 18
- 开发依赖:`typescript` / `tsx` / `@babel/*` / `js-yaml`,见 `package.json`

## 目录地图

| 路径 | 职责 |
|---|---|
| `src/file/` | `.abc` 文件格式解析(PandaFile / Header / PandaClass / PandaMethod / 字面量 / 模块元数据) |
| `src/codec/` | Leb128 / MUTF8 / Adler32 |
| `src/disasm/` | 反汇编:`opcodes.ts`(生成)、`PandaInstruction.ts`(统一指令模型 + KIND_MAP)、`PandaIRCFG`、`passes.ts`、`PandaLexical.ts` |
| `src/decompiler/` | `StructureAnalysis.ts`(Region 归约核心)、`Region.ts` / `RegionGraphBuilder.ts`(区域、条件/逻辑标志、不可归约 Tail 复制)、`statements.ts`、`MethodHandler.ts`(HANDLES 分发)、`TryFinally.ts`(ArkTS 13 try/finally 还原)、`SimpleAnalysis.ts`、`ValueGraph.ts`、`DominatorGraph.ts` |
| `src/codegen/CodeGenerator.ts` | AST 生成入口(包装 `src/ast/`) |
| `src/ast/` | `NodeFactory` / `NodeUtils`(Babel AST 工具);`FormatCode.ts` 对超长逻辑链输出折行 |
| `src/simplify/` | 优化器流水线(`SimplifyExport`、`TempVariableSimplify`、`ConditionSimplify`、`SyntaxRewriteSimplify`、`ClassSyntaxSimplify`、`ObjectLiteralSimplify`、`NullishCoalescingSimplify`、`HighLevelGrammarSimplify`、`AstUtils`、`NormalizeDeclarations`);末尾含 `foldConditionAssignments`(条件取反链二次折叠)与 `hoistTestPrefixes`(常量前缀提升) |
| `src/parallel/` | 按类并行的 simplify worker 池(`ParallelDecompiler.ts` 调度、`simplify-worker.ts` worker 入口) |
| `src/hap/` | HAP 应用包适配:`ZipFile.ts`(只读 ZIP 解析,store/deflate)、`HapFile.ts`(.abc 条目/module.json/resources.index) |
| `src/mcp/` | MCP Server(`server.ts` stdio 入口、`registry.ts` abc/hap 会话注册表、`tools/` 十个工具),文档见 [docs/MCP.md](docs/MCP.md) |
| `src/PandaDecompiler.ts` | 对外总入口(库 API) |
| `src/cli.ts` | CLI:`decompile <file.abc|file.hap> [-o outDir] [--no-simplify] [--stdout] [--quiet] [-j N]`、`unpack-index <resources.index> [-o outDir] [--stdout]` |
| `resources/isa.yaml` | ArkCompiler 指令集描述(v24.0.0.0) |
| `scripts/gen-opcodes.ts` | 生成 `src/disasm/opcodes.ts` |
| `test/` | 集成测试 + 样本(`md5.abc`、`class.abc`、`aes.abc`、`zhihupp0.59.hap`) |
| `test/expected/` | 反编译输出快照(`md5.js`、`class.js`、`aes.js`) |
| `scripts/test-mcp.ts` | MCP Server 端到端测试(子进程 + JSON-RPC) |
| `docs/ARCHITECTURE.md` | 架构文档 |
| `docs/MCP.md` | MCP Server 文档 |

## 常用命令

```bash
npm install                # 安装依赖
npm test                   # 集成测试:反编译 + 快照比较 + Babel 再解析
npm run typecheck          # tsc --noEmit
npm run gen:opcodes        # isa.yaml → src/disasm/opcodes.ts

# 快速验证小样本
npx tsx src/cli.ts decompile test/resources/md5.abc -o out --quiet

# 反编译鸿蒙 HAP 应用包(ZIP 容器,自动解出全部 .abc + resources.index)
npx tsx src/cli.ts decompile test/resources/zhihupp0.59.hap -o out --quiet

# 大文件按类并行 simplify(worker_threads)
npx tsx src/cli.ts decompile test/resources/zhihupp0.59.hap -o out -j 4 --quiet

# 跳过优化器,验证解析/反汇编改动
npx tsx src/cli.ts decompile test/resources/zhihupp0.59.hap -o out --no-simplify --quiet

# 大文件加堆
NODE_OPTIONS=--max-old-space-size=4096 \
  npx tsx src/cli.ts decompile test/resources/zhihupp0.59.hap -o out --quiet

# 启动 MCP Server(stdio)/ MCP 端到端测试
npm run mcp
npm run test:mcp
```

## 硬性约定

1. **`src/disasm/opcodes.ts` 是生成文件,不要手改**——由 `npm run gen:opcodes` 依据 `resources/isa.yaml` 生成。
2. 文件格式解析、指令 kind 映射、handle 行为、结构化归约顺序要保持确定性;改动后用 `md5.abc` / `class.abc` 的测试快照验证。
3. 注释与文档使用中文,保持现有风格(类头 `@Author: jmp0`)。
4. 不要引入 CI 配置或改变依赖结构,除非用户要求。
5. 优化器 pass 返回 `boolean` 表示是否修改 AST,由 `SimplifyExport` 定点迭代;不要在 pass 内保留过程日志。
6. **单类输出必须是该类的纯函数**:不要引入跨类的可变状态(全局计数器、按偏移共享的可变缓存等),否则 `-j` 并行结果与串行不一致。生成名计数器在 `PandaDecompiler.decompileRaw()` 里按类复位;`test/decompile.test.ts` 有串行/并行一致性回归。

## 常见任务怎么做

### 新增/修改一条字节码指令的处理

1. 确认 `resources/isa.yaml` 里有该指令,没有则更新后 `npm run gen:opcodes`;
2. 在 `src/disasm/PandaInstruction.ts` 的 `KIND_MAP` / `classifyKind` 登记语义 kind(勿忘 `InstructionKind` 联合类型);
3. 需要专属语义字段时,在 `PandaInstruction` 构造函数的 switch 中解析;
4. 在 `src/decompiler/MethodHandler.ts` 的 `HANDLES` 中实现该 kind 的 handle(参考现有 handle 的写法);
5. `npm test`。

### 新增一个 simplify pass

1. 在 `src/simplify/` 实现 `ISimplify`;
2. 在 `SimplifyExport.ts` 注册(常规 pass 加进 `simplifyALL` 数组,全局性 pass 放流水线首尾,如 `CallResultSimplify`、`HighLevelGrammarSimplify`);
3. 只有需要在定点迭代中反复运行的 pass 才放进 `simplifyALL`;只跑一次的收尾步骤(如 `TempVariableSimplify.foldConditionAssignments`、`SyntaxRewriteSimplify.hoistTestPrefixes`)直接在 `SimplifyExport.simplify()` 末尾调用;
4. 运行 `npm test`,确认快照变化符合预期。

### 升级支持的字节码版本

替换 `resources/isa.yaml` → `npm run gen:opcodes` → 在 `PandaInstruction.ts` 补齐新增指令的 kind/语义解析 → 在 `MethodHandler.ts` 补 handle → 调整 `src/file/desc/Header.ts` 等格式差异 → `npm test` + 大样本验证。

### 修改文件格式解析

`src/file/` 对应类;注意保持偏移掩码、缓存语义、边界处理等格式语义。改完用 `md5.abc`、`class.abc` 和 `zhihupp0.59.hap` 验证。

### 修改优化器

- 复制传播必须限制表达式大小/克隆预算,避免 `v2 = v1 + v1; v3 = v2 + v2; ...` 指数膨胀;
- 不活跃变量、SequenceExpression、return 语句、catch 参数的清理要经过 liveness / 作用域检查;
- **捕获判定必须同时看 `binding.referencePaths` 和 `binding.constantViolations`**。闭包里"只写不读"的外层变量只在 constantViolations 里;只看读取会把外层初始化(如 `local_1_1 = undefined`)当成唯一值传播到闭包之后的读取,并删掉声明;
- **名字级活跃性分不清临时变量的新旧版本**:`X = RHS` 且 RHS 只读一次 X 时,这次读取是旧值的最后一次使用(`acc = p0.trim(); acc = acc.length` → `acc = p0.trim().length`)。此时若变量名在语句后仍活跃(后续读到的是新值),不可复制的右值只允许搬进调用接收者位置(`v0 = !v0.test(p0)`);裸成员装载 `acc = acc.test` 是 AccCallSimplify 依赖的中间形态,提前内联会让 `acc.call(recv, ...)` 无法还原;
- **自引用成员链 `X = X.prop; X = f(X)` → `X = f(X.prop)`**(`foldSelfReadChains`):`X = X.prop` 的右值读取旧值,复制传播不会缓存这类表达式;若它的结果只被紧随其后的赋值消费一次,可在两条赋值之间整体搬移。要求 A 为纯成员装载、B 只读一次 X、B 不写 X 也不写 A 依赖的名字;
- **嵌套 if / else-if 的布尔物化要自底向上折叠**:`if (!p2) { if (!f) acc = true else acc = false } else if (!g) acc = true else acc = false` 应折成 `if (p2 ? !g : !f)`。`HighLevelGrammarSimplify` 的 IfStatement 折叠改用 `exit`,保证内层先变成赋值语句;return 链不折成嵌套三目,保留 `else if ... else` 结构;
- **`foldShortCircuitChains` 把 `X = E; if (X/!X) { X = B; }` 物化链折成 `X = E &&/|| B`**(test 被结构化归约重新物化成原表达式时要求 E 纯)。以 `X = !X` 自取反开头的链必须跳过:整条取反链的奇偶性归尾部 `foldConditionAssignments`,提前吃掉链头会让 `X = has(); X = !X; if (!X) { X = set() }` 无法折回 `if (!has())`;
- **非纯表达式(`call` / `new` / 函数/类)只能在真正最后一次读取时搬移**;`if` 的 test 和分支体都读同一临时变量时不能搬,否则会把调用复制成两次;**例外**:if 的 test 读取、且两个分支都一定在读取前覆盖该变量(`definitelyWritesBeforeRead`)时,旧值在 test 后已死,可以搬进 test(`v0 = new RegExp(...); if (!v0.test(p0)) {...} else {...}` → `if (!new RegExp(...).test(p0))`);
- `acc = !acc` 既可能来自 `callruntime.isfalse`,也可能来自条件物化(`istrue + jnez + ldtrue/ldfalse`);折叠时按取反次数的奇偶性处理,不能只删一层;
- test 序列里的自取反链(`if (A || (X = E, X = !X, !X))`)只有在 `X` 在 test 后已死、test 外无其它读取、分支/前缀不会先读后写时才折叠;循环 test 里的自取反尚未处理(死保存清理与累加器链折叠由 `foldLoopTestTemps` 负责,见下条);
- **循环 test 是表达式序列,`cleanupStatements` 扫不到**:`foldLoopTestTemps` 按 test 自己的求值顺序做活跃性分析,删除死保存(`acc = !(acc !== undefined)`、寄存器恢复 `v8 = false`)并把 `X = E; X = F(X)` 折成 `X = F(E)`、`X = E; Y = X` 折成 `Y = E`。test 之后的活跃集必须用循环体入口活跃集(`loopBodyIn`,由 liveness 定点迭代记录)∪ 循环之后活跃集(`liveAfter`):body 里先写后读的临时变量(`v8 = v6.call(v5)` 之后的 `v8.done`)不能算作 test 写入的活跃使用,只看 `liveAfter` 会把 `v8 = false` 误判为活跃;
- **do-while 的 test 在 body 之后求值**:liveness 需要把"body 一定先写 `X` 再读"的 test 读取从循环入口的活跃集里剔除,否则 `X = !E; if (!X)` 会因 `X` 在循环里仍活跃而不折叠(或折叠后重复求值)。`foldDoWhileTestAssignments` 再把 `do { ...; X = E } while (!X)` 折成 `while (!E)`,要求 `X` 在循环后已死且 body 内没有 `continue`;
- `if (A || (v1 = 0, v2 = 2, B))` 这类常量前缀提升(`hoistTestPrefixes`)要求:前缀只是临时变量赋常量、短路分支直接 return/throw 且不读取这些临时变量、不在带 `finally` 的 `try` 中;
- `ObjectLiteralSimplify` 合并 `createobjectwithbuffer` 的模板对象与紧邻的 `obj.key = value`:要求字段初值是字面量、赋值顺序与模板字段一致、对象未被闭包捕获;`obj = {...}; return obj` 在模式外无读取时内联成 `return {...}`。对象字面量里的函数属性会按原求值顺序创建,不会被提前提升;
- `HighLevelGrammarSimplify` 会把 `if (x === null || x === undefined) x = default` 合成为 switch;`NullishCoalescingSimplify` 在流水线末尾把 `v = obj.k; switch (obj.k) { case null: case undefined: v = default; }` 还原成 `v = obj.k ?? default`。判别式是纯成员表达式时才允许合并两次求值;
- **switch 合成必须完整拆出 `||` test 的每一项**:无法识别的项(如 `!(a !== b)`、带 sequence 的条件)不能静默丢弃,否则会生成漏掉条件的 switch。链尾拆不出时只能把当前 if 及其 else 链整体放进 `default`(`partial`),第一个条件就拆不出则不合成;
- **`while (true) { vv = it.next(); if (vv.done) break; vv = vv.value; ... }` 还原成 `for (vv of iterable)`**(`checkAndTransformToForOfStatement`):要求 `it = iterable[Symbol.iterator]()`,且 `it` 除循环第一条 `next()` 外没有任何读取(ArkTS 会在提前 return 分支内联 `it.return()`,转换后 `it` 已不再赋值),`vv` 在循环外也不能被读取(for-of 对空数组不赋值)。只替换 `vv.value`,循环体里其它对象的 `.value` 必须保持不变。反编译生成的 AST 节点没有 `start/end`,判断 `vv` 是否在循环内要用路径祖先关系(`ref.findParent`),不能按位置;
- 修改输出后,更新 `test/expected/*.js` 快照并在提交说明中解释变化。

### 修改 Region 归约 / 条件极性

结构化分析里最容易出错的是“条件该不该取反”:

1. **不要依赖 `regionGraph.successors()` 的返回顺序**。`ValueGraph` 按插入顺序返回,与 true/false 边无关;判断分支极性必须用 `edgeValueOrThrow(region, succ)`。
2. `conditionalExp` 描述的是 fallthrough(false 边)分支的条件:jnez 时 false 边为 `!acc`,jeqz 时 false 边为 `acc`;折叠 true 边(`coalesceTailRegion`)时才需要 `expInvert()`。
3. `simplifyConditionalSequence` 会把 `if (A) ... if (B) ...` 合并成 `OrLogicalExpressionStatement` 并设置 `logicalRegion`;`reduceSequence` 合并这种 Region 时必须传播 `logicalRegion`,否则后续只能用 `acc` 生成 test,会丢掉 `A || B` 的计算。
4. `Region.copy()`(不可归约 Tail 复制)必须保留 `conditionalExp` / `logicalRegion` / `exceptionLandingPad` / `tryCatchHelperRegion` 标志。
5. 合并后的子区域如果已经是 `LogicalExpressionStatement`(`(A || B)` / `(A && B)`),**不要再追加 `acc`/`!acc`**:它的表达式本身就是条件值,追加会把 `acc` 里最后一个比较结果覆盖到条件上(`name === A || ((name === B, acc) || ...)` 既是语义错误,又会留下 `(acc = E, !E)` 死赋值)。`||` 的操作数是跳转条件、`&&` 的操作数是 fallthrough 条件,父子类型不同时要取反。
6. `virtualizeIrregularExits` 遇到循环体内的不规则出口时,**同一条边只生成一个语句**:条件区域生成 `if (cond) break`,线性区域生成无条件 `break`。两者都生成会先得到 `if (cond) break`、再追加一条无条件 `break`,循环体永远只执行一次(`AppUpdateClient.fetchReleaseDetail` 的内层 for...of 曾因此直接返回迭代器结果对象)。出口目标是 `outDegree === 0` 的 Tail(只剩 `return`/`throw`)时不能靠 `break`(它只会跳到循环 follow),应把 Tail 的语句复制进该分支;目标还有其它前驱、不能合并时正是这种情形。
7. 改完用 `zhihupp0.59.hap` 的 `AbsoluteUrlParser` / `ZhihuHttpClient`、`AppDestination.shouldReloadAfterAuthentication`(17 项 `===` 的 `||` 链)、`AppUpdateClient.fetchReleaseDetail`(for...of 内提前 return)和 `aes.abc` 的 `Counter.increment`(必须是 `!== 255`)验证。

## 测试

| 测试 | 用途 |
|---|---|
| `test/decompile.test.ts` | 反编译 `md5.abc` / `class.abc` / `aes.abc`,与 `test/expected/*.js` 比较,并做 Babel 再解析;另含并行一致性回归与 HAP 包(`zhihupp0.59.hap`)的重点类回归(AppDestination / AbsoluteUrlParser / ContentFilterRuntimeStore / StartupDestinationChannel / DeepLinkResolver / ShareContracts / AppUpdateClient 等,部分含沙箱行为校验) |
| `scripts/test-mcp.ts` | 以子进程启动 MCP Server,按 JSON-RPC 调用全部工具,快照比对 + 错误路径校验(含 hap 加载/解 abc/资源查询) |
| `test/resources/md5.abc` | 小样本,测试中还会执行输出并校验 MD5 结果 |
| `test/resources/class.abc` | 类/访问器/原型方法还原样本 |
| `test/resources/aes.abc` | AES 加解密样本,测试中还会执行输出并校验加解密自检结果为 `true`;快照覆盖条件极性(`Counter.increment` 必须是 `!== 255`)和 test 序列死赋值清理 |
| `test/resources/zhihupp0.59.hap` | HAP 应用包样本(字节码版本 13.0.1.0,含 `callruntime.supercallforwardallargs`),完整反编译约 1 分钟,测试只做重点类校验;`AbsoluteUrlParser` / `ZhihuHttpClient` 是逻辑条件与取反链的重点回归类,`DeepLinkResolver` 是累加器物化、重复调用消除、test 序列死赋值与跨变量布尔物化折叠(`acc = A; v1 = A; if (acc) { v1 = B }` → `v1 = A && B`)的重点回归类 |

更新快照前先确认输出变化是预期的;不要为了通过测试而直接覆盖快照。

## 陷阱与注意事项

- **降级路径是设计行为,不是 bug**:单方法 > 500 基本块、指令 kind 未注册 handle,二者使该方法走 `SimpleAnalysis` 线性输出;`jeq/jne/jstricteq/jnstricteq` 指令构造即抛异常,词法分析阶段(`PandaLexical`)会跳过该方法并输出占位函数体,不中断整个类。
- 前缀指令占 2 字节(首字节 ≥ 251),`PandaDisAssembler` 有特殊处理;新增指令名(kind 映射)用 isa.yaml 的 `sig` 首词(如 `wide.callrange`)。
- 类名形如 `Lpkg/Name;`,输出前由 `PandaDecompiler.saveFile()` demangle。
- `--no-simplify` 不执行优化器,适合验证解析/反汇编;大文件完整优化耗时主要来自逐类按函数分析和定点迭代。
- `acc` 是 Panda 累加器,不是源码变量:`acc = !acc` 可能来自 `callruntime.isfalse`,也可能来自编译器对条件的布尔物化;二者叠加时看起来是两条取反,实际源码可能只有一个 `!`。
- `HighLevelGrammarSimplify` 会把 `if (!X) { X = true } else { X = false }` 合成为 `X = !X`,可能和已有的 `X = !X` 形成新的连续取反链;因此流水线末尾必须再跑一次 `TempVariableSimplify.foldConditionAssignments`,不要删掉这一步。
- 优化器尾部顺序固定为:HighLevelGrammarSimplify → foldShortCircuitAssignments(补折 HighLevel 新暴露的 `X = E; if (E) { X = B }`) → NullishCoalescing → foldReturnAssignments(先折 `X = E; Y = X` / `obj.k = X`(X 已死)与累加器链 `X = E; X = X op F`,再补折 `X = E; return X` / `X = E; return X op F`,三目合成发生在定点迭代之后) → foldConditionAssignments → normalizeConditionTests → hoistTestPrefixes → foldCompoundAssignments。调整顺序前先确认条件极性、复合赋值和 `test` 序列折叠不会互相覆盖。
- **ArkTS 13(字节码 13.0.1.0)的 catch 块 codeSize 恒为 0**,`RegionGraphBuilder` 会跳过这些 try 块;`TryFinally.ts` 在结构化成功后按 try 表把 `X = hole; cleanup; if (X != hole) throw X` 重新包成 `try/finally`。try 起点 / cleanup / guard 可能被结构化进条件 test 的 `SequenceExpression`(如首块正好是可选链比较、cleanup 首块是 `sentinel === undefined` 比较),也可能整段 finally 被折叠进最后一个分支的尾部——`handleBlock` 对这种情况放表达式标记,`applyFinallyPlans` 再提升到包含该 test 的语句并在尾部情形上提 finally。仍无法定位时会在函数体末尾留 `/* xpanda: try/finally not restored */`,不要把它当成全局修复。
- 测试 test 序列取反链和条件赋值折叠时,优先用 `zhihupp0.59.hap` 的 `AbsoluteUrlParser`(`if (host.length === 0 || host.startsWith("["))`)与 `aes.abc` 的 `Counter.increment`(`if (arr[i] !== 255)`)做回归。
- `NodeFactory.generate()` 末尾会把超过 120 字符的行在顶层 `||` / `&&` / `??` 前折行(`src/ast/FormatCode.ts`),新行以操作符开头;字符串/模板/注释/正则内部与含顶层三目的行不折行。它只影响输出文本,不改 AST 语义;新增快照时保持这份格式。
