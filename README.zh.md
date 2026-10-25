# xpanda

**简体中文** | [English](README.md)

**反编译网页:** <https://tencent.jmp0.top/xpanda>

> 卧槽，然后他看了以后啊，就怔住了说，说这么好的**鸿蒙反编译器**，你咋不，你怎么不早点告诉我。

鸿蒙 HarmonyOS `.abc`(Panda / ArkCompiler 字节码)反编译器,**纯 TypeScript** 实现,Node.js ≥ 18,零原生依赖。

把 `.abc` 文件反编译成可读的 JavaScript 源码:还原类、方法、函数、控制流、模块 import/export,并通过优化器清理编译器生成的寄存器临时变量。

支持字节码版本:`24.0.0.0`(向后兼容 `13.0.1.0`)。

## 特性

- **纯 TypeScript、零原生依赖**:解析 `.abc` 并输出可直接阅读、可直接运行的 JavaScript;
- **类与函数还原**:类字段、访问器、原型方法、闭包、词法环境(`local` / `sendable` env);
- **控制流还原**:`if/else`、`while/do-while`、`for`、`try/catch` 等;结构化失败时自动降级为带标签的线性输出;
- **模块还原**:ES Module 的 `import` / `export`;
- **Babel AST 优化器**:寄存器临时变量复制传播、死存储消除、函数/类语法还原、调用形式重写、复合赋值折叠;
- **MCP Server**:可接入 Claude Code、OpenCode、Cursor 等 AI 客户端按需分析 `.abc`;
- **Web UI**:浏览器里拖入 `.abc` / `.hap` 即可反编译,全程纯前端,不上传任何数据。

## 反编译结果

以下内容直接来自项目测试快照,没有手工改写。

### `packages/xpanda-core/test/expected/class.js`

```js
/*
* class name:L_GLOBAL;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
let Test = class panda_jmp0_reserved_class_0 {
  c = 10;
  get c() {
    return "10";
  }
  test() {
    console.log("123");
  }
};
new Test().test();
```

### `packages/xpanda-core/test/expected/md5.js`

完整结果见 [`test/expected/md5.js`](packages/xpanda-core/test/expected/md5.js)。

<details>
<summary>展开查看实际反编译输出</summary>

