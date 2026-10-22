# xpanda MCP Server

> 把 xpanda 反编译器通过 [Model Context Protocol](https://modelcontextprotocol.io) 暴露给 AI agent,支持按需、增量地分析鸿蒙 `.abc` 字节码文件与 `.hap` 应用包(字节码 + 资源表)。

## 快速开始

```bash
npm install                       # 安装依赖(含 @modelcontextprotocol/sdk)
npm run mcp                       # 直接启动(stdio transport)
npm run test:mcp                  # 端到端测试(子进程模拟 MCP 客户端)
```

### 客户端接入

Claude Code:

```bash
claude mcp add xpanda -- npx tsx /absolute/path/to/xpanda/src/mcp/server.ts
```

OpenCode(V2,本地 stdio server):

```bash
# 仅当前项目(写入项目 opencode.json);加 --global 全局可用
opencode mcp add xpanda -- npx tsx /absolute/path/to/xpanda/src/mcp/server.ts
opencode mcp list   # 验证:✓ xpanda connected
```

或手写 `opencode.jsonc`(V2 形状为 `mcp.servers.<name>`,`type` 必须为 `"local"`):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "xpanda": {
        "type": "local",
        "command": ["npx", "tsx", "/absolute/path/to/xpanda/src/mcp/server.ts"]
      }
    }
  }
}
```

OpenCode 默认以 Code Mode 暴露工具(`tools.xpanda.abc_load(...)`);需要原生工具列表时在 server 配置加 `"codemode": false`。

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

## 工具一览

| 工具 | 作用 | 关键参数 |
|---|---|---|
| `abc_load` | 解析 `.abc` 或 `.hap`;hap 返回包摘要与 `.abc` 条目清单 | `path` |
| `hap_read_abc` | 把 hap 内 `.abc` 条目解出为 abc 会话 | `fileId, entry?` |
| `hap_resources` | 解析 hap 内 `resources.index`(名字/类型/限定词/ID 过滤 + 分页) | `fileId, name?, type?, limitKey?, id?, offset?, limit?` |
| `abc_list_classes` | 分页列出类(名称/方法数/字段数/external),支持子串过滤 | `fileId, filter?, offset?, limit?` |
| `abc_get_class` | 类元数据:父类、字段表、方法表(shorty 原型)、import/export | `fileId, className` |
| `abc_decompile_class` | 单类反编译为 JavaScript 源码,带 `degraded` 降级标志 | `fileId, className, simplify?=true` |
| `abc_disassemble_method` | 方法级反汇编(基本块 + pc/操作数/跳转目标/try-catch) | `fileId, className, methodName?=func_main_0` |
| `abc_search_strings` | 字符串池搜索(子串或正则),返回内容与文件偏移 | `fileId, pattern, regex?=` |
| `abc_export` | 全量反编译落盘(等价 CLI decompile) | `fileId, outDir, simplify?=` |
| `abc_close` | 释放会话内存(abc 或 hap) | `fileId` |

所有工具除 `abc_load` 外都需要先 `abc_load` 拿到 `fileId`。类名接受 `Lpkg/Name;` 与 `pkg/Name` 两种形态,查找失败时会列出候选类名。

## 推荐工作流

```text
abc_load(.abc)
  → abc_list_classes(filter 定位目标类)
  → abc_get_class(确认方法表 / import-export)
  → abc_decompile_class(读源码)
      degraded=false → 直接分析
      degraded=true  → abc_disassemble_method 对照字节码
  → abc_search_strings(URL / 密钥 / 类名等线索)
  → abc_export(需要全量或输出被截断时)
  → abc_close(释放内存)
```

HAP 应用包工作流:

```text
abc_load(.hap)                     → kind="hap",包摘要 + .abc 条目清单 + 资源项数
  → hap_read_abc(entry?)           → 解出 .abc 得到 abcFileId
      → abc_list_classes / abc_decompile_class / abc_search_strings …(与 .abc 工作流相同)
  → hap_resources(name/type/limitKey/id 过滤)  → 资源项(id ↔ name ↔ value)对账
  → abc_close(释放 hap 会话与 abc 会话)
```

## 设计说明

### 会话注册表

MCP 工具调用本身无状态,但 `PandaFile` 解析大文件成本高。server 内部维护
`fileId → 会话` 注册表(上限 8 个会话,超出按最久未使用淘汰);
同一路径重复 `abc_load` 直接复用,返回 `cached: true`。

两类会话共用同一个 LRU 池:

- `AbcSession`:`.abc`(或从 hap 内解出的 `.abc`)→ `PandaFile + PandaDecompiler`,
  供全部 `abc_*` 工具使用;
- `HapSession`:`.hap` → `HapFile`(条目读取 / module.json / resources.index),
  供 `hap_read_abc` / `hap_resources` 使用;加载时只记资源项数,完整解析推迟到
  `hap_resources` 调用时。

`abc_*` 工具拿到 hap `fileId`、`hap_*` 工具拿到 abc `fileId` 都会得到带指引的错误。

`fileId` 形如 `md5-5411df7`(文件名 + Adler32 checksum 十六进制);
hap 会话为 `hap-<文件名>-<checksum>`,hap 内解出的 abc 会话为
`hap_<hap名>_<条目名>-<checksum>`(如 `hap_zhihupp0.59_ets_modules-7041b86`)。

### stdio 纯净性

stdio transport 下任何 stdout 输出都会破坏 JSON-RPC 流。server 入口**无条件**把
`console.log/warn/error` 重定向到 stderr,不依赖调用方传参;反编译流水线内部的
过程日志因此也不会泄漏到协议层。

### 大输出保护

`abc_decompile_class` 单类输出超过 50KB 时截断,并提示改用 `abc_export` 落盘;
`abc_disassemble_method` 默认最多输出 1500 条指令,可通过 `maxInstructions`(上限 5000)调整。

### 降级可观测

结构化分析失败时会降级为 `SimpleAnalysis` 线性输出,特征是源码含 `decompiler_goto`。
`abc_decompile_class` 返回头注释中带 `degraded=true/false`,agent 据此可自动切换到
`abc_disassemble_method` 阅读字节码。降级是设计行为(单方法 > 500 基本块、
jeq/jne 家族指令未实现、指令 kind 未注册 handle 三种路径)。

### 对核心的最小改动

MCP 层只新增了 `PandaFile.getAllStrings()`(与 `dumpAllString()` 同语义的结构化版本,
后者改为复用它),其余全部复用 `src/index.ts` 现有公共 API;
反汇编文本渲染直接使用 `PandaInstruction.toString()` / `PandaIRBasicBlock.toString()` 现有实现。

## 目录结构

```text
src/mcp/
  server.ts        入口:stdio transport + 无条件静默 console
  registry.ts      会话注册表(fileId → abc/hap 会话,LRU 上限 8)
  nameutil.ts      类名归一化与查找(Lpkg/Name; ↔ pkg/Name)
  tools/
    util.ts        结果包装(textResult/jsonResult/errorResult/截断)
    load.ts        abc_load / abc_close
    hap.ts         hap_read_abc / hap_resources
    browse.ts      abc_list_classes / abc_get_class
    decompile.ts   abc_decompile_class / abc_export
    disasm.ts      abc_disassemble_method
    strings.ts     abc_search_strings
scripts/test-mcp.ts 端到端测试(真实子进程 + JSON-RPC)
```
