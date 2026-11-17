import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PandaDecompiler } from "@asm-xpanda/core";
import { saveClassFile } from "../io";
import { demangleClassName, findClass } from "../nameutil";
import type { AbcSession, Registry } from "../registry";
import { errorResult, jsonResult, MAX_DECOMPILE_OUTPUT, textResult } from "./util";

/**
 * abc_decompile_class / abc_export:反编译输出
 * @Author: jmp0
 */

/** 降级输出的特征串(SimpleAnalysis 用 goto 模拟跳转) */
const DEGRADED_MARKER = "decompiler_goto";

/** 未显式传 limit 且输出超长时,默认单页行数 */
const DEFAULT_PAGE_LINES = 1000;
/** 单次翻页返回的最大行数(与 zod 上限保持一致) */
const MAX_PAGE_LINES = 5000;
/** 单类反编译缓存容量(插入序 LRU;翻页同类命中,避免重跑优化器流水线) */
const MAX_DECOMPILE_CACHE = 4;

/** 反编译并写入会话缓存(命中时刷新插入序) */
function decompileCached(session: AbcSession, clazz: ReturnType<typeof findClass>, useSimplify: boolean): string {
    const key = clazz.name.content + "|" + (useSimplify ? "1" : "0");
    const cache = session.decompiles;
    const hit = cache.get(key);
    if (hit !== undefined) {
        cache.delete(key);
        cache.set(key, hit);
        return hit;
    }
    const content = useSimplify
        ? session.decompiler.decompileClass(clazz)
        : session.decompiler.decompileClassRaw(clazz);
    cache.set(key, content);
    while (cache.size > MAX_DECOMPILE_CACHE) {
        const oldest = cache.keys().next().value as string;
        cache.delete(oldest);
    }
    return content;
}

/** 按行切出一页;同一页累计不超过 MAX_DECOMPILE_OUTPUT 字符(至少保留一行) */
function slicePage(lines: string[], start: number, maxLines: number): { page: string[]; next: number } {
    const page: string[] = [];
    let size = 0;
    let i = start;
    while (i < lines.length && page.length < maxLines) {
        const line = lines[i];
        if (page.length > 0 && size + line.length + 1 > MAX_DECOMPILE_OUTPUT) break;
        page.push(line);
        size += line.length + 1;
        i++;
    }
    return { page, next: i };
}

