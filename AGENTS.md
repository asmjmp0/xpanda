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
| `src/decompiler/` | `StructureAnalysis.ts`(Region 归约核心)、`Region.ts` / `RegionGraphBuilder.ts`(区域、条件/逻辑标志、不可归约 Tail 复制)、`statements.ts`、`MethodHandler.ts`(HANDLES 分发)、`SimpleAnalysis.ts`、`ValueGraph.ts`、`DominatorGraph.ts` |
| `src/codegen/CodeGenerator.ts` | AST 生成入口(包装 `src/ast/`) |
| `src/ast/` | `NodeFactory` / `NodeUtils`(Babel AST 工具) |
| `src/simplify/` | 优化器流水线(`SimplifyExport`、`TempVariableSimplify`、`ConditionSimplify`、`SyntaxRewriteSimplify`、`ClassSyntaxSimplify`、`HighLevelGrammarSimplify`、`AstUtils`、`NormalizeDeclarations`);末尾含 `foldConditionAssignments`(条件取反链二次折叠)与 `hoistTestPrefixes`(常量前缀提升) |
| `src/parallel/` | 按类并行的 simplify worker 池(`ParallelDecompiler.ts` 调度、`simplify-worker.ts` worker 入口) |
| `src/hap/` | HAP 应用包适配:`ZipFile.ts`(只读 ZIP 解析,store/deflate)、`HapFile.ts`(.abc 条目/module.json/resources.index) |
| `src/mcp/` | MCP Server(`server.ts` stdio 入口、`registry.ts` abc/hap 会话注册表、`tools/` 十个工具),文档见 [docs/MCP.md](docs/MCP.md) |
| `src/PandaDecompiler.ts` | 对外总入口(库 API) |
| `src/cli.ts` | CLI:`decompile <file.abc|file.hap> [-o outDir] [--no-simplify] [--stdout] [--quiet] [-j N]`、`unpack-index <resources.index> [-o outDir] [--stdout]` |
| `resources/isa.yaml` | ArkCompiler 指令集描述(v24.0.0.0) |
| `scripts/gen-opcodes.ts` | 生成 `src/disasm/opcodes.ts` |
| `test/` | 集成测试 + 样本(`md5.abc`、`class.abc`、`aes.abc`、`bilibili_open.abc`) |
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
npx tsx src/cli.ts decompile test/resources/bilibili_open.abc -o out -j 4 --quiet

# 跳过优化器,验证解析/反汇编改动
npx tsx src/cli.ts decompile test/resources/bilibili_open.abc -o out --no-simplify --quiet

# 大文件加堆
NODE_OPTIONS=--max-old-space-size=4096 \
  npx tsx src/cli.ts decompile test/resources/bilibili_open.abc -o out --quiet

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

`src/file/` 对应类;注意保持偏移掩码、缓存语义、边界处理等格式语义。改完用 `md5.abc`、`class.abc` 和 `bilibili_open.abc` 验证。

### 修改优化器

- 复制传播必须限制表达式大小/克隆预算,避免 `v2 = v1 + v1; v3 = v2 + v2; ...` 指数膨胀;
- 不活跃变量、SequenceExpression、return 语句、catch 参数的清理要经过 liveness / 作用域检查;
- **捕获判定必须同时看 `binding.referencePaths` 和 `binding.constantViolations`**。闭包里"只写不读"的外层变量只在 constantViolations 里;只看读取会把外层初始化(如 `local_1_1 = undefined`)当成唯一值传播到闭包之后的读取,并删掉声明;
- **非纯表达式(`call` / `new` / 函数/类)只能在真正最后一次读取时搬移**;`if` 的 test 和分支体都读同一临时变量时不能搬,否则会把调用复制成两次;
- `acc = !acc` 既可能来自 `callruntime.isfalse`,也可能来自条件物化(`istrue + jnez + ldtrue/ldfalse`);折叠时按取反次数的奇偶性处理,不能只删一层;
- test 序列里的自取反链(`if (A || (X = E, X = !X, !X))`)只有在 `X` 在 test 后已死、test 外无其它读取、分支/前缀不会先读后写时才折叠;循环 test 暂不处理;
- `if (A || (v1 = 0, v2 = 2, B))` 这类常量前缀提升(`hoistTestPrefixes`)要求:前缀只是临时变量赋常量、短路分支直接 return/throw 且不读取这些临时变量、不在带 `finally` 的 `try` 中;
- 修改输出后,更新 `test/expected/*.js` 快照并在提交说明中解释变化。

### 修改 Region 归约 / 条件极性

结构化分析里最容易出错的是“条件该不该取反”:

