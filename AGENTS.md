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
| `test/` | 集成测试 + 样本(`md5.abc`、`class.abc`、`aes.abc`、`zhihupp0.59.hap`、`yourpipe0.7.0.abc`) |
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
- **累加器链不只限二元运算**(`tryFoldAccumulatorPair`):`X = E; X = X.trim()` / `X = X.length` 这类成员调用/装载链同样只读取旧值一次。读取落在最先求值位置(调用接收者/成员对象)时 E 可以含调用,否则要求 E 纯(求值顺序会越过 E 的副作用);`countReadsInNode === 1`、`hasDeferredSelfReference` 等检查保持;
- **Hub 别名折叠要把旧值的读取一起重定向**(`tryFoldTempAlias` + `redirectReadsUntilWrite`):`acc = E; v5 = acc; <读取 acc>...; acc = G` 中,`v5 = acc` 到下一次写 acc 之间的读取都属于旧值,先改看 v5 再把 E 搬进 v5;遇到分支/循环/异常路径里的条件写入(或对 target 的写入)放弃,避免把写入后的值当成旧值。成员目标(`v0.sbox = acc`)不做重定向;
- **`then` 分支一定终止时展开 else**(`SyntaxRewriteSimplify.flattenElseAfterExit`):`if (C) { return/throw/break/continue } else { BODY }` → `if (C) { ... } BODY`。必须放在 HighLevelGrammarSimplify 的三目合成之后(两分支都是单条 return 的 if/else 要先合成三目,否则会被拆散),且只在语句列表里展开(LabeledStatement 直接包住 if 时 break label 依赖 else 仍在标签内);else 块顶层有块级声明(let/const/class/function)时保守跳过;
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
- **提前 return 的 for-of 被 lower 成 `do { vv = it.next(); if (vv.done) return true; ... } while (test)` + `it.return()` 收尾时,由 `checkAndTransformDoWhileToForOfStatement` 还原成 for-of**,把循环 test 搬到循环体末尾 `if (!test) return <循环后的返回值>`,循环后的常量搬成 for-of 之后的 return。要求 done/循环后返回值都是布尔常量、`it` 在 close 之外不再读取、循环体无 break,且 continue 的唯一形态是 `if (test) continue`(保证 continue 路径上的 test 为真,跳过附加出口判断等价)。
- **`while (true) { vv = it.next(); if (vv.done) break; vv = vv.value; ... }` 还原成 `for (vv of iterable)`**(`checkAndTransformToForOfStatement`):要求 `it = iterable[Symbol.iterator]()`,且 `it` 在循环体内除第一条 `next()` 外不再读取/赋值(ArkTS 会在提前 return 分支内联 `it.return()`,转换后 `it` 已不再赋值)。编译器会复用同一个临时迭代器/循环变量连续写多个 while,所以循环外的读取不是一律禁止:只要读取前一定先有新的 `it = ...` / `vv = ...` 覆盖就是安全的(`hasNewerValueBefore` 沿读取的祖先块向前找直接赋值,闭包内的读取直接放弃)。`vv` 在 for-of 结束后停在最后一个元素,而 while 形态停在 done 结果对象,因此循环外读取必须被后续赋值覆盖,循环之前读取则不受影响。只替换 `vv.value`,循环体里其它对象的 `.value` 必须保持不变。反编译生成的 AST 节点没有 `start/end`,判断 `vv` 是否在循环内要用路径祖先关系(`ref.findParent`),不能按位置;替换必须在仍挂在 AST 上的 `body` 路径上 `.traverse`,不要先构造脱离树的 `blockStatement` 再单独 `traverse`(缺 `parentPath` 会让嵌套作用域的 scope 链断在非 `Program` 节点,`Scope.crawl` 抛 `addGlobal` 异常);
- 修改输出后,更新 `test/expected/*.js` 快照并在提交说明中解释变化。

### 修改 Region 归约 / 条件极性

结构化分析里最容易出错的是“条件该不该取反”:

