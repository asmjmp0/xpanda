# xpanda MCP Server

> Exposes the xpanda decompiler to AI agents via the [Model Context Protocol](https://modelcontextprotocol.io), supporting on-demand, incremental analysis of HarmonyOS `.abc` bytecode files and `.hap` app packages (bytecode + resource tables).

## Quick Start

```bash
npm install                       # install dependencies (including @modelcontextprotocol/sdk)
npm run mcp                       # start directly (stdio transport)
npm run test:mcp                  # end-to-end test (subprocess simulating an MCP client)
```

### Client Integration

Claude Code:

```bash
claude mcp add xpanda -- npx tsx /absolute/path/to/xpanda/packages/xpanda-mcp/src/server.ts
```

OpenCode (V2, local stdio server):

```bash
# current project only (writes to the project opencode.json); add --global to make it available globally
opencode mcp add xpanda -- npx tsx /absolute/path/to/xpanda/packages/xpanda-mcp/src/server.ts
opencode mcp list   # verify: ✓ xpanda connected
```

Or hand-write `opencode.jsonc` (V2 shape is `mcp.servers.<name>`, `type` must be `"local"`):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "xpanda": {
        "type": "local",
        "command": ["npx", "tsx", "/absolute/path/to/xpanda/packages/xpanda-mcp/src/server.ts"]
      }
    }
  }
}
```

OpenCode exposes the tools through Code Mode by default (`tools.xpanda.abc_load(...)`); add `"codemode": false` to the server config if you need a native tool list.

Generic JSON config (Claude Desktop / Cursor etc.):

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

## Tool Overview

| Tool | Purpose | Key Parameters |
|---|---|---|
| `abc_load` | Parse `.abc` or `.hap`; for hap returns the package summary and the `.abc` entry list | `path` |
| `hap_read_abc` | Extract an `.abc` entry inside a hap into an abc session | `fileId, entry?` |
| `hap_resources` | Parse `resources.index` inside a hap (name/type/qualifier/ID filtering + pagination) | `fileId, name?, type?, limitKey?, id?, offset?, limit?` |
| `abc_list_classes` | List classes with pagination (name/method count/field count/external), supports substring filtering | `fileId, filter?, offset?, limit?` |
| `abc_get_class` | Class metadata: superclass, field table, method table (shorty prototypes), import/export | `fileId, className` |
| `abc_decompile_class` | Decompile a single class to JavaScript source, with the `degraded` flag | `fileId, className, simplify?=true` |
| `abc_disassemble_method` | Method-level disassembly (basic blocks + pc/operands/jump targets/try-catch) | `fileId, className, methodName?=func_main_0` |
| `abc_search_strings` | String pool search (substring or regex), returns content and file offsets | `fileId, pattern, regex?=` |
| `abc_export` | Full decompile to disk (equivalent to CLI decompile) | `fileId, outDir, simplify?=` |
| `abc_close` | Free session memory (abc or hap) | `fileId` |

All tools except `abc_load` require an `abc_load` first to get a `fileId`. Class names accept both `Lpkg/Name;` and `pkg/Name`; failed lookups list candidate class names.

## Recommended Workflow

```text
abc_load(.abc)
  → abc_list_classes(filter to locate target classes)
  → abc_get_class (confirm method table / import-export)
  → abc_decompile_class (read source)
      degraded=false → analyze directly
      degraded=true  → abc_disassemble_method to compare against bytecode
  → abc_search_strings (URL / keys / class names and other clues)
  → abc_export (when you need the full output or the output was truncated)
  → abc_close (free memory)
```

HAP app package workflow:

```text
abc_load(.hap)                     → kind="hap", package summary + .abc entry list + resource count
  → hap_read_abc(entry?)           → extract the .abc to get an abcFileId
      → abc_list_classes / abc_decompile_class / abc_search_strings … (same as the .abc workflow)
  → hap_resources(name/type/limitKey/id filters)  → reconcile resource items (id ↔ name ↔ value)
  → abc_close (free the hap session and the abc session)
```

## Design Notes

### Session Registry

MCP tool calls are themselves stateless, but `PandaFile` parsing is expensive for large files. The server keeps an internal `fileId → session` registry (8-session cap, LRU eviction beyond that); repeated `abc_load` on the same path reuses the session directly and returns `cached: true`.

Two session kinds share one LRU pool:

- `AbcSession`: `.abc` (or an `.abc` extracted from inside a hap) → `PandaFile + PandaDecompiler`,
  used by all `abc_*` tools;
- `HapSession`: `.hap` → `HapFile` (entry reading / module.json / resources.index),
  used by `hap_read_abc` / `hap_resources`; at load time only the resource item count is recorded, full parsing is deferred to the
  `hap_resources` call.

Passing a hap `fileId` to an `abc_*` tool, or an abc `fileId` to a `hap_*` tool, yields an error with guidance.

`fileId` looks like `md5-5411df7` (file name + Adler32 checksum in hex);
hap sessions are `hap-<file name>-<checksum>`, and abc sessions extracted from inside a hap are
`hap_<hap name>_<entry name>-<checksum>` (e.g. `hap_zhihupp0.59_ets_modules-7041b86`).

### stdio Purity

Under the stdio transport, any stdout output corrupts the JSON-RPC stream. The server entry **unconditionally** redirects
`console.log/warn/error` to stderr, independent of caller arguments; procedural logs inside the
decompile pipeline therefore never leak into the protocol layer.

### Large Output Protection

`abc_decompile_class` truncates output over 50KB per class and suggests `abc_export` to write to disk instead;
`abc_disassemble_method` outputs at most 1500 instructions by default, adjustable via `maxInstructions` (cap 5000).

### Degradation Observability

When structured analysis fails, it degrades to `SimpleAnalysis` linear output, recognizable by `decompiler_goto` in the source.
`abc_decompile_class` returns `degraded=true/false` in the header comment, so agents can automatically switch to
`abc_disassemble_method` to read the bytecode. Degradation is by design (three paths: single method > 2000 basic blocks,
unimplemented jeq/jne family instructions, unregistered instruction kind handles).

### Minimal Changes to Core

The MCP layer only added `PandaFile.getAllStrings()` (a structured version with the same semantics as `dumpAllString()`,
which was changed to reuse it); everything else reuses existing public APIs from xpanda-core's `src/index.ts`;
disassembly text rendering directly uses the existing `PandaInstruction.toString()` / `PandaIRBasicBlock.toString()` implementations.

## Directory Structure

```text
packages/xpanda-mcp/src/
  server.ts        entry: stdio transport + unconditional console silencing
  registry.ts      session registry (fileId → abc/hap session, LRU cap 8)
  nameutil.ts      class name normalization and lookup (Lpkg/Name; ↔ pkg/Name)
  tools/
    util.ts        result wrappers (textResult/jsonResult/errorResult/truncation)
    load.ts        abc_load / abc_close
    hap.ts         hap_read_abc / hap_resources
    browse.ts      abc_list_classes / abc_get_class
    decompile.ts   abc_decompile_class / abc_export
    disasm.ts      abc_disassemble_method
    strings.ts     abc_search_strings
packages/xpanda-mcp/scripts/test-mcp.ts end-to-end test (real subprocess + JSON-RPC)
```
