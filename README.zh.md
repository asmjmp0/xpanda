# xpanda

**简体中文** | [English](README.md)

**反编译网页:** <https://tencent.jmp0.top/xpanda>

> 卧槽,然后他看了以后啊,就怔住了说,说这么好的**鸿蒙反编译器**,你咋不,你怎么不早点告诉我。

鸿蒙 HarmonyOS `.abc`(Panda / ArkCompiler 字节码)反编译器,**纯 TypeScript** 实现,Node.js ≥ 18,零原生依赖。

把 `.abc` 文件反编译成可读的 JavaScript 源码:还原类、方法、函数、控制流、模块 import/export,并通过优化器清理编译器生成的寄存器临时变量。

支持字节码版本:`24.0.0.0`(向后兼容 `13.0.1.0`)。

![xpanda web UI —— 在浏览器内完成鸿蒙应用包反编译,数据不出本地](assets/web-ui.png)

## 特性

- **纯 TypeScript、零原生依赖**:解析 `.abc` 并输出可直接阅读、可直接运行的 JavaScript;
- **类与函数还原**:类字段、访问器、原型方法、闭包、词法环境(`local` / `sendable` env);
- **控制流还原**:`if/else`、`while/do-while`、`for`、`try/catch/finally` 等;结构化失败时自动降级为带标签的线性输出;
- **模块还原**:ES Module 的 `import` / `export`;
- **Babel AST 优化器**:寄存器临时变量复制传播、死存储消除、函数/类语法还原、调用形式重写、复合赋值折叠;
- **MCP Server**:可接入 Claude Code、OpenCode、Cursor 等 AI 客户端按需分析 `.abc`;
- **Web UI**:浏览器里拖入 `.abc` / `.hap` 即可反编译,全程纯前端,不上传任何数据。

## 环境要求

- Node.js ≥ 18

## 目录结构

项目拆分为四个 yarn workspaces 子包,位于 `packages/` 下:

| 子包 | 职责 |
|---|---|
| `xpanda-core` | `.abc` / `.hap` 解析、反汇编、反编译与优化器——其余子包依赖的核心库 |
| `xpanda-cli` | 命令行(`decompile` / `unpack-index` / `dump-asm`) |
| `xpanda-mcp` | MCP Server(stdio,供 AI 客户端接入) |
| `xpanda-web` | 浏览器 UI(React + Vite,纯前端) |

## 安装与使用

```bash
yarn install
```

CLI(在仓库根目录执行):

```bash
yarn tsx packages/xpanda-cli/src/cli.ts decompile <file.abc|file.hap> [-o outDir] [--no-simplify] [--stdout] [--quiet] [-j N]
yarn tsx packages/xpanda-cli/src/cli.ts dump-asm <file.abc|file.hap> [-o outDir] [--stdout]
```

| 参数 | 说明 |
|---|---|
| `-o outDir` | 输出目录,默认 `out` |
| `--no-simplify` | 跳过优化器,输出原始反编译结果,速度更快 |
| `--stdout` | 把结果输出到标准输出,不落盘 |
| `--quiet` | 关闭过程日志 |
| `-j, --jobs N` | 按类并行 simplify 的 worker 数;`0` 表示自动(CPU-1,上限 4) |

hap 支持说明:

- 输入 `.hap`(鸿蒙应用包,ZIP 容器)时自动解出包内全部 `.abc` 条目逐个反编译,
  类文件输出到 `outDir/<abc 条目路径>/`(如 `ets/modules.abc` → `out/ets/modules/`),
  并把 `resources.index` 解包为 `outDir/resources.json`;
- `unpack-index` 子命令也可单独解包 `resources.index`。

示例:

```bash
# 完整反编译(含优化器)
yarn tsx packages/xpanda-cli/src/cli.ts decompile app.abc -o out --quiet

# 大文件按类并行(worker_threads)
yarn tsx packages/xpanda-cli/src/cli.ts decompile app.abc -o out -j 4 --quiet

# 只看反编译结果,不优化
yarn tsx packages/xpanda-cli/src/cli.ts decompile app.abc -o out --no-simplify --quiet

# 输出到终端
yarn tsx packages/xpanda-cli/src/cli.ts decompile app.abc --stdout --quiet
```

### 导出字节码汇编

`dump-asm` 把每个类的全部方法反汇编为字节码汇编文本(`.asm` 文件,每类一个,
目录结构与 `decompile` 一致),便于查看反编译结果对应的原始字节码。每个方法输出
`vregs` / `args` / 代码字节数 / try 块数,随后是带标签的基本块;跳转指令会打印
解析后的目标标签(`[label_221]`)。

```bash
# 落盘为 .asm 文件(hap 输出到 out/<abc 条目路径>/<类路径>.asm)
yarn tsx packages/xpanda-cli/src/cli.ts dump-asm app.hap -o out

# 或全部输出到终端
yarn tsx packages/xpanda-cli/src/cli.ts dump-asm app.abc --stdout
```

大文件建议加堆并开启按类并行:

```bash
NODE_OPTIONS=--max-old-space-size=4096 \
  yarn tsx packages/xpanda-cli/src/cli.ts decompile app.abc -o out -j 4 --quiet
```