1. **不要依赖 `regionGraph.successors()` 的返回顺序**。`ValueGraph` 按插入顺序返回,与 true/false 边无关;判断分支极性必须用 `edgeValueOrThrow(region, succ)`。
2. `conditionalExp` 描述的是 fallthrough(false 边)分支的条件:jnez 时 false 边为 `!acc`,jeqz 时 false 边为 `acc`;折叠 true 边(`coalesceTailRegion`)时才需要 `expInvert()`。
3. `simplifyConditionalSequence` 会把 `if (A) ... if (B) ...` 合并成 `OrLogicalExpressionStatement` 并设置 `logicalRegion`;`reduceSequence` 合并这种 Region 时必须传播 `logicalRegion`,否则后续只能用 `acc` 生成 test,会丢掉 `A || B` 的计算。
4. `Region.copy()`(不可归约 Tail 复制)必须保留 `conditionalExp` / `logicalRegion` / `exceptionLandingPad` / `tryCatchHelperRegion` 标志。
5. 合并后的子区域如果已经是 `LogicalExpressionStatement`(`(A || B)` / `(A && B)`),**不要再追加 `acc`/`!acc`**:它的表达式本身就是条件值,追加会把 `acc` 里最后一个比较结果覆盖到条件上(`name === A || ((name === B, acc) || ...)` 既是语义错误,又会留下 `(acc = E, !E)` 死赋值)。`||` 的操作数是跳转条件、`&&` 的操作数是 fallthrough 条件,父子类型不同时要取反。
6. `virtualizeIrregularExits` 遇到循环体内的不规则出口时,**同一条边只生成一个语句**:条件区域生成 `if (cond) break`,线性区域生成无条件 `break`。两者都生成会先得到 `if (cond) break`、再追加一条无条件 `break`,循环体永远只执行一次(`AppUpdateClient.fetchReleaseDetail` 的内层 for...of 曾因此直接返回迭代器结果对象)。出口目标是 `outDegree === 0` 的 Tail(只剩 `return`/`throw`)时不能靠 `break`(它只会跳到循环 follow),应把 Tail 的语句复制进该分支;目标还有其它前驱、不能合并时正是这种情形。
7. **`tryCatchHelperRegion` 只在 try/catch 的两条分支还没消费时有效**:`reduceIfRegion` 生成 `IfPandaStatement`(case 3/4)或 `reduceTryCatchWithDeadBranch` 之后必须把标志清掉(`region.tryCatchHelperRegion = false`)。否则该区域继续吸收后续代码时,`reduceSequence` 会把标志一路传下去,后面正常的条件区域会被 `IfPandaStatement` 当成 try/catch,输出 `try { ... } catch { 成功路径 }` 这种语义错误的语句(`HttpDownloader.request` 曾因此把成功分支放进 catch)。
8. **try/catch 的一条分支归约成 `outDegree === 0` 的 Tail、另一条是回边时**需要 `reduceTryCatchWithDeadBranch`:case 3 要求两条分支汇合到同一后继,case 4 要求两条都是 Tail,都不满足时区域图会卡住直到 `can not reduce the graph`(`HttpDownloader.request` / `postBinaryWithRetry` 的循环体)。继续执行的分支必须已经归约成 `Linear`(否则留给下一轮定点迭代),两条分支都必须只有当前区域一个前驱。
9. **`&&` 合并出的逻辑区域(`AndLogicalExpressionStatement`)表达式是 fallthrough 条件**,不是 true 边条件;在 `coalesceTailRegion` / `virtualizeIrregularExits` 里折叠 true 边上的 Tail 时 `expInvert()` 对它不生效,必须改用取反分支(`new IfPandaStatement(region, null, tail)`),再由 `normalizeConditionTests` 折成 `!A || !B`。否则会输出反过来的条件(`if (code && code >= 400) return` ← 应为 `if (!code || code < 400) return`)。
10. 改完用 `zhihupp0.59.hap` 的 `AbsoluteUrlParser` / `ZhihuHttpClient`、`AppDestination.shouldReloadAfterAuthentication`(17 项 `===` 的 `||` 链)、`AppUpdateClient.fetchReleaseDetail`(for...of 内提前 return)、`yourpipe0.7.0.abc` 的 `HttpDownloader.request` / `postBinaryWithRetry`(循环体内嵌套 try/catch)和 `aes.abc` 的 `Counter.increment`(必须是 `!== 255`)验证。

## 测试

