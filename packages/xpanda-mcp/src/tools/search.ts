import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listMethodsFromSource, SymbolIndex, type MethodRange, type PandaClass } from "@asm-xpanda/core";
import { demangleClassName } from "../nameutil";
import type { AbcSession, Registry } from "../registry";
import { getClassSource, MAX_SEARCH_CACHE } from "../sourceCache";
import { errorResult, jsonResult } from "./util";

/**
 * abc_search_symbols / abc_search_code:全局检索
 * @Author: jmp0
 */

/** 源码搜索最多累计的匹配数(超过后标记 truncated,避免单次响应爆炸) */
const MAX_SEARCH_MATCHES = 5000;

interface SearchMatch {
    className: string;
    line: number;
    text: string;
    method?: string;
    methodKind?: string;
    context?: Array<{ line: number; text: string }>;
}

function buildMatcher(pattern: string, regex: boolean, caseSensitive: boolean): (text: string) => boolean {
    if (regex) {
        const re = new RegExp(pattern, caseSensitive ? "" : "i");
        return (text) => {
            re.lastIndex = 0;
            return re.test(text);
        };
    }
    if (caseSensitive) return (text) => text.includes(pattern);
    const needle = pattern.toLowerCase();
    return (text) => text.toLowerCase().includes(needle);
}

function hasCode(clazz: PandaClass): boolean {
    for (const method of clazz.pandaMethods.values()) {
        if (method.methodCode) return true;
    }
    return false;
}

function methodAtLine(ranges: MethodRange[], line: number): MethodRange | null {
    for (const range of ranges) {
        if (line >= range.startLine && line <= range.endLine) return range;
    }
    return null;
}

