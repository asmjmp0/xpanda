import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { demangleClassName } from "../nameutil";
import type { Registry } from "../registry";
import { errorResult, jsonResult } from "./util";
import { PandaDisAssembler } from "xpanda-core";



interface XrefHit {
    kind: string;
    targetOffset: string;
    targetText: string;
    className: string;
    methodName: string;
    instructionOffset: string;
    opcode: string;
}

function matchesQuery(text: string, query: string): boolean {
    if (!query) return true;
    return text.toLowerCase().includes(query.toLowerCase());
}

function scanMethodForXrefs(
    session: any, query: string, limit: number
): XrefHit[] {
    const hits: XrefHit[] = [];
    const decompiler = session.decompiler;
    if (!decompiler) return hits;
    const classes = session.pandaFile.getAllClasses();
    const lowerQuery = query.toLowerCase();

    for (const cls of classes) {
        if (hits.length >= limit) break;
        const className = demangleClassName(cls.name.content);
        if (!className) continue;
        try {
            const source = decompiler.decompileClass(cls);
            if (!source) continue;
            const lines = source.split("\n");
            for (let i = 0; i < lines.length && hits.length < limit; i++) {
                const line = lines[i];
                if (line.toLowerCase().includes(lowerQuery)) {
                    hits.push({
                        kind: "source_line",
                        targetOffset: `line:${i + 1}`,
                        targetText: line.trim().slice(0, 200),
                        className,
                        methodName: "",
                        instructionOffset: `line:${i + 1}`,
                        opcode: "decompiled",
                    });
                }
            }
        } catch { /* skip classes that fail */ }
    }
    return hits;
}

export function registerXrefTools(server: McpServer, registry: Registry): void {
    server.registerTool("abc_find_xrefs", {
        title: "查找交叉引用",
        description: "反编译所有类并查找包含指定文本的代码行。返回类名/行号/代码内容。适用于定位'这个密钥/函数在哪里被使用'。",
        inputSchema: {
            fileId: z.string().describe("abc_load 返回的文件 ID"),
            query: z.string().describe("要查找的文本（子串匹配）"),
            limit: z.number().optional().describe("最多返回条数（默认 80）"),
        },
    }, async ({ fileId, query, limit }) => {
        try {
            const session = registry.get(fileId);
            const maxResults = limit ?? 80;
            const hits = scanMethodForXrefs(session, query, maxResults);
            return jsonResult({
                query, total: hits.length,
                truncated: hits.length >= maxResults,
                xrefs: hits,
            });
        } catch (e) { return errorResult(e); }
    });

server.registerTool("abc_find_call_flows", {
        title: "追踪调用参数流",
        description: "查找指定文本出现在哪些方法中，并列出该方法内的所有调用指令。启发式数据流分析。",
        inputSchema: {
            fileId: z.string().describe("abc_load 返回的文件 ID"),
            query: z.string().describe("要追踪的文本"),
            limit: z.number().optional().describe("最多返回条数（默认 80）"),
        },
    }, async ({ fileId, query, limit }) => {
        try {
            const session = registry.get(fileId);
            const maxResults = limit ?? 80;
            const results: any[] = [];
            const classes = session.pandaFile.getAllClasses();

            for (const cls of classes) {
                if (results.length >= maxResults) break;
                for (const method of cls.pandaMethods.values()) {
                    if (results.length >= maxResults) break;
                    if (!method.methodCode?.instructions) continue;
                    const className = demangleClassName(cls.name.content);
                    const methodName = method.name?.content ?? "";
                    try {
                        const cfg = PandaDisAssembler.disAssembly(method);
                        let hasMatch = false;
                        const calls: any[] = [];
                        for (const block of cfg.basicBlocks) {
                            for (const insn of block.instructions) {
                                const s = insn.toString();
                                if (matchesQuery(s, query)) hasMatch = true;
                                const op = insn.opcodeInfo?.name ?? "";
                                if (op.includes("call") || op.includes("Call") || op.startsWith("ld")) {
                                    calls.push({ offset: `0x${insn.pc.toString(16)}`, opcode: op, text: s.slice(0, 120) });
                                }
                            }
                        }
                        if (hasMatch) {
                            results.push({ class: className, method: methodName, matched: true, calls: calls.slice(0, 10) });
                        }
                    } catch { /* skip */ }
                }
            }
            return jsonResult({ query, total: results.length, flows: results });
        } catch (e) { return errorResult(e); }
    });

    server.registerTool("abc_read_literal", {
        title: "列出字面量",
        description: "列出 ABC 文件中的所有字符串常量和字面量数组。",
        inputSchema: {
            fileId: z.string().describe("abc_load 返回的文件 ID"),
            pattern: z.string().optional().describe("过滤模式（子串匹配）"),
            limit: z.number().optional().describe("最多返回条数（默认 20）"),
        },
    }, async ({ fileId, pattern, limit }) => {
        try {
            const session = registry.get(fileId);
            const maxResults = limit ?? 20;
            // Use string search as fallback for literal reading
            const strs = session.pandaFile.getAllStrings();
            const items: any[] = [];
            const lowerPat = (pattern ?? "").toLowerCase();
            for (const str of strs) {
                if (items.length >= maxResults) break;
                const content = str.content ?? "";
                if (!lowerPat || content.toLowerCase().includes(lowerPat)) {
                    items.push({ type: "string", value: content.slice(0, 200), offset: str.offset });
                }
            }
            return jsonResult({ total: items.length, items });
        } catch (e) { return errorResult(e); }
    });
}