export function registerDecompileTools(server: McpServer, registry: Registry): void {
    server.registerTool("abc_decompile_class", {
        title: "反编译单个类",
        description: "将单个类反编译为可读 JavaScript 源码。"
            + "返回带 degraded 标志:为 true 时表示结构化分析降级(输出含 decompiler_goto),建议改用 abc_disassemble_method 阅读字节码。"
            + "输出 ≤50KB 时整份返回;超过时按行分页(每页默认 1000 行),按头注释的 next_offset 传 offset 续读。"
            + "传 outFile 可把全量源码落盘(协议内只回元数据),再用本地文件工具读取。",
        inputSchema: {
            fileId: z.string().describe("abc_load 返回的文件 ID"),
            className: z.string().describe('类名,如 "Lpkg/Name;" 或 "pkg/Name"'),
            simplify: z.boolean().optional().describe("是否执行优化器流水线(默认 true;false 等价 CLI --no-simplify)"),
            outFile: z.string().optional().describe("落盘路径:全量源码写入该文件(目录自动创建),协议内只返回行数/字符数等元数据"),
            offset: z.number().int().min(0).optional().describe("分页起始行(0 起);不传且输出超长时从第 0 行开始"),
            limit: z.number().int().min(1).max(MAX_PAGE_LINES).optional().describe("单页行数,默认 1000;传了 limit/offset 即按分页返回"),
        },
    }, async ({ fileId, className, simplify, outFile, offset, limit }) => {
        try {
            const session = registry.get(fileId);
            const clazz = findClass(session.pandaFile, className);
            const useSimplify = simplify ?? true;
            const cached = session.decompiles.has(clazz.name.content + "|" + (useSimplify ? "1" : "0"));
            const content = decompileCached(session, clazz, useSimplify);

            if (content.length === 0) {
                return textResult("// 反编译结果为空(该类可能没有 func_main_0 入口或反编译失败)");
            }
            const degraded = content.includes(DEGRADED_MARKER);
            const demangled = demangleClassName(clazz.name.content);
            const lines = content.split("\n");

            // 落盘模式:全量写出,不在协议里回传源码,交给本地文件工具按行读取
            if (outFile !== undefined && outFile.length > 0) {
                const abs = path.resolve(outFile);
                fs.mkdirSync(path.dirname(abs), { recursive: true });
                fs.writeFileSync(abs, content);
                return jsonResult({
                    fileId,
                    class: demangled,
                    simplified: useSimplify,
                    degraded,
                    outFile: abs,
                    lines: lines.length,
                    chars: content.length,
                    hint: "完整源码已写入 outFile(无截断),请用本地文件读取工具查看",
                });
            }

            const headerBase = "// xpanda-mcp class=" + demangled
                + " simplified=" + useSimplify
                + " degraded=" + degraded
                + " chars=" + content.length
                + " lines=" + lines.length
                + " cached=" + cached;

            // 输出在阈值内且未显式要求分页:整份返回(与旧行为一致)
            if (content.length <= MAX_DECOMPILE_OUTPUT && offset === undefined && limit === undefined) {
                return textResult(headerBase + " offset=0 returned=" + lines.length + " truncated=false\n" + content);
            }

            // 超长(或显式分页):按行返回一页
            const start = Math.min(offset ?? 0, lines.length);
            const { page, next } = slicePage(lines, start, limit ?? DEFAULT_PAGE_LINES);
            const truncated = next < lines.length;
            const header = headerBase
                + " offset=" + start
                + " returned=" + page.length
                + " truncated=" + truncated
                + (truncated ? " next_offset=" + next : "");
            let text = header + "\n" + page.join("\n");
            if (truncated) {
                text += "\n\n// ...输出分页:共 " + lines.length + " 行,本页 " + page.length + " 行;"
                    + "用 offset=" + next + " 继续读取,或传 outFile 落盘后用本地文件工具读取全量。";
            }
            return textResult(text);
        } catch (e) {
            return errorResult(e);
        }
    });

    server.registerTool("abc_export", {
        title: "全量反编译落盘",
        description: "将 .abc 文件中所有类反编译并按类名写入输出目录(等价 CLI decompile)。"
            + "返回写入文件列表;大文件耗时较长,单个类的反编译失败不会中断整体导出。",
        inputSchema: {
            fileId: z.string().describe("abc_load 返回的文件 ID"),
            outDir: z.string().describe("输出目录(不存在会自动创建)"),
            simplify: z.boolean().optional().describe("是否执行优化器流水线(默认 true)"),
        },
    }, async ({ fileId, outDir, simplify }) => {
        try {
            const session = registry.get(fileId);
            const useSimplify = simplify ?? true;
            const absOut = path.resolve(outDir);
            fs.mkdirSync(absOut, { recursive: true });

            const files: string[] = [];
            let skipped = 0;
            let failed = 0;
            const degradedClasses: string[] = [];

            for (const clazz of session.pandaFile.getAllClasses()) {
                try {
                    const content = useSimplify
                        ? session.decompiler.decompileClass(clazz)
                        : session.decompiler.decompileClassRaw(clazz);
                    if (content.length === 0) {
                        skipped++;
                        continue;
                    }
                    if (content.includes(DEGRADED_MARKER)) degradedClasses.push(demangleClassName(clazz.name.content));
                    saveClassFile(absOut, clazz, content);
                    files.push(demangleClassName(clazz.name.content));
                } catch {
                    failed++;
                }
            }

            return jsonResult({
                fileId,
                outDir: absOut,
                written: files.length,
                skipped,
                failed,
                degradedClasses,
                files: files.slice(0, 200),
                filesTruncated: files.length > 200,
            });
        } catch (e) {
            return errorResult(e);
        }
    });
}