export function registerSearchTools(server: McpServer, registry: Registry): void {
    server.registerTool("abc_search_symbols", {
        title: "搜索类 / 方法 / 字段",
        description: "在类元数据中全局搜索类名、方法名、字段名(默认不区分大小写,可正则)。"
            + "不触发反编译,速度快;适合先定位目标类/方法,再用 abc_decompile_class / abc_decompile_method 深入。"
            + "className 过滤可缩小到某个包或类。",
        inputSchema: {
            fileId: z.string().describe("abc_load 返回的文件 ID"),
            query: z.string().describe("搜索文本(空字符串表示列出全部,可配合 kind/classFilter)"),
            kind: z.enum(["all", "class", "method", "field"]).optional().describe("符号类型,默认 all"),
            regex: z.boolean().optional().describe("按正则表达式解析 query,默认 false"),
            caseSensitive: z.boolean().optional().describe("区分大小写,默认 false"),
            classFilter: z.string().optional().describe("类名子串过滤(mangled 或 demangled 均可)"),
            includeExternal: z.boolean().optional().describe("是否包含 external 符号,默认 true"),
            offset: z.number().int().min(0).optional().describe("起始索引,默认 0"),
            limit: z.number().int().min(1).max(500).optional().describe("每页数量,默认 50"),
        },
    }, async ({ fileId, query, kind, regex, caseSensitive, classFilter, includeExternal, offset, limit }) => {
        try {
            const session = registry.get(fileId);
            if (!session.symbolIndex) session.symbolIndex = SymbolIndex.build(session.pandaFile);
            const result = session.symbolIndex.search({
                query,
                kind: kind ?? "all",
                regex,
                caseSensitive,
                classFilter,
                includeExternal,
                offset,
                limit,
            });
            return jsonResult({
                fileId,
                total: result.total,
                offset: result.offset,
                limit: result.limit,
                returned: result.matches.length,
                truncated: result.offset + result.matches.length < result.total,
                matches: result.matches,
            });
        } catch (e) {
            return errorResult(e);
        }
    });

    server.registerTool("abc_search_code", {
        title: "搜索反编译源码",
        description: "在反编译后的 JavaScript 源码中搜索文本/正则,返回类名、行号、命中行与所在方法。"
            + "会按需反编译命中的类,比 abc_search_strings / abc_search_symbols 慢;大文件建议配合 classFilter 或调大 maxClasses。"
            + "exhaustive 需求可先用 abc_export 落盘再本地搜索。",
        inputSchema: {
            fileId: z.string().describe("abc_load 返回的文件 ID"),
            pattern: z.string().describe("搜索文本(默认子串;regex=true 时按正则)"),
            regex: z.boolean().optional().describe("按正则表达式解析,默认 false"),
            caseSensitive: z.boolean().optional().describe("区分大小写,默认 false"),
            classFilter: z.string().optional().describe("只扫描类名包含该子串的类(mangled 或 demangled)"),
            simplify: z.boolean().optional().describe("搜索优化后的源码,默认 true;false 更快但输出更接近原始结构"),
            maxClasses: z.number().int().min(1).max(1000).optional().describe("最多反编译多少个类,默认 100"),
            contextLines: z.number().int().min(0).max(3).optional().describe("命中行上下文行数,默认 0"),
            offset: z.number().int().min(0).optional().describe("匹配起始索引,默认 0"),
            limit: z.number().int().min(1).max(500).optional().describe("每页匹配数,默认 50"),
        },
    }, async ({ fileId, pattern, regex, caseSensitive, classFilter, simplify, maxClasses, contextLines, offset, limit }) => {
        try {
            const session = registry.get(fileId);
            const useSimplify = simplify ?? true;
            const matcher = buildMatcher(pattern, regex === true, caseSensitive === true);
            const needle = classFilter?.trim().toLowerCase();
            const classes = session.pandaFile.getAllClasses().filter((clazz) => {
                if (!hasCode(clazz)) return false;
                if (!needle) return true;
                const raw = clazz.name.content.toLowerCase();
                return raw.includes(needle) || demangleClassName(clazz.name.content).toLowerCase().includes(needle);
            });
            const classLimit = maxClasses ?? 100;
            const selected = classes.slice(0, classLimit);
            const truncatedClasses = selected.length < classes.length;

            const matches: SearchMatch[] = [];
            let scannedClasses = 0;
            let skippedClasses = 0;
            const failedClasses: string[] = [];
            let hitMatchLimit = false;

            for (const clazz of selected) {
                scannedClasses++;
                let source: string;
                try {
                    source = getClassSource(session, clazz, useSimplify, session.searchSources, MAX_SEARCH_CACHE);
                } catch (e) {
                    failedClasses.push(demangleClassName(clazz.name.content));
                    continue;
                }
                if (!source) {
                    skippedClasses++;
                    continue;
                }
                const lines = source.split("\n");
                const classMatches: Array<{ line: number; text: string }> = [];
                for (let i = 0; i < lines.length; i++) {
                    if (matcher(lines[i])) classMatches.push({ line: i + 1, text: lines[i] });
                }
                if (classMatches.length === 0) continue;

                let ranges: MethodRange[] = [];
                if (classMatches.length > 0) {
                    try {
                        ranges = listMethodsFromSource(source);
                    } catch {
                        ranges = [];
                    }
                }
                const className = demangleClassName(clazz.name.content);
                for (const match of classMatches) {
                    if (matches.length >= MAX_SEARCH_MATCHES) {
                        hitMatchLimit = true;
                        break;
                    }
                    const range = methodAtLine(ranges, match.line);
                    const result: SearchMatch = {
                        className,
                        line: match.line,
                        text: match.text,
                        method: range?.name,
                        methodKind: range?.kind,
                    };
                    if ((contextLines ?? 0) > 0) {
                        const before = Math.max(0, match.line - 1 - (contextLines ?? 0));
                        const after = Math.min(lines.length, match.line + (contextLines ?? 0));
                        result.context = [];
                        for (let i = before; i < after; i++) {
                            result.context.push({ line: i + 1, text: lines[i] });
                        }
                    }
                    matches.push(result);
                }
                if (hitMatchLimit) break;
            }

            const pageOffset = Math.max(0, offset ?? 0);
            const pageLimit = Math.max(1, limit ?? 50);
            const page = matches.slice(pageOffset, pageOffset + pageLimit);
            const truncated = hitMatchLimit || pageOffset + page.length < matches.length || truncatedClasses;
            return jsonResult({
                fileId,
                pattern,
                simplified: useSimplify,
                scannedClasses,
                skippedClasses,
                failedClasses: failedClasses.slice(0, 20),
                failedClassCount: failedClasses.length,
                candidateClasses: classes.length,
                truncatedClasses,
                total: matches.length,
                offset: pageOffset,
                limit: pageLimit,
                returned: page.length,
                truncated,
                matches: page,
                hint: truncated
                    ? "结果被截断:可用 classFilter/maxClasses 缩小范围,或 abc_export 落盘后本地搜索。"
                    : "可用 abc_decompile_class 的 offset/limit 查看命中行附近上下文。",
            });
        } catch (e) {
            return errorResult(e);
        }
    });
}
