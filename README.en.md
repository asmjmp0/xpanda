# xpanda

**English** | [简体中文](README.md)

> "Holy crap — when he read it, he froze and said: with a **HarmonyOS decompiler** this good, why on earth didn't you tell me sooner?"

A decompiler for HarmonyOS `.abc` files (Panda / ArkCompiler bytecode), written in **pure TypeScript**. Node.js ≥ 18, zero native dependencies.

It turns `.abc` files back into readable JavaScript: classes, methods, functions, control flow and module `import`/`export` are restored, and an optimizer pipeline cleans up the register temporaries emitted by the compiler.

Supported bytecode version: `13.0.1.0`.

## Decompilation results

Everything below comes straight from the project's test snapshots — nothing was hand-edited.

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

The full result is in [`test/expected/md5.js`](test/expected/md5.js).

<details>
<summary>Expand to view the actual decompiled output</summary>

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

## Requirements

- Node.js ≥ 18
- Development dependencies: `typescript`, `tsx`, `@babel/*`, `js-yaml`

## Install and use

```bash
npm install
```

CLI:

```bash
npx tsx src/cli.ts decompile <file.abc> [-o outDir] [--no-simplify] [--stdout] [--quiet]
```

| Option | Description |
|---|---|
| `-o outDir` | Output directory, defaults to `out` |
| `--no-simplify` | Skip the optimizer and emit raw decompiler output; faster |
| `--stdout` | Print the result to stdout instead of writing files |
| `--quiet` | Suppress progress logs |

Examples:

```bash
# Full decompilation (with optimizer)
npx tsx src/cli.ts decompile app.abc -o out --quiet

# Inspect raw output without optimization
npx tsx src/cli.ts decompile app.abc -o out --no-simplify --quiet

# Print to the terminal
npx tsx src/cli.ts decompile app.abc --stdout --quiet
```

For large files, raise the heap limit:

```bash
NODE_OPTIONS=--max-old-space-size=4096 \
  npx tsx src/cli.ts decompile app.abc -o out --quiet
```

## Programmatic API

```ts
import * as fs from "fs";
import { PandaFile, PandaDecompiler } from "./src";

const pandaFile = new PandaFile(new Uint8Array(fs.readFileSync("app.abc")));
const decompiler = new PandaDecompiler();

for (const cls of pandaFile.getAllClasses()) {
    const js = decompiler.decompileClass(cls);       // with simplify
    // const js = decompiler.decompileClassRaw(cls); // without simplify
}
```

## MCP Server

xpanda ships a built-in [Model Context Protocol](https://modelcontextprotocol.io) server, so AI clients such as Claude Code, OpenCode and Cursor can drive the decompiler — letting an agent analyze `.abc` files on demand: load → browse classes → inspect metadata → decompile a single class → cross-check disassembly → search strings.

```bash
npm run mcp          # start it (stdio transport)
npm run test:mcp     # end-to-end test
```

| Tool | Purpose |
|---|---|
| `abc_load` | Parse an `.abc` file, return a `fileId` plus header info and a class-list preview |
| `abc_list_classes` | Page through classes (name / method count / field count) with substring filtering |
| `abc_get_class` | Class metadata: superclass, fields, methods (shorty prototypes), import/export |
| `abc_decompile_class` | Decompile a single class to JavaScript, with a degradation flag |
| `abc_disassemble_method` | Method-level disassembly (basic blocks + jump targets + try-catch membership) |
| `abc_search_strings` | Search the string pool (substring or regex) to locate URLs, keys and other leads |
| `abc_export` | Decompile everything to disk (equivalent to the CLI decompile) |
| `abc_close` | Release the session's memory |

Client integration:

```bash
# Claude Code
claude mcp add xpanda -- npx tsx /absolute/path/to/xpanda/src/mcp/server.ts

# OpenCode
opencode mcp add xpanda -- npx tsx /absolute/path/to/xpanda/src/mcp/server.ts
```

Generic JSON config (Claude Desktop / Cursor, etc.):

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

See [docs/MCP.md](docs/MCP.md) for the full tool reference and design notes (session registry, output truncation, degradation flag).

## Directory layout

```text
src/
  codec/        Leb128 / MUTF8 / Adler32 codecs
  file/         .abc format parsing (header / indexes / classes / methods / literals / module metadata)
  disasm/       disassembly: generated opcodes.ts, unified instruction model, CFG, lexical analysis
  decompiler/   Region-based structural analysis, statement tree, instruction handles, dominator tree, fallback
  codegen/      CodeGenerator (wraps ast/ NodeFactory & NodeUtils)
  ast/          Babel AST construction and utilities
  simplify/     optimizer pipeline (AST cleanup and syntax recovery)
  mcp/          MCP server (stdio, for AI client integration)
  PandaDecompiler.ts  public entry point
  cli.ts        command line interface
resources/isa.yaml      ArkCompiler instruction set description (v13.0.1.0)
scripts/gen-opcodes.ts  isa.yaml → src/disasm/opcodes.ts
test/                   integration tests, sample files and snapshots
docs/                   architecture documentation, MCP documentation
```

## Decompilation pipeline

```text
.abc file
  → PandaFile (parse header / indexes / classes / methods / literals, verify Adler32)
  → PandaDisAssembler (bytecode → instruction objects)
  → PandaIRCFG (basic-block CFG + SplitJump / SplitTryCatch)
  → PandaLexical (lexical environment / register type inference)
  → MethodHandler (instructions → Babel AST nodes)
  → StructureAnalysis (Region reduction → if/while/try statement tree; falls back to SimpleAnalysis)
  → NodeFactory.generate (Babel AST → JavaScript)
  → SimplifyExport (optimizer pipeline)
  → JavaScript output
```

## Tests

```bash
npm test           # decompile md5.abc / class.abc, diff against snapshots, then re-parse with Babel
npm run test:mcp   # MCP server end-to-end test (child process + JSON-RPC)
npm run typecheck  # tsc --noEmit
```

Snapshots live in:

```text
test/expected/md5.js
test/expected/class.js
```

The output for `md5.abc` is also executed, and `md5("admin")` is checked against Node's `crypto`.

## Known limitations

- The following cases degrade to the `SimpleAnalysis` linear output (emulated with `decompiler_goto`):
  - a single method with more than 500 basic blocks;
  - the `jeq/jne/jstricteq/jnstricteq` instructions;
  - an instruction kind with no registered handle.
- Degraded output may contain `break` scoping issues, or use `export ... from` syntax that requires the matching parser plugin.
- The optimizer targets semantic equivalence and readability.

## License

See [LICENSE](LICENSE).
