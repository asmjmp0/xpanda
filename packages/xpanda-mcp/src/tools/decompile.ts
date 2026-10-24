import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PandaDecompiler } from "xpanda-core";
import { saveClassFile } from "../io";
import { demangleClassName, findClass } from "../nameutil";
import type { Registry } from "../registry";
import { errorResult, jsonResult, MAX_DECOMPILE_OUTPUT, textResult, truncateText } from "./util";

/**
 * abc_decompile_class / abc_export:反编译输出
 * @Author: jmp0
 */

/** 降级输出的特征串(SimpleAnalysis 用 goto 模拟跳转) */
const DEGRADED_MARKER = "decompiler_goto";

export function registerDecompileTools(server: McpServer, registry: Registry): void {
    server.registerTool("abc_decompile_class", {
        title: "反编译单个类",
        description: "将单个类反编译为可读 JavaScript 源码。"
            + "返回带 degraded 标志:为 true 时表示结构化分析降级(输出含 decompiler_goto),建议改用 abc_disassemble_method 阅读字节码。"
            + "超过 50KB 的输出会被截断并提示落盘。",
        inputSchema: {
            fileId: z.string().describe("abc_load 返回的文件 ID"),
            className: z.string().describe('类名,如 "Lpkg/Name;" 或 "pkg/Name"'),
            simplify: z.boolean().optional().describe("是否执行优化器流水线(默认 true;false 等价 CLI --no-simplify)"),
        },
    }, async ({ fileId, className, simplify }) => {
        try {
            const session = registry.get(fileId);
            const clazz = findClass(session.pandaFile, className);
            const useSimplify = simplify ?? true;
            const content = useSimplify
                ? session.decompiler.decompileClass(clazz)
                : session.decompiler.decompileClassRaw(clazz);

            if (content.length === 0) {
                return textResult("// 反编译结果为空(该类可能没有 func_main_0 入口或反编译失败)");
            }
            const degraded = content.includes(DEGRADED_MARKER);
            const { text, truncated } = truncateText(content, MAX_DECOMPILE_OUTPUT);
            const header = "// xpanda-mcp class=" + demangleClassName(clazz.name.content)
                + " simplified=" + useSimplify
                + " degraded=" + degraded
                + " chars=" + content.length
                + (truncated ? " TRUNCATED" : "") + "\n";
            return textResult(header + text);
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
