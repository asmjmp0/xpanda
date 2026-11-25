# xpanda MCP Server

> Exposes the xpanda decompiler to AI agents via the [Model Context Protocol](https://modelcontextprotocol.io), supporting on-demand, incremental analysis of HarmonyOS `.abc` bytecode files and `.hap` app packages (bytecode + resource tables). Both dynamic Panda bytecode and ArkTS-Sta (static runtime) `.abc` files are supported.

## Quick Start

```bash
yarn install                      # install dependencies (including @modelcontextprotocol/sdk)
yarn mcp                          # start directly (stdio transport)
yarn test:mcp                     # end-to-end test (subprocess simulating an MCP client)
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
| `abc_load` | Parse `.abc` or `.hap`; auto-detects dynamic Panda vs ArkTS-Sta (static runtime) bytecode; for hap returns the package summary and the `.abc` entry list | `path` |
| `hap_read_abc` | Extract an `.abc` entry inside a hap into an abc session | `fileId, entry?` |
| `hap_resources` | Parse `resources.index` inside a hap (name/type/qualifier/ID filtering + pagination) | `fileId, name?, type?, limitKey?, id?, offset?, limit?` |
| `abc_list_classes` | List classes with pagination (name/method count/field count/external), supports substring filtering | `fileId, filter?, offset?, limit?` |
| `abc_get_class` | Class metadata: superclass, field table, method table (shorty prototypes), import/export | `fileId, className` |
| `abc_search_symbols` | Global class / method / field name search (substring or regex, class filter, pagination); no decompilation | `fileId, query, kind?, regex?, classFilter?, offset?, limit?` |
| `abc_decompile_class` | Decompile a single class to JavaScript source, with the `degraded` flag; over 50KB the output is paged line-by-line (`offset`/`limit`), or written whole to disk via `outFile` | `fileId, className, simplify?=true, outFile?, offset?, limit?` |
| `abc_decompile_method` | Extract one method / constructor / getter / setter from the class source (same paging and `outFile` options) | `fileId, className, methodName, simplify?, outFile?, offset?, limit?` |
| `abc_search_code` | Search decompiled JavaScript source (substring or regex), returning class / line / method and optional context lines | `fileId, pattern, regex?, classFilter?, simplify?, maxClasses?, contextLines?, offset?, limit?` |
| `abc_xrefs` | Cross-references to a class / method / field / string (bytecode operands; dynamic method calls can additionally be scanned from source with `source=true`) | `fileId, targetType, target, ownerClass?, source?, maxClasses?, offset?, limit?` |
| `abc_call_graph` | Callers / callees / both, N levels deep, JSON or Mermaid; static uses exact bytecode refs, dynamic uses decompiled-source calls | `fileId, className, methodName, direction?, depth?, maxNodes?, maxClasses?, format?` |
| `abc_disassemble_method` | Method-level disassembly (basic blocks + pc/operands/jump targets/try-catch) | `fileId, className, methodName?=func_main_0` |
| `abc_search_strings` | String pool search (substring or regex), returns content and file offsets | `fileId, pattern, regex?=` |
| `abc_export` | Full decompile to disk (equivalent to CLI decompile) | `fileId, outDir, simplify?=` |
| `abc_close` | Free session memory (abc or hap) | `fileId` |

All tools except `abc_load` require an `abc_load` first to get a `fileId`. Class names accept both `Lpkg/Name;` and `pkg/Name`; failed lookups list candidate class names.

## Recommended Workflow

```text
abc_load(.abc)
  → abc_search_symbols / abc_list_classes (locate target classes and methods)
  → abc_get_class (confirm method table / import-export)
  → abc_decompile_method (read one method) or abc_decompile_class (whole class)
      degraded=false → analyze directly
      degraded=true  → abc_disassemble_method to compare against bytecode
  → abc_xrefs / abc_call_graph (trace callers, callees and data/field uses)
  → abc_search_code / abc_search_strings (locate patterns, URLs, keys)
  → abc_export (when you need every class written to disk at once)
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

ArkTS-Sta (static runtime) bytecode uses the same workflow; `abc_load` reports `runtime: "static"` and the static
parser/disassembler are selected automatically. `abc_decompile_class` renders the class from a lazily built whole-file
result (the static decompiler reconstructs compiler-generated lambdas across class boundaries), so the first call is
slightly slower while later calls for other classes reuse the same cache. `abc_disassemble_method` switches to the
static ISA, and `abc_search_strings` decodes the static string pool on first use.

## Design Notes

### Session Registry

MCP tool calls are themselves stateless, but `PandaFile` parsing is expensive for large files. The server keeps an internal `fileId → session` registry (8-session cap, LRU eviction beyond that); repeated `abc_load` on the same path reuses the session directly and returns `cached: true`.

Two session kinds share one LRU pool:

- `AbcSession`: `.abc` (or an `.abc` extracted from inside a hap) → `PandaFile`/`StaticPandaFile` + the matching decompiler,
  used by all `abc_*` tools (the static parser is chosen by the header version);
- `HapSession`: `.hap` → `HapFile` (entry reading / module.json / resources.index),
  used by `hap_read_abc` / `hap_resources`; at load time only the resource item count is recorded, full parsing is deferred to the
  `hap_resources` call.

Passing a hap `fileId` to an `abc_*` tool, or an abc `fileId` to a `hap_*` tool, yields an error with guidance.

`fileId` looks like `md5-5411df7` (file name + Adler32 checksum in hex);
hap sessions are `hap-<file name>-<checksum>`, and abc sessions extracted from inside a hap are
`hap_<hap name>_<entry name>-<checksum>` (e.g. `hap_zhihupp0.59_ets_modules-7041b86`).

Static sessions additionally cache the whole-file rendered output per `simplify` flag
(`src/staticDecompile.ts`), because ArkTS-Sta lowers every closure to a separate class
(`%%lambda-lambda_invoke-N`) and the decompiler must inline those across class records before a caller class is readable.

### Symbol and Xref Indexes

`abc_search_symbols` builds a metadata-only `SymbolIndex` from the class table (no disassembly), so it is fast even for large
packages. `abc_xrefs` builds a lazy `XrefIndex` that disassembles every method once and records class / method / field / string
operands; on a 7MB sample this takes well under a second. The index is cached per session.

Static ArkTS bytecode carries resolved method/field/class ids, so its xrefs and call graph are exact. Dynamic Panda bytecode
puts the call target in the accumulator, not in the instruction operands; `abc_call_graph` therefore collects calls from the
decompiled source for dynamic sessions (`src/sourceRefs.ts`), and `abc_xrefs(..., source=true)` can merge those source call
sites. Source scanning is bounded by `maxClasses`; use `classFilter` / `abc_export` for exhaustive searches on very large files.

### stdio Purity

Under the stdio transport, any stdout output corrupts the JSON-RPC stream. The server entry **unconditionally** redirects
`console.log/warn/error` to stderr, independent of caller arguments; procedural logs inside the
decompile pipeline therefore never leak into the protocol layer.

### Large Output Protection

`abc_decompile_class` returns content inline as a whole while it stays within 50KB. Beyond that it switches to line
paging: each response carries one page (default 1000 lines, cap 5000, also capped at 50KB per response), and the header
comment reports `lines` / `offset` / `returned` / `truncated` / `next_offset` so agents keep calling with the next
`offset` until `truncated=false`. Passing `outFile` instead writes the full source to disk in one call and returns only
metadata (`outFile` / `lines` / `chars` / `degraded`) — clients with local file tools read it page by page themselves,
which is the most token-efficient path for very large classes.

Paged and `outFile` calls reuse a per-session decompile cache (LRU, 4 entries, keyed by class + `simplify`), so paging
through one class does not re-run the pipeline per page; the header's `cached` flag reports whether the result came from
the cache.

`abc_disassemble_method` outputs at most 1500 instructions by default, adjustable via `maxInstructions` (cap 5000).

### Degradation Observability

When structured analysis fails, it degrades to `SimpleAnalysis` linear output, recognizable by `decompiler_goto` in the source.
`abc_decompile_class` returns `degraded=true/false` in the header comment, so agents can automatically switch to
`abc_disassemble_method` to read the bytecode. Degradation is by design (three paths: single method > 2000 basic blocks,
unimplemented jeq/jne family instructions, unregistered instruction kind handles).

### Minimal Changes to Core

The MCP layer only added `PandaFile.getAllStrings()` (a structured version with the same semantics as `dumpAllString()`,
which was changed to reuse it), plus `StaticPandaFile.parseAssembly()` / `getAllStrings()` mirroring that API for
ArkTS-Sta string searches; everything else reuses existing public APIs from xpanda-core's `src/index.ts`;
disassembly text rendering directly uses the existing `PandaInstruction.toString()` / `PandaIRBasicBlock.toString()` implementations.

## Directory Structure

```text
packages/xpanda-mcp/src/
  server.ts        entry: stdio transport + unconditional console silencing
  registry.ts      session registry (fileId → abc/hap session, LRU cap 8)
  io.ts            disk IO: load .abc (auto dynamic/static) and write class files
  nameutil.ts      class name normalization and lookup (Lpkg/Name; ↔ pkg/Name)
  sourceCache.ts   per-class source cache (dynamic LRU, static whole-file)
  sourceRefs.ts    dynamic bytecode source-level call/reference collection
  staticDecompile.ts ArkTS-Sta whole-file render cache used by abc_decompile_class / abc_export
  tools/
    util.ts        result wrappers (textResult/jsonResult/errorResult/truncation)
    load.ts        abc_load / abc_close
    hap.ts         hap_read_abc / hap_resources
    browse.ts      abc_list_classes / abc_get_class
    search.ts      abc_search_symbols / abc_search_code
    xref.ts        abc_xrefs / abc_call_graph
    decompile.ts   abc_decompile_class / abc_decompile_method / abc_export
    disasm.ts      abc_disassemble_method
    strings.ts     abc_search_strings
packages/xpanda-mcp/scripts/test-mcp.ts end-to-end test (real subprocess + JSON-RPC)
```