| 测试 | 用途 |
|---|---|
| `test/decompile.test.ts` | 反编译 `md5.abc` / `class.abc` / `aes.abc`,与 `test/expected/*.js` 比较,并做 Babel 再解析;另含并行一致性回归、HAP 包(`zhihupp0.59.hap`)重点类回归(AppDestination / AbsoluteUrlParser / ContentFilterRuntimeStore / StartupDestinationChannel / DeepLinkResolver / ShareContracts / AppUpdateClient 等,部分含沙箱行为校验)与 `yourpipe0.7.0.abc` 的 SabrResponseDecoder 嵌套作用域 for-of、MpvPlayerView 单跳转区域、HttpDownloader 循环体嵌套 try/catch 回归 |
| `scripts/test-mcp.ts` | 以子进程启动 MCP Server,按 JSON-RPC 调用全部工具,快照比对 + 错误路径校验(含 hap 加载/解 abc/资源查询) |
| `test/resources/md5.abc` | 小样本,测试中还会执行输出并校验 MD5 结果 |
| `test/resources/class.abc` | 类/访问器/原型方法还原样本 |
| `test/resources/aes.abc` | AES 加解密样本,测试中还会执行输出并校验加解密自检结果为 `true`;快照覆盖条件极性(`Counter.increment` 必须是 `!== 255`)和 test 序列死赋值清理 |
| `test/resources/yourpipe0.7.0.abc` | 5.4MB 应用字节码样本,测试反编译 `SabrResponseDecoder`(其 for-of 循环体含 switch/嵌套循环,用于覆盖“脱离 AST 的 blockStatement 单独 traverse 导致 scope 链断裂”的回归)、`MpvPlayerView`(单跳转区域)、`HttpDownloader`(循环体内嵌套 try/catch,整类快照 `test/expected/yourpipe-http-downloader.js`)、`MusicSearchService`(真值守卫三目→可选链、`it.next` 方法量提升的 for-of 还原、死枢纽拷贝折叠,整类快照 `test/expected/yourpipe-music-search-service.js`)、`AVPlayer`(资源对象 `LiteralTag.ACCESSOR` 字面量的兜底输出,覆盖非法标识符回归,整类快照 `test/expected/yourpipe-av-player.js`) |
| `test/resources/zhihupp0.59.hap` | HAP 应用包样本(字节码版本 13.0.1.0,含 `callruntime.supercallforwardallargs`),完整反编译约 1 分钟,测试只做重点类校验;`AbsoluteUrlParser` / `ZhihuHttpClient` 是逻辑条件与取反链的重点回归类,`DeepLinkResolver` 是累加器物化、重复调用消除、test 序列死赋值与跨变量布尔物化折叠(`acc = A; v1 = A; if (acc) { v1 = B }` → `v1 = A && B`)的重点回归类 |

更新快照前先确认输出变化是预期的;不要为了通过测试而直接覆盖快照。

## 陷阱与注意事项