## 编程 API

```ts
import * as fs from "fs";
import { PandaFile, PandaDecompiler } from "xpanda-core";

const pandaFile = new PandaFile(new Uint8Array(fs.readFileSync("app.abc")));
const decompiler = new PandaDecompiler();

for (const cls of pandaFile.getAllClasses()) {
    const js = decompiler.decompileClass(cls);       // 含 simplify
    // const js = decompiler.decompileClassRaw(cls); // 不含 simplify
}
```

## MCP Server

xpanda 内置 [Model Context Protocol](https://modelcontextprotocol.io) Server,可把反编译能力接入 Claude Code、OpenCode、Cursor 等 AI 客户端,让 agent 按需、增量地分析 `.abc` 与 `.hap`(应用包,内含字节码与资源表):加载 → 浏览类 → 查看元数据 → 反编译单类 → 反汇编对照 → 搜索字符串 → 查询资源。

```bash
yarn mcp             # 启动(stdio transport)
yarn test:mcp        # 端到端测试
```

| 工具 | 作用 |
|---|---|
| `abc_load` | 解析 `.abc` 或 `.hap` 文件,返回 `fileId`;hap 返回包摘要与 `.abc` 条目清单 |
| `hap_read_abc` | 把 hap 内 `.abc` 条目解出为 abc 会话,返回的 `abcFileId` 可用于全部 `abc_*` 工具 |
| `hap_resources` | 解析 hap 内 `resources.index`,按名字/类型/限定词/ID 查询资源项 |
| `abc_list_classes` | 分页列出类(名称/方法数/字段数),支持子串过滤 |
| `abc_get_class` | 类元数据:父类、字段表、方法表(shorty 原型)、import/export |
| `abc_decompile_class` | 单类反编译为 JavaScript 源码,带降级标志 |
| `abc_disassemble_method` | 方法级反汇编(基本块 + 跳转目标 + try-catch 归属) |
| `abc_search_strings` | 字符串池搜索(子串或正则),定位 URL/密钥等线索 |
| `abc_export` | 全量反编译落盘(等价 CLI decompile) |
| `abc_close` | 释放会话内存(abc 或 hap) |

客户端接入:

```bash
# Claude Code
claude mcp add xpanda -- npx tsx /absolute/path/to/xpanda/packages/xpanda-mcp/src/server.ts

# OpenCode
opencode mcp add xpanda -- npx tsx /absolute/path/to/xpanda/packages/xpanda-mcp/src/server.ts
```

通用 JSON 配置(Claude Desktop / Cursor 等):

```json
{
  "mcpServers": {
    "xpanda": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/xpanda/packages/xpanda-mcp/src/server.ts"]
    }
  }
}
```

完整工具说明见 [docs/MCP.md](docs/MCP.md)。

## Web UI

xpanda 还带一个浏览器 UI,`.abc` 文件与 `.hap` 应用包**全程在浏览器内**反编译,不向服务器上传任何数据。

```bash
yarn web             # vite dev server → http://localhost:5173
```

- 任意位置拖拽或选择文件(`.abc` / `.hap`,支持多选);hap 在内存中解包,每个 `.abc` 条目有独立的类列表;
- 类列表支持搜索与按包分组;点击单个类反编译,或"全部反编译"(实时进度条,可取消);
- 单类复制 / 下载,全部结果打包 `.zip`;输出模式可切换 **Optimized**(含优化器)/ **Raw AST**;
- 零依赖语法高亮,带行号。

详见 [packages/xpanda-web/README.md](packages/xpanda-web/README.md)。

## 规划(Roadmap)

1. **继续优化结构化输出。** 区域归约在不可归约图上仍会降级成带 label 的线性输出,
   少数 `try/finally` 形态还会留下 `try/finally not restored` 注释;改进点在
   `StructureAnalysis.ts` 与 `TryFinally.ts`,每条新规则都要在全量样本上量过影响面。
2. **增加 SSA 层。** 在 CFG 上建立 def-use 链与 φ 节点(参考
   [React Compiler](https://github.com/react/react/tree/main/compiler) 的设计),
   让死存储消除、复制传播、累加器折叠在**结构化之前**于 IR 上做一次,而不是事后从
   生成的 AST 里再反推 —— 目标是消掉优化器现在必须靠形态匹配才能识别的
   `vN = v0` 寄存器搬运与条件物化临时变量。

## 参考实现

字节码格式、指令执行语义与 `resources.index` 布局参考 OpenHarmony 官方仓库:

- [arkcompiler_runtime_core](https://gitcode.com/openharmony/arkcompiler_runtime_core) — ISA 指令集定义(`isa/isa.yaml`)、字节码文件格式与验证器;
- [arkcompiler_ets_runtime](https://gitcode.com/openharmony/arkcompiler_ets_runtime) — 动态语言解释器实现(各指令的执行语义,如 `callthis*withname` 系列);
- [developtools_global_resource_tool](https://gitcode.com/openharmony/developtools_global_resource_tool) — `restool` 实现(`ResourceTable::LoadResTable`),用于解析 `resources.index`。

## License

见 [LICENSE](LICENSE)。