```js
/*
* class name:L_GLOBAL;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
(function () {
  function add32(p0, p1) {
    return p0 + p1 & 4294967295;
  }
  function rhex(p0) {
    let v3, v4;
    v3 = 0;
    for (v4 = ""; v3 < 4; v3 += 1) {
      v4 += "0123456789abcdef"[p0 >> v3 * 8 + 4 & 15] + "0123456789abcdef"[p0 >> v3 * 8 & 15];
    }
    return v4;
  }
  function gg(p0, p1, p2, p3, p4, p5, p6) {
    return cmn(p1 & p3 | p2 & ~p3, p0, p1, p4, p5, p6);
  }
  function md5blk(p0) {
    let v8, v9, v11;
    v8 = 0;
    for (v9 = []; v8 < 64; v8 += 4) {
      v11 = p0.charCodeAt(v8) + (p0.charCodeAt(v8 + 1) << 8) + (p0.charCodeAt(v8 + 2) << 16);
      v9[v8 >> 2] = v11 + (p0.charCodeAt(v8 + 3) << 24);
    }
    return v9;
  }
  function md51(p0) {
    let v0, v2, v3, v4, v8;
    if (new RegExp("[\\x80-\\xFF]").test(p0)) {
      p0 = unescape(encodeURI(p0));
    }
    globalThis.txt = "";
    v2 = [1732584193, -271733879, -1732584194, 271733878];
    for (v3 = 64; v3 <= p0.length; v3 += 64) {
      md5cycle(v2, md5blk(p0.substring(v3 - 64, v3)));
    }
    v0 = p0.substring(v3 - 64);
    v3 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (v8 = 0; v8 < v0.length; v8 += 1) {
      v3[v8 >> 2] = v3[v8 >> 2] | v0.charCodeAt(v8) << (v8 % 4 << 3);
    }
    v3[v8 >> 2] = v3[v8 >> 2] | 128 << (v8 % 4 << 3);
    if (v8 > 55) {
      md5cycle(v2, v3);
      for (v4 = 0; v4 < 16; v4 += 1) {
        v3[v4] = 0;
      }
    }
    v3[14] = p0.length * 8;
    md5cycle(v2, v3);
    return v2;
  }
  function ff(p0, p1, p2, p3, p4, p5, p6) {
    return cmn(p1 & p2 | ~p1 & p3, p0, p1, p4, p5, p6);
  }
  function hex(p0) {
    let v0;
    for (v0 = 0; v0 < p0.length; v0 += 1) {
      p0[v0] = rhex(p0[v0]);
    }
    return p0.join("");
  }
  function ii(p0, p1, p2, p3, p4, p5, p6) {
    return cmn(p2 ^ (p1 | ~p3), p0, p1, p4, p5, p6);
  }
  function hh(p0, p1, p2, p3, p4, p5, p6) {
    return cmn(p1 ^ p2 ^ p3, p0, p1, p4, p5, p6);
  }
  function md5cycle(p0, p1) {
    let v1, v3, v5, v7;
    v1 = ff(p0[0], p0[1], p0[2], p0[3], p1[0], 7, -680876936);
    v7 = ff(p0[3], v1, p0[1], p0[2], p1[1], 12, -389564586);
    v5 = ff(p0[2], v7, v1, p0[1], p1[2], 17, 606105819);
    v3 = ff(p0[1], v5, v7, v1, p1[3], 22, -1044525330);
    v1 = ff(v1, v3, v5, v7, p1[4], 7, -176418897);
    v7 = ff(v7, v1, v3, v5, p1[5], 12, 1200080426);
    v5 = ff(v5, v7, v1, v3, p1[6], 17, -1473231341);
    v3 = ff(v3, v5, v7, v1, p1[7], 22, -45705983);
    v1 = ff(v1, v3, v5, v7, p1[8], 7, 1770035416);
    v7 = ff(v7, v1, v3, v5, p1[9], 12, -1958414417);
    v5 = ff(v5, v7, v1, v3, p1[10], 17, -42063);
    v3 = ff(v3, v5, v7, v1, p1[11], 22, -1990404162);
    v1 = ff(v1, v3, v5, v7, p1[12], 7, 1804603682);
    v7 = ff(v7, v1, v3, v5, p1[13], 12, -40341101);
    v5 = ff(v5, v7, v1, v3, p1[14], 17, -1502002290);
    v3 = ff(v3, v5, v7, v1, p1[15], 22, 1236535329);
    v1 = gg(v1, v3, v5, v7, p1[1], 5, -165796510);
    v7 = gg(v7, v1, v3, v5, p1[6], 9, -1069501632);
    v5 = gg(v5, v7, v1, v3, p1[11], 14, 643717713);
    v3 = gg(v3, v5, v7, v1, p1[0], 20, -373897302);
    v1 = gg(v1, v3, v5, v7, p1[5], 5, -701558691);
    v7 = gg(v7, v1, v3, v5, p1[10], 9, 38016083);
    v5 = gg(v5, v7, v1, v3, p1[15], 14, -660478335);
    v3 = gg(v3, v5, v7, v1, p1[4], 20, -405537848);
    v1 = gg(v1, v3, v5, v7, p1[9], 5, 568446438);
    v7 = gg(v7, v1, v3, v5, p1[14], 9, -1019803690);
    v5 = gg(v5, v7, v1, v3, p1[3], 14, -187363961);
    v3 = gg(v3, v5, v7, v1, p1[8], 20, 1163531501);
    v1 = gg(v1, v3, v5, v7, p1[13], 5, -1444681467);
    v7 = gg(v7, v1, v3, v5, p1[2], 9, -51403784);
    v5 = gg(v5, v7, v1, v3, p1[7], 14, 1735328473);
    v3 = gg(v3, v5, v7, v1, p1[12], 20, -1926607734);
    v1 = hh(v1, v3, v5, v7, p1[5], 4, -378558);
    v7 = hh(v7, v1, v3, v5, p1[8], 11, -2022574463);
    v5 = hh(v5, v7, v1, v3, p1[11], 16, 1839030562);
    v3 = hh(v3, v5, v7, v1, p1[14], 23, -35309556);
    v1 = hh(v1, v3, v5, v7, p1[1], 4, -1530992060);
    v7 = hh(v7, v1, v3, v5, p1[4], 11, 1272893353);
    v5 = hh(v5, v7, v1, v3, p1[7], 16, -155497632);
    v3 = hh(v3, v5, v7, v1, p1[10], 23, -1094730640);
    v1 = hh(v1, v3, v5, v7, p1[13], 4, 681279174);
    v7 = hh(v7, v1, v3, v5, p1[0], 11, -358537222);
    v5 = hh(v5, v7, v1, v3, p1[3], 16, -722521979);
    v3 = hh(v3, v5, v7, v1, p1[6], 23, 76029189);
    v1 = hh(v1, v3, v5, v7, p1[9], 4, -640364487);
    v7 = hh(v7, v1, v3, v5, p1[12], 11, -421815835);
    v5 = hh(v5, v7, v1, v3, p1[15], 16, 530742520);
    v3 = hh(v3, v5, v7, v1, p1[2], 23, -995338651);
    v1 = ii(v1, v3, v5, v7, p1[0], 6, -198630844);
    v7 = ii(v7, v1, v3, v5, p1[7], 10, 1126891415);
    v5 = ii(v5, v7, v1, v3, p1[14], 15, -1416354905);
    v3 = ii(v3, v5, v7, v1, p1[5], 21, -57434055);
    v1 = ii(v1, v3, v5, v7, p1[12], 6, 1700485571);
    v7 = ii(v7, v1, v3, v5, p1[3], 10, -1894986606);
    v5 = ii(v5, v7, v1, v3, p1[10], 15, -1051523);
    v3 = ii(v3, v5, v7, v1, p1[1], 21, -2054922799);
    v1 = ii(v1, v3, v5, v7, p1[8], 6, 1873313359);
    v7 = ii(v7, v1, v3, v5, p1[15], 10, -30611744);
    v5 = ii(v5, v7, v1, v3, p1[6], 15, -1560198380);
    v3 = ii(v3, v5, v7, v1, p1[13], 21, 1309151649);
    v1 = ii(v1, v3, v5, v7, p1[4], 6, -145523070);
    v7 = ii(v7, v1, v3, v5, p1[11], 10, -1120210379);
    v5 = ii(v5, v7, v1, v3, p1[2], 15, 718787259);
    v3 = ii(v3, v5, v7, v1, p1[9], 21, -343485551);
    p0[0] = add32(v1, p0[0]);
    p0[1] = add32(v3, p0[1]);
    p0[2] = add32(v5, p0[2]);
    p0[3] = add32(v7, p0[3]);
  }
  function cmn(p0, p1, p2, p3, p4, p5) {
    let v0;
    v0 = add32(add32(p1, p0), add32(p3, p5));
    v0 = v0 << p4 | v0 >>> 32 - p4;
    return add32(v0, p2);
  }
  globalThis.md5 = function md5(p0) {
    let v1;
    v1 = md51(p0);
    return hex(v1);
  };
  console.log("md5 of admin is ", md5("admin"));
})();
```