- **降级路径是设计行为,不是 bug**:单方法 > 500 基本块、指令 kind 未注册 handle,二者使该方法走 `SimpleAnalysis` 线性输出;`jeq/jne/jstricteq/jnstricteq` 指令构造即抛异常,词法分析阶段(`PandaLexical`)会跳过该方法并输出占位函数体,不中断整个类。
- 前缀指令占 2 字节(首字节 ≥ 251),`PandaDisAssembler` 有特殊处理;新增指令名(kind 映射)用 isa.yaml 的 `sig` 首词(如 `wide.callrange`)。
- 类名形如 `Lpkg/Name;`,输出前由 `PandaDecompiler.saveFile()` demangle。
- `--no-simplify` 不执行优化器,适合验证解析/反汇编;大文件完整优化耗时主要来自逐类按函数分析和定点迭代。
- `acc` 是 Panda 累加器,不是源码变量:`acc = !acc` 可能来自 `callruntime.isfalse`,也可能来自编译器对条件的布尔物化;二者叠加时看起来是两条取反,实际源码可能只有一个 `!`。
- `HighLevelGrammarSimplify` 会把 `if (!X) { X = true } else { X = false }` 合成为 `X = !X`,可能和已有的 `X = !X` 形成新的连续取反链;因此流水线末尾必须再跑一次 `TempVariableSimplify.foldConditionAssignments`,不要删掉这一步。
- 优化器在 HighLevelGrammarSimplify 之前先跑一次 `TempVariableSimplify.foldAccumulatorAssignments`(只折累加器链,全深度递归):超过 `MAX_PROPAGATED_SIZE` 的长右值进不了复制传播环境(`define` 直接拒收),嵌套累加链 `acc = S; acc = acc + E + F > 0` 会原样留到定点迭代结束,使三目合成对 `if (C) { acc = S; acc = acc + E + F > 0 } else { acc = false }` 匹配失败(它要求分支是单条赋值语句)。
- 优化器尾部顺序固定为:HighLevelGrammarSimplify → foldShortCircuitAssignments(补折 HighLevel 新暴露的 `X = E; if (E) { X = B }`) → NullishCoalescing → `AccCallSimplify.simplifySequences`(还原只存在于条件 `SequenceExpression` 里的 `acc = acc.method; acc = acc.call(recv, ...)`,提前处理会被后续别名传播读错版本) → ConditionSimplify.foldMaterializedTestArtifacts(清 test 序列物化残留) → flattenElseAfterExit(then 分支终止的 else 展开成守卫子句) → foldReturnAssignments(先折累加器链 `X = E; X = X op F`(含成员调用),再折 `X = E; Y = X` / `obj.k = X`(X 已死,或旧值读取可重定向到 Y)、调用参数末次读取 `X = E; f(X)` → `f(E)`,再补折 `X = E; return X` / `X = E; return X op F`,三目合成发生在定点迭代之后;累加器链必须先于别名折叠,否则会留下无人的 `acc = C ? A : B` 死存储) → foldConditionAssignments → normalizeConditionTests → foldConditionAssignments(再折 normalize 刚展开的 `X = Y && Z` 布尔别名链与死存储) → normalizeConditionTests(把 `!(!A && !B)` 归一成 `||`) → hoistTestPrefixes → foldCompoundAssignments → `HighLevelGrammarSimplify.simplifyTail`(见下条)。调整顺序前先确认条件极性、复合赋值和 `test` 序列折叠不会互相覆盖。
- **`matchConditionPattern` 的复合 test 支持多次读取,但仅限存在取反链时**:编译器把 `A && (f(), A)` 这类"读取同一物化布尔"的 lowering 生成 `acc = E; acc = !acc; if (!acc && (f(), acc))`,test 里两处读取都替换成同一奇偶值才能消掉 `acc = !acc`(`AppUpdateClient` 的 `fetchReleaseDetail` 守卫、`AVPlayer.onControllerChanged` 的 surfaceID 回注是回归样本)。约束:E 必须纯(多读取 = 多次求值)、test 序列里不得再赋值 X(`acc = trim(), acc = acc.length, acc === 0` 的两次读取是不同版本,都替换成模式右值是语义错误)、negations = 0 的多次读取保持原样(`v2 = E; if (v2 && (..., !v2 ...))` 折叠会把 E 复制多遍,输出变差)。另外 E 读取 X(`X = X.length; if (X > 0)`)是合法的:start..ifIndex 的赋值会被整体删除,test 里的替换值读到的正是删除前的旧 X。
- **常量 test + 守卫的循环要提成 `while (COND)`**(`TempVariableSimplify.foldWhileTrueBreakGuards`):ArkTS 把 `while (COND)` 折成 `while (true) { if (!COND) break; ... }`;守卫留在 body 里时,条件内的累加器物化(`acc = line.trim(), acc = acc.length`)与守卫前的死保存(`acc = !(i < len)`)既不在语句列表也不是循环 test,`cleanupStatements`/`foldTestSequences` 都清理不到。折叠放在 `cleanupConditionAssignments` 之后(守卫前的死保存必须先并进 if test),守卫前连续的**纯**表达式语句一起搬进 test,由同一轮的 `foldLoopTestTemps` 清理,De Morgan/比较反转交给尾部 `normalizeConditionTests`。必须跳过 `init; while (true) { if (!cond) break; BODY; update }`(`looksLikeForLoopLowering`)以及前缀含调用(for-of/for-in 的 `vv = it.next()`)的形态,否则 for / for-of / for-in 还原再也认不出来(aes/md5 的 for 会退化成 while + 手工自增)。
- **`branchReadsNameBeforeWrite` 遇到 while 要按求值时序判断**:循环 test 每轮在 body 之前求值,`collectReadNames(test)` 命中 name 时保守放弃;test 不读 name 时循环本身不构成“先读后写”,body 内部仍按语句顺序递归(先 `definitelyWritesBeforeRead` 再逐条)。否则嵌套循环里先写后读的累加器读取会被当成整个 else 分支的首次读取,挡住外层 `acc = !!v11; if (!acc)` 的条件折叠(`parseVttSubtitles` 回归)。
- **`simplifyTail` 必须在所有条件折叠之后跑,且只做五类局部还原**:①真值守卫三目 `x ? x.k : undefined` → `x?.k`(ArkTS 在类型系统保证守卫值是对象或 nullish 时对 `?.` 的 lowering;主遍历阶段它还是 `!acc` 物化链,守卫未折回标识符,所以必须放在尾部)②累加器死枢纽拷贝折叠(`acc = E; v14 = acc` 且 acc 随即被覆写 → `v14 = E`,要求 RHS 纯)③while(true)+break 形态 for-of 还原,含 `v21 = it; v20 = it.next; v22 = v20.call(v21)` 的方法量提升 lowering(`foldHoistedIteratorNext` 先归一化成 `v22 = it.next()`;别名被前面的折叠内联时 `G = X[Symbol.iterator](); F = G.next` 两种形态都要认),转换成功后 `tryInlineForOfIterable` 把只为迭代器供值的 `X = E` 内联进 for-of 头部(for-of 头部自己的 `of X` 也是 X 的引用,检查时要排除)④同一语句列表里连续的 `if (disc === v) { return ...; }` 守卫链 → `switch`(ArkTS 对源码 switch 的 lowering,else-if 块先由 `flattenElseAfterExit` 展开成守卫子句):要求 case 标签(含 `A || B` 拆出的 fallthrough 标签)至少 3 个,2 个标签的短链保持 if 形式(旧的 `checkAndTransformToSwitchCase` 同步提高到 ≥3,只有 null/undefined 对保留 2 个 case 供 `??` 还原)、判别式与 case 值无副作用、分支体顶层以 return/throw 结尾(否则匹配后还要继续检查后面的 if,语义不等价),分支体里不能有会绑定到外层循环的裸 break(会被 switch 截获),只认同 `===`(switch case 用严格比较),链尾紧跟的 return/throw 折成 default;case 体顶层有块级声明时包一层块 ⑤清理只剩声明自身的 `vN`/`acc` 声明(`removeUnusedTempDeclarations`,按整个函数子树含嵌套函数计数,宁可多保留)。该 lowering 在主遍历阶段同样对不上形状。删除语句后绑定里的 referencePaths 不会清理,`hasNewerValueBefore` 对 `indexOf === -1` 的已删语句引用按"不再执行"跳过;循环内引用判定必须用当前 AST 的节点集合(walkNode 收集),不能直接用 `findParent`——被替换/删除节点的 parentPath 链是陈旧的,会把已消失的读取误判成循环内。
- **ArkTS 13(字节码 13.0.1.0)的 finally handler 形态随编译器版本不同**:有的 catch 块 `codeSize === 0`(`RegionGraphBuilder` 直接跳过,handler 不在区域图里),有的会带 `sta vX` 保存异常(`yourpipe0.7.0.abc` 里是 2/3)。`TryFinally.buildFinallyPlans` 不能按 codeSize 过滤,靠结构特征识别:try 结束块写 `hole` 哨兵并跳到 cleanup、handler 以 `sta` 开始且不直接 throw、cleanup 之后有 `X != hole` 重抛守卫。`applyFinallyPlans` 支持三种布局:try 体/cleanup/guard 在同一语句列表;三者都在嵌套列表尾部;以及结构化分析已经把 handler 生成成 `try { ... } catch (acc) { cleanup ... guard }`(同一个 try 起点既有真 catch、又有 finally handler)——最后一种直接改写成 `try/finally`,sentinel 保存与重抛守卫整段丢弃。try 起点 / cleanup / guard 也可能被结构化进条件 test 的 `SequenceExpression`,`handleBlock` 用表达式标记,`applyFinallyPlans` 会提升到包含该 test 的语句。仍无法定位时会在函数体末尾留 `/* xpanda: try/finally not restored */`,不要把它当成全局修复。
- **finally 的读取在 try 的每个出口都活跃**:`TempVariableSimplify` 的活跃性模型没有异常边,`return/throw/break/continue` 的出口必须并入 `finalizerReads`(`LoopLive.finallyLive`),否则 try 里 `v14 = request` 会被当成死存储删掉,finally 只剩 try 之前的 `v14 = null`,清理逻辑变成死代码。
- **匿名函数表达式的入口自引用不能整条删**:`ReservedIdentifierSimplifier` 把 `panda_jmp0_reserved_param_p0` 当成“匿名函数没有自身名字”删语句;但入口指令会被结构化归约折进 `if ((v0 = p0, ..., cond)) { 整个函数体 }` 的 test 序列,删语句会把函数体一起删掉(空函数)。只有整条语句就是自引用赋值时才能删,否则把标识符替换成 `undefined`。
- **词法环境要按 CFG 栈传播,且每个环境实例必须有唯一名字**:循环体里 `popLexEnv` 在 pc 序里可能先于同一作用域的其它分支出现,线性扫描会把后面的 `ldlexvar` 命名成 `local_-1_x`(未声明变量)。`PandaLexical.computeEnvStacks` 从入口按边传播每个基本块的**环境栈**;异常 handler 用 try 起点处的栈播种(异常边不在 CFG 里;起点与块首之间可能有 `newLexEnv`,要用 `stackAfterPC`),handler 子图里还可能有嵌套 try,所以播种与传播交替进行直到没有新的 handler 可播种。变量名不能只用 `local_<depth>_<index>`:同一层级的多个环境(典型是连续定义的多个 class 各自的 self-reference 环境,ArkTS 会为每个 class 单独开一个 lexenv 并把类存到 `stlexvar 0,0`)会生成同名变量,后声明的 `let` 会在块内遮蔽前面的引用,优化器还会把外层声明当成未使用删掉(`HttpDownloader` 的 `local_1_0` 曾整体丢失)。现在同一 `newLexEnv` 的槽位共享前缀 `local_<depth>` / `local_<depth>_<n>`,`loadLex/storeLex` 通过环境栈解析到目标环境的前缀;临时变量正则都允许第三个数字后缀。
- **声明清理不能只信过期的 `ctx.infos.refs`**:复制传播会克隆表达式,克隆出来的读取不在 refs 里,`refs.size === 0` 时可能把仍有引用的声明删掉(`RangeProxy` 的 `local_1_2_1`)。`removeUnusedDeclarations` 还会按当前 AST 数一遍名字出现次数(跳过嵌套函数,被闭包捕获的变量由 `captured` 保护),只有确实只剩声明本身才删。
- **catch 参数不能叫 `acc`**:结构化分析生成的 handler 是照 Panda 累加器写的——异常在 `acc` 里进入,try 体也用 `acc` 当累加器。若 `catch (acc)` 会遮蔽函数级累加器,优化器只能看到一串写 catch 参数的赋值(`catchAcc = ...` 死链)。现在 `NodeFactory.tryStatementNode` 用独立的 `catchAcc`,`TryCatchPandaStatement` 在 handler 开头插一条 `acc = catchAcc` 把异常搬回累加器,后续累加器链就能按普通 `acc` 折叠。
- 测试 test 序列取反链和条件赋值折叠时,优先用 `zhihupp0.59.hap` 的 `AbsoluteUrlParser`(`if (host.length === 0 || host.startsWith("["))`)与 `aes.abc` 的 `Counter.increment`(`if (arr[i] !== 255)`)做回归。
- `NodeFactory.generate()` 末尾会把超过 120 字符的行在顶层 `||` / `&&` / `??` 前折行(`src/ast/FormatCode.ts`),新行以操作符开头;字符串/模板/注释/正则内部与含顶层三目的行不折行。它只影响输出文本,不改 AST 语义;新增快照时保持这份格式。
