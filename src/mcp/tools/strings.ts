import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Registry } from "../registry";
import { errorResult, jsonResult } from "./util";

/**
 * abc_search_strings:字符串常量搜索
 * 先 parseAssembly 填充字符串缓存(与 dumpAllString 同语义),再从缓存枚举。
 * 个别方法反汇编失败不影响已解析部分的搜索。
 * @Author: jmp0
 */

export function registerStringTools(server: McpServer, registry: Registry): void {
    server.registerTool("abc_search_strings", {
        title: "搜索字符串常量",
        description: "在 .abc 文件字符串池中搜索字符串(默认子串、不区分大小写;可选正则)。"
            + "适合定位 URL、密钥、反射类名等关键线索。返回字符串内容及其在文件中的偏移。",
        inputSchema: {
            fileId: z.string().describe("abc_load 返回的文件 ID"),
            pattern: z.string().describe("匹配模式(默认为子串;regex=true 时按正则解析)"),
            regex: z.boolean().optional().describe("将 pattern 按正则表达式解析,默认 false"),
            offset: z.number().int().min(0).optional().describe("起始索引,默认 0"),
            limit: z.number().int().min(1).max(500).optional().describe("每页数量,默认 100"),
        },
    }, async ({ fileId, pattern, regex, offset, limit }) => {
        try {
            const session = registry.get(fileId);
            const pandaFile = session.pandaFile;

            try {
                pandaFile.parseAssembly();
            } catch {
                // 部分方法反汇编失败(如含未实现指令),已解析部分仍可搜索
            }
            const all = pandaFile.getAllStrings().map((s) => ({
                offset: "0x" + s.getOffset().toString(16),
                content: s.content,
            }));

            let matcher: (s: string) => boolean;
            if (regex) {
                let re: RegExp;
                try {
                    re = new RegExp(pattern);
                } catch (e) {
                    throw new Error("正则表达式无效: " + pattern);
                }
                matcher = (s) => re.test(s);
            } else {
                const needle = pattern.toLowerCase();
                matcher = (s) => s.toLowerCase().includes(needle);
            }

            const matches = all.filter((e) => matcher(e.content));
            const start = offset ?? 0;
            const size = limit ?? 100;
            const page = matches.slice(start, start + size);
            return jsonResult({
                fileId,
                poolSize: all.length,
                matched: matches.length,
                offset: start,
                returned: page.length,
                truncated: start + page.length < matches.length,
                strings: page,
            });
        } catch (e) {
            return errorResult(e);
        }
    });
}
