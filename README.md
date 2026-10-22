# xpanda

**简体中文** | [English](README.en.md)

> 卧槽，然后他看了以后啊，就怔住了说，说这么好的**鸿蒙反编译器**，你咋不，你怎么不早点告诉我。

鸿蒙 HarmonyOS `.abc`(Panda / ArkCompiler 字节码)反编译器,**纯 TypeScript** 实现,Node.js ≥ 18,零原生依赖。

把 `.abc` 文件反编译成可读的 JavaScript 源码:还原类、方法、函数、控制流、模块 import/export,并通过优化器清理编译器生成的寄存器临时变量。

支持字节码版本:`13.0.1.0`。

## 反编译结果

以下内容直接来自项目测试快照,没有手工改写。

### `test/expected/class.js`

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

### `test/expected/md5.js`

完整结果见 [`test/expected/md5.js`](test/expected/md5.js)。

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
    for (v4 = ""; v3 < 4; v3 = v3 + 1) {
      v4 = v4 + ("0123456789abcdef"[p0 >> v3 * 8 + 4 & 15] + "0123456789abcdef"[p0 >> v3 * 8 & 15]);
    }
    return v4;
  }
  function gg(p0, p1, p2, p3, p4, p5, p6) {
    return cmn(p1 & p3 | p2 & ~p3, p0, p1, p4, p5, p6);
  }
  function md5blk(p0) {
    let v8, v9, v11;
    v8 = 0;
    for (v9 = []; v8 < 64; v8 = v8 + 4) {
      v11 = p0.charCodeAt(v8);
      v11 = v11 + (p0.charCodeAt(v8 + 1) << 8);
      v11 = v11 + (p0.charCodeAt(v8 + 2) << 16);
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
    for (v3 = 64; v3 <= p0.length; v3 = v3 + 64) {
      md5cycle(v2, md5blk(p0.substring(v3 - 64, v3)));
    }
    v0 = p0.substring(v3 - 64);
    v3 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (v8 = 0; v8 < v0.length; v8 = v8 + 1) {
      v3[v8 >> 2] = v3[v8 >> 2] | v0.charCodeAt(v8) << (v8 % 4 << 3);
    }
    v3[v8 >> 2] = v3[v8 >> 2] | 128 << (v8 % 4 << 3);
    if (v8 > 55) {
      md5cycle(v2, v3);
      for (v4 = 0; v4 < 16; v4 = v4 + 1) {
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
    for (v0 = 0; v0 < p0.length; v0 = v0 + 1) {
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

## 环境要求

- Node.js ≥ 18
- 开发依赖:`typescript`、`tsx`、`@babel/*`、`js-yaml`

## 安装与使用

```bash
npm install
```

CLI:

```bash
npx tsx src/cli.ts decompile <file.abc> [-o outDir] [--no-simplify] [--stdout] [--quiet]
```

| 参数 | 说明 |
|---|---|
| `-o outDir` | 输出目录,默认 `out` |
| `--no-simplify` | 跳过优化器,输出原始反编译结果,速度更快 |
| `--stdout` | 把结果输出到标准输出,不落盘 |
| `--quiet` | 关闭过程日志 |

示例:

```bash
# 完整反编译(含优化器)
npx tsx src/cli.ts decompile app.abc -o out --quiet

# 只看反编译结果,不优化
npx tsx src/cli.ts decompile app.abc -o out --no-simplify --quiet

# 输出到终端
npx tsx src/cli.ts decompile app.abc --stdout --quiet
```

大文件建议加堆:

```bash
NODE_OPTIONS=--max-old-space-size=4096 \
  npx tsx src/cli.ts decompile app.abc -o out --quiet
```

## 编程 API

```ts
import * as fs from "fs";
import { PandaFile, PandaDecompiler } from "./src";

const pandaFile = new PandaFile(new Uint8Array(fs.readFileSync("app.abc")));
const decompiler = new PandaDecompiler();

for (const cls of pandaFile.getAllClasses()) {
    const js = decompiler.decompileClass(cls);       // 含 simplify
    // const js = decompiler.decompileClassRaw(cls); // 不含 simplify
}
```

## MCP Server

xpanda 内置 [Model Context Protocol](https://modelcontextprotocol.io) Server,可把反编译能力接入 Claude Code、OpenCode、Cursor 等 AI 客户端,让 agent 按需、增量地分析 `.abc` 文件:加载 → 浏览类 → 查看元数据 → 反编译单类 → 反汇编对照 → 搜索字符串。

```bash
npm run mcp          # 启动(stdio transport)
npm run test:mcp     # 端到端测试
```

| 工具 | 作用 |
|---|---|
| `abc_load` | 解析 `.abc` 文件,返回 `fileId` 与文件头信息、类列表预览 |
| `abc_list_classes` | 分页列出类(名称/方法数/字段数),支持子串过滤 |
| `abc_get_class` | 类元数据:父类、字段表、方法表(shorty 原型)、import/export |
| `abc_decompile_class` | 单类反编译为 JavaScript 源码,带降级标志 |
| `abc_disassemble_method` | 方法级反汇编(基本块 + 跳转目标 + try-catch 归属) |
| `abc_search_strings` | 字符串池搜索(子串或正则),定位 URL/密钥等线索 |
| `abc_export` | 全量反编译落盘(等价 CLI decompile) |
| `abc_close` | 释放会话内存 |

客户端接入:

```bash
# Claude Code
claude mcp add xpanda -- npx tsx /absolute/path/to/xpanda/src/mcp/server.ts

# OpenCode
opencode mcp add xpanda -- npx tsx /absolute/path/to/xpanda/src/mcp/server.ts
```

通用 JSON 配置(Claude Desktop / Cursor 等):

```json
{
  "mcpServers": {
    "xpanda": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/xpanda/src/mcp/server.ts"]
    }
  }
}
```

完整工具说明与设计细节(会话注册表、大输出保护、降级标志)见 [docs/MCP.md](docs/MCP.md)。

## 目录结构

```text
src/
  codec/        Leb128 / MUTF8 / Adler32 编解码
  file/         .abc 文件格式解析(Header / 索引 / 类 / 方法 / 字面量 / 模块元数据)
  disasm/       反汇编:opcodes.ts(生成)、统一指令模型、CFG、词法分析
  decompiler/   Region 归约结构化分析、语句树、指令 handle、支配树、降级方案
  codegen/      CodeGenerator(包装 ast/ 的 NodeFactory/NodeUtils)
  ast/          Babel AST 构建与工具
  simplify/     优化器流水线(AST 清理与语法还原)
  mcp/          MCP Server(stdio,供 AI 客户端接入)
  PandaDecompiler.ts  对外总入口
  cli.ts        命令行
resources/isa.yaml      ArkCompiler 指令集描述(v13.0.1.0)
scripts/gen-opcodes.ts  isa.yaml → src/disasm/opcodes.ts
test/                   集成测试、样本与快照
docs/                   架构文档、MCP 文档
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

## 测试

```bash
npm test           # 反编译 md5.abc / class.abc,与快照逐字比较并做 Babel 再解析
npm run test:mcp   # MCP Server 端到端测试(子进程 + JSON-RPC)
npm run typecheck  # tsc --noEmit
```

测试快照位于:

```text
test/expected/md5.js
test/expected/class.js
```

`md5.abc` 的输出还会实际执行,并校验 `md5("admin")` 与 Node `crypto` 的结果一致。

## 已知限制

- 以下情况会降级为 `SimpleAnalysis` 线性输出(带 `decompiler_goto` 模拟):
  - 单方法超过 500 个基本块;
  - `jeq/jne/jstricteq/jnstricteq` 指令;
  - 指令 kind 未注册 handle。
- 降级输出可能包含 `break` 作用域问题,或使用 `export ... from` 语法,需要对应的 parser 插件才能解析。
- 优化器以语义等价和可读性为目标。

## License

见 [LICENSE](LICENSE)。
