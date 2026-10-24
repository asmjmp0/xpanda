/**
 * xpanda MCP Server 入口(stdio transport)
 *
 * 启动方式:
 *   npx tsx src/mcp/server.ts
 *
 * 客户端接入(Claude Code / Cursor 等):
 *   {
 *     "mcpServers": {
 *       "xpanda": {
 *         "command": "npx",
 *         "args": ["tsx", "/absolute/path/to/xpanda/src/mcp/server.ts"]
 *       }
 *     }
 *   }
 *
 * @Author: jmp0
 */

// ---------------------------------------------------------------------------
// stdio 静默:stdio transport 下任何 stdout 输出都会破坏 JSON-RPC 流。
// 反编译流水线内部可能调用 console.log(如 NodeUtils 的比较告警),
// 这里无条件把全部 console 输出重定向到 stderr,不依赖调用方传参。
// ---------------------------------------------------------------------------
const writeToStderr = (...args: unknown[]): void => {
    process.stderr.write(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ") + "\n");
};
console.log = writeToStderr;
console.warn = writeToStderr;
console.error = writeToStderr;

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Registry } from "./registry";
import { registerLoadTools } from "./tools/load";
import { registerBrowseTools } from "./tools/browse";
import { registerDecompileTools } from "./tools/decompile";
import { registerDisasmTools } from "./tools/disasm";
import { registerStringTools } from "./tools/strings";
import { registerHapTools } from "./tools/hap";

async function main(): Promise<void> {
    const server = new McpServer({ name: "xpanda", version: "1.0.0" });
    const registry = new Registry();

    registerLoadTools(server, registry);
    registerBrowseTools(server, registry);
    registerDecompileTools(server, registry);
    registerDisasmTools(server, registry);
    registerStringTools(server, registry);
    registerHapTools(server, registry);

    await server.connect(new StdioServerTransport());
    writeToStderr("xpanda-mcp: stdio server started");
}

main().catch((e) => {
    writeToStderr("xpanda-mcp: fatal: " + (e instanceof Error ? (e.stack ?? e.message) : String(e)));
    process.exit(1);
});