1. **不要依赖 `regionGraph.successors()` 的返回顺序**。`ValueGraph` 按插入顺序返回,与 true/false 边无关;判断分支极性必须用 `edgeValueOrThrow(region, succ)`。
2. `conditionalExp` 描述的是 fallthrough(false 边)分支的条件:jnez 时 false 边为 `!acc`,jeqz 时 false 边为 `acc`;折叠 true 边(`coalesceTailRegion`)时才需要 `expInvert()`。
3. `simplifyConditionalSequence` 会把 `if (A) ... if (B) ...` 合并成 `OrLogicalExpressionStatement` 并设置 `logicalRegion`;`reduceSequence` 合并这种 Region 时必须传播 `logicalRegion`,否则后续只能用 `acc` 生成 test,会丢掉 `A || B` 的计算。
4. `Region.copy()`(不可归约 Tail 复制)必须保留 `conditionalExp` / `logicalRegion` / `exceptionLandingPad` / `tryCatchHelperRegion` 标志。
5. 改完用 `zhihupp0.59.hap` 的 `AbsoluteUrlParser` / `ZhihuHttpClient`、`aes.abc` 的 `Counter.increment`(必须是 `!== 255`)和大样本 `bilibili_open.abc` 验证。

## 测试

| 测试 | 用途 |
|---|---|
| `test/decompile.test.ts` | 反编译 `md5.abc` / `class.abc` / `aes.abc`,与 `test/expected/*.js` 比较,并做 Babel 再解析;另含并行一致性回归与 HAP 包(`zhihupp0.59.hap`)轻量回归 |
| `scripts/test-mcp.ts` | 以子进程启动 MCP Server,按 JSON-RPC 调用全部工具,快照比对 + 错误路径校验(含 hap 加载/解 abc/资源查询) |
| `test/resources/md5.abc` | 小样本,测试中还会执行输出并校验 MD5 结果 |
| `test/resources/class.abc` | 类/访问器/原型方法还原样本 |
| `test/resources/aes.abc` | AES 加解密样本,测试中还会执行输出并校验加解密自检结果为 `true`;快照覆盖条件极性(`Counter.increment` 必须是 `!== 255`)和 test 序列死赋值清理 |
| `test/resources/bilibili_open.abc` | 大文件回归样本,通常手动验证 |
| `test/resources/zhihupp0.59.hap` | HAP 应用包样本(字节码版本 13.0.1.0,含 `callruntime.supercallforwardallargs`),完整反编译约 1 分钟,测试只做轻量校验;`AbsoluteUrlParser` / `ZhihuHttpClient` 是逻辑条件与取反链的重点回归类 |

更新快照前先确认输出变化是预期的;不要为了通过测试而直接覆盖快照。

## 陷阱与注意事项

- **降级路径是设计行为,不是 bug**:单方法 > 500 基本块、指令 kind 未注册 handle,二者使该方法走 `SimpleAnalysis` 线性输出;`jeq/jne/jstricteq/jnstricteq` 指令构造即抛异常,词法分析阶段(`PandaLexical`)会跳过该方法并输出占位函数体,不中断整个类。
- 前缀指令占 2 字节(首字节 ≥ 251),`PandaDisAssembler` 有特殊处理;新增指令名(kind 映射)用 isa.yaml 的 `sig` 首词(如 `wide.callrange`)。
- 类名形如 `Lpkg/Name;`,输出前由 `PandaDecompiler.saveFile()` demangle。
- `--no-simplify` 不执行优化器,适合验证解析/反汇编;大文件完整优化耗时主要来自逐类按函数分析和定点迭代。
- `acc` 是 Panda 累加器,不是源码变量:`acc = !acc` 可能来自 `callruntime.isfalse`,也可能来自编译器对条件的布尔物化;二者叠加时看起来是两条取反,实际源码可能只有一个 `!`。
- `HighLevelGrammarSimplify` 会把 `if (!X) { X = true } else { X = false }` 合成为 `X = !X`,可能和已有的 `X = !X` 形成新的连续取反链;因此流水线末尾必须再跑一次 `TempVariableSimplify.foldConditionAssignments`,不要删掉这一步。
- 优化器尾部顺序固定为:`HighLevelGrammarSimplify` → `foldConditionAssignments` → `normalizeConditionTests` → `hoistTestPrefixes` → `foldCompoundAssignments`。调整顺序前先确认条件极性、复合赋值和 `test` 序列折叠不会互相覆盖。
- 测试 test 序列取反链和条件赋值折叠时,优先用 `zhihupp0.59.hap` 的 `AbsoluteUrlParser`(`if (host.length === 0 || host.startsWith("["))`)与 `aes.abc` 的 `Counter.increment`(`if (arr[i] !== 255)`)做回归。