</details>

### `packages/xpanda-core/test/expected/aes.js`

完整结果见 [`test/expected/aes.js`](packages/xpanda-core/test/expected/aes.js)。优化器会把 `acc` 累加链还原成复合赋值:

```js
v9 <<= 2;
v9 |= v10 >> 4;
v10 &= 15;
v10 <<= 4;
v10 |= v11 >> 2;
v7 += String.fromCharCode(v9);
if (v11 !== 64) {
  v7 += String.fromCharCode(v10);
}
```

## 环境要求

- Node.js ≥ 18
- 开发依赖:`typescript`、`tsx`(core 另用 `@babel/*` 与 `fflate` —— 纯 JS、浏览器可用的 inflate;操作码生成脚本用 `js-yaml`)

## 安装与使用

```bash
npm install
```

CLI(在仓库根目录执行):

```bash
npx tsx packages/xpanda-cli/src/cli.ts decompile <file.abc|file.hap> [-o outDir] [--no-simplify] [--stdout] [--quiet] [-j N]
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
npx tsx packages/xpanda-cli/src/cli.ts decompile app.abc -o out --quiet

# 大文件按类并行(worker_threads)
npx tsx packages/xpanda-cli/src/cli.ts decompile app.abc -o out -j 4 --quiet

# 只看反编译结果,不优化
npx tsx packages/xpanda-cli/src/cli.ts decompile app.abc -o out --no-simplify --quiet

# 输出到终端
npx tsx packages/xpanda-cli/src/cli.ts decompile app.abc --stdout --quiet
```

大文件建议加堆并开启按类并行:

```bash
NODE_OPTIONS=--max-old-space-size=4096 \
  npx tsx packages/xpanda-cli/src/cli.ts decompile app.abc -o out -j 4 --quiet
```

`-j` 只并行 simplify(单类耗时占比 >99%);解析与反汇编仍在主线程。单个超大类的 simplify 峰值约 1.4GB,worker 默认堆上限 3GB,可用 `XPANDA_WORKER_HEAP_MB` 调整。

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

核心库浏览器兼容且不做磁盘 IO:`src/index.ts` 是唯一入口(Node 与浏览器共用),导入闭包内无任何 Node 内建模块、无 worker——`-j` 并行 simplify 的 worker 池由 `xpanda-cli` 自带(`src/parallel/`),读写文件由 `xpanda-cli` 与 `xpanda-mcp` 包各自实现。

## MCP Server

xpanda 内置 [Model Context Protocol](https://modelcontextprotocol.io) Server,可把反编译能力接入 Claude Code、OpenCode、Cursor 等 AI 客户端,让 agent 按需、增量地分析 `.abc` 与 `.hap`(应用包,内含字节码与资源表):加载 → 浏览类 → 查看元数据 → 反编译单类 → 反汇编对照 → 搜索字符串 → 查询资源。

```bash
npm run mcp          # 启动(stdio transport)
npm run test:mcp     # 端到端测试
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

完整工具说明与设计细节(会话注册表、大输出保护、降级标志)见 [docs/MCP.md](docs/MCP.md)。

## Web UI

xpanda 还带一个浏览器 UI,`.abc` 文件与 `.hap` 应用包**全程在浏览器内**反编译 —— 复用核心库的浏览器安全入口,不向服务器上传任何数据。

```bash
npm run web          # vite dev server → http://localhost:5173
```

- 任意位置拖拽或选择文件(`.abc` / `.hap`,支持多选);hap 在内存中解包,每个 `.abc` 条目有独立的类列表;
- 类列表支持搜索与按包分组;点击单个类反编译,或"全部反编译"(实时进度条,可取消);
- 单类复制 / 下载,全部结果打包 `.zip`;输出模式可切换 **Optimized**(含优化器)/ **Raw AST**;
- 零依赖语法高亮,带行号。

详见 [packages/xpanda-web/README.md](packages/xpanda-web/README.md) 与 [docs/ARCHITECTURE.zh-CN.md §13](docs/ARCHITECTURE.zh-CN.md)。

## 目录结构

项目拆分为四个 npm workspaces 子包,位于 `packages/` 下:

| 子包 | 职责 |
|---|---|
| `xpanda-core` | `.abc` / `.hap` 解析、反汇编、反编译与优化器——其余子包依赖的核心库 |
| `xpanda-cli` | 命令行(`decompile` / `unpack-index`) |
| `xpanda-mcp` | MCP Server(stdio,供 AI 客户端接入) |
| `xpanda-web` | 浏览器 UI(React + Vite,纯前端) |

```text
packages/
  xpanda-core/
    src/
      codec/        Leb128 / MUTF8 / Adler32 编解码
      file/         .abc 文件格式解析(Header / 索引 / 类 / 方法 / 字面量 / 模块元数据)
      disasm/       反汇编:opcodes.ts(生成)、统一指令模型、CFG、词法分析
      decompiler/   Region 归约结构化分析、语句树、指令 handle、支配树、降级方案
      codegen/      CodeGenerator(包装 ast/ 的 NodeFactory/NodeUtils)
      ast/          Babel AST 构建与工具
      simplify/     优化器流水线(AST 清理与语法还原)
      parallel/     按类并行 simplify(worker_threads)
      hap/          HAP 应用包(ZIP)适配
      res/          resources.index 解析
      PandaDecompiler.ts  对外总入口
      index.ts      唯一入口(Node 与浏览器共用;无 Node 内建模块、无磁盘 IO、无 worker)
    resources/isa.yaml      ArkCompiler 指令集描述(v24.0.0.0,兼容 v13.0.1.0)
    scripts/gen-opcodes.ts  isa.yaml → src/disasm/opcodes.ts
    test/                   集成测试、样本与快照
  xpanda-cli/
    src/cli.ts              命令行
    src/io.ts               文件 IO:按类名落盘反编译结果
    src/parallel/           按类并行 simplify worker 池(worker_threads)
    test/                   串行 vs 并行一致性回归
  xpanda-mcp/
    src/                    MCP Server(stdio,供 AI 客户端接入)
    src/io.ts               文件 IO:读盘解析 .abc、按类名落盘
    scripts/test-mcp.ts     端到端测试
  xpanda-web/
    src/decompiler.ts       文件加载(.abc/.hap)、类索引、反编译服务(缓存 + 单类/全量)
    src/components/         Topbar / BulkBar / Sidebar / CodePane
    src/highlight.ts        零依赖 JavaScript 语法高亮器
docs/                       架构文档、MCP 文档
```

## 反编译流水线

```text
.abc 文件
  → PandaFile(解析 Header / 索引 / 类 / 方法 / 字面量,Adler32 校验)
  → PandaDisAssembler(字节码 → 指令对象)
  → PandaIRCFG(基本块 CFG + SplitJump / SplitTryCatch)
  → PandaLexical(词法环境 / 寄存器类型推断)
  → MethodHandler(指令 → Babel AST 节点)
  → StructureAnalysis(Region 归约 → if/while/try 语句树;失败降级 SimpleAnalysis)
  → NodeFactory.generate(Babel AST → JavaScript)
  → SimplifyExport(优化器流水线)
  → JavaScript 输出
```

## 优化器

`SimplifyExport` 以定点迭代方式运行,直到 AST 不再变化(最多 5 轮),主要做三件事:

- 清理 `panda_jmp0_reserved_*` 占位符、累加器临时变量和死代码;
- 还原函数/类、if/switch、循环、模块等高层语法;
- 重写调用形式,折叠复合赋值、逻辑条件和常见表达式。

优化器的 pass 顺序、条件极性规则和回归样本见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

`PandaLexical` 先解析每个方法的词法环境:闭包从定义处的层级开始,`newlexenv` / `stlexvar` / `ldlexvar` 统一换算为绝对层级,再据此还原 `local_L_i` / `sendable_L_i` 变量。

## 测试

```bash
npm test           # 反编译 md5.abc / class.abc / aes.abc,快照比较 + Babel 再解析 + 执行校验
npm run test:mcp   # MCP Server 端到端测试(子进程 + JSON-RPC)
npm run typecheck  # tsc --noEmit
```

测试快照位于:

```text
packages/xpanda-core/test/expected/md5.js
packages/xpanda-core/test/expected/class.js
packages/xpanda-core/test/expected/aes.js
```

`md5.abc` 的输出会实际执行,并校验 `md5("admin")` 与 Node `crypto` 的结果一致;`aes.abc` 的输出也会执行加解密自检。

## 已知限制

- 以下情况会降级为 `SimpleAnalysis` 线性输出(带 `decompiler_goto` 模拟):
  - 单方法超过 500 个基本块;
  - 区域级共享尾块消除后结构化展开规模仍超过 `MAX_STRUCTURED_STATEMENTS`(见 `docs/ARCHITECTURE.zh-CN.md` §7.3);
  - `jeq/jne/jstricteq/jnstricteq` 指令;
  - 指令 kind 未注册 handle。
- 降级输出会把词法环境声明提升到函数顶部,以支持跨 `label` 访问;但仍可能包含裸 `break` 作用域问题,或使用 `export ... from` 语法,需要对应的 parser 插件才能解析。
- 优化器以语义等价和可读性为目标。

## 参考实现

字节码格式、指令执行语义与 `resources.index` 布局参考 OpenHarmony 官方仓库:

- [arkcompiler_runtime_core](https://gitcode.com/openharmony/arkcompiler_runtime_core) — ISA 指令集定义(`isa/isa.yaml`)、字节码文件格式与验证器;
- [arkcompiler_ets_runtime](https://gitcode.com/openharmony/arkcompiler_ets_runtime) — 动态语言解释器实现(各指令的执行语义,如 `callthis*withname` 系列);
- [developtools_global_resource_tool](https://gitcode.com/openharmony/developtools_global_resource_tool) — `restool` 实现(`ResourceTable::LoadResTable`),用于解析 `resources.index`。

## License

见 [LICENSE](LICENSE)。
